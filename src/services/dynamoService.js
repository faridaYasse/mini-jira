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
  USERS: process.env.DYNAMODB_USERS_TABLE,
  TEAMS: process.env.DYNAMODB_TEAMS_TABLE,
  TASKS: process.env.DYNAMODB_TASKS_TABLE,
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

function buildUpdateExpression(updates) {
  const sets = [];
  const names = {};
  const values = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'updatedAt') continue;

    sets.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = value;
  }

  sets.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = new Date().toISOString();

  return {
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

function paginationParams({ limit, lastKey } = {}) {
  const p = {};

  if (limit) {
    p.Limit = limit;
  }

  if (lastKey) {
    p.ExclusiveStartKey = lastKey;
  }

  return p;
}

// ── Users & Teams ──────────────────────────────────────────────────────────────

async function getUserById(userId) {
  try {
    const { Item } = await dynamo.send(
      new GetCommand({
        TableName: TABLES.USERS,
        Key: { userId },
      })
    );

    return Item ?? null;
  } catch (err) {
    throw serviceError('USER_FETCH_FAILED', err.message);
  }
}

async function getTeamById(teamId) {
  try {
    const { Item } = await dynamo.send(
      new GetCommand({
        TableName: TABLES.TEAMS,
        Key: { teamId },
      })
    );

    return Item ?? null;
  } catch (err) {
    throw serviceError('TEAM_FETCH_FAILED', err.message);
  }
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

async function createTask(taskData) {
  const now = new Date().toISOString();

  const item = {
    ...taskData,
    taskId: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TABLES.TASKS,
        Item: item,
        ConditionExpression: 'attribute_not_exists(taskId)',
      })
    );

    return item;
  } catch (err) {
    throw serviceError('TASK_CREATE_FAILED', err.message);
  }
}

async function getTaskById(taskId) {
  try {
    const { Item } = await dynamo.send(
      new GetCommand({
        TableName: TABLES.TASKS,
        Key: { taskId },
      })
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
        TableName: TABLES.TASKS,
        IndexName: 'teamId-index',
        KeyConditionExpression: 'teamId = :teamId',
        ExpressionAttributeValues: {
          ':teamId': teamId,
        },
        ...paginationParams(options),
      })
    );

    return {
      items: Items || [],
      lastKey: LastEvaluatedKey ?? null,
    };
  } catch (err) {
    throw serviceError('TASK_QUERY_FAILED', err.message);
  }
}

async function getTasksByAssignee(assigneeId, options = {}) {
  try {
    const { Items, LastEvaluatedKey } = await dynamo.send(
      new QueryCommand({
        TableName: TABLES.TASKS,
        IndexName: 'assigneeId-index',
        KeyConditionExpression: 'assigneeId = :assigneeId',
        ExpressionAttributeValues: {
          ':assigneeId': assigneeId,
        },
        ...paginationParams(options),
      })
    );

    return {
      items: Items || [],
      lastKey: LastEvaluatedKey ?? null,
    };
  } catch (err) {
    throw serviceError('TASK_QUERY_FAILED', err.message);
  }
}

async function getAllTasks(options = {}) {
  try {
    const { Items, LastEvaluatedKey } = await dynamo.send(
      new ScanCommand({
        TableName: TABLES.TASKS,
        ...paginationParams(options),
      })
    );

    return {
      items: Items || [],
      lastKey: LastEvaluatedKey ?? null,
    };
  } catch (err) {
    throw serviceError('TASK_SCAN_FAILED', err.message);
  }
}

async function getTasksByProject(projectId, options = {}) {
  try {
    const { Items, LastEvaluatedKey } = await dynamo.send(
      new QueryCommand({
        TableName: TABLES.TASKS,
        IndexName: 'projectId-index',
        KeyConditionExpression: 'projectId = :projectId',
        ExpressionAttributeValues: {
          ':projectId': projectId,
        },
        ...paginationParams(options),
      })
    );

    return {
      items: Items || [],
      lastKey: LastEvaluatedKey ?? null,
    };
  } catch (err) {
    throw serviceError('TASK_QUERY_FAILED', err.message);
  }
}

