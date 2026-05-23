import type {
  DeviceBackend,
  DeviceScreenshot,
  DeviceState,
  ExecuteActionOptions,
  InstalledApp,
} from '../adapters/deviceTypes'
import { buildActionPreview } from './actionPreview'
import type { AgentAction } from './actionTypes'
import { parseModelAction } from './actions'
import { resolveAppCard } from './appCards'
import type {
  AgentConversationMessage,
  AgentHistoryItem,
  ModelConfig,
  OpenAiClient,
} from './openAiTypes'
import { mapActionCoordinates, modelScreenshotView } from './screenshotCoordinates'
import { buildAgentPromptContext, compactThreadContext } from './contextBuilder'
import {
  createAgentThread,
  createConversationMessage,
  recordThreadTurnExecution,
  recordThreadUserMessage,
  startThreadTurn,
  updateThreadDeviceSnapshot,
  type AgentThread,
  type QueuedUserMessage,
} from './agentThread'
import {
  createDefaultActionToolRegistry,
  type ActionToolRegistry,
} from './toolRegistry'

export type AgentTiming = {
  captureMs: number
  currentAppMs: number
  modelMs: number
  parseMs: number
  totalMs: number
}

export type AgentStep = {
  index: number
  turnId?: string
  promptContext?: string
  screenshot: DeviceScreenshot
  currentApp: string
  deviceState: DeviceState
  modelOutput: string
  action: AgentAction
  executionAction: AgentAction
  preview: string
  timing: AgentTiming
  executionResult?: string
}

export type AgentDeviceSnapshot = {
  index: number
  screenshot: DeviceScreenshot
  currentApp: string
  deviceState: DeviceState
}

export type RunAgentStepInput = {
  device: DeviceBackend
  client: OpenAiClient
  modelConfig: ModelConfig
  task: string
  session?: AgentSession
  index?: number
  onSnapshot?: (snapshot: AgentDeviceSnapshot) => void | Promise<void>
}

export type AgentRunStatus =
  | 'awaiting_review'
  | 'awaiting_takeover'
  | 'done'
  | 'loop_guard'
  | 'max_steps'
  | 'stopped'

export type AgentRunResult = {
  status: AgentRunStatus
  steps: AgentStep[]
  reason?: string
}

export type AgentRunnerInput = {
  modelConfig: ModelConfig
  task: string
  autoExecute: boolean
  maxSteps: number
  session?: AgentSession
  signal?: AbortSignal
  onSnapshot?: (snapshot: AgentDeviceSnapshot) => void | Promise<void>
  onStep?: (step: AgentStep) => void
  onExecuted?: (step: AgentStep, result: string) => void | Promise<void>
  confirmSensitiveAction?: ExecuteActionOptions['confirmSensitiveAction']
}

export type CreateAgentRunnerInput = {
  device: DeviceBackend
  client: OpenAiClient
  toolRegistry?: ActionToolRegistry
}

export type AgentSession = AgentThread

export function createAgentSession(task: string): AgentSession {
  return createAgentThread(task)
}

export function addUserMessage(session: AgentSession, message: string) {
  return recordThreadUserMessage(session, message)
}

export function queueUserMessage(session: AgentSession, message: string): QueuedUserMessage {
  const entry = addUserMessage(session, message)
  const queued = {
    id: entry.id,
    message: entry.content,
    queuedAtStep: session.stepNumber,
  }
  session.pendingUserMessages.push(queued)
  return queued
}

