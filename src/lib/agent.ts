import type {
  DeviceBackend,
  DeviceScreenshot,
  DeviceState,
  ExecuteActionOptions,
  InstalledApp,
} from '../adapters/deviceTypes'
import { buildActionPreview } from './actionPreview'
import type { AgentAction } from './actionTypes'
import { parseModelAction } from './actionParser'
import { createDefaultAppCards, resolveAppCard, type AppCardMap } from './appCards'
import type { ActionProtocol } from './actionProtocol'
import {
  customToolDescriptors,
  secretDescriptors,
  type CustomToolDefinition,
  type SecretRecord,
} from './agentResources'
import { createUnknownDeviceState } from './deviceState'
import type {
  AgentConversationMessage,
  AgentHistoryItem,
  CompletionRequest,
  ModelConfig,
  OpenAiClient,
  PromptScreenshotAttachment,
} from './openAiTypes'
import { OpenAiClientError } from './openAiErrors'
import { compactScreenshotForMemory, mapActionCoordinates, modelScreenshotView } from './screenshot'
import { buildAgentPromptContext, compactThreadContext } from './contextBuilder'
import { truncateRetainedText } from './textRetention'
import {
  clearThreadActiveScreenshotRecall,
  createAgentThread,
  createConversationMessage,
  rememberThreadInformation,
  recordThreadScreenshot,
  recordThreadFinalResponse,
  recordThreadTurnExecution,
  recordThreadUserMessage,
  startThreadTurn,
  updateThreadDeviceSnapshot,
  type AgentRecalledScreenshot,
  type AgentThread,
  type QueuedUserMessage,
} from './agentThread'
import {
  createDefaultActionToolRegistry,
  type ActionToolSignature,
  type ActionToolResult,
  type ActionToolRegistry,
} from './toolRegistry'
import { isAbortError, throwIfAborted, withAbort } from './abortSignal'

const MAX_AUTO_RECOVERABLE_EXECUTION_FAILURES = 2
const RUN_RESULT_MODEL_OUTPUT_MAX_LENGTH = 4000

export type AgentTiming = {
  captureMs: number
  currentAppMs: number
  executionMs?: number
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
  toolName?: string
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
  actionProtocol?: ActionProtocol
  task: string
  unrestrictedMode?: boolean
  session?: AgentSession
  appCards?: AppCardMap
  customTools?: readonly CustomToolDefinition[]
  secrets?: readonly SecretRecord[]
  memoryEnabled?: boolean
  memoryItems?: readonly string[]
  actionTools?: Record<string, ActionToolSignature>
  index?: number
  onSnapshot?: (snapshot: AgentDeviceSnapshot) => void | Promise<void>
  signal?: AbortSignal
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
  finalResponse?: string
}

export type AgentRunnerInput = {
  modelConfig: ModelConfig
  actionProtocol?: ActionProtocol
  task: string
  autoExecute: boolean
  maxSteps: number
  session?: AgentSession
  appCards?: AppCardMap
  customTools?: readonly CustomToolDefinition[]
  secrets?: readonly SecretRecord[]
  memoryEnabled?: boolean
  memoryItems?: readonly string[]
  onMemoryItem?: (information: string) => void
  signal?: AbortSignal
  onSnapshot?: (snapshot: AgentDeviceSnapshot) => void | Promise<void>
  onStep?: (step: AgentStep) => void
  onExecuted?: (step: AgentStep, result: string) => void | Promise<void>
  onFinalResponse?: (response: string) => void | Promise<void>
  confirmSensitiveAction?: ExecuteActionOptions['confirmSensitiveAction']
  unrestrictedMode?: boolean
}

export type CreateAgentRunnerInput = {
  device: DeviceBackend
  client: OpenAiClient
  toolRegistry?: ActionToolRegistry
}

export type AgentSession = AgentThread

export type RecordAgentStepOptions = {
  memoryEnabled?: boolean
  onMemoryItem?: (information: string) => void
}

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

export function nextAgentStepIndex(session: AgentSession) {
  const latestHistoryStep = Math.max(0, ...session.history.map((item) => item.step))
  const latestTurnStep = Math.max(0, ...session.turns.map((turn) => turn.index))
  return Math.max(session.stepNumber, latestHistoryStep, latestTurnStep) + 1
}