async function updateTask(taskId, updates) {
  if (!updates || Object.keys(updates).length === 0) {
    throw serviceError('TASK_UPDATE_FAILED', 'No updates provided');
  }

  const {
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  } = buildUpdateExpression(updates);

  try {
    const { Attributes } = await dynamo.send(
      new UpdateCommand({
        TableName: TABLES.TASKS,
        Key: { taskId },
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return Attributes;
  } catch (err) {
    throw serviceError('TASK_UPDATE_FAILED', err.message);
  }
}

async function deleteTask(taskId) {
  try {
    await dynamo.send(
      new DeleteCommand({
        TableName: TABLES.TASKS,
        Key: { taskId },
      })
    );
  } catch (err) {
    throw serviceError('TASK_DELETE_FAILED', err.message);
  }
}

// ── Projects ───────────────────────────────────────────────────────────────────

async function createProject(data) {
  const now = new Date().toISOString();

  const item = {
    ...data,
    projectId: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TABLES.PROJECTS,
        Item: item,
        ConditionExpression: 'attribute_not_exists(projectId)',
      })
    );

    return item;
  } catch (err) {
    throw serviceError('PROJECT_CREATE_FAILED', err.message);
  }
}

async function getProjectById(projectId) {
  try {
    const { Item } = await dynamo.send(
      new GetCommand({
        TableName: TABLES.PROJECTS,
        Key: { projectId },
      })
    );

    return Item ?? null;
  } catch (err) {
    throw serviceError('PROJECT_FETCH_FAILED', err.message);
  }
}

async function getAllProjects() {
  try {
    const { Items } = await dynamo.send(
      new ScanCommand({
        TableName: TABLES.PROJECTS,
      })
    );

    return Items || [];
  } catch (err) {
    throw serviceError('PROJECT_SCAN_FAILED', err.message);
  }
}

async function updateProject(projectId, updates) {
  if (!updates || Object.keys(updates).length === 0) {
    throw serviceError('PROJECT_UPDATE_FAILED', 'No updates provided');
  }

  const {
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  } = buildUpdateExpression(updates);

  try {
    const { Attributes } = await dynamo.send(
      new UpdateCommand({
        TableName: TABLES.PROJECTS,
        Key: { projectId },
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return Attributes;
  } catch (err) {
    throw serviceError('PROJECT_UPDATE_FAILED', err.message);
  }
}

async function deleteProject(projectId) {
  try {
    await dynamo.send(
      new DeleteCommand({
        TableName: TABLES.PROJECTS,
        Key: { projectId },
      })
    );
  } catch (err) {
    throw serviceError('PROJECT_DELETE_FAILED', err.message);
  }
}

// ── Comments ───────────────────────────────────────────────────────────────────

async function createComment(taskId, data) {
  const now = new Date().toISOString();

  const item = {
    ...data,
    commentId: uuidv4(),
    taskId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TABLES.COMMENTS,
        Item: item,
        ConditionExpression: 'attribute_not_exists(commentId)',
      })
    );

    return item;
  } catch (err) {
    throw serviceError('COMMENT_CREATE_FAILED', err.message);
  }
}

async function getCommentsByTask(taskId) {
  try {
    const { Items } = await dynamo.send(
      new QueryCommand({
        TableName: TABLES.COMMENTS,
        IndexName: 'taskId-index',
        KeyConditionExpression: 'taskId = :taskId',
        ExpressionAttributeValues: {
          ':taskId': taskId,
        },
        ScanIndexForward: true,
      })
    );

    return Items || [];
  } catch (err) {
    throw serviceError('COMMENT_QUERY_FAILED', err.message);
  }
}

async function getCommentById(commentId) {
  try {
    const { Item } = await dynamo.send(
      new GetCommand({
        TableName: TABLES.COMMENTS,
        Key: { commentId },
      })
    );

    return Item ?? null;
  } catch (err) {
    throw serviceError('COMMENT_FETCH_FAILED', err.message);
  }
}

