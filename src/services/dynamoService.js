const {
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const dynamo = require('../config/dynamo');

const TABLES = {
  TASKS:    process.env.DYNAMODB_TASKS_TABLE,
  PROJECTS: process.env.DYNAMODB_PROJECTS_TABLE,
  COMMENTS: process.env.DYNAMODB_COMMENTS_TABLE,
  AUDITLOG: process.env.DYNAMODB_AUDITLOG_TABLE,
};

function serviceError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ── Update expression builder ──────────────────────────────────────────────────
//
// Aliases every field through ExpressionAttributeNames so DynamoDB reserved
// words (status, name, date, data, …) never cause ValidationException.
//
// Given: { status: 'done', title: 'New title' }
// Produces:
//   UpdateExpression:           "SET #status = :status, #title = :title, #updatedAt = :updatedAt"
//   ExpressionAttributeNames:  { '#status': 'status', '#title': 'title', '#updatedAt': 'updatedAt' }
//   ExpressionAttributeValues: { ':status': 'done', ':title': 'New title', ':updatedAt': '<iso>' }
//
// updatedAt is always injected, overwriting whatever the caller may have supplied.
function buildUpdateExpression(updates) {
  const sets   = [];
  const names  = {};
  const values = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'updatedAt') continue; // injected below
    sets.push(`#${key} = :${key}`);
    names[`#${key}`]  = key;
    values[`:${key}`] = value;
  }

  sets.push('#updatedAt = :updatedAt');
  names['#updatedAt']   = 'updatedAt';
  values[':updatedAt']  = new Date().toISOString();

  return {
    UpdateExpression:           `SET ${sets.join(', ')}`,
    ExpressionAttributeNames:  names,
    ExpressionAttributeValues: values,
  };
}

