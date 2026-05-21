import { getStoredIdToken, logout } from './cognito.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const token = getStoredIdToken();

  if (!token) {
    throw new Error('Please sign in before using the board.');
  }

  const headers = {
    'Content-Type': 'application/json',
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
    }

    const message =
      payload?.error?.message ||
      payload?.error ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export function listProjects() {
  return request('/api/projects');
}

export function listTasks() {
  return request('/api/tasks');
}

export function updateTask(taskId, updates) {
  return request(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
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
