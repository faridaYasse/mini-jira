import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  BarChart3,
  FolderPlus,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createComment,
  assignUserToTeam,
  createEmployee,
  createProject,
  createTeam,
  createTask,
  deleteProject,
  deleteTask,
  getProfile,
  listComments,
  listProjects,
  listTasks,
  listTeams,
  listUsers,
  updateProject,
  updateTask,
  uploadTaskImage,
} from './api.js';
import { getStoredIdToken, loginWithCognito, logout } from './cognito.js';
import { Buffer } from 'buffer';

window.global = window;
window.Buffer = Buffer;

const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const STATUS_META = {
  'To Do': { icon: Clock3, accent: '#287b7a' },
  'In Progress': { icon: Loader2, accent: '#5b6ee1' },
  'In Review': { icon: AlertCircle, accent: '#aa6a16' },
  Done: { icon: CheckCircle2, accent: '#2f7d48' },
};

const EMPTY_TASK = {
  title: '',
  description: '',
  priority: 'Normal',
  deadline: '',
  assigneeId: '',
  teamId: '',
  projectId: '',
  image: null,
};

function normalizeTask(task) {
  return {
    ...task,
    status: STATUSES.includes(task.status) ? task.status : 'To Do',
  };
}

function normalizeList(result) {
  return result?.items || result || [];
}

function decodeUser(token) {
  if (!token) return null;

  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized));

    return {
      userId: decoded.sub,
      role: decoded['custom:role'],
      teamId: decoded['custom:teamId'],
      email: decoded.email,
    };
  } catch {
    return null;
  }
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