export function recordAgentStep(
  session: AgentSession,
  step: AgentStep,
  executionResult?: string,
  success = executionResult === undefined ? undefined : true,
) {
  step.executionResult = executionResult
  updateSessionDeviceSnapshot(session, {
    currentApp: step.currentApp,
    deviceState: step.deviceState,
    screenshot: step.screenshot,
  })

  if (step.turnId && session.turns.some((turn) => turn.id === step.turnId)) {
    recordThreadTurnExecution(session, step.turnId, {
      executionResult,
      success,
    })
    compactThreadContext(session)
    return
  }

  session.lastActionPreview = step.preview
  session.lastExecutionResult = executionResult
  if (step.action.action === 'done') {
    session.finished = true
    session.success = true
    session.progressSummary = step.action.summary ?? step.action.reason ?? 'Task completed.'
  }
  session.history.push({
    step: step.index,
    currentApp: step.currentApp,
    actionPreview: step.preview,
    executionResult,
  })
  if (success !== undefined) {
    session.actionOutcomes.push(success)
    if (!success && executionResult) {
      session.errorDescriptions.push(executionResult)
    }
  }
  if (executionResult) {
    session.messages.push(createConversationMessage('observation', executionResult))
  }
  compactThreadContext(session)
}

export async function runAgentStep({
  device,
  client,
  modelConfig,
  task,
  session,
  index = 1,
  onSnapshot,
}: RunAgentStepInput): Promise<AgentStep> {
  const startedAt = now()
  const captureStartedAt = now()
  const screenshot = await device.screenshot()
  const captureMs = elapsed(captureStartedAt)
  const currentAppStartedAt = now()
  const deviceState = await getDeviceStateOrUnknown(device)
  const currentApp = deviceState.app
  const currentAppMs = elapsed(currentAppStartedAt)
  const modelScreenshot = modelScreenshotView(screenshot)
  await onSnapshot?.({
    index,
    screenshot,
    currentApp,
    deviceState,
  })
  const installedApps = await getInstalledAppsOrEmpty(device)
  const modelStartedAt = now()
  if (session) {
    session.stepNumber = index
    updateSessionDeviceSnapshot(session, { currentApp, deviceState, screenshot })
    drainPendingUserMessages(session)
  }
  const builtContext = buildAgentPromptContext({
    thread: session,
    task,
    latestUserMessage: session ? latestUserMessage(session.messages) : undefined,
    screen: modelScreenshot.screen,
    deviceScreen: screenshot.screen,
    currentApp,
    deviceState,
    appCard: resolveAppCard(deviceState.packageName),
    installedApps,
  })
  const promptContext = builtContext.text
  const completionRequest = {
    ...modelConfig,
    task,
    conversation: session?.messages,
    screenshotDataUrl: modelScreenshot.dataUrl,
    screen: modelScreenshot.screen,
    deviceScreen: screenshot.screen,
    currentApp,
    deviceState,
    history: builtContext.history,
    appCard: resolveAppCard(deviceState.packageName),
    installedApps,
    promptContext,
  }
  let modelOutput = await client.completeAction(completionRequest)
  let modelMs = elapsed(modelStartedAt)
  let parseStartedAt = now()
  let action = parseActionOrError(modelOutput, modelScreenshot.screen)
  let parseMs = elapsed(parseStartedAt)

  if (action instanceof Error) {
    if (!client.repairAction) {
      throw action
    }

    const repairStartedAt = now()
    modelOutput = await client.repairAction({
      ...completionRequest,
      invalidOutput: modelOutput,
      validationError: action.message,
    })
    modelMs += elapsed(repairStartedAt)

    parseStartedAt = now()
    action = parseModelAction(modelOutput, modelScreenshot.screen)
    parseMs += elapsed(parseStartedAt)
  }

  const executionAction = mapActionCoordinates(action, modelScreenshot.screen, screenshot.screen)
  const preview = buildActionPreview(action)
  const timing = {
    captureMs,
    currentAppMs,
    modelMs,
    parseMs,
    totalMs: elapsed(startedAt),
  }
  const turn = session
    ? startThreadTurn(session, {
        index,
        task,
        latestUserMessage: latestUserMessage(session.messages),
        promptContext,
        deviceSnapshot: { currentApp, deviceState, screenshot },
        modelOutput,
        action,
        executionAction,
        preview,
        timing,
      })
    : undefined

  return {
    index,
    turnId: turn?.id,
    promptContext,
    screenshot,
    currentApp,
    deviceState,
    modelOutput,
    action,
    executionAction,
    preview,
    timing,
  }
}

