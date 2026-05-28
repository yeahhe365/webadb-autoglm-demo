import {
  MAX_THREAD_SCREENSHOT_REFERENCES,
  type AgentRecalledScreenshot,
  type AgentScreenshotReference,
  type AgentSettingsSnapshot,
  type AgentThread,
} from './agentThread'
import type { ModelConfig } from './openAiTypes'
import { compactScreenshotForMemory } from './screenshot'
import { truncateOptionalRetainedText, truncateRetainedText } from './textRetention'

const DATABASE_NAME = 'webdroid-agent-threads'
const DATABASE_VERSION = 2
const THREAD_STORE = 'threads'
const THREAD_SUMMARY_STORE = 'threadSummaries'
const UPDATED_AT_INDEX = 'updatedAt'
const PERSISTED_FULL_TURN_COUNT = 12
const MAX_PERSISTED_EVENTS = 240
const MAX_PERSISTED_HISTORY_ITEMS = 160
const MAX_PERSISTED_MODEL_OUTPUT_CHARS = 8000
const MAX_PERSISTED_MESSAGE_CHARS = 12000
const MAX_PERSISTED_OBSERVATION_CHARS = 4000
const MAX_PERSISTED_EXECUTION_RESULT_CHARS = 4000

export type AgentThreadSummary = {
  id: string
  title: string
  status: AgentThread['status']
  task: string
  createdAt: number
  updatedAt: number
}

export type AgentThreadStore = {
  save(thread: AgentThread): Promise<void>
  load(threadId: string): Promise<AgentThread | null>
  loadLatest(): Promise<AgentThread | null>
  list(): Promise<AgentThreadSummary[]>
  delete(threadId: string): Promise<void>
  clear(): Promise<void>
}

export type CreateSettingsSnapshotInput = Omit<AgentSettingsSnapshot, 'modelConfig'> & {
  modelConfig?: ModelConfig
}

export function createSettingsSnapshot({
  modelConfig,
  ...rest
}: CreateSettingsSnapshotInput): AgentSettingsSnapshot {
  return {
    ...rest,
    ...(modelConfig
      ? {
          modelConfig: {
            baseUrl: modelConfig.baseUrl,
            model: modelConfig.model,
            reasoningEffort: modelConfig.reasoningEffort,
            stream: modelConfig.stream,
          },
        }
      : {}),
  }
}

export function createMemoryThreadStore(initialThreads: readonly AgentThread[] = []): AgentThreadStore {
  const threads = new Map<string, AgentThread>()
  const summaries = new Map<string, AgentThreadSummary>()
  for (const thread of initialThreads) {
    const persistedThread = cloneThreadForPersistence(thread)
    threads.set(thread.id, persistedThread)
    summaries.set(thread.id, toThreadSummary(persistedThread))
  }

  return {
    async save(thread) {
      const persistedThread = cloneThreadForPersistence(thread)
      threads.set(thread.id, persistedThread)
      summaries.set(thread.id, toThreadSummary(persistedThread))
    },
    async load(threadId) {
      const thread = threads.get(threadId)
      return thread ? cloneThreadForRuntime(thread) : null
    },
    async loadLatest() {
      const [latestSummary] = sortedSummaries([...summaries.values()])
      const latest = latestSummary ? threads.get(latestSummary.id) : undefined
      return latest ? cloneThreadForRuntime(latest) : null
    },
    async list() {
      return sortedSummaries([...summaries.values()]).map(cloneSummary)
    },
    async delete(threadId) {
      threads.delete(threadId)
      summaries.delete(threadId)
    },
    async clear() {
      threads.clear()
      summaries.clear()
    },
  }
}

