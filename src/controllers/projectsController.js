'use strict';

const dynamoService = require('../services/dynamoService');

async function createProject(req, res, next) {
  try {
    const { name, description } = req.body;
    const project = await dynamoService.createProject({
      name,
      description,
      createdBy: req.user.userId,
    });
    return res.status(201).json(project);
  } catch (err) {
    next(err);
  }
}

async function listProjects(req, res, next) {
  try {
    const projects = await dynamoService.getAllProjects();
    return res.json(projects);
  } catch (err) {
    next(err);
  }
}

async function getProject(req, res, next) {
  try {
    const project = await dynamoService.getProjectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    return res.json(project);
  } catch (err) {
    next(err);
  }
}

async function updateProject(req, res, next) {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { projectId } = req.params;
    const project = await dynamoService.getProjectById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const updated = await dynamoService.updateProject(projectId, req.body);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function deleteProject(req, res, next) {
  try {
    const { projectId } = req.params;
    const project = await dynamoService.getProjectById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await dynamoService.deleteProject(projectId);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { createProject, listProjects, getProject, updateProject, deleteProject };
