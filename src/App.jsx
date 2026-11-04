
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import {
  getLocalTasks,
  saveLocalTask,
  deleteLocalTask,
  addToSyncQueue,
  getSyncQueue,
  removeFromSyncQueue,
} from './lib/db'
import './App.css'

const isLocalTask = (id) =>
  typeof id === 'string' && id.startsWith('local-')

const createLocalId = () =>
  `local-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tasksLoading, setTasksLoading] = useState(false)

  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)

  const [tasks, setTasks] = useState([])
  const [taskInput, setTaskInput] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [deadline, setDeadline] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('react-todo-theme') === 'dark'
  )

  const [taskError, setTaskError] = useState('')
  const [taskSubmitting, setTaskSubmitting] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  const syncInProgress = useRef(false)

  // --------------------------------------------------
  // Authentication session
  // --------------------------------------------------

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      const { data, error } = await supabase.auth.getSession()

      if (!mounted) return

      if (error) {
        setAuthError(error.message)
      }

      setUser(data.session?.user ?? null)
      setAuthLoading(false)
    }

    checkSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)

      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('reset')
        setAuthMessage('')
        setAuthError('')
      }

      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // --------------------------------------------------
  // Theme preference
  // --------------------------------------------------

  useEffect(() => {
    localStorage.setItem(
      'react-todo-theme',
      darkMode ? 'dark' : 'light'
    )
  }, [darkMode])

  // --------------------------------------------------
  // Sync pending local changes with Supabase
  // --------------------------------------------------

  const syncPendingOperations = useCallback(async () => {
    if (!user || !navigator.onLine || syncInProgress.current) {
      return
    }

    syncInProgress.current = true
    setSyncing(true)

    try {
      const queue = await getSyncQueue(user.id)

      for (const operation of queue) {
        let syncError = null

        if (operation.type === 'upsert') {
          const task = operation.task

          const taskData = {
            user_id: user.id,
            title: task.title,
            priority: task.priority,
            deadline: task.deadline || null,
            completed: task.completed,
          }

          if (isLocalTask(operation.task_id)) {
            // New offline task: let Supabase generate its own ID.
            const { data, error } = await supabase
              .from('tasks')
              .insert(taskData)
              .select()
              .single()

            syncError = error

            if (!error && data) {
              await deleteLocalTask(operation.task_id)
              await saveLocalTask(data)

              setTasks((current) =>
                current.map((item) =>
                  item.id === operation.task_id ? data : item
                )
              )
            }
          } else {
            // Existing cloud task: update it.
            const { data, error } = await supabase
              .from('tasks')
              .update(taskData)
              .eq('id', operation.task_id)
              .eq('user_id', user.id)
              .select()
              .maybeSingle()

            syncError = error

            if (!error && data) {
              await saveLocalTask(data)

              setTasks((current) =>
                current.map((item) =>
                  item.id === operation.task_id ? data : item
                )
              )
            }

            if (!error && !data) {
              syncError = new Error(
                'Task was not found in the cloud. The pending change was kept.'
              )
            }
          }
        }

        if (operation.type === 'delete') {
          if (!isLocalTask(operation.task_id)) {
            const { error } = await supabase
              .from('tasks')
              .delete()
              .eq('id', operation.task_id)
              .eq('user_id', user.id)

            syncError = error
          }
        }

        // Keep failed operations in the queue for a later retry.
        if (syncError) {
          console.error('Sync failed:', syncError)
          break
        }

        await removeFromSyncQueue(operation.queueId)
      }

      const remaining = await getSyncQueue(user.id)
      setPendingSyncCount(remaining.length)
    } catch (error) {
      console.error('Sync error:', error)
    } finally {
      syncInProgress.current = false
      setSyncing(false)
    }
  }, [user])

  // --------------------------------------------------
  // Load local tasks and cloud tasks
  // --------------------------------------------------

  useEffect(() => {
    if (!user) {
      setTasks([])
      setPendingSyncCount(0)
      return
    }

    let active = true

    async function loadTasks() {
      setTasksLoading(true)
      setTaskError('')

      try {
        // Always load this user's local tasks first.
        const localTasks = await getLocalTasks(user.id)

        if (!active) return

        if (!navigator.onLine) {
          setTasks(localTasks)
          const queue = await getSyncQueue(user.id)
          setPendingSyncCount(queue.length)
          setTasksLoading(false)
          return
        }

        // Then get the latest cloud data.
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })

        if (!active) return

        if (error) {
          // If the cloud request fails, continue with local data.
          setTasks(localTasks)
          setTaskError(
            `Could not connect to cloud. Showing local tasks: ${error.message}`
          )

          const queue = await getSyncQueue(user.id)
          setPendingSyncCount(queue.length)
          setTasksLoading(false)
          return
        }

        const queue = await getSyncQueue(user.id)

        const pendingUpserts = new Map()
        const pendingDeletes = new Set()

        queue.forEach((operation) => {
          if (operation.type === 'upsert') {
            pendingUpserts.set(
              String(operation.task_id),
              operation.task
            )
            pendingDeletes.delete(String(operation.task_id))
          }

          if (operation.type === 'delete') {
            pendingDeletes.add(String(operation.task_id))
            pendingUpserts.delete(String(operation.task_id))
          }
        })

        // Cache the latest cloud tasks locally.
        for (const cloudTask of data ?? []) {
          await saveLocalTask(cloudTask)
        }

        const mergedTasks = new Map()

        ;(data ?? []).forEach((task) => {
          mergedTasks.set(String(task.id), task)
        })

        // Apply pending local changes on top of cloud data.
        pendingDeletes.forEach((id) => {
          mergedTasks.delete(id)
        })

        pendingUpserts.forEach((task, id) => {
          mergedTasks.set(id, task)
        })

        if (!active) return

        setTasks(Array.from(mergedTasks.values()))
        setPendingSyncCount(queue.length)

        setTasksLoading(false)

        // Try syncing any pending changes.
        syncPendingOperations()
      } catch (error) {
        console.error('Task loading error:', error)

        if (active) {
          setTaskError(`Could not load tasks: ${error.message}`)
          setTasksLoading(false)
        }
      }
    }

    loadTasks()

    return () => {
      active = false
    }
  }, [user?.id, syncPendingOperations])

  // --------------------------------------------------
  // Keep the app updated when internet changes
  // --------------------------------------------------

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)

      if (user) {
        syncPendingOperations()
      }
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        user
      ) {
        syncPendingOperations()
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener(
        'visibilitychange',
        handleVisibility
      )
    }
  }, [user, syncPendingOperations])

  // --------------------------------------------------
  // Add or replace a pending operation for one task
  // --------------------------------------------------

  async function queueTaskUpsert(task) {
    const existing = await getSyncQueue(user.id)

    // Coalesce changes so an offline add followed by edits
    // becomes one latest upsert operation.
    for (const operation of existing) {
      if (String(operation.task_id) === String(task.id)) {
        await removeFromSyncQueue(operation.queueId)
      }
    }

    await addToSyncQueue({
      user_id: user.id,
      task_id: task.id,
      type: 'upsert',
      task,
    })

    const updatedQueue = await getSyncQueue(user.id)
    setPendingSyncCount(updatedQueue.length)
  }

  async function queueTaskDelete(taskId) {
    const existing = await getSyncQueue(user.id)

    for (const operation of existing) {
      if (String(operation.task_id) === String(taskId)) {
        await removeFromSyncQueue(operation.queueId)
      }
    }

    // A local-only task has never been inserted into Supabase.
    // Deleting it locally is enough.
    if (!isLocalTask(taskId)) {
      await addToSyncQueue({
        user_id: user.id,
        task_id: taskId,
        type: 'delete',
      })
    }

    const updatedQueue = await getSyncQueue(user.id)
    setPendingSyncCount(updatedQueue.length)
  }

  // --------------------------------------------------
  // Login and Signup
  // --------------------------------------------------

  async function handleAuth(e) {
    e.preventDefault()
    setAuthMessage('')
    setAuthError('')

    const cleanEmail = email.trim()

    if (!cleanEmail || !password) {
      setAuthError('Please enter your email and password.')
      return
    }

    if (password.length < 6) {
      setAuthError('Password must contain at least 6 characters.')
      return
    }

    setAuthSubmitting(true)

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        })

        if (error) throw error

        if (data.session) {
          setAuthMessage('Account created successfully!')
        } else {
          setAuthMessage(
            'Account created! Please check your email and confirm your account before logging in.'
          )
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })

        if (error) throw error
      }
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthSubmitting(false)
    }
  }

  // --------------------------------------------------
  // Forgot Password
  // --------------------------------------------------

  async function handleForgotPassword(e) {
    e.preventDefault()
    setAuthMessage('')
    setAuthError('')

    const cleanEmail = email.trim()

    if (!cleanEmail) {
      setAuthError('Please enter your email address.')
      return
    }

    setAuthSubmitting(true)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        {
          redirectTo: window.location.origin,
        }
      )

      if (error) throw error

      setAuthMessage(
        'Password reset link sent! Please check your email.'
      )
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthSubmitting(false)
    }
  }

  // --------------------------------------------------
  // Reset Password
  // --------------------------------------------------

  async function handleResetPassword(e) {
    e.preventDefault()
    setAuthMessage('')
    setAuthError('')

    if (newPassword.length < 6) {
      setAuthError('Password must contain at least 6 characters.')
      return
    }

    setAuthSubmitting(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) throw error

      await supabase.auth.signOut()

      setNewPassword('')
      setPassword('')
      setAuthMode('login')
      setAuthMessage(
        'Password updated successfully! Please login with your new password.'
      )
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthSubmitting(false)
    }
  }

  // --------------------------------------------------
  // Logout
  // --------------------------------------------------

  async function handleLogout() {
    setAuthError('')

    const { error } = await supabase.auth.signOut()

    if (error) {
      setAuthError(error.message)
    }
  }

  // --------------------------------------------------
  // Add task - works online and offline
  // --------------------------------------------------

  async function addTask(e) {
    e.preventDefault()

    const title = taskInput.trim()

    if (!title || !user || taskSubmitting) return

    setTaskSubmitting(true)
    setTaskError('')

    try {
      const newTask = {
        id: createLocalId(),
        user_id: user.id,
        title,
        priority,
        deadline: deadline || null,
        completed: false,
        created_at: new Date().toISOString(),
      }

      // Save locally first.
      await saveLocalTask(newTask)
      await queueTaskUpsert(newTask)

      setTasks((current) => [newTask, ...current])

      setTaskInput('')
      setPriority('Medium')
      setDeadline('')

      // If online, sync immediately.
      if (navigator.onLine) {
        await syncPendingOperations()
      }
    } catch (error) {
      setTaskError(`Could not save task locally: ${error.message}`)
    } finally {
      setTaskSubmitting(false)
    }
  }

  // --------------------------------------------------
  // Toggle task completion - online and offline
  // --------------------------------------------------

  async function toggleTask(id) {
    const task = tasks.find((item) => item.id === id)

    if (!task || !user) return

    setTaskError('')

    try {
      const updatedTask = {
        ...task,
        completed: !task.completed,
      }

      await saveLocalTask(updatedTask)
      await queueTaskUpsert(updatedTask)

      setTasks((current) =>
        current.map((item) => (item.id === id ? updatedTask : item))
      )

      if (navigator.onLine) {
        await syncPendingOperations()
      }
    } catch (error) {
      setTaskError(`Could not update task: ${error.message}`)
    }
  }

  // --------------------------------------------------
  // Delete task - online and offline
  // --------------------------------------------------

  async function deleteTask(id) {
    if (!user) return

    setTaskError('')

    try {
      await deleteLocalTask(id)
      await queueTaskDelete(id)

      setTasks((current) =>
        current.filter((task) => task.id !== id)
      )

      if (navigator.onLine) {
        await syncPendingOperations()
      }
    } catch (error) {
      setTaskError(`Could not delete task: ${error.message}`)
    }
  }

  // --------------------------------------------------
  // Edit task - online and offline
  // --------------------------------------------------

  async function editTask(task) {
    if (!user) return

    const title = window.prompt('Edit task name:', task.title)

    if (title === null || !title.trim()) return

    const newPriority = window.prompt(
      'Priority: High, Medium, or Low',
      task.priority
    )

    if (newPriority === null) return

    const validPriority = ['High', 'Medium', 'Low'].find(
      (value) =>
        value.toLowerCase() === newPriority.trim().toLowerCase()
    )

    if (!validPriority) {
      window.alert('Please enter High, Medium, or Low.')
      return
    }

    const newDeadline = window.prompt(
      'Deadline (YYYY-MM-DD), or leave blank:',
      task.deadline || ''
    )

    if (newDeadline === null) return

    setTaskError('')

    try {
      const updatedTask = {
        ...task,
        title: title.trim(),
        priority: validPriority,
        deadline: newDeadline.trim() || null,
      }

      await saveLocalTask(updatedTask)
      await queueTaskUpsert(updatedTask)

      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? updatedTask : item
        )
      )

      if (navigator.onLine) {
        await syncPendingOperations()
      }
    } catch (error) {
      setTaskError(`Could not edit task: ${error.message}`)
    }
  }

  // --------------------------------------------------
  // Clear completed tasks - online and offline
  // --------------------------------------------------

  async function clearCompleted() {
    if (!user) return

    const completedTasks = tasks.filter((task) => task.completed)

    if (completedTasks.length === 0) return

    setTaskError('')

    try {
      for (const task of completedTasks) {
        await deleteLocalTask(task.id)
        await queueTaskDelete(task.id)
      }

      setTasks((current) =>
        current.filter((task) => !task.completed)
      )

      if (navigator.onLine) {
        await syncPendingOperations()
      }
    } catch (error) {
      setTaskError(
        `Could not clear completed tasks: ${error.message}`
      )
    }
  }

  // --------------------------------------------------
  // Task statistics and filters
  // --------------------------------------------------

  const completedCount = tasks.filter(
    (task) => task.completed
  ).length

  const pendingCount = tasks.length - completedCount

  const progress = tasks.length
    ? Math.round((completedCount / tasks.length) * 100)
    : 0

  const visibleTasks = tasks.filter((task) => {
    const matchesSearch = task.title
      .toLowerCase()
      .includes(search.toLowerCase())

    const matchesFilter =
      filter === 'All' ||
      (filter === 'Pending' && !task.completed) ||
      (filter === 'Completed' && task.completed)

    return matchesSearch && matchesFilter
  })

  // --------------------------------------------------
  // Loading screen
  // --------------------------------------------------

  if (authLoading) {
    return (
      <div className="auth-loading">
        Checking login session...
      </div>
    )
  }

  // --------------------------------------------------
  // Forgot Password page
  // --------------------------------------------------

  if (!user && authMode === 'forgot') {
    return (
      <main className={darkMode ? 'app dark' : 'app'}>
        <div className="auth-card">
          <h1>Forgot Password 🔐</h1>

          <p className="subtitle">
            Enter your email to receive a password reset link.
          </p>

          <form
            className="auth-form"
            onSubmit={handleForgotPassword}
          >
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />

            <button
              className="add-button"
              type="submit"
              disabled={authSubmitting}
            >
              {authSubmitting ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          {authMessage && (
            <p className="auth-success">{authMessage}</p>
          )}

          {authError && (
            <p className="auth-error">{authError}</p>
          )}

          <p className="auth-switch">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login')
                setAuthMessage('')
                setAuthError('')
              }}
            >
              Back to Login
            </button>
          </p>

          <button
            className="theme-button"
            type="button"
            onClick={() => setDarkMode((value) => !value)}
          >
            {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
      </main>
    )
  }

  // --------------------------------------------------
  // Reset Password page
  // --------------------------------------------------

  if (authMode === 'reset') {
    return (
      <main className={darkMode ? 'app dark' : 'app'}>
        <div className="auth-card">
          <h1>Set New Password 🔐</h1>

          <p className="subtitle">
            Enter your new password.
          </p>

          <form
            className="auth-form"
            onSubmit={handleResetPassword}
          >
            <input
              type="password"
              placeholder="New password (minimum 6 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />

            <button
              className="add-button"
              type="submit"
              disabled={authSubmitting}
            >
              {authSubmitting ? 'Updating...' : 'Update Password'}
            </button>
          </form>

          {authError && (
            <p className="auth-error">{authError}</p>
          )}
        </div>
      </main>
    )
  }

  // --------------------------------------------------
  // Login and Signup page
  // --------------------------------------------------

  if (!user) {
    return (
      <main className={darkMode ? 'app dark' : 'app'}>
        <div className="auth-card">
          <h1>My Daily Task Manager 📝</h1>

          <p className="subtitle">
            {authMode === 'signup'
              ? 'Create your account'
              : 'Welcome back! Please login.'}
          </p>

          <form className="auth-form" onSubmit={handleAuth}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />

            <input
              type="password"
              placeholder="Password (minimum 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                authMode === 'signup'
                  ? 'new-password'
                  : 'current-password'
              }
              minLength={6}
              required
            />

            <button
              className="add-button"
              type="submit"
              disabled={authSubmitting}
            >
              {authSubmitting
                ? 'Please wait...'
                : authMode === 'signup'
                  ? 'Sign Up'
                  : 'Login'}
            </button>
          </form>

          {authMode === 'login' && (
            <p className="auth-switch">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('forgot')
                  setAuthMessage('')
                  setAuthError('')
                }}
              >
                Forgot Password?
              </button>
            </p>
          )}

          {authMessage && (
            <p className="auth-success">{authMessage}</p>
          )}

          {authError && (
            <p className="auth-error">{authError}</p>
          )}

          <p className="auth-switch">
            {authMode === 'signup'
              ? 'Already have an account?'
              : "Don't have an account?"}{' '}

            <button
              type="button"
              onClick={() => {
                setAuthMode(
                  authMode === 'signup' ? 'login' : 'signup'
                )
                setAuthMessage('')
                setAuthError('')
              }}
            >
              {authMode === 'signup' ? 'Login' : 'Sign Up'}
            </button>
          </p>

          <button
            className="theme-button"
            type="button"
            onClick={() => setDarkMode((value) => !value)}
          >
            {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
      </main>
    )
  }

  // --------------------------------------------------
  // Main To-Do application
  // --------------------------------------------------

  return (
    <main className={darkMode ? 'app dark' : 'app'}>
      <div className="todo-card">
        <header className="header">
          <div>
            <h1>My Daily Task Manager 📝</h1>

            <p className="subtitle">
              Plan your day. Complete your goals.
            </p>

            <p className="user-email">
              Logged in as: {user.email}
            </p>

            <p className="user-email">
              {isOnline ? '🟢 Online' : '🔴 Offline'}
              {' · '}
              {syncing
                ? 'Syncing...'
                : pendingSyncCount > 0
                  ? `${pendingSyncCount} change(s) waiting to sync`
                  : 'All changes synced'}
            </p>
          </div>

          <div className="header-actions">
            <button
              className="theme-button"
              onClick={() => setDarkMode((value) => !value)}
              type="button"
            >
              {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </button>

            <button
              className="logout-button"
              onClick={handleLogout}
              type="button"
            >
              Logout
            </button>
          </div>
        </header>

        <form className="task-form" onSubmit={addTask}>
          <input
            aria-label="Task name"
            placeholder="Enter a new task..."
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
          />

          <select
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>

          <input
            aria-label="Deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />

          <button
            className="add-button"
            type="submit"
            disabled={taskSubmitting}
          >
            {taskSubmitting ? 'Saving...' : 'Add Task'}
          </button>
        </form>

        {taskError && (
          <p className="auth-error">{taskError}</p>
        )}

        <section className="stats">
          <div className="stat">
            <strong>{tasks.length}</strong>
            <span>Total</span>
          </div>

          <div className="stat">
            <strong>{pendingCount}</strong>
            <span>Pending</span>
          </div>

          <div className="stat">
            <strong>{completedCount}</strong>
            <span>Completed</span>
          </div>
        </section>

        <section className="progress-section">
          <div className="progress-label">
            <span>Overall Progress</span>
            <strong>{progress}%</strong>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-label="Overall task completion"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </section>

        <input
          className="search-input"
          placeholder="🔎 Search tasks..."
          aria-label="Search tasks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <nav className="filters" aria-label="Task filters">
          {['All', 'Pending', 'Completed'].map((item) => (
            <button
              key={item}
              className={
                filter === item ? 'filter active' : 'filter'
              }
              onClick={() => setFilter(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>

        <section className="task-list">
          {tasksLoading ? (
            <p className="empty-message">
              Loading your tasks...
            </p>
          ) : visibleTasks.length === 0 ? (
            <p className="empty-message">
              No tasks found. Add a new task!
            </p>
          ) : (
            visibleTasks.map((task) => (
              <article className="task-row" key={task.id}>
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleTask(task.id)}
                  aria-label={`Mark ${task.title} as ${
                    task.completed ? 'pending' : 'completed'
                  }`}
                />

                <div className="task-details">
                  <span
                    className={
                      task.completed
                        ? 'task-title completed'
                        : 'task-title'
                    }
                  >
                    {task.title}
                  </span>

                  <div className="task-meta">
                    <span
                      className={`priority ${task.priority.toLowerCase()}`}
                    >
                      {task.priority} priority
                    </span>

                    {task.deadline && (
                      <span className="deadline">
                        📅 {task.deadline}
                      </span>
                    )}

                    {task.completed && (
                      <span className="done-label">
                        ✓ Completed
                      </span>
                    )}
                  </div>
                </div>

                <div className="task-actions">
                  <button
                    className="edit-button"
                    onClick={() => editTask(task)}
                    type="button"
                  >
                    Edit
                  </button>

                  <button
                    className="delete-button"
                    onClick={() => deleteTask(task.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </section>

        <footer className="footer">
          <span>{pendingCount} task(s) remaining</span>

          <button
            className="clear-button"
            onClick={clearCompleted}
            type="button"
          >
            Clear Completed
          </button>
        </footer>
      </div>
    </main>
  )
}

export default App