export function recordAgentStep(
  session: AgentSession,
  step: AgentStep,
  executionResult?: string,
  success = executionResult === undefined ? undefined : true,
  options: RecordAgentStepOptions = {},
) {
  step.executionResult = executionResult
  session.stepNumber = Math.max(session.stepNumber, step.index)
  updateSessionDeviceSnapshot(session, {
    currentApp: step.currentApp,
    deviceState: step.deviceState,
    screenshot: step.screenshot,
  })

  if (step.turnId && session.turns.some((turn) => turn.id === step.turnId)) {
    const turn = recordThreadTurnExecution(session, step.turnId, {
      executionResult,
      toolName: step.toolName,
      memoryEnabled: options.memoryEnabled,
      timing: step.timing,
      success,
    })
    if (options.memoryEnabled && turn.action.action === 'note' && success !== false) {
      const message = turn.action.message.trim()
      if (message) {
        options.onMemoryItem?.(message)
      }
    }
    compactThreadContext(session)
    return
  }

  session.lastActionPreview = step.preview
  session.lastExecutionResult = executionResult
  if (
    options.memoryEnabled &&
    step.action.action === 'note' &&
    success !== false &&
    step.action.message.trim()
  ) {
    const retained = rememberThreadInformation(session, step.action.message)
    if (retained) {
      options.onMemoryItem?.(retained)
    }
  }
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

export function recordAgentStepExecutionDuration(step: AgentStep, executionMs: number) {
  const roundedExecutionMs = Math.max(0, Math.round(executionMs))
  const previousExecutionMs = step.timing.executionMs ?? 0

  step.timing.executionMs = roundedExecutionMs
  step.timing.totalMs = Math.max(0, step.timing.totalMs - previousExecutionMs + roundedExecutionMs)
}

export async function recordAgentFinalResponse({
  client,
  modelConfig,
  session,
  signal,
  task,
}: {
  client: OpenAiClient
  modelConfig: ModelConfig
  session: AgentSession
  signal?: AbortSignal
  task: string
}) {
  throwIfAborted(signal)
  const fallback = session.progressSummary.trim() || 'Task completed.'
  let finalResponse = fallback

  if (client.completeFinalResponse) {
    try {
      finalResponse =
        (
          await withAbort(
            client.completeFinalResponse({
              ...modelConfig,
              task,
              conversation: session.messages.map((message) => ({ ...message })),
              history: session.history.map((item) => ({ ...item })),
              currentApp: session.currentApp,
              deviceState: session.deviceState,
              progressSummary: session.progressSummary,
              signal,
            }),
            signal,
          )
        ).trim() || fallback
    } catch (caught) {
      if (isAbortError(caught)) {
        throw caught
      }
      finalResponse = fallback
    }
  }

  throwIfAborted(signal)
  const message = recordThreadFinalResponse(session, finalResponse)
  compactThreadContext(session)
  return message.content
}

export async function runAgentStep({
  device,
  client,
  modelConfig,
  actionProtocol = 'webdroid_json',
  task,
  session,
  appCards = createDefaultAppCards(),
  customTools,
  memoryEnabled = false,
  memoryItems,
  actionTools,
  index = 1,
  onSnapshot,
  secrets,
  signal,
  unrestrictedMode,
}: RunAgentStepInput): Promise<AgentStep> {
  throwIfAborted(signal)
  const startedAt = now()
  const captureStartedAt = now()
  const screenshot = await withAbort(device.screenshot(), signal)
  const captureMs = elapsed(captureStartedAt)
  const currentAppStartedAt = now()
  const deviceState = await getDeviceStateOrUnknown(device, signal)
  const currentApp = deviceState.app
  const currentAppMs = elapsed(currentAppStartedAt)
  const modelScreenshot = modelScreenshotView(screenshot)
  const retainedScreenshot = compactScreenshotForMemory(screenshot)
  await withAbort(
    Promise.resolve(
      onSnapshot?.({
        index,
        screenshot: retainedScreenshot,
        currentApp,
        deviceState,
      }),
    ),
    signal,
  )
  const installedApps = await getInstalledAppsOrEmpty(device, signal)
  const screenTree = await getScreenTreeOrUndefined(device, signal)
  throwIfAborted(signal)
  const modelStartedAt = now()
  if (session) {
    session.stepNumber = Math.max(session.stepNumber, index)
    updateSessionDeviceSnapshot(session, {
      currentApp,
      deviceState,
      screenshot: retainedScreenshot,
    })
  }
  const pendingUserMessages = session ? [...session.pendingUserMessages] : []
  const recalledScreenshot = session?.activeScreenshotRecall
  const appCard = resolveAppCard(appCards, deviceState.packageName)
  const promptCustomTools = customToolDescriptors(customTools ?? [])
  const promptSecrets = secretDescriptors(secrets ?? [])
  const builtContext = buildAgentPromptContext({
    thread: session,
    task,
    latestUserMessage: session ? latestUserMessage(session.messages) : undefined,
    pendingUserMessages: pendingUserMessages.map((message) => message.message),
    screen: modelScreenshot.screen,
    deviceScreen: screenshot.screen,
    currentApp,
    deviceState,
    screenTree,
    appCard,
    customTools: promptCustomTools,
    installedApps,
    memoryEnabled,
    memoryItems,
    actionTools,
    secrets: promptSecrets,
    recalledScreenshot,
  })
  const promptContext = builtContext.text
  const completionRequest: CompletionRequest = {
    ...modelConfig,
    actionProtocol,
    task,
    conversation: session?.messages,
    recalledScreenshots: recalledScreenshot
      ? [toPromptScreenshotAttachment(recalledScreenshot)]
      : undefined,
    screenshotDataUrl: modelScreenshot.dataUrl,
    screen: modelScreenshot.screen,
    deviceScreen: screenshot.screen,
    currentApp,
    deviceState,
    screenTree,
    history: builtContext.history,
    appCard,
    customTools: promptCustomTools,
    installedApps,
    memoryEnabled,
    memoryItems,
    actionTools,
    secrets: promptSecrets,
    promptContext,
    unrestrictedMode,
    signal,
  }
  let modelOutput = await completeActionWithEmptyContentRetry(client, completionRequest)
  let modelMs = elapsed(modelStartedAt)
  let parseStartedAt = now()
  let action = parseActionOrError(modelOutput, modelScreenshot.screen)
  let parseMs = elapsed(parseStartedAt)

  if (action instanceof Error) {
    if (!client.repairAction) {
      throw action
    }

    const repairStartedAt = now()
    modelOutput = await withAbort(
      client.repairAction({
        ...completionRequest,
        invalidOutput: modelOutput,
        validationError: action.message,
      }),
      signal,
    )
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
        deviceSnapshot: { currentApp, deviceState, screenshot: retainedScreenshot },
        modelOutput,
        action,
        executionAction,
        preview,
        timing,
      })
    : undefined
  if (session) {
    if (recalledScreenshot) {
      clearThreadActiveScreenshotRecall(session)
    }
    recordThreadScreenshot(session, {
      step: index,
      title: `Step #${index}`,
      currentApp,
      deviceState,
      screenshot: retainedScreenshot,
    })
    markPendingUserMessagesConsumed(session, pendingUserMessages)
  }

  return {
    index,
    turnId: turn?.id,
    promptContext,
    screenshot: retainedScreenshot,
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

async function completeActionWithEmptyContentRetry(
  client: OpenAiClient,
  request: CompletionRequest,
) {
  try {
    return await withAbort(client.completeAction(request), request.signal)
  } catch (caught) {
    if (isAbortError(caught)) {
      throw caught
    }
    if (!isEmptyAssistantContentError(caught) || request.signal?.aborted) {
      throw caught
    }

    return withAbort(
      client.completeAction({
        ...request,
        conversation: [],
        history: request.history?.slice(-6),
        stream: false,
        promptContext: [
          request.promptContext,
          emptyContentRetryInstruction(request.actionProtocol),
        ]
          .filter(Boolean)
          .join('\n'),
      }),
      request.signal,
    )
  }
}

function emptyContentRetryInstruction(actionProtocol: CompletionRequest['actionProtocol']) {
  const prefix = [
    'The previous model response for this exact screenshot was empty.',
    'Use the screenshot and compact context above, then return exactly one valid',
  ].join(' ')
  if (actionProtocol === 'open_autoglm_function') {
    return `${prefix} Open-AutoGLM <think>...</think><answer>...</answer> action.`
  }
  if (actionProtocol === 'mobilerun_xml') {
    return `${prefix} mobilerun <function_calls>...</function_calls> tool call block.`
  }
  return `${prefix} JSON action object.`
}

function isEmptyAssistantContentError(error: unknown) {
  return (
    error instanceof OpenAiClientError &&
    /No assistant content returned by model/i.test(error.message)
  )
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
      const startIndex = nextAgentStepIndex(session)
      let recoverableExecutionFailures = 0

      for (let offset = 0; offset < input.maxSteps; offset += 1) {
        const index = startIndex + offset
        if (input.signal?.aborted) {
          return { status: 'stopped', steps }
        }

        let step: AgentStep
        try {
          step = await runAgentStep({
            device,
            client,
            modelConfig: input.modelConfig,
            actionProtocol: input.actionProtocol,
            task: input.task,
            session,
            appCards: input.appCards,
            customTools: input.customTools,
            memoryEnabled: input.memoryEnabled,
            memoryItems: input.memoryItems,
            actionTools: toolRegistry.getSignatures(),
            index,
            onSnapshot: input.onSnapshot,
            secrets: input.secrets,
            signal: input.signal,
            unrestrictedMode: input.unrestrictedMode,
          })
        } catch (caught) {
          if (input.signal?.aborted || isAbortError(caught)) {
            return { status: 'stopped', steps }
          }
          throw caught
        }
        if (input.signal?.aborted) {
          return { status: 'stopped', steps }
        }
        input.onStep?.(step)
        steps.push(retainStepForRunResult(step))

        if (step.action.action === 'done') {
          recordAgentStep(session, step, undefined, undefined, {
            memoryEnabled: input.memoryEnabled,
            onMemoryItem: input.onMemoryItem,
          })
          if (session.pendingUserMessages.length > 0) {
            continue
          }
          try {
            const finalResponse = await recordAgentFinalResponse({
              client,
              modelConfig: input.modelConfig,
              session,
              signal: input.signal,
              task: input.task,
            })
            await withAbort(Promise.resolve(input.onFinalResponse?.(finalResponse)), input.signal)
            return { status: 'done', steps, finalResponse }
          } catch (caught) {
            if (input.signal?.aborted || isAbortError(caught)) {
              return { status: 'stopped', steps }
            }
            throw caught
          }
        }

        if (step.action.action === 'take_over' && !input.unrestrictedMode) {
          recordAgentStep(session, step, undefined, undefined, {
            memoryEnabled: input.memoryEnabled,
            onMemoryItem: input.onMemoryItem,
          })
          return { status: 'awaiting_takeover', steps }
        }

        const loopSignal = detectLoopGuard(session, step)
        if (loopSignal) {
          recordAgentStep(session, step, loopSignal, undefined, {
            memoryEnabled: input.memoryEnabled,
            onMemoryItem: input.onMemoryItem,
          })
          return { status: 'loop_guard', steps, reason: loopSignal }
        }

        if (!input.autoExecute) {
          return { status: 'awaiting_review', steps }
        }

        if (input.signal?.aborted) {
          return { status: 'stopped', steps }
        }

        let result: ActionToolResult
        const executionStartedAt = now()
        try {
          result = await toolRegistry.execute(step.executionAction, {
            device,
            confirmSensitiveAction: input.confirmSensitiveAction,
            unrestrictedMode: input.unrestrictedMode,
            safetyContext: {
              task: input.task,
              currentApp: step.currentApp,
              deviceState: step.deviceState,
              modelOutput: step.modelOutput,
            },
            customTools: input.customTools,
            secrets: input.secrets,
            screenshotRecallThread: session,
            signal: input.signal,
          })
        } catch (caught) {
          if (input.signal?.aborted || isAbortError(caught)) {
            return { status: 'stopped', steps }
          }
          throw caught
        }
        step.toolName = result.toolName
        recordAgentStepExecutionDuration(step, elapsed(executionStartedAt))
        if (input.signal?.aborted) {
          return { status: 'stopped', steps }
        }
        recordAgentStep(session, step, result.summary, result.success, {
          memoryEnabled: input.memoryEnabled,
          onMemoryItem: input.onMemoryItem,
        })
        steps[steps.length - 1] = retainStepForRunResult(step)
        try {
          await withAbort(Promise.resolve(input.onExecuted?.(step, result.summary)), input.signal)
        } catch (caught) {
          if (input.signal?.aborted || isAbortError(caught)) {
            return { status: 'stopped', steps }
          }
          throw caught
        }
        if (!result.success) {
          if (result.safetyDecision === 'take_over') {
            return { status: 'awaiting_takeover', steps, reason: result.summary }
          }
          if (!isAutoRecoverableExecutionFailure(result)) {
            return { status: 'awaiting_review', steps, reason: result.summary }
          }

          recoverableExecutionFailures += 1
          if (recoverableExecutionFailures > MAX_AUTO_RECOVERABLE_EXECUTION_FAILURES) {
            return { status: 'awaiting_review', steps, reason: result.summary }
          }
          continue
        }
        recoverableExecutionFailures = 0
      }

      return { status: 'max_steps', steps }
    },
  }
}

