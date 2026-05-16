'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockHeader(user) {
  return JSON.stringify(user);
}

async function api(fetch, method, path, { user, body } = {}) {
  const headers = { 'x-mock-user': mockHeader(user) };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json;
  try { json = await res.json(); } catch { json = null; }

  return { status: res.status, body: json };
}

const USERS = {
  ali:  { userId: 'ali-1',  role: 'manager',  teamId: null },
  sara: { userId: 'sara-1', role: 'employee', teamId: 'frontend' },
  omar: { userId: 'omar-1', role: 'employee', teamId: 'backend' },
};

// ── Assertion runner ───────────────────────────────────────────────────────────

const results = [];

function assert(label, condition) {
  const pass = Boolean(condition);
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}`);
  return pass;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

async function run() {
  // node-fetch v3 is ESM-only; dynamic import lets this file stay CommonJS
  const { default: fetch } = await import('node-fetch');

  let taskAId, taskBId;

  // ── 1. Manager creates Task A (frontend) ───────────────────────────────────
  {
    const { status, body } = await api(fetch, 'POST', '/api/tasks', {
      user: USERS.ali,
      body: {
        title:       'Task A',
        assigneeId:  'sara-1',
        teamId:      'frontend',
        projectId:   'proj-1',
        priority:    'High',
        deadline:    '2026-06-01',
        description: 'test',
      },
    });

    if (assert('1. createTask A — status 201', status === 201)) {
      taskAId = body?.taskId;
      assert('1. createTask A — taskId returned', Boolean(taskAId));
    } else {
      console.error('   response:', body);
    }
  }

  // ── 2. Manager creates Task B (backend) ────────────────────────────────────
  {
    const { status, body } = await api(fetch, 'POST', '/api/tasks', {
      user: USERS.ali,
      body: {
        title:       'Task B',
        assigneeId:  'omar-1',
        teamId:      'backend',
        projectId:   'proj-1',
        priority:    'High',
        deadline:    '2026-06-01',
        description: 'test',
      },
    });

    if (assert('2. createTask B — status 201', status === 201)) {
      taskBId = body?.taskId;
      assert('2. createTask B — taskId returned', Boolean(taskBId));
    } else {
      console.error('   response:', body);
    }
  }

  if (!taskAId || !taskBId) {
    console.error('\nCannot continue — task creation failed. Exiting.');
    process.exit(1);
  }

  // ── 3. Sara (frontend) lists tasks ────────────────────────────────────────
  {
    const { status, body } = await api(fetch, 'GET', '/api/tasks', { user: USERS.sara });
    const ids = (body?.items ?? []).map((t) => t.taskId);

    assert('3. Sara listTasks — status 200',          status === 200);
    assert('3. Sara listTasks — sees Task A',          ids.includes(taskAId));
    assert('3. Sara listTasks — does NOT see Task B',  !ids.includes(taskBId));
  }

  // ── 4. Omar (backend) lists tasks ─────────────────────────────────────────
  {
    const { status, body } = await api(fetch, 'GET', '/api/tasks', { user: USERS.omar });
    const ids = (body?.items ?? []).map((t) => t.taskId);

    assert('4. Omar listTasks — status 200',          status === 200);
    assert('4. Omar listTasks — sees Task B',          ids.includes(taskBId));
    assert('4. Omar listTasks — does NOT see Task A',  !ids.includes(taskAId));
  }

  // ── 5. Omar tries to access Task A (cross-team) ───────────────────────────
  {
    const { status } = await api(fetch, 'GET', `/api/tasks/${taskAId}`, { user: USERS.omar });
    assert('5. Omar getTask A — status 403', status === 403);
  }

  // ── 6. Ali (manager) lists all tasks ──────────────────────────────────────
  {
    const { status, body } = await api(fetch, 'GET', '/api/tasks', { user: USERS.ali });
    const ids = (body?.items ?? []).map((t) => t.taskId);

    assert('6. Ali listTasks — status 200',      status === 200);
    assert('6. Ali listTasks — sees Task A',      ids.includes(taskAId));
    assert('6. Ali listTasks — sees Task B',      ids.includes(taskBId));
  }

  // ── 7. Ali lists tasks filtered by teamId=frontend ────────────────────────
  {
    const { status, body } = await api(fetch, 'GET', '/api/tasks?teamId=frontend', { user: USERS.ali });
    const ids = (body?.items ?? []).map((t) => t.taskId);

    assert('7. Ali listTasks?teamId=frontend — status 200',         status === 200);
    assert('7. Ali listTasks?teamId=frontend — sees Task A',         ids.includes(taskAId));
    assert('7. Ali listTasks?teamId=frontend — does NOT see Task B', !ids.includes(taskBId));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  const failed = results.filter((r) => !r.pass);
  const total  = results.length;
  console.log(`Results: ${total - failed.length}/${total} passed`);

  if (failed.length > 0) {
    console.log('Failed assertions:');
    for (const r of failed) console.log(`  • ${r.label}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
