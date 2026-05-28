import type { DeviceScreenshot, DeviceState } from '../adapters/deviceTypes'
import type { AgentAction } from './actionTypes'
import type { ActionProtocol } from './actionProtocol'
import { createUnknownDeviceState, UNKNOWN_APP_NAME } from './deviceState'
import type { AgentConversationMessage, AgentHistoryItem, ModelConfig } from './openAiTypes'
import { compactScreenshotForMemory } from './screenshot'
import { truncateRetainedTailText, truncateRetainedText } from './textRetention'

const DEFAULT_THREAD_TITLE = 'New chat'
const MAX_THREAD_MEMORY_ITEMS = 24
const THREAD_MEMORY_ITEM_MAX_LENGTH = 1200
export const MAX_THREAD_SCREENSHOT_REFERENCES = 32

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
  actionProtocol?: ActionProtocol
  modelConfig?: Pick<ModelConfig, 'baseUrl' | 'model' | 'reasoningEffort' | 'stream'>
  autoExecute?: boolean
  maxSteps?: number
  memoryEnabled?: boolean
  confirmSensitiveActions?: boolean
  unrestrictedMode?: boolean
  screenBlackoutDuringAutoControl?: boolean
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

export type AgentScreenshotReference = {
  id: string
  step: number
  title: string
  currentApp: string
  deviceState: DeviceState
  screenshot: DeviceScreenshot
  createdAt: number
}

export type AgentRecalledScreenshot = AgentScreenshotReference & {
  recalledAt: number
}

export type AgentTurnTiming = {
  captureMs: number
  currentAppMs: number
  executionMs?: number
  modelMs: number
  parseMs: number
  totalMs: number
}