function isOverdue(deadline, status) {
  if (!deadline || status === 'Done') return false;
  const due = new Date(deadline);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function getTeamName(teams, teamId) {
  return teams.find((team) => team.teamId === teamId)?.teamName || teamId;
}

function getUserLabel(users, userId) {
  const user = users.find((item) => item.userId === userId);
  return user ? user.name || user.email || user.userId : userId;
}

function getUserId(user) {
  return user.userId;
}

function getUserRole(user) {
  return String(user.role || user['custom:role'] || '').toLowerCase();
}

function getUserTeamId(user) {
  return String(user.teamId || user['custom:teamId'] || '');
}

function getUserDisplayName(user) {
  return user.name || user.email || user.userId;
}

function getEmployeeUsers(users) {
  return users.filter((user) => getUserRole(user) === 'employee' && getUserId(user));
}

function getTeamOptions(teams, users = []) {
  const employeeTeamIds = new Set(
    getEmployeeUsers(users)
      .map((user) => getUserTeamId(user))
      .filter(Boolean)
  );
  const optionsById = new Map();

  teams.forEach((team) => {
    if (!team.teamId) return;

    optionsById.set(team.teamId, {
      teamId: team.teamId,
      teamName: team.teamName || team.name || team.teamId,
    });
  });

  return [...optionsById.values()].sort((a, b) => {
    const aHasUsers = employeeTeamIds.has(String(a.teamId));
    const bHasUsers = employeeTeamIds.has(String(b.teamId));

    if (aHasUsers !== bHasUsers) return aHasUsers ? -1 : 1;
    return String(a.teamName).localeCompare(String(b.teamName));
  });
}

function getAssignableTeamOptions(teams, users = []) {
  const employeeTeamIds = new Set(
    getEmployeeUsers(users)
      .map((user) => getUserTeamId(user))
      .filter(Boolean)
  );

  return getTeamOptions(teams, users).filter((team) =>
    employeeTeamIds.has(String(team.teamId))
  );
}

export default function App() {
  const [idToken, setIdToken] = useState(() => getStoredIdToken());
  const currentUser = useMemo(() => decodeUser(idToken), [idToken]);
  const isManager = String(currentUser?.role || '').toLowerCase() === 'manager';
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [profile, setProfile] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [savingTaskId, setSavingTaskId] = useState(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isMemberManagerOpen, setIsMemberManagerOpen] = useState(false);
  const [isMonitoringOpen, setIsMonitoringOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const assignableTeams = useMemo(() => getAssignableTeamOptions(teams, users), [teams, users]);

  async function loadReferenceData() {
    const [projectResult, teamResult, userResult, profileResult] = await Promise.allSettled([
      listProjects(),
      isManager ? listTeams() : Promise.resolve([]),
      isManager ? listUsers() : Promise.resolve([]),
      getProfile(),
    ]);

    if (projectResult.status === 'fulfilled') {
      setProjects(normalizeList(projectResult.value));
    } else {
      throw projectResult.reason;
    }

    if (teamResult.status === 'fulfilled' && normalizeList(teamResult.value).length) {
      setTeams(normalizeList(teamResult.value));
    }

    if (userResult.status === 'fulfilled') {
      setUsers(normalizeList(userResult.value));
    }

    if (profileResult.status === 'fulfilled') {
      setProfile(profileResult.value?.user || null);
    }
  }

  async function loadBoard() {
    setIsLoading(true);
    setLoadError('');
    try {
      const [taskResult] = await Promise.all([
        listTasks(isManager ? teamFilter : undefined),
        loadReferenceData(),
      ]);
      setTasks(normalizeList(taskResult).map(normalizeTask));
    } catch (error) {
      setLoadError(error.message);
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
  }, [idToken, teamFilter]);

  useEffect(() => {
    function handleSessionExpired() {
      setSessionMessage('Session expired. Please sign in again.');
      setIdToken(null);
      setTasks([]);
      setProjects([]);
      setUsers([]);
      setTeams([]);
      setProfile(null);
    }

    window.addEventListener('mini-jira-session-expired', handleSessionExpired);
    return () => window.removeEventListener('mini-jira-session-expired', handleSessionExpired);
  }, []);

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesSearch =
        !needle ||
        [task.title, task.description, task.assigneeId, task.teamId, task.priority]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      const matchesProject =
        projectFilter === 'all' || task.projectId === projectFilter;
      const matchesPriority =
        priorityFilter === 'all' || String(task.priority || 'Normal') === priorityFilter;
      const matchesAssignee =
        assigneeFilter === 'all' || task.assigneeId === assigneeFilter;
      const matchesStatus =
        statusFilter === 'all' || task.status === statusFilter;
      return matchesSearch && matchesProject && matchesPriority && matchesAssignee && matchesStatus;
    });
  }, [assigneeFilter, priorityFilter, projectFilter, query, statusFilter, tasks]);

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
      const normalized = normalizeTask(updated);
      setTasks((current) =>
        current.map((item) =>
          item.taskId === taskId ? normalized : item
        )
      );
      if (selectedTask?.taskId === taskId) setSelectedTask(normalized);
      toast.success('Task moved');
    } catch (error) {
      setTasks(previousTasks);
      toast.error(error.message);
    } finally {
      setSavingTaskId(null);
    }
  }

  async function handleTaskCreated() {
    setIsTaskModalOpen(false);
    toast.success('Task created');
    await loadBoard();
  }

  async function handleProjectCreated() {
    setIsProjectModalOpen(false);
    toast.success('Project created');
    await loadReferenceData();
  }

  async function handleTeamCreated() {
    setIsTeamModalOpen(false);
    toast.success('Team created');
    await loadReferenceData();
  }

  async function handleUsersChanged() {
    await loadReferenceData();
    await loadBoard();
  }

  async function handleProjectsChanged() {
    await loadReferenceData();
    await loadBoard();
  }

  function handleTaskUpdated(updated) {
    const normalized = normalizeTask(updated);
    setSelectedTask(normalized);
    setTasks((current) =>
      current.map((task) =>
        task.taskId === normalized.taskId ? normalized : task
      )
    );
  }

  async function handleTaskDeleted(taskId) {
    setSelectedTask(null);
    setTasks((current) => current.filter((task) => task.taskId !== taskId));
    toast.success('Task deleted');
    await loadBoard();
  }

  function getProjectName(projectId) {
    return projects.find((project) => project.projectId === projectId)?.name;
  }

  if (!idToken) {
    return (
      <LoginScreen
        message={sessionMessage}
        onLogin={(tokens) => {
          setIdToken(tokens.idToken);
          setSessionMessage('');
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
          {isManager && (
            <>
              <button className="primary-button" onClick={() => setIsTaskModalOpen(true)}>
                <Plus size={17} />
                Create Task
              </button>
              <button className="secondary-button icon-text" onClick={() => setIsTeamModalOpen(true)}>
                <Plus size={17} />
                Team
              </button>
              <button className="secondary-button icon-text" onClick={() => setIsEmployeeModalOpen(true)}>
                <UserPlus size={17} />
                Employee
              </button>
              <button className="secondary-button icon-text" onClick={() => setIsMemberManagerOpen(true)}>
                <UsersRound size={17} />
                Members
              </button>
              <button className="secondary-button icon-text" onClick={() => setIsProjectModalOpen(true)}>
                <FolderPlus size={17} />
                Project
              </button>
              <button className="secondary-button" onClick={() => setIsProjectManagerOpen(true)}>
                Manage Projects
              </button>
            </>
          )}
          <button className="secondary-button icon-text" onClick={() => setIsMonitoringOpen(true)}>
            <BarChart3 size={17} />
            Monitoring
          </button>
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
              setUsers([]);
              setTeams([]);
              setProfile(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="user-strip" aria-label="Signed in user">
        <span>{profile?.email || currentUser?.email || 'Signed in'}</span>
        <strong>{profile?.role || currentUser?.role || 'user'}</strong>
        <span>{getTeamName(teams, profile?.teamId || currentUser?.teamId) || 'No team'}</span>
      </section>

      <section className="toolbar" aria-label="Board controls">
        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
          />
        </label>
        {isManager && (
          <select
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
            aria-label="Filter by team"
          >
            <option value="all">All teams</option>
            {assignableTeams.map((team) => (
              <option key={team.teamId} value={team.teamId}>
                {team.teamName || team.teamId}
              </option>
            ))}
          </select>
        )}
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
        <select
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value)}
          aria-label="Filter by priority"
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>{priority}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        {isManager && (
          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            aria-label="Filter by assignee"
          >
            <option value="all">All assignees</option>
            {getEmployeeUsers(users).map((user) => (
              <option key={getUserId(user)} value={getUserId(user)}>
                {getUserDisplayName(user)}
              </option>
            ))}
          </select>
        )}
      </section>

      {loadError && !isLoading && (
        <ErrorState message={loadError} onRetry={loadBoard} />
      )}

      {isLoading ? (
        <BoardLoading />
      ) : (
        <>
          {!loadError && filteredTasks.length === 0 && (
            <EmptyState
              isManager={isManager}
              query={query}
              onCreateTask={() => setIsTaskModalOpen(true)}
            />
          )}
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
                getAssigneeName={(id) => getUserLabel(users, id)}
                getTeamLabel={(id) => getTeamName(teams, id)}
              />
            ))}
          </section>
        </>
      )}

      <TaskFormModal
        open={isTaskModalOpen}
        onOpenChange={setIsTaskModalOpen}
        projects={projects}
        teams={assignableTeams}
        users={users}
        onCreated={handleTaskCreated}
      />

      <ProjectFormModal
        open={isProjectModalOpen}
        onOpenChange={setIsProjectModalOpen}
        onCreated={handleProjectCreated}
      />

      <TeamFormModal
        open={isTeamModalOpen}
        onOpenChange={setIsTeamModalOpen}
        onCreated={handleTeamCreated}
      />

      <EmployeeFormModal
        open={isEmployeeModalOpen}
        onOpenChange={setIsEmployeeModalOpen}
        teams={teams}
        onCreated={async () => {
          setIsEmployeeModalOpen(false);
          toast.success('Employee created');
          await handleUsersChanged();
        }}
      />

      <MemberManagerModal
        open={isMemberManagerOpen}
        onOpenChange={setIsMemberManagerOpen}
        teams={teams}
        users={users}
        onChanged={handleUsersChanged}
      />

      <MonitoringModal
        open={isMonitoringOpen}
        onOpenChange={setIsMonitoringOpen}
      />

      <ProjectManagerModal
        open={isProjectManagerOpen}
        onOpenChange={setIsProjectManagerOpen}
        projects={projects}
        onChanged={handleProjectsChanged}
      />

      <TaskDetailModal
        task={selectedTask}
        isManager={isManager}
        projects={projects}
        teams={teams}
        users={users}
        projectName={selectedTask ? getProjectName(selectedTask.projectId) : ''}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={handleTaskUpdated}
        onTaskDeleted={handleTaskDeleted}
        onReload={loadBoard}
      />
    </main>
  );
}