function parseActionOrError(raw: string, screen: DeviceScreenshot['screen']) {
  try {
    return parseModelAction(raw, screen)
  } catch (caught) {
    return caught instanceof Error ? caught : new Error(String(caught))
  }
}

export function createAgentRunner({
  device,
  client,
  toolRegistry = createDefaultActionToolRegistry(),
}: CreateAgentRunnerInput) {
  return {
    async run(input: AgentRunnerInput): Promise<AgentRunResult> {
      const steps: AgentStep[] = []
      const session = input.session ?? createAgentSession(input.task)

      for (let index = 1; index <= input.maxSteps; index += 1) {
        if (input.signal?.aborted) {
          return { status: 'stopped', steps }
        }

        const step = await runAgentStep({
          device,
          client,
          modelConfig: input.modelConfig,
          task: input.task,
          session,
          index,
          onSnapshot: input.onSnapshot,
        })
        steps.push(step)
        input.onStep?.(step)

        if (step.action.action === 'done') {
          recordAgentStep(session, step)
          if (session.pendingUserMessages.length > 0) {
            continue
          }
          return { status: 'done', steps }
        }

        if (step.action.action === 'take_over') {
          recordAgentStep(session, step)
          return { status: 'awaiting_takeover', steps }
        }

        const loopSignal = detectLoopGuard(session, step)
        if (loopSignal) {
          recordAgentStep(session, step, loopSignal)
          return { status: 'loop_guard', steps, reason: loopSignal }
        }

        if (!input.autoExecute) {
          return { status: 'awaiting_review', steps }
        }

        const result = await toolRegistry.execute(step.executionAction, {
          device,
          confirmSensitiveAction: input.confirmSensitiveAction,
        })
        recordAgentStep(session, step, result.summary, result.success)
        await input.onExecuted?.(step, result.summary)
        if (!result.success) {
          return { status: 'awaiting_review', steps, reason: result.summary }
        }
      }

      return { status: 'max_steps', steps }
    },
  }
}

function drainPendingUserMessages(session: AgentSession) {
  if (session.pendingUserMessages.length === 0) {
    return []
  }
  const messages = [...session.pendingUserMessages]
  session.pendingUserMessages = []
  return messages
}

function updateSessionDeviceSnapshot(
  session: AgentSession,
  snapshot: {
    currentApp: string
    deviceState: DeviceState
    screenshot?: DeviceScreenshot
  },
) {
  updateThreadDeviceSnapshot(session, snapshot)
}

function now() {
  return performance.now()
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt)
}

function latestUserMessage(conversation: readonly AgentConversationMessage[]) {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index]
    if (message.role === 'user' && message.content.trim()) {
      return message.content.trim()
    }
  }
  return undefined
}

function detectLoopGuard(session: AgentSession, step: AgentStep) {
  const repeatedPreviewCount = countConsecutive(
    session.history,
    (item) => item.actionPreview === step.preview,
  )
  if (repeatedPreviewCount >= 3) {
    return `Stopped before repeating "${step.preview}" a fourth time.`
  }

  if (step.action.action === 'wait') {
    const waitCount = countConsecutive(session.history, (item) =>
      item.actionPreview.startsWith('wait '),
    )
    if (waitCount >= 3) {
      return 'Stopped before executing a fourth consecutive wait action.'
    }
  }

  return null
}

function countConsecutive(
  history: readonly AgentHistoryItem[],
  predicate: (item: AgentHistoryItem) => boolean,
) {
  let count = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (!predicate(history[index])) {
      break
    }
    count += 1
  }
  return count
}

async function getDeviceStateOrUnknown(device: DeviceBackend): Promise<DeviceState> {
  try {
    return await device.getDeviceState()
  } catch {
    return { app: 'Unknown' }
  }
}

async function getInstalledAppsOrEmpty(device: DeviceBackend): Promise<InstalledApp[]> {
  if (!device.getInstalledApps) {
    return []
  }

  try {
    return await device.getInstalledApps()
  } catch {
    return []
  }
}