export function createIndexedDbThreadStore(
  options: {
    indexedDb?: IDBFactory
    databaseName?: string
  } = {},
): AgentThreadStore {
  const indexedDb = options.indexedDb ?? globalThis.indexedDB
  const databaseName = options.databaseName ?? DATABASE_NAME

  if (!indexedDb) {
    return createMemoryThreadStore()
  }

  return {
    async save(thread) {
      const persistedThread = cloneThreadForPersistence(thread)
      const summary = toThreadSummary(persistedThread)
      await withDatabase(indexedDb, databaseName, (database) =>
        runThreadStoresTransaction(database, 'readwrite', (transaction) => {
          transaction.objectStore(THREAD_STORE).put(persistedThread)
          transaction.objectStore(THREAD_SUMMARY_STORE).put(summary)
        }),
      )
    },
    async load(threadId) {
      const result = await withDatabase(indexedDb, databaseName, (database) =>
        runObjectStoreRequest<AgentThread | undefined>(database, THREAD_STORE, 'readonly', (store) =>
          store.get(threadId),
        ),
      )
      return result ? cloneThreadForRuntime(result) : null
    },
    async loadLatest() {
      const result = await withDatabase(indexedDb, databaseName, loadLatestThread)
      return result ? cloneThreadForRuntime(result) : null
    },
    async list() {
      return withDatabase(indexedDb, databaseName, listThreadSummaries)
    },
    async delete(threadId) {
      await withDatabase(indexedDb, databaseName, (database) =>
        runThreadStoresTransaction(database, 'readwrite', (transaction) => {
          transaction.objectStore(THREAD_STORE).delete(threadId)
          transaction.objectStore(THREAD_SUMMARY_STORE).delete(threadId)
        }),
      )
    },
    async clear() {
      await withDatabase(indexedDb, databaseName, (database) =>
        runThreadStoresTransaction(database, 'readwrite', (transaction) => {
          transaction.objectStore(THREAD_STORE).clear()
          transaction.objectStore(THREAD_SUMMARY_STORE).clear()
        }),
      )
    },
  }
}

async function withDatabase<Result>(
  indexedDb: IDBFactory,
  databaseName: string,
  run: (database: IDBDatabase) => Promise<Result>,
) {
  const database = await openDatabase(indexedDb, databaseName)
  try {
    return await run(database)
  } finally {
    database.close()
  }
}

function openDatabase(indexedDb: IDBFactory, databaseName: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = (event) => {
      const database = request.result
      const store = database.objectStoreNames.contains(THREAD_STORE)
        ? request.transaction?.objectStore(THREAD_STORE)
        : database.createObjectStore(THREAD_STORE, { keyPath: 'id' })
      if (store && !store.indexNames.contains(UPDATED_AT_INDEX)) {
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt')
      }
      const summaryStore = database.objectStoreNames.contains(THREAD_SUMMARY_STORE)
        ? request.transaction?.objectStore(THREAD_SUMMARY_STORE)
        : database.createObjectStore(THREAD_SUMMARY_STORE, { keyPath: 'id' })
      if (summaryStore && !summaryStore.indexNames.contains(UPDATED_AT_INDEX)) {
        summaryStore.createIndex(UPDATED_AT_INDEX, 'updatedAt')
      }
      if (store && summaryStore && event.oldVersion < 2) {
        backfillThreadSummaries(store, summaryStore)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open thread store.'))
  })
}

function runObjectStoreRequest<Result = undefined>(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<Result>,
) {
  return new Promise<Result>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = run(store)
    request.onerror = () => reject(request.error ?? new Error('Thread store request failed.'))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Thread store transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Thread store transaction aborted.'))
  })
}

function runThreadStoresTransaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([THREAD_STORE, THREAD_SUMMARY_STORE], mode)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Thread store transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Thread store transaction aborted.'))

    try {
      run(transaction)
    } catch (caught) {
      transaction.abort()
      reject(caught)
    }
  })
}

function listThreadSummaries(database: IDBDatabase) {
  return new Promise<AgentThreadSummary[]>((resolve, reject) => {
    const transaction = database.transaction(THREAD_SUMMARY_STORE, 'readonly')
    const store = transaction.objectStore(THREAD_SUMMARY_STORE)
    const index = store.indexNames.contains(UPDATED_AT_INDEX)
      ? store.index(UPDATED_AT_INDEX)
      : null
    const source = index ?? store
    const summaries: AgentThreadSummary[] = []
    const request = source.openCursor(null, index ? 'prev' : 'next')

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(index ? summaries : summaries.sort((left, right) => right.updatedAt - left.updatedAt))
        return
      }

      summaries.push(cloneSummary(cursor.value as AgentThreadSummary))
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to list thread summaries.'))
  })
}

function loadLatestThread(database: IDBDatabase) {
  return new Promise<AgentThread | undefined>((resolve, reject) => {
    const transaction = database.transaction([THREAD_SUMMARY_STORE, THREAD_STORE], 'readonly')
    const summaryStore = transaction.objectStore(THREAD_SUMMARY_STORE)
    const threadStore = transaction.objectStore(THREAD_STORE)
    const index = summaryStore.indexNames.contains(UPDATED_AT_INDEX)
      ? summaryStore.index(UPDATED_AT_INDEX)
      : null

    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to load latest thread.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Failed to load latest thread.'))

    const request = (index ?? summaryStore).openCursor(null, index ? 'prev' : 'next')
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        void loadLegacyLatestThread(database).then(resolve, reject)
        return
      }

      const summary = cursor.value as AgentThreadSummary
      const threadRequest = threadStore.get(summary.id)
      threadRequest.onsuccess = () => resolve(threadRequest.result as AgentThread | undefined)
      threadRequest.onerror = () =>
        reject(threadRequest.error ?? new Error('Failed to load latest thread.'))
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to load latest thread.'))
  })
}

