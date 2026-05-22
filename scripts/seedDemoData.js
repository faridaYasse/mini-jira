require('dotenv').config();

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const dynamo = require('../src/config/dynamo');

const TABLES = {
  USERS: process.env.DYNAMODB_USERS_TABLE,
  TEAMS: process.env.DYNAMODB_TEAMS_TABLE,
  TASKS: process.env.DYNAMODB_TASKS_TABLE,
  PROJECTS: process.env.DYNAMODB_PROJECTS_TABLE,
  COMMENTS: process.env.DYNAMODB_COMMENTS_TABLE,
  AUDITLOG: process.env.DYNAMODB_AUDITLOG_TABLE,
};

const now = new Date();

function isoDays(offset) {
  const date = new Date(now);
  date.setDate(date.getDate() + offset);
  date.setHours(9, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function isoHours(offset) {
  const date = new Date(now);
  date.setHours(date.getHours() + offset);
  return date.toISOString();
}

function requireTables() {
  for (const [key, value] of Object.entries(TABLES)) {
    if (!value) throw new Error(`${key} table env var is not configured`);
  }
}

const teams = [
  { teamId: 'frontend-team', teamName: 'Frontend' },
  { teamId: 'backend-team', teamName: 'Backend' },
  { teamId: 'qa-team', teamName: 'QA' },
  { teamId: 'devops-team', teamName: 'DevOps' },
];

const users = [
  {
    userId: 'demo-sara-frontend',
    name: 'Sara Frontend Demo',
    email: 'demo.sara.frontend@example.com',
    role: 'employee',
    teamId: 'frontend-team',
    status: 'active',
  },
  {
    userId: 'demo-omar-backend',
    name: 'Omar Backend Demo',
    email: 'demo.omar.backend@example.com',
    role: 'employee',
    teamId: 'backend-team',
    status: 'active',
  },
  {
    userId: 'demo-maya-qa',
    name: 'Maya QA Demo',
    email: 'demo.maya.qa@example.com',
    role: 'employee',
    teamId: 'qa-team',
    status: 'active',
  },
  {
    userId: 'demo-youssef-devops',
    name: 'Youssef DevOps Demo',
    email: 'demo.youssef.devops@example.com',
    role: 'employee',
    teamId: 'devops-team',
    status: 'active',
  },
  {
    userId: 'demo-farah-pending',
    name: 'Farah Pending Demo',
    email: 'demo.farah.pending@example.com',
    role: 'pending',
    teamId: '',
    status: 'pending_approval',
  },
];

const projects = [
  {
    projectId: 'demo-project-web-redesign',
    name: 'Website Redesign',
    description: 'Refresh the customer-facing Mini-Jira demo board experience.',
  },
  {
    projectId: 'demo-project-api-hardening',
    name: 'API Hardening',
    description: 'Strengthen backend auth, task APIs, and monitoring readiness.',
  },
  {
    projectId: 'demo-project-mobile-polish',
    name: 'Mobile Polish',
    description: 'Improve responsive UI behavior before the final demo.',
  },
  {
    projectId: 'demo-project-launch-readiness',
    name: 'Launch Readiness',
    description: 'Prepare QA, DevOps, and release checklist tasks.',
  },
];

const taskSeeds = [
  ['demo-task-001', 'Wireframe compact board cards', 'Define the compact card layout for dense task scanning.', 'High', -2, 'frontend-team', 'demo-sara-frontend', 'demo-project-web-redesign', 'To Do'],
  ['demo-task-002', 'Build task detail responsive layout', 'Make the task modal usable on laptop and mobile screens.', 'Urgent', 0, 'frontend-team', 'demo-sara-frontend', 'demo-project-mobile-polish', 'In Progress'],
  ['demo-task-003', 'Add empty states to each column', 'Show clear copy when a Kanban column has no matching tasks.', 'Normal', 2, 'frontend-team', 'demo-sara-frontend', 'demo-project-web-redesign', 'In Review'],
  ['demo-task-004', 'Polish priority badges', 'Tune colors and spacing for priority labels on cards.', 'Low', 6, 'frontend-team', 'demo-sara-frontend', 'demo-project-web-redesign', 'Done'],
  ['demo-task-005', 'Validate pending approval response', 'Return consistent PENDING_APPROVAL payloads from protected routes.', 'Urgent', -1, 'backend-team', 'demo-omar-backend', 'demo-project-api-hardening', 'To Do'],
  ['demo-task-006', 'Sync Cognito users into Users table', 'Keep pending Cognito signups visible in manager member approval.', 'High', 1, 'backend-team', 'demo-omar-backend', 'demo-project-api-hardening', 'In Progress'],
  ['demo-task-007', 'Harden team assignment endpoint', 'Ensure manager approval always assigns role employee and valid team.', 'High', 3, 'backend-team', 'demo-omar-backend', 'demo-project-api-hardening', 'In Review'],
  ['demo-task-008', 'Normalize API errors', 'Return clean messages for frontend toast display.', 'Normal', 8, 'backend-team', 'demo-omar-backend', 'demo-project-api-hardening', 'Done'],
  ['demo-task-009', 'Write auth regression checklist', 'Document signup, pending approval, and team filtering test cases.', 'High', 0, 'qa-team', 'demo-maya-qa', 'demo-project-launch-readiness', 'To Do'],
  ['demo-task-010', 'Test manager all-team visibility', 'Verify manager can view and filter every team on the board.', 'Normal', 2, 'qa-team', 'demo-maya-qa', 'demo-project-launch-readiness', 'In Progress'],
  ['demo-task-011', 'Test employee cross-team blocking', 'Attempt cross-team task access and confirm server-side rejection.', 'Urgent', 4, 'qa-team', 'demo-maya-qa', 'demo-project-api-hardening', 'In Review'],
  ['demo-task-012', 'Close image upload smoke test', 'Upload a sample image and confirm the task stores imageOriginalKey.', 'Low', 7, 'qa-team', 'demo-maya-qa', 'demo-project-mobile-polish', 'Done'],
  ['demo-task-013', 'Configure dashboard widgets', 'Review CloudWatch widgets for API, overdue tasks, and assignments.', 'Normal', -3, 'devops-team', 'demo-youssef-devops', 'demo-project-launch-readiness', 'To Do'],
  ['demo-task-014', 'Check SNS assignment topic', 'Confirm task assignment publishes the expected SNS payload.', 'High', 1, 'devops-team', 'demo-youssef-devops', 'demo-project-launch-readiness', 'In Progress'],
  ['demo-task-015', 'Package Lambda deployment zips', 'Bundle image resize, assignment worker, and daily digest Lambdas.', 'Normal', 5, 'devops-team', 'demo-youssef-devops', 'demo-project-launch-readiness', 'In Review'],
  ['demo-task-016', 'Review S3 lifecycle notes', 'Confirm old image versions are retained until task deletion.', 'Low', 9, 'devops-team', 'demo-youssef-devops', 'demo-project-launch-readiness', 'Done'],
  ['demo-task-017', 'Add manager dashboard counters', 'Show counts for total, status buckets, and overdue work.', 'High', -4, 'frontend-team', 'demo-sara-frontend', 'demo-project-web-redesign', 'To Do'],
  ['demo-task-018', 'Document HA diagram unknowns', 'Mark unavailable VPC, subnet, ALB, and ASG values clearly.', 'Normal', 10, 'backend-team', 'demo-omar-backend', 'demo-project-api-hardening', 'Done'],
  ['demo-task-019', 'Run final mobile viewport pass', 'Check board, modals, filters, and auth pages on narrow screens.', 'High', 1, 'qa-team', 'demo-maya-qa', 'demo-project-mobile-polish', 'In Progress'],
  ['demo-task-020', 'Verify daily digest scan filters', 'Confirm due-today scan excludes tasks already marked Done.', 'Normal', 2, 'devops-team', 'demo-youssef-devops', 'demo-project-launch-readiness', 'To Do'],
];

const tasks = taskSeeds.map(([taskId, title, description, priority, deadlineOffset, teamId, assigneeId, projectId, status], index) => ({
  taskId,
  title,
  description,
  priority,
  deadline: isoDays(deadlineOffset),
  teamId,
  assigneeId,
  projectId,
  status,
  createdAt: isoHours(-240 + index * 3),
  updatedAt: isoHours(-24 + index),
}));

const comments = [
  ['demo-comment-001', 'demo-task-002', 'demo-sara-frontend', 'Modal layout is ready for design review.'],
  ['demo-comment-002', 'demo-task-006', 'demo-omar-backend', 'Sync handles Cognito users that predate the Users table row.'],
  ['demo-comment-003', 'demo-task-009', 'demo-maya-qa', 'Added signup and approval cases to the QA checklist.'],
  ['demo-comment-004', 'demo-task-014', 'demo-youssef-devops', 'SNS topic ARN matches the environment configuration.'],
  ['demo-comment-005', 'demo-task-017', 'demo-sara-frontend', 'Counters should include overdue tasks for demo clarity.'],
  ['demo-comment-006', 'demo-task-011', 'demo-maya-qa', 'Employee cross-team API checks should stay server-side.'],
].map(([commentId, taskId, authorId, content], index) => ({
  commentId,
  taskId,
  authorId,
  content,
  createdAt: isoHours(-12 + index),
  updatedAt: isoHours(-12 + index),
}));

const auditEntries = [
  ['demo-audit-001', 'demo-task-004', 'demo-sara-frontend', 'In Review', 'Done'],
  ['demo-audit-002', 'demo-task-008', 'demo-omar-backend', 'In Review', 'Done'],
  ['demo-audit-003', 'demo-task-012', 'demo-maya-qa', 'In Review', 'Done'],
  ['demo-audit-004', 'demo-task-016', 'demo-youssef-devops', 'In Review', 'Done'],
  ['demo-audit-005', 'demo-task-018', 'demo-omar-backend', 'In Progress', 'Done'],
].map(([logId, taskId, changedBy, fromStatus, toStatus], index) => ({
  logId,
  taskId,
  changedBy,
  fromStatus,
  toStatus,
  createdAt: isoHours(-8 + index),
}));

async function put(tableName, item) {
  await dynamo.send(new PutCommand({ TableName: tableName, Item: item }));
}

async function seed() {
  requireTables();

  const stampedTeams = teams.map((team) => ({
    ...team,
    createdAt: isoHours(-300),
    updatedAt: isoHours(0),
    createdBy: 'seedDemoData',
  }));

  const stampedUsers = users.map((user) => ({
    ...user,
    createdAt: isoHours(-300),
    updatedAt: isoHours(0),
  }));

  const stampedProjects = projects.map((project, index) => ({
    ...project,
    createdBy: 'seedDemoData',
    createdAt: isoHours(-280 + index),
    updatedAt: isoHours(-20 + index),
  }));

  for (const team of stampedTeams) await put(TABLES.TEAMS, team);
  for (const user of stampedUsers) await put(TABLES.USERS, user);
  for (const project of stampedProjects) await put(TABLES.PROJECTS, project);
  for (const task of tasks) await put(TABLES.TASKS, task);
  for (const comment of comments) await put(TABLES.COMMENTS, comment);
  for (const entry of auditEntries) await put(TABLES.AUDITLOG, entry);

  console.log('Seeded demo data:');
  console.log(`  teams: ${stampedTeams.length}`);
  console.log(`  users: ${stampedUsers.length}`);
  console.log(`  projects: ${stampedProjects.length}`);
  console.log(`  tasks: ${tasks.length}`);
  console.log(`  comments: ${comments.length}`);
  console.log(`  audit entries: ${auditEntries.length}`);
}

seed().catch((error) => {
  console.error('Failed to seed demo data:', error);
  process.exit(1);
});