function LoginScreen({ message, onLogin }) {
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
        {message && <div className="inline-alert">{message}</div>}
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

function ErrorState({ message, onRetry }) {
  return (
    <section className="empty-state error-state">
      <AlertCircle size={28} />
      <h2>Could not load board</h2>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}>
        <RefreshCw size={17} />
        Retry
      </button>
    </section>
  );
}

function EmptyState({ isManager, query, onCreateTask }) {
  return (
    <section className="empty-state">
      <AlertCircle size={28} />
      <h2>{query ? 'No tasks found' : isManager ? 'No tasks yet' : 'No tasks assigned'}</h2>
      <p>
        {query
          ? 'Try a different search or filter.'
          : isManager
            ? 'No tasks yet. Create your first task.'
            : 'No tasks assigned to your team yet.'}
      </p>
      {isManager && !query && (
        <button className="primary-button" onClick={onCreateTask}>
          <Plus size={17} />
          Create Task
        </button>
      )}
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
  getAssigneeName,
  getTeamLabel,
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
              assigneeName={getAssigneeName(task.assigneeId)}
              teamLabel={getTeamLabel(task.teamId)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  isSaving,
  onOpen,
  onDragStart,
  onDragEnd,
  projectName,
  assigneeName,
  teamLabel,
}) {
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
        {isOverdue(task.deadline, task.status) && <span className="overdue-badge">Overdue</span>}
        {isSaving && <Loader2 className="spin" size={16} />}
      </div>
      <h2>{task.title}</h2>
      <p>{task.description || 'No description provided.'}</p>
      {task.imageUrl && <img src={task.imageUrl} alt="" className="task-thumb" />}
      <footer>
        <span title="Assignee">
          <UserRound size={15} />
          {assigneeName || task.assigneeId || 'Unassigned'}
        </span>
        <span title="Team">{teamLabel || task.teamId || 'No team'}</span>
        <span title="Deadline">
          <CalendarDays size={15} />
          {getDueState(task.deadline)}
        </span>
      </footer>
      {projectName && <div className="project-chip">{projectName}</div>}
    </article>
  );
}

