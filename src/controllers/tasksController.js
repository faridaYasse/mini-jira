'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const dynamoService = require('../services/dynamoService');
const s3Service = require('../services/s3Service');

const sns = new SNSClient({
  region: process.env.AWS_REGION || process.env.DYNAMODB_REGION || process.env.COGNITO_REGION,
});

const ORIGINALS_BUCKET = process.env.S3_ORIGINALS_BUCKET;

const ALLOWED_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

function isValidStatus(status) {
  return ALLOWED_STATUSES.includes(status);
}

// Adds a presigned imageUrl to a task if it has an imageOriginalKey.
// Non-fatal: if presigning fails the task is still returned without the URL.
async function enrichWithImageUrl(task) {
  if (!task?.imageOriginalKey) return task;

  try {
    const imageUrl = await s3Service.getImageUrl(
      ORIGINALS_BUCKET,
      task.imageOriginalKey
    );

    return {
      ...task,
      imageUrl,
    };
  } catch {
    return task;
  }
}

// Check if employee can access task team
function canAccessTask(req, task) {
  if (req.user.role === 'manager') return true;
  return task.teamId === req.user.teamId;
}

// Check if employee can modify task
function canModifyTask(req, task) {
  if (req.user.role === 'manager') return true;

  return (
    task.teamId === req.user.teamId &&
    task.assigneeId === req.user.userId
  );
}

// ── Handlers ───────────────────────────────────────────────────────────────────

async function createTask(req, res, next) {
  try {
    const {
      title,
      description,
      priority,
      deadline,
      assigneeId,
      teamId,
      projectId,
    } = req.body;

    if (
      isMissing(title) ||
      isMissing(description) ||
      isMissing(priority) ||
      isMissing(deadline) ||
      isMissing(assigneeId) ||
      isMissing(teamId)
    ) {
      return res.status(400).json({
        error:
          'title, description, priority, deadline, assigneeId, and teamId are required',
      });
    }

    // Check team exists
    const team = await dynamoService.getTeamById(teamId);
    if (!team) {
      return res.status(404).json({
        error: 'Team not found',
      });
    }

    // Check assignee exists
    const assignee = await dynamoService.getUserById(assigneeId);
    if (!assignee) {
      return res.status(404).json({
        error: 'Assignee not found',
      });
    }

    // Check assignee belongs to selected team
    if (assignee.role !== 'employee') {
      return res.status(400).json({
        error: 'Tasks can only be assigned to employees',
      });
    }

    if (assignee.teamId !== teamId) {
      return res.status(400).json({
        error: 'Assignee does not belong to the selected team',
      });
    }

    // Create the task first so we have taskId for the S3 key
    let task = await dynamoService.createTask({
      title,
      description,
      priority,
      deadline,
      assigneeId,
      teamId,
      projectId,
      status: 'To Do',
    });

    if (req.file) {
      if (!ORIGINALS_BUCKET) {
        return res.status(500).json({
          error: 'S3_ORIGINALS_BUCKET is not configured',
        });
      }

      const imageOriginalKey = await s3Service.uploadImage(
        task.taskId,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );

      task = await dynamoService.updateTask(task.taskId, {
        imageOriginalKey,
      });
    }

    if (process.env.SNS_TASK_ASSIGNMENT_TOPIC) {
      try {
        await sns.send(
          new PublishCommand({
            TopicArn: process.env.SNS_TASK_ASSIGNMENT_TOPIC,
            Message: JSON.stringify({
              taskId: task.taskId,
              assigneeId,
              teamId,
              title,
            }),
          })
        );
      } catch (snsErr) {
        console.error('SNS publish failed for task', task.taskId, snsErr);
      }
    } else {
      console.warn('SNS_TASK_ASSIGNMENT_TOPIC is not configured. Skipping SNS publish.');
    }

    return res.status(201).json(task);
  } catch (err) {
    return next(err);
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
      // Employees are always scoped to their own team.
      // Query param is ignored for employees.
      result = await dynamoService.getTasksByTeam(req.user.teamId, options);
    }

    const items = await Promise.all(
      result.items.map(enrichWithImageUrl)
    );

    return res.json({
      items,
      lastKey: result.lastKey,
    });
  } catch (err) {
    return next(err);
  }
}

