import { getStoredIdToken, logout } from './cognito.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

async function publicRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error?.message ||
      payload?.error ||
      `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.code || payload?.error?.code;
    throw error;
  }

  return payload;
}

async function request(path, options = {}) {
  const token = getStoredIdToken();

  if (!token) {
    throw new Error('Please sign in before using the board.');
  }

  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      logout();
      window.dispatchEvent(new CustomEvent('mini-jira-session-expired'));
    }

    const message =
      payload?.message ||
      payload?.error?.message ||
      payload?.error ||
      `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.code || payload?.error?.code;
    throw error;
  }

  return payload;
}

export function listProjects() {
  return request('/api/projects');
}

export function createProject(project) {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify(project),
  });
}

export function updateProject(projectId, project) {
  return request(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(project),
  });
}

export function deleteProject(projectId) {
  return request(`/api/projects/${projectId}`, {
    method: 'DELETE',
  });
}

export function createTeam(team) {
  return request('/api/users/teams', {
    method: 'POST',
    body: JSON.stringify(team),
  });
}

export function createEmployee(user) {
  return request('/api/users/employees', {
    method: 'POST',
    body: JSON.stringify({
      name: user.name,
      email: user.email,
      temporaryPassword: user.temporaryPassword,
      teamId: user.teamId,
      role: 'employee',
    }),
  });
}

export function signUpPendingUser(user) {
  return publicRequest('/api/users/signup', {
    method: 'POST',
    body: JSON.stringify(user),
  });
}

export function assignUserToTeam(teamId, membership) {
  return request(`/api/users/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify(membership),
  });
}

export function listTasks(teamId) {
  const query = teamId && teamId !== 'all' ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return request(`/api/tasks${query}`);
}

export function createTask(taskData) {
  const hasImage = taskData.image instanceof File;

  if (hasImage) {
    const formData = new FormData();
    Object.entries(taskData).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, value);
      }
    });

    return request('/api/tasks', {
      method: 'POST',
      body: formData,
    });
  }

  const { image: _image, ...payload } = taskData;
  return request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateTask(taskId, updates) {
  return request(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function deleteTask(taskId) {
  return request(`/api/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

export function uploadTaskImage(taskId, image) {
  const formData = new FormData();
  formData.append('image', image);

  return request(`/api/tasks/${taskId}/image`, {
    method: 'POST',
    body: formData,
  });
}

export function getTaskImage(taskId) {
  return request(`/api/tasks/${taskId}/image`);
}

export function listTaskHistory(taskId) {
  return request(`/api/tasks/${taskId}/history`);
}

export function listUsers() {
  return request('/api/users');
}

export function listTeams() {
  return request('/api/users/teams');
}

export function getProfile() {
  return request('/api/users/me');
}

export function listComments(taskId) {
  return request(`/api/tasks/${taskId}/comments`);
}

export function createComment(taskId, content) {
  return request(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function listAuditLogs(taskId) {
  const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
  return request(`/api/audit-logs${query}`);
}
