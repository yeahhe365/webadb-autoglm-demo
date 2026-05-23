import type { DeviceScreenshot, DeviceState } from '../adapters/deviceTypes'
import type { AgentAction } from './actionTypes'
import type { AgentConversationMessage, AgentHistoryItem, ModelConfig } from './openAiTypes'

export type AgentThreadStatus =
  | 'idle'
  | 'running'
  | 'awaiting_review'
  | 'awaiting_takeover'
  | 'done'
  | 'stopped'
  | 'error'

export type AgentTurnStatus =
  | 'planned'
  | 'executed'
  | 'failed'
  | 'done'
  | 'awaiting_review'
  | 'awaiting_takeover'

export type AgentSettingsSnapshot = {
  modelConfig?: Pick<ModelConfig, 'baseUrl' | 'model' | 'stream'>
  autoExecute?: boolean
  maxSteps?: number
  confirmSensitiveActions?: boolean
  preferAdbKeyboard?: boolean
  actionSettleMs?: number
  doubleTapIntervalMs?: number
  keyboardStepMs?: number
}

export type AgentDeviceSnapshot = {
  currentApp: string
  deviceState: DeviceState
  screenshot?: DeviceScreenshot
}

export type AgentTurnTiming = {
  captureMs: number
  currentAppMs: number
  modelMs: number
  parseMs: number
  totalMs: number
}

export type AgentTurn = {
  id: string
  index: number
  status: AgentTurnStatus
  task: string
  latestUserMessage?: string
  promptContext: string
  deviceSnapshot: AgentDeviceSnapshot
  modelOutput: string
  action: AgentAction
  executionAction: AgentAction
  preview: string
  timing: AgentTurnTiming
  executionResult?: string
  success?: boolean
  createdAt: number
  completedAt?: number
  compacted?: boolean
}

export type AgentThreadEvent =
  | {
      id: string
      type: 'user_message'
      messageId: string
      message: string
      createdAt: number
    }
  | {
      id: string
      type: 'device_snapshot'
      turnId?: string
      currentApp: string
      deviceState: DeviceState
      screenshot?: DeviceScreenshot
      createdAt: number
    }
  | {
      id: string
      type: 'assistant_action'
      turnId: string
      modelOutput: string
      actionPreview: string
      createdAt: number
    }
  | {
      id: string
      type: 'action_execution'
      turnId: string
      actionPreview: string
      executionResult: string
      success?: boolean
      createdAt: number
    }
  | {
      id: string
      type: 'context_compaction'
      summary: string
      compactedThroughStep: number
      createdAt: number
    }
  | {
      id: string
      type: 'status_change'
      status: AgentThreadStatus
      message?: string
      createdAt: number
    }

type EventInput<Event> = Event extends AgentThreadEvent ? Omit<Event, 'id' | 'createdAt'> : never

export type AgentThreadEventInput = EventInput<AgentThreadEvent>

export type AgentThread = {
  id: string
  title: string
  status: AgentThreadStatus
  task: string
  currentApp: string
  deviceState: DeviceState
  lastScreenshot?: DeviceScreenshot
  deviceSnapshot?: AgentDeviceSnapshot
  visitedPackages: string[]
  visitedActivities: string[]
  lastActionPreview?: string
  lastExecutionResult?: string
  actionOutcomes: boolean[]
  errorDescriptions: string[]
  memory: string[]
  contextSummary: string
  contextCompactedThroughStep: number
  progressSummary: string
  finished: boolean
  success?: boolean
  history: AgentHistoryItem[]
  messages: AgentConversationMessage[]
  pendingUserMessages: QueuedUserMessage[]
  stepNumber: number
  turns: AgentTurn[]
  events: AgentThreadEvent[]
  settingsSnapshot?: AgentSettingsSnapshot
  createdAt: number
  updatedAt: number
}

export type QueuedUserMessage = {
  id: string
  message: string
  queuedAtStep: number
}

export type CreateAgentThreadOptions = {
  id?: string
  now?: number
  settingsSnapshot?: AgentSettingsSnapshot
}

export function createAgentThread(
  task: string,
  options: CreateAgentThreadOptions = {},
): AgentThread {
  const createdAt = options.now ?? Date.now()
  const thread: AgentThread = {
    id: options.id ?? createId('thread'),
    title: task.trim() || 'New chat',
    status: 'idle',
    task,
    currentApp: 'Unknown',
    deviceState: { app: 'Unknown' },
    visitedPackages: [],
    visitedActivities: [],
    actionOutcomes: [],
    errorDescriptions: [],
    memory: [],
    contextSummary: '',
    contextCompactedThroughStep: 0,
    progressSummary: '',
    finished: false,
    history: [],
    messages: [],
    pendingUserMessages: [],
    stepNumber: 0,
    turns: [],
    events: [],
    settingsSnapshot: options.settingsSnapshot,
    createdAt,
    updatedAt: createdAt,
  }

  if (task.trim()) {
    recordThreadUserMessage(thread, task, { now: createdAt })
  }

  return thread
}

