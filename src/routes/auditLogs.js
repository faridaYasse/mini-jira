const express = require('express');

const dynamoService = require('../services/dynamoService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 50;
    const taskId = req.query.taskId ? String(req.query.taskId) : '';
    const logs = await dynamoService.getAuditLogs({
      taskId,
      limit: Math.min(Math.max(limit, 1), 100),
    });

    if (['manager', 'admin'].includes(req.user.role)) {
      return res.json(logs);
    }

    const visibleLogs = [];

    for (const log of logs) {
      if (log.entityType !== 'task' || !log.entityId) continue;

      const task = await dynamoService.getTaskById(log.entityId);
      if (task && task.teamId === req.user.teamId) {
        visibleLogs.push(log);
      }
    }

    return res.json(visibleLogs);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
