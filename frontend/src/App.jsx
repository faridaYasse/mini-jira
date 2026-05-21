import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createComment,
  listComments,
  listProjects,
  listTasks,
  updateTask,
} from './api.js';
import { getStoredIdToken, loginWithCognito, logout } from './cognito.js';
import { Buffer } from "buffer";

window.global = window;
window.Buffer = Buffer;

const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];

const STATUS_META = {
  'To Do': { icon: Clock3, accent: '#287b7a' },
  'In Progress': { icon: Loader2, accent: '#5b6ee1' },
  'In Review': { icon: AlertCircle, accent: '#aa6a16' },
  Done: { icon: CheckCircle2, accent: '#2f7d48' },
};

function normalizeTask(task) {
  return {
    ...task,
    status: STATUSES.includes(task.status) ? task.status : 'To Do',
  };
}

function getDueState(deadline) {
  if (!deadline) return 'No date';
  const due = new Date(deadline);
  if (Number.isNaN(due.getTime())) return deadline;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  if (due < today) return 'Overdue';
  if (due.getTime() === today.getTime()) return 'Due today';
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function App() {
  const [idToken, setIdToken] = useState(() => getStoredIdToken());
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [savingTaskId, setSavingTaskId] = useState(null);

  async function loadBoard() {
    setIsLoading(true);
    try {
      const [taskResult, projectResult] = await Promise.all([
        listTasks(),
        listProjects().catch(() => []),
      ]);
      setTasks((taskResult.items || taskResult || []).map(normalizeTask));
      setProjects(projectResult.items || projectResult || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (idToken) {
      loadBoard();
    } else {
      setIsLoading(false);
    }
  }, [idToken]);

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesSearch =
        !needle ||
        [task.title, task.description, task.assigneeId, task.priority]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      const matchesProject =
        projectFilter === 'all' || task.projectId === projectFilter;
      return matchesSearch && matchesProject;
    });
  }, [projectFilter, query, tasks]);

  const groupedTasks = useMemo(() => {
    return STATUSES.reduce((columns, status) => {
      columns[status] = filteredTasks.filter((task) => task.status === status);
      return columns;
    }, {});
  }, [filteredTasks]);

  async function moveTask(taskId, status) {
    const task = tasks.find((item) => item.taskId === taskId);
    if (!task || task.status === status) return;

    setSavingTaskId(taskId);
    const previousTasks = tasks;
    setTasks((current) =>
      current.map((item) =>
        item.taskId === taskId ? { ...item, status } : item
      )
    );

    try {
      const updated = await updateTask(taskId, { status });
      setTasks((current) =>
        current.map((item) =>
          item.taskId === taskId ? normalizeTask(updated) : item
        )
      );
      toast.success('Task moved');
    } catch (error) {
      setTasks(previousTasks);
      toast.error(error.message);
    } finally {
      setSavingTaskId(null);
    }
  }

  function getProjectName(projectId) {
    return projects.find((project) => project.projectId === projectId)?.name;
  }

  if (!idToken) {
    return (
      <LoginScreen
        onLogin={(tokens) => {
          setIdToken(tokens.idToken);
          toast.success('Signed in');
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Member 2 workspace</p>
          <h1>Mini Jira Board</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={loadBoard} aria-label="Refresh board">
            <RefreshCw size={18} />
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              logout();
              setIdToken(null);
              setTasks([]);
              setProjects([]);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="toolbar" aria-label="Board controls">
        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
          />
        </label>
        <select
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
          aria-label="Filter by project"
        >
          <option value="all">All projects</option>
          {projects.map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
        </select>
      </section>

      {isLoading ? (
        <BoardLoading />
      ) : filteredTasks.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <section className="board" aria-label="Kanban board">
          {STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={groupedTasks[status]}
              onDropTask={moveTask}
              onOpenTask={setSelectedTask}
              draggedTaskId={draggedTaskId}
              setDraggedTaskId={setDraggedTaskId}
              savingTaskId={savingTaskId}
              getProjectName={getProjectName}
            />
          ))}
        </section>
      )}

      <TaskDetailModal
        task={selectedTask}
        projectName={selectedTask ? getProjectName(selectedTask.projectId) : ''}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={(updated) => {
          const normalized = normalizeTask(updated);
          setSelectedTask(normalized);
          setTasks((current) =>
            current.map((task) =>
              task.taskId === normalized.taskId ? normalized : task
            )
          );
        }}
      />
    </main>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    setIsSubmitting(true);
    try {
      const tokens = await loginWithCognito(email.trim(), password);
      onLogin(tokens);
    } catch (error) {
      toast.error(error.message || 'Unable to sign in');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Mini Jira</p>
          <h1>Sign in</h1>
        </div>
        <label>
          Email
          <input
            autoComplete="username"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

function BoardLoading() {
  return (
    <section className="board board-loading" aria-label="Loading board">
      {STATUSES.map((status) => (
        <div className="column" key={status}>
          <div className="column-heading skeleton skeleton-heading" />
          {[1, 2, 3].map((item) => (
            <div className="task-card skeleton-card" key={item}>
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function EmptyState({ query }) {
  return (
    <section className="empty-state">
      <AlertCircle size={28} />
      <h2>No tasks found</h2>
      <p>{query ? 'Try a different search.' : 'Tasks will appear here when the API returns them.'}</p>
    </section>
  );
}

function KanbanColumn({
  status,
  tasks,
  onDropTask,
  onOpenTask,
  draggedTaskId,
  setDraggedTaskId,
  savingTaskId,
  getProjectName,
}) {
  const Icon = STATUS_META[status].icon;

  return (
    <section
      className={`column ${draggedTaskId ? 'drop-ready' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const taskId = event.dataTransfer.getData('text/plain');
        setDraggedTaskId(null);
        onDropTask(taskId, status);
      }}
      style={{ '--accent': STATUS_META[status].accent }}
    >
      <header className="column-heading">
        <span>
          <Icon size={17} />
          {status}
        </span>
        <strong>{tasks.length}</strong>
      </header>

      <div className="task-stack">
        {tasks.length === 0 ? (
          <div className="column-empty">No tasks</div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.taskId}
              task={task}
              isSaving={savingTaskId === task.taskId}
              onOpen={() => onOpenTask(task)}
              onDragStart={() => setDraggedTaskId(task.taskId)}
              onDragEnd={() => setDraggedTaskId(null)}
              projectName={getProjectName(task.projectId)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TaskCard({ task, isSaving, onOpen, onDragStart, onDragEnd, projectName }) {
  return (
    <article
      className="task-card"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.taskId);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen();
      }}
    >
      <div className="card-topline">
        <span className={`priority ${String(task.priority || 'normal').toLowerCase()}`}>
          {task.priority || 'Normal'}
        </span>
        {isSaving && <Loader2 className="spin" size={16} />}
      </div>
      <h2>{task.title}</h2>
      <p>{task.description || 'No description provided.'}</p>
      {task.imageUrl && <img src={task.imageUrl} alt="" className="task-thumb" />}
      <footer>
        <span title="Assignee">
          <UserRound size={15} />
          {task.assigneeId || 'Unassigned'}
        </span>
        <span title="Deadline">
          <CalendarDays size={15} />
          {getDueState(task.deadline)}
        </span>
      </footer>
      {projectName && <div className="project-chip">{projectName}</div>}
    </article>
  );
}

function TaskDetailModal({ task, projectName, onClose, onTaskUpdated }) {
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  useEffect(() => {
    if (!task?.taskId) return;

    setIsLoadingComments(true);
    listComments(task.taskId)
      .then((items) => setComments(items.items || items || []))
      .catch((error) => toast.error(error.message))
      .finally(() => setIsLoadingComments(false));
  }, [task?.taskId]);

  async function handleStatusChange(status) {
    try {
      const updated = await updateTask(task.taskId, { status });
      onTaskUpdated(updated);
      toast.success('Task updated');
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    const content = commentText.trim();
    if (!content) return;

    setIsPosting(true);
    try {
      const created = await createComment(task.taskId, content);
      setComments((current) => [created, ...current]);
      setCommentText('');
      toast.success('Comment added');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <Dialog.Root open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby={undefined}>
          {task && (
            <>
              <header className="modal-header">
                <div>
                  <Dialog.Title>{task.title}</Dialog.Title>
                  <p>{projectName || task.projectId || 'No project linked'}</p>
                </div>
                <Dialog.Close className="icon-button" aria-label="Close task details">
                  <X size={18} />
                </Dialog.Close>
              </header>

              <div className="modal-grid">
                <section>
                  <h3>Details</h3>
                  <p className="description">{task.description || 'No description provided.'}</p>
                  {task.imageUrl && <img src={task.imageUrl} alt="" className="detail-image" />}
                  <div className="detail-list">
                    <span>Priority</span>
                    <strong>{task.priority || 'Normal'}</strong>
                    <span>Assignee</span>
                    <strong>{task.assigneeId || 'Unassigned'}</strong>
                    <span>Deadline</span>
                    <strong>{getDueState(task.deadline)}</strong>
                    <span>Team</span>
                    <strong>{task.teamId || 'Unknown'}</strong>
                  </div>

                  <div className="status-picker" aria-label="Change task status">
                    {STATUSES.map((status) => (
                      <button
                        key={status}
                        className={task.status === status ? 'active' : ''}
                        onClick={() => handleStatusChange(status)}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>
                    <MessageSquare size={18} />
                    Comments
                  </h3>
                  <form className="comment-form" onSubmit={handleCommentSubmit}>
                    <textarea
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder="Add a comment"
                      rows={4}
                    />
                    <button type="submit" disabled={isPosting || !commentText.trim()}>
                      {isPosting ? 'Posting...' : 'Comment'}
                    </button>
                  </form>

                  {isLoadingComments ? (
                    <div className="comments-loading">
                      <Loader2 className="spin" size={18} />
                      Loading comments
                    </div>
                  ) : comments.length === 0 ? (
                    <div className="comments-empty">No comments yet</div>
                  ) : (
                    <div className="comments-list">
                      {comments.map((comment) => (
                        <article key={comment.commentId || comment.createdAt} className="comment">
                          <strong>{comment.authorId || 'User'}</strong>
                          <p>{comment.content}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
