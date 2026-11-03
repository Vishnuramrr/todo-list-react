
import { useEffect, useState } from 'react'
import './App.css'

const initialTasks = [
  {
    id: 1,
    title: 'Welcome to your React To-Do List!',
    priority: 'Medium',
    deadline: '',
    completed: false,
  },
]

function App() {
  const [tasks, setTasks] = useState(() => {
    try {
      const savedTasks = localStorage.getItem('react-todo-tasks')
      return savedTasks ? JSON.parse(savedTasks) : initialTasks
    } catch {
      return initialTasks
    }
  })

  const [taskInput, setTaskInput] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [deadline, setDeadline] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('react-todo-theme') === 'dark'
  )

  useEffect(() => {
    localStorage.setItem('react-todo-tasks', JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    localStorage.setItem('react-todo-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  function addTask(e) {
    e.preventDefault()

    const title = taskInput.trim()
    if (!title) return

    setTasks((current) => [
      ...current,
      {
        id: Date.now(),
        title,
        priority,
        deadline,
        completed: false,
      },
    ])

    setTaskInput('')
    setPriority('Medium')
    setDeadline('')
  }

  function toggleTask(id) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, completed: !task.completed }
          : task
      )
    )
  }

  function deleteTask(id) {
    setTasks((current) =>
      current.filter((task) => task.id !== id)
    )
  }

  function editTask(task) {
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
      task.deadline
    )

    if (newDeadline === null) return

    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              title: title.trim(),
              priority: validPriority,
              deadline: newDeadline.trim(),
            }
          : item
      )
    )
  }

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

  return (
    <main className={darkMode ? 'app dark' : 'app'}>
      <div className="todo-card">
        <header className="header">
          <div>
            <h1>My Daily Task Manager 📝</h1>
            <p className="subtitle">
              Plan your day. Complete your goals.
            </p>
          </div>

          <button
            className="theme-button"
            onClick={() => setDarkMode((value) => !value)}
            type="button"
          >
            {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
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

          <button className="add-button" type="submit">
            Add Task
          </button>
        </form>

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
          {visibleTasks.length === 0 ? (
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
            onClick={() =>
              setTasks((current) =>
                current.filter((task) => !task.completed)
              )
            }
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