async function updateComment(commentId, updates) {
  if (!updates || Object.keys(updates).length === 0) {
    throw serviceError('COMMENT_UPDATE_FAILED', 'No updates provided');
  }

  const {
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  } = buildUpdateExpression(updates);

  try {
    const { Attributes } = await dynamo.send(
      new UpdateCommand({
        TableName: TABLES.COMMENTS,
        Key: { commentId },
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return Attributes;
  } catch (err) {
    throw serviceError('COMMENT_UPDATE_FAILED', err.message);
  }
}

async function deleteComment(commentId) {
  try {
    await dynamo.send(
      new DeleteCommand({
        TableName: TABLES.COMMENTS,
        Key: { commentId },
      })
    );
  } catch (err) {
    throw serviceError('COMMENT_DELETE_FAILED', err.message);
  }
}

// ── Audit Log ──────────────────────────────────────────────────────────────────

async function writeAuditEntry({ taskId, changedBy, fromStatus, toStatus }) {
  return writeAuditLog({
    action: 'status_changed',
    entityType: 'task',
    entityId: taskId,
    userId: changedBy,
    details: {
      oldStatus: fromStatus,
      newStatus: toStatus,
    },
    taskId,
    changedBy,
    fromStatus,
    toStatus,
  });
}

async function writeAuditLog({
  action,
  entityType,
  entityId,
  entityName,
  userId,
  userName,
  details,
  taskId,
  ...extra
}) {
  if (!TABLES.AUDITLOG) {
    return null;
  }

  const logId = uuidv4();
  const resolvedEntityId = entityId || taskId || logId;
  const item = {
    logId,
    id: logId,
    action,
    entityType,
    entityId: resolvedEntityId,
    entityName: entityName || '',
    userId: userId || '',
    userName: userName || '',
    details: details || {},
    taskId: taskId || (entityType === 'task' ? resolvedEntityId : `${entityType || 'log'}#${resolvedEntityId}`),
    createdAt: new Date().toISOString(),
    ...extra,
  };

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TABLES.AUDITLOG,
        Item: item,
      })
    );

    return item;
  } catch (err) {
    throw serviceError('AUDIT_WRITE_FAILED', err.message);
  }
}

async function getAuditLogs({ taskId, limit = 50 } = {}) {
  if (!TABLES.AUDITLOG) {
    return [];
  }

  try {
    const params = {
      TableName: TABLES.AUDITLOG,
    };

    if (taskId) {
      params.FilterExpression = 'taskId = :taskId OR entityId = :taskId';
      params.ExpressionAttributeValues = {
        ':taskId': taskId,
      };
    }

    const { Items } = await dynamo.send(new ScanCommand(params));
    const sorted = (Items || [])
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, limit);

    return sorted.map(normalizeAuditLog);
  } catch (err) {
    throw serviceError('AUDIT_QUERY_FAILED', err.message);
  }
}

function normalizeAuditLog(item) {
  const details = item.details && typeof item.details === 'object'
    ? item.details
    : {
        oldStatus: item.fromStatus || '',
        newStatus: item.toStatus || '',
        assigneeId: item.assigneeId || '',
        teamId: item.teamId || '',
      };

  return {
    id: item.id || item.logId,
    action: item.action || inferAuditAction(item),
    taskId: item.taskId || item.entityId || '',
    entityType: item.entityType || 'task',
    entityId: item.entityId || item.taskId,
    entityName: item.entityName || item.title || '',
    userId: item.userId || item.changedBy || '',
    userName: item.userName || item.changedBy || '',
    createdAt: item.createdAt,
    details,
  };
}

function inferAuditAction(item) {
  if (item.toStatus === 'assigned') return 'assignee_changed';
  if (item.fromStatus || item.toStatus) return 'status_changed';
  return 'activity_recorded';
}

module.exports = {
  // users & teams
  getUserById,
  getTeamById,

  // tasks
  createTask,
  getTaskById,
  getTasksByTeam,
  getTasksByAssignee,
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
  getCommentById,
  updateComment,
  deleteComment,

  // audit
  writeAuditEntry,
  writeAuditLog,
  getAuditLogs,
};