function backfillThreadSummaries(threadStore: IDBObjectStore, summaryStore: IDBObjectStore) {
  const cursorRequest = threadStore.openCursor()
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result
    if (!cursor) {
      return
    }
    summaryStore.put(toThreadSummary(cursor.value as AgentThread))
    cursor.continue()
  }
}

function sortedSummaries(summaries: AgentThreadSummary[]) {
  return [...summaries].sort((left, right) => right.updatedAt - left.updatedAt)
}

function sortedThreads(threads: AgentThread[]) {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt)
}

function toThreadSummary(thread: AgentThread): AgentThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    task: thread.task,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }
}

function cloneSummary(summary: AgentThreadSummary): AgentThreadSummary {
  return { ...summary }
}

function cloneThreadForRuntime(thread: AgentThread): AgentThread {
  return compactThreadForMemory(cloneValue(thread))
}

function cloneThreadForPersistence(thread: AgentThread): AgentThread {
  const fullTurnIds = new Set(
    thread.turns.slice(-PERSISTED_FULL_TURN_COUNT).map((turn) => turn.id),
  )
  const clone: AgentThread = {
    ...thread,
    deviceState: cloneValue(thread.deviceState),
    visitedPackages: [...thread.visitedPackages],
    visitedActivities: [...thread.visitedActivities],
    actionOutcomes: [...thread.actionOutcomes],
    errorDescriptions: thread.errorDescriptions.map((value) =>
      truncateRetainedText(value, MAX_PERSISTED_EXECUTION_RESULT_CHARS),
    ),
    memory: thread.memory.map((value) => truncateRetainedText(value, MAX_PERSISTED_MESSAGE_CHARS)),
    screenshotReferences: cloneScreenshotReferences(thread.screenshotReferences ?? []),
    history: thread.history.slice(-MAX_PERSISTED_HISTORY_ITEMS).map((item) => ({
      ...item,
      executionResult: truncateOptionalRetainedText(
        item.executionResult,
        MAX_PERSISTED_EXECUTION_RESULT_CHARS,
      ),
    })),
    messages: thread.messages.map((message) => ({
      ...message,
      content: truncateRetainedText(
        message.content,
        message.role === 'observation'
          ? MAX_PERSISTED_OBSERVATION_CHARS
          : MAX_PERSISTED_MESSAGE_CHARS,
      ),
    })),
    pendingUserMessages: thread.pendingUserMessages.map((message) => ({ ...message })),
    turns: thread.turns.map((turn) => ({
      ...turn,
      action: cloneValue(turn.action),
      executionAction: cloneValue(turn.executionAction),
      promptContext: '',
      modelOutput: fullTurnIds.has(turn.id)
        ? truncateRetainedText(turn.modelOutput, MAX_PERSISTED_MODEL_OUTPUT_CHARS)
        : '',
      executionResult: truncateOptionalRetainedText(
        turn.executionResult,
        MAX_PERSISTED_EXECUTION_RESULT_CHARS,
      ),
      deviceSnapshot: {
        currentApp: turn.deviceSnapshot.currentApp,
        deviceState: cloneValue(turn.deviceSnapshot.deviceState),
      },
    })),
    events: compactThreadEvents(thread.events),
    ...(thread.settingsSnapshot ? { settingsSnapshot: cloneValue(thread.settingsSnapshot) } : {}),
  }

  if (thread.lastScreenshot) {
    clone.lastScreenshot = compactScreenshotForMemory(thread.lastScreenshot)
  } else {
    delete clone.lastScreenshot
  }

  if (thread.deviceSnapshot) {
    clone.deviceSnapshot = {
      currentApp: thread.deviceSnapshot.currentApp,
      deviceState: cloneValue(thread.deviceSnapshot.deviceState),
      ...(thread.deviceSnapshot.screenshot
        ? { screenshot: compactScreenshotForMemory(thread.deviceSnapshot.screenshot) }
        : {}),
    }
  } else {
    delete clone.deviceSnapshot
  }

  if (thread.activeScreenshotRecall) {
    clone.activeScreenshotRecall = cloneRecalledScreenshot(thread.activeScreenshotRecall)
  } else {
    delete clone.activeScreenshotRecall
  }

  return compactThreadForMemory(clone)
}

