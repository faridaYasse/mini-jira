const express = require('express');

const projectsController = require('../controllers/projectsController');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

router.post('/', authenticateToken, requireRole('manager'), projectsController.createProject);
router.get('/', authenticateToken, projectsController.listProjects);
router.get('/:projectId', authenticateToken, projectsController.getProject);
router.patch('/:projectId', authenticateToken, projectsController.updateProject);
router.delete('/:projectId', authenticateToken, requireRole('manager'), projectsController.deleteProject);

module.exports = router;