export function recordThreadUserMessage(
  thread: AgentThread,
  message: string,
  options: { now?: number } = {},
) {
  const content = message.trim()
  if (!content) {
    throw new Error('Cannot add an empty user message.')
  }

  const now = options.now ?? Date.now()
  const entry = createConversationMessage('user', content)
  thread.messages.push(entry)
  if (!thread.task.trim()) {
    thread.task = content
  }
  if (!thread.title.trim() || thread.title === 'New chat') {
    thread.title = content
  }
  addThreadEvent(
    thread,
    {
      type: 'user_message',
      messageId: entry.id,
      message: content,
    },
    { now },
  )
  return entry
}

export type StartThreadTurnInput = {
  id?: string
  index: number
  task: string
  latestUserMessage?: string
  promptContext: string
  deviceSnapshot: AgentDeviceSnapshot
  modelOutput: string
  action: AgentAction
  executionAction: AgentAction
  preview: string
  timing: AgentTurnTiming
  status?: AgentTurnStatus
  now?: number
}

export function startThreadTurn(thread: AgentThread, input: StartThreadTurnInput): AgentTurn {
  const now = input.now ?? Date.now()
  const turn: AgentTurn = {
    id: input.id ?? createId('turn'),
    index: input.index,
    status: input.status ?? 'planned',
    task: input.task,
    latestUserMessage: input.latestUserMessage,
    promptContext: input.promptContext,
    deviceSnapshot: input.deviceSnapshot,
    modelOutput: input.modelOutput,
    action: input.action,
    executionAction: input.executionAction,
    preview: input.preview,
    timing: input.timing,
    createdAt: now,
  }

  thread.turns.push(turn)
  updateThreadDeviceSnapshot(thread, input.deviceSnapshot)
  addThreadEvent(
    thread,
    {
      type: 'device_snapshot',
      turnId: turn.id,
      currentApp: input.deviceSnapshot.currentApp,
      deviceState: input.deviceSnapshot.deviceState,
      screenshot: input.deviceSnapshot.screenshot,
    },
    { now },
  )
  addThreadEvent(
    thread,
    {
      type: 'assistant_action',
      turnId: turn.id,
      modelOutput: input.modelOutput,
      actionPreview: input.preview,
    },
    { now },
  )
  return turn
}

export function recordThreadTurnExecution(
  thread: AgentThread,
  turnId: string,
  input: {
    executionResult?: string
    success?: boolean
    status?: AgentTurnStatus
    now?: number
  } = {},
) {
  const turn = thread.turns.find((candidate) => candidate.id === turnId)
  if (!turn) {
    throw new Error(`Unknown turn "${turnId}".`)
  }

  const now = input.now ?? Date.now()
  turn.executionResult = input.executionResult
  turn.success = input.success
  turn.completedAt = now
  turn.status =
    input.status ??
    (turn.action.action === 'done'
      ? 'done'
      : turn.action.action === 'take_over'
        ? 'awaiting_takeover'
        : input.success === false
          ? 'failed'
          : 'executed')

  thread.lastActionPreview = turn.preview
  thread.lastExecutionResult = input.executionResult
  thread.history.push({
    step: turn.index,
    currentApp: turn.deviceSnapshot.currentApp,
    actionPreview: turn.preview,
    executionResult: input.executionResult,
  })

  if (input.success !== undefined) {
    thread.actionOutcomes.push(input.success)
    if (!input.success && input.executionResult) {
      thread.errorDescriptions.push(input.executionResult)
    }
  }

  if (turn.action.action === 'done') {
    thread.finished = true
    thread.success = true
    thread.status = 'done'
    thread.progressSummary = turn.action.summary ?? turn.action.reason ?? 'Task completed.'
    if (thread.progressSummary) {
      thread.messages.push(createConversationMessage('assistant', thread.progressSummary))
    }
  }

  if (input.executionResult) {
    thread.messages.push(createConversationMessage('observation', input.executionResult))
    addThreadEvent(
      thread,
      {
        type: 'action_execution',
        turnId: turn.id,
        actionPreview: turn.preview,
        executionResult: input.executionResult,
        success: input.success,
      },
      { now },
    )
  }

  touchThread(thread, now)
  return turn
}

export function addThreadEvent(
  thread: AgentThread,
  event: AgentThreadEventInput,
  options: { now?: number } = {},
) {
  const now = options.now ?? Date.now()
  const entry = {
    ...event,
    id: createId('event'),
    createdAt: now,
  } as unknown as AgentThreadEvent
  thread.events.push(entry)
  if (entry.type === 'status_change') {
    thread.status = entry.status
  }
  touchThread(thread, now)
  return entry
}

export function updateThreadDeviceSnapshot(
  thread: AgentThread,
  snapshot: AgentDeviceSnapshot,
) {
  thread.currentApp = snapshot.currentApp
  thread.deviceState = snapshot.deviceState
  thread.deviceSnapshot = snapshot
  if (snapshot.screenshot) {
    thread.lastScreenshot = snapshot.screenshot
  }
  addUnique(thread.visitedPackages, snapshot.deviceState.packageName)
  addUnique(thread.visitedActivities, snapshot.deviceState.activity)
}

export function createConversationMessage(
  role: AgentConversationMessage['role'],
  content: string,
): AgentConversationMessage {
  return {
    id: createId('message'),
    role,
    content,
  }
}

function touchThread(thread: AgentThread, now = Date.now()) {
  thread.updatedAt = now
}

function addUnique(values: string[], value: string | undefined) {
  if (value && !values.includes(value)) {
    values.push(value)
  }
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