function cloneScreenshotReferences(references: readonly AgentScreenshotReference[]) {
  return references.slice(-MAX_THREAD_SCREENSHOT_REFERENCES).map((reference) => ({
    ...reference,
    deviceState: cloneValue(reference.deviceState),
    screenshot: compactScreenshotForMemory(reference.screenshot),
  }))
}

function cloneRecalledScreenshot(recall: AgentRecalledScreenshot): AgentRecalledScreenshot {
  return {
    ...recall,
    deviceState: cloneValue(recall.deviceState),
    screenshot: compactScreenshotForMemory(recall.screenshot),
  }
}

function compactThreadEvents(events: AgentThread['events']) {
  return events.slice(-MAX_PERSISTED_EVENTS).map((event) => {
    if (event.type === 'device_snapshot') {
      return {
        id: event.id,
        type: event.type,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        currentApp: event.currentApp,
        deviceState: cloneValue(event.deviceState),
        createdAt: event.createdAt,
      }
    }

    if (event.type === 'assistant_action') {
      return {
        id: event.id,
        type: event.type,
        turnId: event.turnId,
        actionPreview: event.actionPreview,
        createdAt: event.createdAt,
      }
    }

    if (event.type === 'action_execution') {
      return {
        ...event,
        executionResult: truncateRetainedText(
          event.executionResult,
          MAX_PERSISTED_EXECUTION_RESULT_CHARS,
        ),
      }
    }

    if (event.type === 'user_message' || event.type === 'assistant_message') {
      return {
        ...event,
        message: truncateRetainedText(event.message, MAX_PERSISTED_MESSAGE_CHARS),
      }
    }

    if (event.type === 'context_compaction') {
      return {
        ...event,
        summary: truncateRetainedText(event.summary, MAX_PERSISTED_MESSAGE_CHARS),
      }
    }

    return { ...event }
  })
}

function cloneValue<Value>(value: Value): Value {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as Value)
}

function compactThreadForMemory(thread: AgentThread): AgentThread {
  if (thread.lastScreenshot) {
    thread.lastScreenshot = compactScreenshotForMemory(thread.lastScreenshot)
  }
  if (thread.deviceSnapshot?.screenshot) {
    thread.deviceSnapshot = {
      ...thread.deviceSnapshot,
      screenshot: compactScreenshotForMemory(thread.deviceSnapshot.screenshot),
    }
  }
  thread.screenshotReferences = cloneScreenshotReferences(thread.screenshotReferences ?? [])
  if (thread.activeScreenshotRecall) {
    thread.activeScreenshotRecall = cloneRecalledScreenshot(thread.activeScreenshotRecall)
  }

  for (const turn of thread.turns) {
    if (turn.deviceSnapshot.screenshot) {
      turn.deviceSnapshot = {
        currentApp: turn.deviceSnapshot.currentApp,
        deviceState: turn.deviceSnapshot.deviceState,
      }
    }
    if (turn.compacted) {
      turn.promptContext = ''
      turn.modelOutput = ''
      turn.executionResult = truncateOptionalRetainedText(
        turn.executionResult,
        MAX_PERSISTED_EXECUTION_RESULT_CHARS,
      )
    }
  }

  for (const event of thread.events) {
    if (event.type === 'device_snapshot') {
      delete event.screenshot
    }
    if (event.type === 'assistant_action') {
      delete event.modelOutput
    }
  }

  return thread
}

function loadLegacyLatestThread(database: IDBDatabase) {
  return new Promise<AgentThread | undefined>((resolve, reject) => {
    const transaction = database.transaction(THREAD_STORE, 'readonly')
    const store = transaction.objectStore(THREAD_STORE)
    const index = store.indexNames.contains(UPDATED_AT_INDEX)
      ? store.index(UPDATED_AT_INDEX)
      : null

    if (!index) {
      const request = store.getAll()
      request.onsuccess = () => resolve(sortedThreads(request.result as AgentThread[])[0])
      request.onerror = () => reject(request.error ?? new Error('Failed to load latest thread.'))
      return
    }

    const request = index.openCursor(null, 'prev')
    request.onsuccess = () => resolve(request.result?.value as AgentThread | undefined)
    request.onerror = () => reject(request.error ?? new Error('Failed to load latest thread.'))
  })
}