async function getTask(req, res, next) {
  try {
    const task = await dynamoService.getTaskById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
      });
    }

    if (!canAccessTask(req, task)) {
      return res.status(403).json({
        error: 'Forbidden',
      });
    }

    return res.json(await enrichWithImageUrl(task));
  } catch (err) {
    return next(err);
  }
}

async function updateTask(req, res, next) {
  try {
    const { taskId } = req.params;

    const task = await dynamoService.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
      });
    }

    if (!canAccessTask(req, task)) {
      return res.status(403).json({
        error: 'Forbidden',
      });
    }

    let updates = {};

    if (req.user.role === 'employee') {
      if (!canModifyTask(req, task)) {
        return res.status(403).json({
          error: 'Employees can only update tasks assigned to them',
        });
      }

      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          error: 'Employees may only update status',
        });
      }

      if (!isValidStatus(status)) {
        return res.status(400).json({
          error: 'Invalid status',
          allowedStatuses: ALLOWED_STATUSES,
        });
      }

      updates = {
        status,
      };

      // Audit only when the value actually changes
      if (status !== task.status) {
        await dynamoService.writeAuditEntry({
          taskId,
          changedBy: req.user.userId,
          fromStatus: task.status,
          toStatus: status,
        });
      }
    } else {
      const {
        taskId: _taskId,
        createdAt: _createdAt,
        teamId: _teamId,
        imageOriginalKey: _imageOriginalKey,
        ...safeUpdates
      } = req.body;

      if (safeUpdates.status && !isValidStatus(safeUpdates.status)) {
        return res.status(400).json({
          error: 'Invalid status',
          allowedStatuses: ALLOWED_STATUSES,
        });
      }

      updates = safeUpdates;

      if (updates.status && updates.status !== task.status) {
        await dynamoService.writeAuditEntry({
          taskId,
          changedBy: req.user.userId,
          fromStatus: task.status,
          toStatus: updates.status,
        });
      }
    }

    const updated = await dynamoService.updateTask(taskId, updates);

    return res.json(await enrichWithImageUrl(updated));
  } catch (err) {
    return next(err);
  }
}

async function deleteTask(req, res, next) {
  try {
    const { taskId } = req.params;

    const task = await dynamoService.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
      });
    }

    await Promise.all([
      dynamoService.deleteTask(taskId),
      s3Service.deleteTaskImages(taskId),
    ]);

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

// Handles POST /:taskId/image
async function uploadImage(req, res, next) {
  try {
    const { taskId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided',
      });
    }

    if (!ORIGINALS_BUCKET) {
      return res.status(500).json({
        error: 'S3_ORIGINALS_BUCKET is not configured',
      });
    }

    const task = await dynamoService.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
      });
    }

    if (!canAccessTask(req, task)) {
      return res.status(403).json({
        error: 'Forbidden',
      });
    }

    if (!canModifyTask(req, task)) {
      return res.status(403).json({
        error: 'Employees can only upload images to tasks assigned to them',
      });
    }

    const imageOriginalKey = await s3Service.uploadImage(
      taskId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    const updated = await dynamoService.updateTask(taskId, {
      imageOriginalKey,
    });

    return res.json(await enrichWithImageUrl(updated));
  } catch (err) {
    return next(err);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildPaginationOptions({ limit, lastKey } = {}) {
  const opts = {};

  if (limit) {
    opts.limit = parseInt(limit, 10);
  }

  if (lastKey) {
    try {
      opts.lastKey = JSON.parse(lastKey);
    } catch {
      // ignore malformed cursor
    }
  }

  return opts;
}

module.exports = {
  createTask,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
  uploadImage,
};