require('dotenv').config();

const cors = require('cors');
const express = require('express');
const path = require('path');

const usersRouter = require('./src/routes/users');
const tasksRouter = require('./src/routes/tasks');
const projectsRouter = require('./src/routes/projects');
const commentsRouter = require('./src/routes/comments');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/users', usersRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tasks/:taskId/comments', commentsRouter);

app.use(express.static(path.join(__dirname, 'frontend/dist')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message
    }
  });
});

module.exports = app;