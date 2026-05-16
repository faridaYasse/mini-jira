'use strict';

const dynamoService = require('../services/dynamoService');

// Shared guard: confirms the task exists and enforces team isolation for employees.
// Returns the task on success; sends the error response and returns null on failure.
async function resolveTask(taskId, user, res) {
  const task = await dynamoService.getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return null;
  }
  if (user.role === 'employee' && task.teamId !== user.teamId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return task;
}

async function createComment(req, res, next) {
  try {
    const { taskId } = req.params;

    const task = await resolveTask(taskId, req.user, res);
    if (!task) return;

    const comment = await dynamoService.createComment(taskId, {
      content:  req.body.content,
      authorId: req.user.userId,
    });
    return res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
}

async function listComments(req, res, next) {
  try {
    const { taskId } = req.params;

    const task = await resolveTask(taskId, req.user, res);
    if (!task) return;

    const comments = await dynamoService.getCommentsByTask(taskId);
    return res.json(comments);
  } catch (err) {
    next(err);
  }
}

module.exports = { createComment, listComments };
