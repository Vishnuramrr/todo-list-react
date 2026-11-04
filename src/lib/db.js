import { openDB } from 'idb'

const DB_NAME = 'daily-task-manager'
const DB_VERSION = 2

const TASK_STORE = 'tasks'
const QUEUE_STORE = 'syncQueue'

export const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const taskStore = db.createObjectStore(TASK_STORE, {
        keyPath: 'id',
      })

      taskStore.createIndex('user_id', 'user_id')
    }

    if (oldVersion < 2) {
      const queueStore = db.createObjectStore(QUEUE_STORE, {
        keyPath: 'queueId',
        autoIncrement: true,
      })

      queueStore.createIndex('user_id', 'user_id')
    }
  },
})

// Get local tasks for a user
export async function getLocalTasks(userId) {
  const db = await dbPromise
  return db.getAllFromIndex(TASK_STORE, 'user_id', userId)
}

// Save or update a local task
export async function saveLocalTask(task) {
  const db = await dbPromise
  return db.put(TASK_STORE, task)
}

// Delete a local task
export async function deleteLocalTask(id) {
  const db = await dbPromise
  return db.delete(TASK_STORE, id)
}

// Clear one user's local tasks
export async function clearLocalTasks(userId) {
  const db = await dbPromise
  const tx = db.transaction(TASK_STORE, 'readwrite')
  const index = tx.store.index('user_id')

  let cursor = await index.openCursor(userId)

  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }

  await tx.done
}

// Add an operation to the sync queue
export async function addToSyncQueue(operation) {
  const db = await dbPromise
  return db.add(QUEUE_STORE, operation)
}

// Get pending operations for a user
export async function getSyncQueue(userId) {
  const db = await dbPromise
  return db.getAllFromIndex(QUEUE_STORE, 'user_id', userId)
}

// Remove a synced operation
export async function removeFromSyncQueue(queueId) {
  const db = await dbPromise
  return db.delete(QUEUE_STORE, queueId)
}

// Clear one user's pending sync operations
export async function clearSyncQueue(userId) {
  const db = await dbPromise
  const tx = db.transaction(QUEUE_STORE, 'readwrite')
  const index = tx.store.index('user_id')

  let cursor = await index.openCursor(userId)

  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }

  await tx.done
}