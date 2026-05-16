'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const dynamoService = require('../services/dynamoService');
const s3Service     = require('../services/s3Service');

const sns = new SNSClient({ region: process.env.AWS_REGION });

const ORIGINALS_BUCKET = process.env.S3_ORIGINALS_BUCKET;

// Adds a presigned imageUrl to a task if it has an imageOriginalKey.
// Non-fatal: if presigning fails the task is still returned without the URL.
async function enrichWithImageUrl(task) {
  if (!task?.imageOriginalKey) return task;
  try {
    const imageUrl = await s3Service.getImageUrl(ORIGINALS_BUCKET, task.imageOriginalKey);
    return { ...task, imageUrl };
  } catch {
    return task;
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────────

async function createTask(req, res, next) {
  try {
    const { title, description, priority, deadline, assigneeId, teamId, projectId } = req.body;

    // Create the record first so we have a taskId for the S3 key
    let task = await dynamoService.createTask({
      title, description, priority, deadline, assigneeId, teamId, projectId,
    });

    if (req.file) {
      const imageOriginalKey = await s3Service.uploadImage(
        task.taskId,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );
      task = await dynamoService.updateTask(task.taskId, { imageOriginalKey });
    }

    try {
      await sns.send(new PublishCommand({
        TopicArn: process.env.SNS_TASK_ASSIGNMENT_TOPIC,
        Message:  JSON.stringify({ taskId: task.taskId, assigneeId, teamId, title }),
      }));
    } catch (snsErr) {
      console.error('SNS publish failed for task', task.taskId, snsErr);
    }

    return res.status(201).json(task);
  } catch (err) {
    next(err);
  }
}

async function listTasks(req, res, next) {
  try {
    const options = buildPaginationOptions(req.query);

    let result;
    if (req.user.role === 'manager') {
      result = req.query.teamId
        ? await dynamoService.getTasksByTeam(req.query.teamId, options)
        : await dynamoService.getAllTasks(options);
    } else {
      // Employees are always scoped to their own team — query param is ignored
      result = await dynamoService.getTasksByTeam(req.user.teamId, options);
    }

    const items = await Promise.all(result.items.map(enrichWithImageUrl));
    return res.json({ items, lastKey: result.lastKey });
  } catch (err) {
    next(err);
  }
}

async function getTask(req, res, next) {
  try {
    const task = await dynamoService.getTaskById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (req.user.role === 'employee' && task.teamId !== req.user.teamId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json(await enrichWithImageUrl(task));
  } catch (err) {
    next(err);
  }
}

async function updateTask(req, res, next) {
  try {
    const { taskId } = req.params;

    const task = await dynamoService.getTaskById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (req.user.role === 'employee' && task.teamId !== req.user.teamId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let updates;
    if (req.user.role === 'employee') {
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: 'Employees may only update status' });

      updates = { status };

      // Audit only when the value actually changes
      if (status !== task.status) {
        await dynamoService.writeAuditEntry({
          taskId,
          changedBy:  req.user.userId,
          fromStatus: task.status,
          toStatus:   status,
        });
      }
    } else {
      const { taskId: _id, createdAt: _ca, teamId: _tid, ...safeUpdates } = req.body;
      updates = safeUpdates;
    }

    const updated = await dynamoService.updateTask(taskId, updates);
    return res.json(await enrichWithImageUrl(updated));
  } catch (err) {
    next(err);
  }
}

async function deleteTask(req, res, next) {
  try {
    const { taskId } = req.params;

    const task = await dynamoService.getTaskById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Run both deletes in parallel — neither depends on the other
    await Promise.all([
      dynamoService.deleteTask(taskId),
      s3Service.deleteTaskImages(taskId),
    ]);

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Handles POST /:taskId/image (standalone image upload after task creation)
async function uploadImage(req, res, next) {
  try {
    const { taskId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    const task = await dynamoService.getTaskById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (req.user.role === 'employee' && task.teamId !== req.user.teamId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const imageOriginalKey = await s3Service.uploadImage(
      taskId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
    );

    const updated = await dynamoService.updateTask(taskId, { imageOriginalKey });
    return res.json(await enrichWithImageUrl(updated));
  } catch (err) {
    next(err);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildPaginationOptions({ limit, lastKey } = {}) {
  const opts = {};
  if (limit)   opts.limit   = parseInt(limit, 10);
  if (lastKey) {
    try { opts.lastKey = JSON.parse(lastKey); } catch { /* ignore malformed cursor */ }
  }
  return opts;
}

module.exports = { createTask, listTasks, getTask, updateTask, deleteTask, uploadImage };