function TaskFormModal({ open, onOpenChange, projects, teams, users, onCreated }) {
  const [form, setForm] = useState(EMPTY_TASK);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState('');
  const employeeUsers = getEmployeeUsers(users);
  const teamOptions = getTeamOptions(teams, users);
  const hasUserOptions = employeeUsers.length > 0;
  const hasTeamOptions = teamOptions.length > 0;
  const selectedTeamId = form.teamId;
  const assignees = selectedTeamId
    ? employeeUsers.filter((user) => getUserTeamId(user) === String(selectedTeamId))
    : [];

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_TASK);
      setPreview('');
    }
  }, [open]);

  function updateField(field, value) {
    setForm((current) => {
      if (field !== 'teamId') {
        return {
          ...current,
          [field]: value,
        };
      }

      const currentAssignee = employeeUsers.find(
        (user) => getUserId(user) === current.assigneeId
      );
      const shouldClearAssignee =
        current.assigneeId &&
        value &&
        getUserTeamId(currentAssignee || {}) !== String(value);

      return {
        ...current,
        teamId: value,
        assigneeId: shouldClearAssignee ? '' : current.assigneeId,
      };
    });
  }

  function handleImageChange(file) {
    updateField('image', file || null);
    setPreview(file ? URL.createObjectURL(file) : '');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await createTask(form);
      await onCreated();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title>Create Task</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close create task">
              <X size={18} />
            </Dialog.Close>
          </header>
          <form className="task-form" onSubmit={handleSubmit}>
            <label>
              Title
              <input required value={form.title} onChange={(event) => updateField('title', event.target.value)} />
            </label>
            <label>
              Description
              <textarea required value={form.description} onChange={(event) => updateField('description', event.target.value)} />
            </label>
            <div className="form-grid">
              <label>
                Priority
                <select value={form.priority} onChange={(event) => updateField('priority', event.target.value)}>
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
              </label>
              <label>
                Deadline
                <input required type="date" value={form.deadline} onChange={(event) => updateField('deadline', event.target.value)} />
              </label>
              <label>
                Team
                <select
                  required
                  value={form.teamId}
                  onChange={(event) => updateField('teamId', event.target.value)}
                  disabled={!hasTeamOptions}
                >
                  <option value="">
                    {hasTeamOptions ? 'Select team' : 'No backend teams found'}
                  </option>
                  {teamOptions.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.teamName || team.teamId}
                    </option>
                  ))}
                </select>
                {!hasTeamOptions && (
                  <span className="form-hint">
                    Create or load teams from the backend before creating a task.
                  </span>
                )}
              </label>
              <label>
                Assignee
                {hasUserOptions ? (
                  <select required value={form.assigneeId} onChange={(event) => updateField('assigneeId', event.target.value)}>
                    <option value="">{selectedTeamId ? 'Select assignee' : 'Select a team first'}</option>
                    {selectedTeamId && assignees.length === 0 && (
                      <option value="" disabled>No users found for this team</option>
                    )}
                    {assignees.map((user) => <option key={getUserId(user)} value={getUserId(user)}>{getUserDisplayName(user)}</option>)}
                  </select>
                ) : (
                  <input required placeholder="assigneeId" value={form.assigneeId} onChange={(event) => updateField('assigneeId', event.target.value)} />
                )}
              </label>
              <label>
                Project
                <select value={form.projectId} onChange={(event) => updateField('projectId', event.target.value)}>
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
                </select>
              </label>
              <label>
                Image
                <input type="file" accept="image/*" onChange={(event) => handleImageChange(event.target.files?.[0])} />
              </label>
            </div>
            {preview && <img src={preview} alt="" className="image-preview" />}
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={isSubmitting || !hasTeamOptions}>
                {isSubmitting ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
                Create Task
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectFormModal({ open, onOpenChange, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await createProject({ name, description });
      await onCreated();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title>Create Project</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close create project">
              <X size={18} />
            </Dialog.Close>
          </header>
          <form className="task-form" onSubmit={handleSubmit}>
            <label>
              Name
              <input required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="spin" size={17} /> : <FolderPlus size={17} />}
                Create Project
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TeamFormModal({ open, onOpenChange, onCreated }) {
  const [teamName, setTeamName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setTeamName('');
  }, [open]);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await createTeam({ teamName });
      await onCreated();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title>Create Team</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close create team">
              <X size={18} />
            </Dialog.Close>
          </header>
          <form className="task-form" onSubmit={handleSubmit}>
            <label>
              Team name
              <input required value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            </label>
            <span className="form-hint">
              The backend generates the teamId and returns it after creation.
            </span>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
                Create Team
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EmployeeFormModal({ open, onOpenChange, teams, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    teamId: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const teamOptions = getTeamOptions(teams);

  useEffect(() => {
    if (!open) {
      setForm({ name: '', email: '', password: '', teamId: '' });
    }
  }, [open]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await createEmployee(form);
      await onCreated();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title>Create Employee</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close create employee">
              <X size={18} />
            </Dialog.Close>
          </header>
          <form className="task-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <label>
                Name
                <input required value={form.name} onChange={(event) => updateField('name', event.target.value)} />
              </label>
              <label>
                Email
                <input required type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} />
              </label>
              <label>
                Temporary password
                <input required type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} />
              </label>
              <label>
                Team
                <select value={form.teamId} onChange={(event) => updateField('teamId', event.target.value)}>
                  <option value="">No team yet</option>
                  {teamOptions.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.teamName || team.teamId}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="form-hint">
              Cognito may require email confirmation before the employee can sign in.
            </span>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="spin" size={17} /> : <UserPlus size={17} />}
                Create Employee
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MemberManagerModal({ open, onOpenChange, teams, users, onChanged }) {
  const employeeUsers = getEmployeeUsers(users);
  const teamOptions = getTeamOptions(teams, users);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const selectedUser = employeeUsers.find((user) => getUserId(user) === selectedUserId);

  useEffect(() => {
    if (!open) {
      setSelectedUserId('');
      setSelectedTeamId('');
    }
  }, [open]);

  async function handleAssign(event) {
    event.preventDefault();
    if (!selectedUser || !selectedTeamId) return;
    setIsSaving(true);

    try {
      await assignUserToTeam(selectedTeamId, {
        userId: getUserId(selectedUser),
        userEmail: selectedUser.email,
      });
      toast.success('Team membership updated');
      await onChanged();
      setSelectedUserId('');
      setSelectedTeamId('');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title>Manage Members</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close manage members">
              <X size={18} />
            </Dialog.Close>
          </header>

          <form className="task-form member-form" onSubmit={handleAssign}>
            <div className="form-grid">
              <label>
                Employee
                <select required value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                  <option value="">Select employee</option>
                  {employeeUsers.map((user) => (
                    <option key={getUserId(user)} value={getUserId(user)}>
                      {getUserDisplayName(user)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Team
                <select required value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                  <option value="">Select team</option>
                  {teamOptions.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.teamName || team.teamId}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={isSaving || !selectedUserId || !selectedTeamId}>
                {isSaving ? <Loader2 className="spin" size={17} /> : <UsersRound size={17} />}
                Assign Team
              </button>
            </div>
          </form>

          {employeeUsers.length === 0 ? (
            <div className="comments-empty">No employee users yet.</div>
          ) : (
            <div className="member-list">
              {employeeUsers.map((user) => (
                <article className="member-row" key={getUserId(user)}>
                  <div>
                    <strong>{getUserDisplayName(user)}</strong>
                    <p>{user.email || getUserId(user)}</p>
                  </div>
                  <span>{getTeamName(teams, getUserTeamId(user)) || 'No team'}</span>
                </article>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectManagerModal({ open, onOpenChange, projects, onChanged }) {
  const [editingProjectId, setEditingProjectId] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(project) {
    setEditingProjectId(project.projectId);
    setForm({
      name: project.name || '',
      description: project.description || '',
    });
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!editingProjectId) return;
    setIsSaving(true);

    try {
      await updateProject(editingProjectId, form);
      toast.success('Project saved');
      setEditingProjectId('');
      setForm({ name: '', description: '' });
      await onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(projectId) {
    if (!window.confirm('Delete this project? Tasks linked to it will keep their projectId.')) return;
    setIsSaving(true);

    try {
      await deleteProject(projectId);
      toast.success('Project deleted');
      if (editingProjectId === projectId) {
        setEditingProjectId('');
        setForm({ name: '', description: '' });
      }
      await onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title>Manage Projects</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close manage projects">
              <X size={18} />
            </Dialog.Close>
          </header>

          {projects.length === 0 ? (
            <div className="comments-empty">No projects yet.</div>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <article className="project-row" key={project.projectId}>
                  <div>
                    <strong>{project.name || 'Untitled project'}</strong>
                    <p>{project.description || project.projectId}</p>
                  </div>
                  <div className="row-actions">
                    <button className="secondary-button" type="button" onClick={() => startEdit(project)}>
                      Edit
                    </button>
                    <button className="danger-button" type="button" onClick={() => handleDelete(project.projectId)} disabled={isSaving}>
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {editingProjectId && (
            <form className="task-form edit-form" onSubmit={handleSave}>
              <h3>Edit Project</h3>
              <label>
                Name
                <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                Description
                <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={isSaving}>
                  {isSaving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
                  Save Project
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MonitoringModal({ open, onOpenChange }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title>Monitoring</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close monitoring">
              <X size={18} />
            </Dialog.Close>
          </header>
          <div className="metric-grid">
            <article>
              <strong>CloudWatch Dashboard</strong>
              <p>infra/member2-monitoring.yml defines the four-widget dashboard.</p>
            </article>
            <article>
              <strong>Overdue Alarm</strong>
              <p>Alarm watches the MiniJira/Tasks OverdueTasks metric and publishes to SNS.</p>
            </article>
            <article>
              <strong>Board Activity</strong>
              <p>Tracks task status changes, comments, and task image uploads.</p>
            </article>
            <article>
              <strong>Assignments</strong>
              <p>Assignment worker metrics feed the notification widget.</p>
            </article>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TaskDetailModal({
  task,
  isManager,
  projects,
  teams,
  users,
  projectName,
  onClose,
  onTaskUpdated,
  onTaskDeleted,
  onReload,
}) {
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const employeeUsers = getEmployeeUsers(users);

  useEffect(() => {
    if (!task?.taskId) return;

    setEditForm({
      title: task.title || '',
      description: task.description || '',
      priority: task.priority || 'Normal',
      deadline: task.deadline || '',
      assigneeId: task.assigneeId || '',
      teamId: task.teamId || '',
      projectId: task.projectId || '',
      status: task.status || 'To Do',
    });
    setImageFile(null);
    setImagePreview('');
    setCommentsError('');
    setIsLoadingComments(true);
    listComments(task.taskId)
      .then((items) => setComments(normalizeList(items)))
      .catch((error) => {
        setCommentsError(error.message);
        toast.error(error.message);
      })
      .finally(() => setIsLoadingComments(false));
  }, [task?.taskId]);

  if (!task) return null;

  const assignees = editForm.teamId
    ? employeeUsers.filter((user) => getUserTeamId(user) === String(editForm.teamId))
    : employeeUsers;
  const editTeamOptions = getAssignableTeamOptions(teams, users);

  function updateEditField(field, value) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleStatusChange(status) {
    try {
      const updated = await updateTask(task.taskId, { status });
      onTaskUpdated(updated);
      toast.success('Task updated');
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const { teamId: _teamId, ...payload } = editForm;
      let updated = await updateTask(task.taskId, payload);
      if (imageFile) {
        updated = await uploadTaskImage(task.taskId, imageFile);
      }
      onTaskUpdated(updated);
      await onReload();
      setImageFile(null);
      setImagePreview('');
      toast.success('Task saved');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this task?')) return;

    setIsSaving(true);
    try {
      await deleteTask(task.taskId);
      await onTaskDeleted(task.taskId);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
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
              {task.imageUrl && <img src={task.imageUrl} alt="" className="detail-image" />}
              <div className="detail-list">
                <span>Priority</span>
                <strong>{task.priority || 'Normal'}</strong>
                <span>Assignee</span>
                <strong>{getUserLabel(users, task.assigneeId) || 'Unassigned'}</strong>
                <span>Deadline</span>
                <strong>{getDueState(task.deadline)}</strong>
                <span>Team</span>
                <strong>{getTeamName(teams, task.teamId) || 'Unknown'}</strong>
                <span>Project</span>
                <strong>{projectName || task.projectId || 'None'}</strong>
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

              {isManager && (
                <form className="task-form edit-form" onSubmit={handleEditSubmit}>
                  <h3>Edit Task</h3>
                  <label>
                    Title
                    <input required value={editForm.title || ''} onChange={(event) => updateEditField('title', event.target.value)} />
                  </label>
                  <label>
                    Description
                    <textarea required value={editForm.description || ''} onChange={(event) => updateEditField('description', event.target.value)} />
                  </label>
                  <div className="form-grid">
                    <label>
                      Priority
                      <select value={editForm.priority || 'Normal'} onChange={(event) => updateEditField('priority', event.target.value)}>
                        {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </select>
                    </label>
                    <label>
                      Deadline
                      <input type="date" value={editForm.deadline || ''} onChange={(event) => updateEditField('deadline', event.target.value)} />
                    </label>
                    <label>
                      Team
                      <select disabled value={editForm.teamId || ''} onChange={(event) => updateEditField('teamId', event.target.value)}>
                        <option value="">No team</option>
                        {editTeamOptions.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName || team.teamId}</option>)}
                      </select>
                    </label>
                    <label>
                      Assignee
                      {employeeUsers.length ? (
                        <select value={editForm.assigneeId || ''} onChange={(event) => updateEditField('assigneeId', event.target.value)}>
                          <option value="">Unassigned</option>
                          {assignees.map((user) => <option key={getUserId(user)} value={getUserId(user)}>{getUserDisplayName(user)}</option>)}
                        </select>
                      ) : (
                        <input value={editForm.assigneeId || ''} onChange={(event) => updateEditField('assigneeId', event.target.value)} />
                      )}
                    </label>
                    <label>
                      Project
                      <select value={editForm.projectId || ''} onChange={(event) => updateEditField('projectId', event.target.value)}>
                        <option value="">No project</option>
                        {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
                      </select>
                    </label>
                    <label>
                      Status
                      <select value={editForm.status || 'To Do'} onChange={(event) => updateEditField('status', event.target.value)}>
                        {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </label>
                    <label>
                      Image
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setImageFile(file);
                          setImagePreview(file ? URL.createObjectURL(file) : '');
                        }}
                      />
                    </label>
                  </div>
                  {imagePreview && <img src={imagePreview} alt="" className="image-preview" />}
                  <div className="form-actions split-actions">
                    <button className="primary-button" type="submit" disabled={isSaving}>
                      {isSaving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
                      Save
                    </button>
                    <button className="danger-button" type="button" onClick={handleDelete} disabled={isSaving}>
                      <Trash2 size={17} />
                      Delete Task
                    </button>
                  </div>
                </form>
              )}
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
              ) : commentsError ? (
                <div className="comments-empty">{commentsError}</div>
              ) : comments.length === 0 ? (
                <div className="comments-empty">No comments yet</div>
              ) : (
                <div className="comments-list">
                  {comments.map((comment) => (
                    <article key={comment.commentId || comment.createdAt} className="comment">
                      <header>
                        <strong>{comment.authorId || 'User'}</strong>
                        {comment.createdAt && <span>{new Date(comment.createdAt).toLocaleString()}</span>}
                      </header>
                      <p>{comment.content}</p>
                    </article>
                  ))}
                </div>
              )}

              <section className="audit-note">
                <h3>History</h3>
                <p>No audit log endpoint is exposed by the backend yet.</p>
              </section>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