function paginationParams({ limit, lastKey } = {}) {
  const p = {};
  if (limit)   p.Limit              = limit;
  if (lastKey) p.ExclusiveStartKey  = lastKey;
  return p;
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

async function createTask(taskData) {
  const now  = new Date().toISOString();
  const item = { ...taskData, taskId: uuidv4(), createdAt: now, updatedAt: now };
  try {
    await dynamo.send(new PutCommand({ TableName: TABLES.TASKS, Item: item }));
    return item;
  } catch (err) {
    throw serviceError('TASK_CREATE_FAILED', err.message);
  }
}

async function getTaskById(taskId) {
  try {
    const { Item } = await dynamo.send(
      new GetCommand({ TableName: TABLES.TASKS, Key: { taskId } })
    );
    return Item ?? null;
  } catch (err) {
    throw serviceError('TASK_FETCH_FAILED', err.message);
  }
}

async function getTasksByTeam(teamId, options = {}) {
  try {
    const { Items, LastEvaluatedKey } = await dynamo.send(
      new QueryCommand({
        TableName:                 TABLES.TASKS,
        IndexName:                 'teamId-index',
        KeyConditionExpression:    'teamId = :teamId',
        ExpressionAttributeValues: { ':teamId': teamId },
        ...paginationParams(options),
      })
    );
    return { items: Items, lastKey: LastEvaluatedKey ?? null };
  } catch (err) {
    throw serviceError('TASK_QUERY_FAILED', err.message);
  }
}

async function getAllTasks(options = {}) {
  try {
    const { Items, LastEvaluatedKey } = await dynamo.send(
      new ScanCommand({ TableName: TABLES.TASKS, ...paginationParams(options) })
    );
    return { items: Items, lastKey: LastEvaluatedKey ?? null };
  } catch (err) {
    throw serviceError('TASK_SCAN_FAILED', err.message);
  }
}

async function getTasksByProject(projectId, options = {}) {
  try {
    const { Items, LastEvaluatedKey } = await dynamo.send(
      new QueryCommand({
        TableName:                 TABLES.TASKS,
        IndexName:                 'projectId-index',
        KeyConditionExpression:    'projectId = :projectId',
        ExpressionAttributeValues: { ':projectId': projectId },
        ...paginationParams(options),
      })
    );
    return { items: Items, lastKey: LastEvaluatedKey ?? null };
  } catch (err) {
    throw serviceError('TASK_QUERY_FAILED', err.message);
  }
}

async function updateTask(taskId, updates) {
  const { UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
    buildUpdateExpression(updates);
  try {
    const { Attributes } = await dynamo.send(
      new UpdateCommand({
        TableName:                 TABLES.TASKS,
        Key:                       { taskId },
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues:              'ALL_NEW',
      })
    );
    return Attributes;
  } catch (err) {
    throw serviceError('TASK_UPDATE_FAILED', err.message);
  }
}

async function deleteTask(taskId) {
  try {
    await dynamo.send(new DeleteCommand({ TableName: TABLES.TASKS, Key: { taskId } }));
  } catch (err) {
    throw serviceError('TASK_DELETE_FAILED', err.message);
  }
}

// ── Projects ───────────────────────────────────────────────────────────────────

async function createProject(data) {
  const now  = new Date().toISOString();
  const item = { ...data, projectId: uuidv4(), createdAt: now, updatedAt: now };
  try {
    await dynamo.send(new PutCommand({ TableName: TABLES.PROJECTS, Item: item }));
    return item;
  } catch (err) {
    throw serviceError('PROJECT_CREATE_FAILED', err.message);
  }
}

async function getProjectById(projectId) {
  try {
    const { Item } = await dynamo.send(
      new GetCommand({ TableName: TABLES.PROJECTS, Key: { projectId } })
    );
    return Item ?? null;
  } catch (err) {
    throw serviceError('PROJECT_FETCH_FAILED', err.message);
  }
}

async function getAllProjects() {
  try {
    const { Items } = await dynamo.send(new ScanCommand({ TableName: TABLES.PROJECTS }));
    return Items;
  } catch (err) {
    throw serviceError('PROJECT_SCAN_FAILED', err.message);
  }
}

async function updateProject(projectId, updates) {
  const { UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
    buildUpdateExpression(updates);
  try {
    const { Attributes } = await dynamo.send(
      new UpdateCommand({
        TableName:                 TABLES.PROJECTS,
        Key:                       { projectId },
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues:              'ALL_NEW',
      })
    );
    return Attributes;
  } catch (err) {
    throw serviceError('PROJECT_UPDATE_FAILED', err.message);
  }
}

async function deleteProject(projectId) {
  try {
    await dynamo.send(new DeleteCommand({ TableName: TABLES.PROJECTS, Key: { projectId } }));
  } catch (err) {
    throw serviceError('PROJECT_DELETE_FAILED', err.message);
  }
}

// ── Comments ───────────────────────────────────────────────────────────────────

async function createComment(taskId, data) {
  const item = { ...data, commentId: uuidv4(), taskId, createdAt: new Date().toISOString() };
  try {
    await dynamo.send(new PutCommand({ TableName: TABLES.COMMENTS, Item: item }));
    return item;
  } catch (err) {
    throw serviceError('COMMENT_CREATE_FAILED', err.message);
  }
}

async function getCommentsByTask(taskId) {
  try {
    const { Items } = await dynamo.send(
      new QueryCommand({
        TableName:                 TABLES.COMMENTS,
        IndexName:                 'taskId-index',
        KeyConditionExpression:    'taskId = :taskId',
        ExpressionAttributeValues: { ':taskId': taskId },
        ScanIndexForward:          true, // ascending createdAt (sort key on the GSI)
      })
    );
    return Items;
  } catch (err) {
    throw serviceError('COMMENT_QUERY_FAILED', err.message);
  }
}

// ── Audit Log ──────────────────────────────────────────────────────────────────

async function writeAuditEntry({ taskId, changedBy, fromStatus, toStatus }) {
  const item = {
    logId:      uuidv4(),
    taskId,
    changedBy,
    fromStatus,
    toStatus,
    createdAt:  new Date().toISOString(),
  };
  try {
    await dynamo.send(new PutCommand({ TableName: TABLES.AUDITLOG, Item: item }));
    return item;
  } catch (err) {
    throw serviceError('AUDIT_WRITE_FAILED', err.message);
  }
}

module.exports = {
  // tasks
  createTask,
  getTaskById,
  getTasksByTeam,
  getAllTasks,
  getTasksByProject,
  updateTask,
  deleteTask,
  // projects
  createProject,
  getProjectById,
  getAllProjects,
  updateProject,
  deleteProject,
  // comments
  createComment,
  getCommentsByTask,
  // audit
  writeAuditEntry,
};