function isAutoRecoverableExecutionFailure(result: ActionToolResult) {
  return !result.safetyDecision
}

function retainStepForRunResult(step: AgentStep): AgentStep {
  return {
    ...step,
    promptContext: undefined,
    modelOutput: truncateRetainedText(step.modelOutput, RUN_RESULT_MODEL_OUTPUT_MAX_LENGTH),
    screenshot: stripScreenshotImageData(step.screenshot),
  }
}

function stripScreenshotImageData(screenshot: DeviceScreenshot): DeviceScreenshot {
  return {
    dataUrl: '',
    screen: screenshot.screen,
    ...(screenshot.modelScreen ? { modelScreen: screenshot.modelScreen } : {}),
    ...(screenshot.modelGridDivisions !== undefined
      ? { modelGridDivisions: screenshot.modelGridDivisions }
      : {}),
  }
}

function toPromptScreenshotAttachment(
  recalledScreenshot: AgentRecalledScreenshot,
): PromptScreenshotAttachment {
  const view = modelScreenshotView(recalledScreenshot.screenshot)
  return {
    label: `${recalledScreenshot.id} from step #${recalledScreenshot.step}`,
    dataUrl: view.dataUrl,
    screen: view.screen,
    step: recalledScreenshot.step,
    currentApp: recalledScreenshot.currentApp || recalledScreenshot.deviceState.app,
  }
}

