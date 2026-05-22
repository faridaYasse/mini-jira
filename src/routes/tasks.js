const express = require('express');
const multer = require('multer');

const tasksController = require('../controllers/tasksController');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

router.post('/', authenticateToken, requireRole('manager', 'admin'), upload.single('image'), tasksController.createTask);
router.get('/', authenticateToken, tasksController.listTasks);
router.get('/:taskId/image', authenticateToken, tasksController.getTaskImage);
router.get('/:taskId/history', authenticateToken, tasksController.getTaskHistory);
router.get('/:taskId', authenticateToken, tasksController.getTask);
router.patch('/:taskId', authenticateToken, tasksController.updateTask);
router.delete('/:taskId', authenticateToken, requireRole('manager', 'admin'), tasksController.deleteTask);
router.post('/:taskId/image', authenticateToken, upload.single('image'), tasksController.uploadImage);

module.exports = router;