export type AgentTurn = {
  id: string
  index: number
  status: AgentTurnStatus
  toolName?: string
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
      modelOutput?: string
      actionPreview: string
      createdAt: number
    }
  | {
      id: string
      type: 'assistant_message'
      messageId: string
      message: string
      createdAt: number
    }
  | {
      id: string
      type: 'action_execution'
      turnId: string
      toolName?: string
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
  screenshotReferences: AgentScreenshotReference[]
  activeScreenshotRecall?: AgentRecalledScreenshot
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
    title: task.trim() || DEFAULT_THREAD_TITLE,
    status: 'idle',
    task,
    currentApp: UNKNOWN_APP_NAME,
    deviceState: createUnknownDeviceState(),
    visitedPackages: [],
    visitedActivities: [],
    actionOutcomes: [],
    errorDescriptions: [],
    memory: [],
    screenshotReferences: [],
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
  if (!thread.title.trim() || thread.title === DEFAULT_THREAD_TITLE) {
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
  const turnDeviceSnapshot = omitSnapshotScreenshot(input.deviceSnapshot)
  const turn: AgentTurn = {
    id: input.id ?? createId('turn'),
    index: input.index,
    status: input.status ?? 'planned',
    task: input.task,
    latestUserMessage: input.latestUserMessage,
    promptContext: input.promptContext,
    deviceSnapshot: turnDeviceSnapshot,
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
      currentApp: turnDeviceSnapshot.currentApp,
      deviceState: turnDeviceSnapshot.deviceState,
    },
    { now },
  )
  addThreadEvent(
    thread,
    {
      type: 'assistant_action',
      turnId: turn.id,
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
    toolName?: string
    memoryEnabled?: boolean
    success?: boolean
    status?: AgentTurnStatus
    timing?: AgentTurnTiming
    now?: number
  } = {},
) {
  const turn = thread.turns.find((candidate) => candidate.id === turnId)
  if (!turn) {
    throw new Error(`Unknown turn "${turnId}".`)
  }

  const now = input.now ?? Date.now()
  turn.executionResult = input.executionResult
  if (input.toolName) {
    turn.toolName = input.toolName
  }
  turn.success = input.success
  if (input.timing) {
    turn.timing = input.timing
  }
  turn.completedAt = now
  turn.status =
    input.status ??
    (turn.action.action === 'done'
      ? 'done'
      : input.success === false
          ? 'failed'
          : input.success === true
            ? 'executed'
            : turn.action.action === 'take_over'
              ? 'awaiting_takeover'
              : 'executed')

  thread.lastActionPreview = turn.preview
  thread.lastExecutionResult = input.executionResult
  if (
    input.memoryEnabled &&
    turn.action.action === 'note' &&
    input.success !== false &&
    turn.action.message.trim()
  ) {
    rememberThreadInformation(thread, turn.action.message, { now })
  }
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
      recordThreadAssistantMessage(thread, thread.progressSummary, { now })
    }
  }

  if (input.executionResult) {
    thread.messages.push(createConversationMessage('observation', input.executionResult))
    addThreadEvent(
      thread,
      {
        type: 'action_execution',
        turnId: turn.id,
        toolName: input.toolName,
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

export function rememberThreadInformation(
  thread: AgentThread,
  information: string,
  options: { now?: number } = {},
) {
  const content = information.trim()
  if (!content) {
    return null
  }

  const retained = truncateRetainedText(content, THREAD_MEMORY_ITEM_MAX_LENGTH)
  thread.memory = [
    ...thread.memory.filter((item) => item.trim() && item.trim() !== retained),
    retained,
  ].slice(-MAX_THREAD_MEMORY_ITEMS)
  touchThread(thread, options.now)
  return retained
}

export function appendThreadContextSummary(
  thread: AgentThread,
  summary: string,
  options: { maxLength?: number; now?: number } = {},
) {
  const content = summary.trim()
  if (!content) {
    return thread.contextSummary
  }

  thread.contextSummary = truncateRetainedTailText(
    [thread.contextSummary, content].filter(Boolean).join('\n'),
    options.maxLength ?? 16000,
  )
  touchThread(thread, options.now)
  return thread.contextSummary
}

export function recordThreadAssistantMessage(
  thread: AgentThread,
  message: string,
  options: { now?: number } = {},
) {
  const content = message.trim()
  if (!content) {
    throw new Error('Cannot add an empty assistant message.')
  }

  const now = options.now ?? Date.now()
  const entry = createConversationMessage('assistant', content)
  thread.messages.push(entry)
  addThreadEvent(
    thread,
    {
      type: 'assistant_message',
      messageId: entry.id,
      message: content,
    },
    { now },
  )
  return entry
}

export function recordThreadFinalResponse(
  thread: AgentThread,
  message: string,
  options: { now?: number } = {},
) {
  const content = message.trim()
  if (!content) {
    throw new Error('Cannot add an empty final response.')
  }

  const lastMessage = thread.messages.at(-1)
  if (
    lastMessage?.role === 'assistant' &&
    (!thread.progressSummary || lastMessage.content === thread.progressSummary)
  ) {
    lastMessage.content = content
    const event = thread.events.find(
      (candidate) =>
        candidate.type === 'assistant_message' && candidate.messageId === lastMessage.id,
    )
    if (event?.type === 'assistant_message') {
      event.message = content
    }
    touchThread(thread, options.now)
    return lastMessage
  }

  return recordThreadAssistantMessage(thread, content, options)
}

export function recordThreadStatus(
  thread: AgentThread,
  status: AgentThreadStatus,
  message?: string,
  options: { now?: number } = {},
) {
  const latestStatusEvent = [...thread.events]
    .reverse()
    .find((event) => event.type === 'status_change')
  if (
    thread.status === status &&
    latestStatusEvent?.type === 'status_change' &&
    latestStatusEvent.message === message
  ) {
    touchThread(thread, options.now)
    return latestStatusEvent
  }

  return addThreadEvent(
    thread,
    {
      type: 'status_change',
      status,
      ...(message ? { message } : {}),
    },
    options,
  )
}

export function recoverInterruptedThread(
  thread: AgentThread,
  message = 'Previous run was interrupted before it finished.',
  options: { now?: number } = {},
) {
  if (thread.status !== 'running') {
    return false
  }

  for (const turn of thread.turns) {
    if (turn.status === 'planned') {
      turn.status = 'awaiting_review'
    }
  }
  recordThreadStatus(thread, 'stopped', message, options)
  return true
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
  } as AgentThreadEvent
  thread.events.push(entry)
  if (entry.type === 'status_change') {
    thread.status = entry.status
  }
  touchThread(thread, now)
  return entry
}

export function recordThreadScreenshot(
  thread: AgentThread,
  input: {
    step: number
    currentApp: string
    deviceState: DeviceState
    screenshot: DeviceScreenshot
    title?: string
    now?: number
  },
) {
  const now = input.now ?? Date.now()
  const step = Math.max(1, Math.round(input.step))
  const id = screenshotReferenceIdForStep(step)
  const entry: AgentScreenshotReference = {
    id,
    step,
    title: input.title ?? `Step #${step}`,
    currentApp: input.currentApp,
    deviceState: cloneValue(input.deviceState),
    screenshot: compactScreenshotForMemory(input.screenshot),
    createdAt: now,
  }
  const references = thread.screenshotReferences ?? []
  thread.screenshotReferences = [
    ...references.filter((reference) => reference.id !== id && reference.step !== step),
    entry,
  ].slice(-MAX_THREAD_SCREENSHOT_REFERENCES)
  touchThread(thread, now)
  return entry
}

export function recallThreadScreenshot(
  thread: AgentThread,
  action: Extract<AgentAction, { action: 'view_screenshot' }>,
  options: { now?: number } = {},
) {
  const references = thread.screenshotReferences ?? []
  const reference = resolveScreenshotReference(references, action)
  if (!reference) {
    const available = references.map((item) => item.id).slice(-8).join(', ')
    throw new Error(
      available
        ? `Screenshot ${formatRequestedScreenshotReference(action)} was not found. Available: ${available}.`
        : 'No recalled screenshots are available yet.',
    )
  }

  const now = options.now ?? Date.now()
  const recalled: AgentRecalledScreenshot = {
    ...reference,
    deviceState: cloneValue(reference.deviceState),
    screenshot: compactScreenshotForMemory(reference.screenshot),
    recalledAt: now,
  }
  thread.activeScreenshotRecall = recalled
  touchThread(thread, now)

  const screen = recalled.screenshot.modelScreen ?? recalled.screenshot.screen
  return [
    `Recalled screenshot ${recalled.id} from step #${recalled.step}.`,
    `App: ${recalled.currentApp || recalled.deviceState.app || UNKNOWN_APP_NAME}.`,
    `Image size: ${screen.width}x${screen.height}.`,
    'It will be attached to the next model request for visual inspection.',
  ].join('\n')
}

export function clearThreadActiveScreenshotRecall(
  thread: AgentThread,
  options: { now?: number } = {},
) {
  if (!thread.activeScreenshotRecall) {
    return null
  }

  const recalled = thread.activeScreenshotRecall
  delete thread.activeScreenshotRecall
  touchThread(thread, options.now)
  return recalled
}

export function updateThreadDeviceSnapshot(
  thread: AgentThread,
  snapshot: AgentDeviceSnapshot,
) {
  const retainedSnapshot = compactDeviceSnapshot(snapshot)
  thread.currentApp = retainedSnapshot.currentApp
  thread.deviceState = retainedSnapshot.deviceState
  thread.deviceSnapshot = retainedSnapshot
  if (retainedSnapshot.screenshot) {
    thread.lastScreenshot = retainedSnapshot.screenshot
  }
  addUnique(thread.visitedPackages, retainedSnapshot.deviceState.packageName)
  addUnique(thread.visitedActivities, retainedSnapshot.deviceState.activity)
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

function compactDeviceSnapshot(snapshot: AgentDeviceSnapshot): AgentDeviceSnapshot {
  return snapshot.screenshot
    ? {
        ...snapshot,
        screenshot: compactScreenshotForMemory(snapshot.screenshot),
      }
    : snapshot
}

function omitSnapshotScreenshot(snapshot: AgentDeviceSnapshot): AgentDeviceSnapshot {
  return {
    currentApp: snapshot.currentApp,
    deviceState: snapshot.deviceState,
  }
}

function resolveScreenshotReference(
  references: readonly AgentScreenshotReference[],
  action: Extract<AgentAction, { action: 'view_screenshot' }>,
) {
  if (action.step !== undefined) {
    return [...references].reverse().find((reference) => reference.step === action.step)
  }

  const ref = action.ref?.trim()
  if (!ref) {
    return undefined
  }
  const normalizedRef = normalizeScreenshotReference(ref)
  const numericStep = parseScreenshotStepReference(ref)

  return [...references]
    .reverse()
    .find(
      (reference) =>
        normalizeScreenshotReference(reference.id) === normalizedRef ||
        normalizeScreenshotReference(reference.title) === normalizedRef ||
        (numericStep !== null && reference.step === numericStep),
    )
}

function screenshotReferenceIdForStep(step: number) {
  return `step-${step}`
}

function parseScreenshotStepReference(ref: string) {
  const match = ref.trim().match(/(?:^|[#\s_-])(\d+)(?:$|\D)/)
  return match ? Number(match[1]) : null
}

function normalizeScreenshotReference(ref: string) {
  return ref.trim().toLowerCase().replace(/[\s_#]+/g, '-')
}

function formatRequestedScreenshotReference(
  action: Extract<AgentAction, { action: 'view_screenshot' }>,
) {
  return action.ref ?? (action.step === undefined ? '' : `step-${action.step}`)
}

function cloneValue<Value>(value: Value): Value {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as Value)
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