function markPendingUserMessagesConsumed(
  session: AgentSession,
  consumedMessages: readonly QueuedUserMessage[],
) {
  if (consumedMessages.length === 0) {
    return
  }

  const consumedIds = new Set(consumedMessages.map((message) => message.id))
  session.pendingUserMessages = session.pendingUserMessages.filter(
    (message) => !consumedIds.has(message.id),
  )
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

async function getDeviceStateOrUnknown(
  device: DeviceBackend,
  signal?: AbortSignal,
): Promise<DeviceState> {
  try {
    return await withAbort(device.getDeviceState(), signal)
  } catch {
    throwIfAborted(signal)
    return createUnknownDeviceState()
  }
}

async function getInstalledAppsOrEmpty(
  device: DeviceBackend,
  signal?: AbortSignal,
): Promise<InstalledApp[]> {
  if (!device.getInstalledApps) {
    return []
  }

  try {
    return await withAbort(device.getInstalledApps(), signal)
  } catch {
    throwIfAborted(signal)
    return []
  }
}

async function getScreenTreeOrUndefined(device: DeviceBackend, signal?: AbortSignal) {
  if (!device.getScreenTree) {
    return undefined
  }

  try {
    return await withAbort(device.getScreenTree(), signal)
  } catch {
    throwIfAborted(signal)
    return undefined
  }
}
