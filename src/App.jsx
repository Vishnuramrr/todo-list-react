import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tasksLoading, setTasksLoading] = useState(false)

  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  // Check existing login session and listen for authentication changes
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Load only the logged-in user's tasks from Supabase
  useEffect(() => {
    if (!user) {
      setTasks([])
      return
    }

    let active = true

    async function loadTasks() {
      setTasksLoading(true)
      setTaskError('')

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (!active) return

      if (error) {
        setTaskError(`Could not load tasks: ${error.message}`)
      } else {
        setTasks(data ?? [])
      }

      setTasksLoading(false)
    }

    loadTasks()

    return () => {
      active = false
    }
  }, [user?.id])

  // Signup and login
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

  // Logout
  async function handleLogout() {
    setAuthError('')
    const { error } = await supabase.auth.signOut()

    if (error) {
      setAuthError(error.message)
    }
  }

  // Save theme preference locally
  useEffect(() => {
    localStorage.setItem('react-todo-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // Add task to Supabase
  async function addTask(e) {
    e.preventDefault()

    const title = taskInput.trim()

    if (!title || !user || taskSubmitting) return

    setTaskSubmitting(true)
    setTaskError('')

    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          user_id: user.id,
          title,
          priority,
          deadline: deadline || null,
          completed: false,
        })
        .select()
        .single()

      if (error) throw error

      setTasks((current) => [data, ...current])
      setTaskInput('')
      setPriority('Medium')
      setDeadline('')
    } catch (error) {
      setTaskError(`Could not add task: ${error.message}`)
    } finally {
      setTaskSubmitting(false)
    }
  }

  // Update task completion in Supabase
  async function toggleTask(id) {
    const task = tasks.find((item) => item.id === id)

    if (!task || !user) return

    setTaskError('')

    const newCompleted = !task.completed

    const { data, error } = await supabase
      .from('tasks')
      .update({ completed: newCompleted })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      setTaskError(`Could not update task: ${error.message}`)
      return
    }

    setTasks((current) =>
      current.map((item) => (item.id === id ? data : item))
    )
  }

  // Delete task from Supabase
  async function deleteTask(id) {
    if (!user) return

    setTaskError('')

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      setTaskError(`Could not delete task: ${error.message}`)
      return
    }

    setTasks((current) => current.filter((task) => task.id !== id))
  }

  // Edit task in Supabase
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
      (value) => value.toLowerCase() === newPriority.trim().toLowerCase()
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

    const { data, error } = await supabase
      .from('tasks')
      .update({
        title: title.trim(),
        priority: validPriority,
        deadline: newDeadline.trim() || null,
      })
      .eq('id', task.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      setTaskError(`Could not edit task: ${error.message}`)
      return
    }

    setTasks((current) =>
      current.map((item) => (item.id === task.id ? data : item))
    )
  }

  // Delete all completed tasks from Supabase
  async function clearCompleted() {
    if (!user) return

    const completedTasks = tasks.filter((task) => task.completed)

    if (completedTasks.length === 0) return

    setTaskError('')

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('user_id', user.id)
      .eq('completed', true)

    if (error) {
      setTaskError(`Could not clear completed tasks: ${error.message}`)
      return
    }

    setTasks((current) => current.filter((task) => !task.completed))
  }

  const completedCount = tasks.filter((task) => task.completed).length
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

  if (authLoading) {
    return <div className="auth-loading">Checking login session...</div>
  }

  // Login and signup page
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
                authMode === 'signup' ? 'new-password' : 'current-password'
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

          {authMessage && (
            <p className="auth-success">{authMessage}</p>
          )}

          {authError && <p className="auth-error">{authError}</p>}

          <p className="auth-switch">
            {authMode === 'signup'
              ? 'Already have an account?'
              : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'signup' ? 'login' : 'signup')
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

  // To-Do application after login
  return (
    <main className={darkMode ? 'app dark' : 'app'}>
      <div className="todo-card">
        <header className="header">
          <div>
            <h1>My Daily Task Manager 📝</h1>
            <p className="subtitle">Plan your day. Complete your goals.</p>
            <p className="user-email">Logged in as: {user.email}</p>
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

        {taskError && <p className="auth-error">{taskError}</p>}

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
              className={filter === item ? 'filter active' : 'filter'}
              onClick={() => setFilter(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>

        <section className="task-list">
          {tasksLoading ? (
            <p className="empty-message">Loading your tasks...</p>
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
                      <span className="done-label">✓ Completed</span>
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