const express = require('express');

const commentsController = require('../controllers/commentsController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.post('/', authenticateToken, commentsController.createComment);
router.get('/', authenticateToken, commentsController.listComments);

module.exports = router;
