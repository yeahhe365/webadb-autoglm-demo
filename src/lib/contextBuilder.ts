import type { DeviceScreenTree, DeviceState, InstalledApp } from '../adapters/deviceTypes'
import { formatScreenTreeForPrompt } from '../adapters/uiAutomator'
import type { ScreenSize } from './actionTypes'
import {
  addThreadEvent,
  appendThreadContextSummary,
  type AgentThread,
  type AgentRecalledScreenshot,
  type AgentScreenshotReference,
  type AgentTurn,
} from './agentThread'
import type { AgentHistoryItem } from './openAiTypes'
import type { CustomToolDescriptor, SecretDescriptor } from './agentResources'
import type { ActionToolParameter, ActionToolSignature } from './toolRegistry'
import {
  truncateOptionalRetainedText,
  truncateRetainedText,
} from './textRetention'
import {
  buildPromptScreenInfo,
  CANONICAL_COORDINATE_INSTRUCTION,
  formatInstalledAppsForPrompt,
  formatPromptHistoryItem,
} from './promptContextFormatting'
import { modelScreenshotView } from './screenshot'

const COMPACTED_TURN_EXECUTION_RESULT_MAX_LENGTH = 4000
const CONTEXT_SUMMARY_MAX_LENGTH = 16000
const APP_CARD_PROMPT_MAX_LENGTH = 5000
const CUSTOM_TOOL_DESCRIPTION_MAX_LENGTH = 600
const PENDING_USER_MESSAGE_MAX_LENGTH = 1200
const PROMPT_HISTORY_RESULT_MAX_LENGTH = 1200
const SHARED_STATE_RESULT_MAX_LENGTH = 360
const SHARED_STATE_RECENT_TURNS = 5
const SCREENSHOT_REFERENCE_PROMPT_LIMIT = 12
const TASK_CONTEXT_MAX_LENGTH = 2000
const TASK_STATE_MEMORY_ITEM_MAX_LENGTH = 400
const TASK_STATE_MEMORY_ITEMS = 8
const TASK_STATE_VISITED_APP_LIMIT = 8

export type BuildAgentPromptContextInput = {
  thread?: AgentThread
  task: string
  history?: readonly AgentHistoryItem[]
  latestUserMessage?: string
  screen: ScreenSize
  deviceScreen?: ScreenSize
  currentApp?: string
  deviceState?: DeviceState
  appCard?: string
  customTools?: readonly CustomToolDescriptor[]
  installedApps?: readonly InstalledApp[]
  memoryEnabled?: boolean
  memoryItems?: readonly string[]
  actionTools?: Record<string, ActionToolSignature>
  maxRecentTurns?: number
  pendingUserMessages?: readonly string[]
  screenTree?: DeviceScreenTree
  secrets?: readonly SecretDescriptor[]
  recalledScreenshot?: AgentRecalledScreenshot
}

export type BuiltAgentPromptContext = {
  text: string
  history: AgentHistoryItem[]
  latestUserMessage?: string
}

export function buildAgentPromptContext({
  thread,
  task,
  history: fallbackHistory,
  latestUserMessage,
  screen,
  deviceScreen,
  currentApp,
  deviceState,
  appCard,
  customTools,
  installedApps,
  memoryEnabled = false,
  memoryItems,
  actionTools,
  maxRecentTurns = 12,
  pendingUserMessages,
  screenTree,
  secrets,
  recalledScreenshot,
}: BuildAgentPromptContextInput): BuiltAgentPromptContext {
  const history = thread
    ? historyFromRecentTurns(thread, maxRecentTurns)
    : (fallbackHistory ?? []).slice(-maxRecentTurns)
  const screenInfo = buildPromptScreenInfo({ currentApp, deviceScreen, deviceState, screen })

  const lines = [
    `Task: ${truncatePromptContextText(task, TASK_CONTEXT_MAX_LENGTH)}`,
    latestUserMessage
      ? `Latest user message: ${truncatePromptContextText(
          latestUserMessage,
          TASK_CONTEXT_MAX_LENGTH,
        )}`
      : null,
    formatPendingUserMessages(pendingUserMessages),
    formatTaskState({
      thread,
      task,
      latestUserMessage,
      currentApp,
      deviceState,
      memoryEnabled,
      memoryItems,
    }),
    formatSharedState({
      thread,
      pendingUserMessages,
    }),
    formatAvailableScreenshotReferences(thread, Boolean(actionTools?.view_screenshot)),
    formatRecalledScreenshotForPrompt(recalledScreenshot ?? thread?.activeScreenshotRecall),
    thread?.contextSummary ? `<context_summary>\n${thread.contextSummary}\n</context_summary>` : null,
    thread ? formatRecentActionErrors(thread) : null,
    `Screen Info: ${screenInfo}`,
    formatScreenTreeForPrompt(screenTree),
    appCard
      ? `<app_card>\n${truncatePromptContextText(appCard, APP_CARD_PROMPT_MAX_LENGTH)}\n</app_card>`
      : null,
    formatActionToolsForPrompt(actionTools),
    formatCustomToolsForPrompt(customTools),
    formatSecretsForPrompt(secrets),
    formatInstalledAppsForPrompt(
      installedApps,
      [task, latestUserMessage, pendingUserMessages?.join('\n')].join('\n'),
    ),
    'Treat the latest user message as the current instruction. Use earlier messages, observations, and context summary only as context.',
    'If a recent action failed, use its feedback to choose a different recovery action; do not repeat the exact same failed action.',
    CANONICAL_COORDINATE_INSTRUCTION,
  ].filter(Boolean) as string[]

  if (history.length > 0) {
    lines.push('Previous steps:')
    for (const item of history) {
      lines.push(formatPromptHistoryItem(item))
    }
  }

  return {
    text: lines.join('\n'),
    history,
    latestUserMessage,
  }
}

function formatAvailableScreenshotReferences(
  thread: AgentThread | undefined,
  recallToolAvailable: boolean,
) {
  const references = thread?.screenshotReferences ?? []
  if (!recallToolAvailable || references.length === 0) {
    return null
  }

  return [
    '<available_screenshots>',
    'Use view_screenshot with ref or step to inspect one old screenshot; it will be attached to the next model turn.',
    ...references.slice(-SCREENSHOT_REFERENCE_PROMPT_LIMIT).map(formatScreenshotReferenceLine),
    '</available_screenshots>',
  ].join('\n')
}

function formatScreenshotReferenceLine(reference: AgentScreenshotReference) {
  const view = modelScreenshotView(reference.screenshot)
  const app = sanitizeTaskStateLine(reference.currentApp || reference.deviceState.app)
  const packageName = sanitizeTaskStateLine(reference.deviceState.packageName)
  const appPart = [app, packageName ? `(${packageName})` : null].filter(Boolean).join(' ')
  return [
    `- ${reference.id}: step #${reference.step}`,
    appPart ? `app=${appPart}` : null,
    `screen=${view.screen.width}x${view.screen.height}`,
  ]
    .filter(Boolean)
    .join(' | ')
}

function formatRecalledScreenshotForPrompt(recalledScreenshot?: AgentRecalledScreenshot) {
  if (!recalledScreenshot) {
    return null
  }

  const view = modelScreenshotView(recalledScreenshot.screenshot)
  return [
    '<recalled_screenshot>',
    `Attached recalled image: ${recalledScreenshot.id}`,
    `Step: #${recalledScreenshot.step}`,
    `App: ${sanitizeTaskStateLine(
      recalledScreenshot.currentApp || recalledScreenshot.deviceState.app,
    ) || 'Unknown'}`,
    `Screen: ${view.screen.width}x${view.screen.height}`,
    'Compare the recalled image with the current screenshot when choosing the next action.',
    '</recalled_screenshot>',
  ].join('\n')
}

function formatCustomToolsForPrompt(customTools?: readonly CustomToolDescriptor[]) {
  const tools = customTools?.filter((tool) => tool.name.trim() && tool.description.trim()) ?? []
  if (tools.length === 0) {
    return null
  }

  return [
    '<available_custom_tools>',
    ...tools.map(
      (tool) =>
        `${tool.name}: ${truncatePromptContextText(
          tool.description,
          CUSTOM_TOOL_DESCRIPTION_MAX_LENGTH,
        )}`,
    ),
    '</available_custom_tools>',
  ].join('\n')
}

function formatActionToolsForPrompt(actionTools?: Record<string, ActionToolSignature>) {
  const tools = Object.entries(actionTools ?? {})
    .filter(([name, tool]) => name.trim() && tool.description.trim())
    .sort(([left], [right]) => left.localeCompare(right))
  if (tools.length === 0) {
    return null
  }

  return [
    '<available_action_tools>',
    'Choose only one listed action tool unless using sequence/repeat with listed child actions.',
    ...tools.map(
      ([name, tool]) =>
        `${name}(${formatActionToolParameters(tool.parameters)}): ${truncatePromptContextText(
          tool.description,
          CUSTOM_TOOL_DESCRIPTION_MAX_LENGTH,
        )}`,
    ),
    '</available_action_tools>',
  ].join('\n')
}

function formatActionToolParameters(parameters: Record<string, ActionToolParameter>) {
  const entries = Object.entries(parameters)
  if (entries.length === 0) {
    return ''
  }

  return entries
    .map(([name, parameter]) => {
      const required = parameter.required === false ? 'optional' : 'required'
      const defaultValue =
        parameter.default === undefined ? '' : ` default=${JSON.stringify(parameter.default)}`
      return `${name}:${parameter.type} ${required}${defaultValue}`
    })
    .join(', ')
}

function formatSecretsForPrompt(secrets?: readonly SecretDescriptor[]) {
  const records = secrets?.filter((secret) => secret.id.trim()) ?? []
  if (records.length === 0) {
    return null
  }

  return [
    '<available_secrets>',
    ...records.map((secret) => `${secret.id}: ${secret.label || secret.id}`),
    '</available_secrets>',
    'Use type_secret with a listed secret id when a secret value must be typed. Secret values are local and are never shown to the model.',
  ].join('\n')
}

export function historyFromRecentTurns(thread: AgentThread, maxRecentTurns = 12) {
  const completedTurns = thread.turns.filter(isCompletedTurn)
  if (completedTurns.length === 0) {
    return thread.history.slice(-maxRecentTurns)
  }
  return completedTurns.slice(-maxRecentTurns).map(turnToHistoryItem)
}

export function compactThreadContext(
  thread: AgentThread,
  options: { keepRecentTurns?: number; now?: number } = {},
) {
  const keepRecentTurns = options.keepRecentTurns ?? 12
  const completedTurns = thread.turns.filter(isCompletedTurn)
  const compactableTurns = completedTurns.slice(0, Math.max(0, completedTurns.length - keepRecentTurns))
  const turnsToCompact = compactableTurns.filter(
    (turn) => turn.index > thread.contextCompactedThroughStep,
  )

  if (turnsToCompact.length === 0) {
    return null
  }

  const summary = turnsToCompact.map(formatTurnSummary).join('\n')
  appendThreadContextSummary(
    thread,
    summary,
    {
      maxLength: CONTEXT_SUMMARY_MAX_LENGTH,
      now: options.now,
    },
  )
  thread.contextCompactedThroughStep = turnsToCompact.at(-1)?.index ?? thread.contextCompactedThroughStep
  for (const turn of turnsToCompact) {
    turn.compacted = true
    turn.promptContext = ''
    turn.modelOutput = ''
    turn.executionResult = truncateOptionalRetainedText(
      turn.executionResult,
      COMPACTED_TURN_EXECUTION_RESULT_MAX_LENGTH,
    )
  }
  addThreadEvent(
    thread,
    {
      type: 'context_compaction',
      summary,
      compactedThroughStep: thread.contextCompactedThroughStep,
    },
    { now: options.now },
  )

  return summary
}

function turnToHistoryItem(turn: AgentTurn): AgentHistoryItem {
  return {
    step: turn.index,
    currentApp: turn.deviceSnapshot.currentApp,
    actionPreview: turn.preview,
    executionResult: truncateOptionalRetainedText(
      turn.executionResult,
      PROMPT_HISTORY_RESULT_MAX_LENGTH,
    ),
  }
}

function isCompletedTurn(turn: AgentTurn) {
  return turn.status !== 'planned'
}

function formatTurnSummary(turn: AgentTurn) {
  return formatPromptHistoryItem(turnToHistoryItem(turn))
}

function formatRecentActionErrors(thread: AgentThread) {
  const failedTurns = thread.turns
    .filter((turn) => isCompletedTurn(turn) && (turn.status === 'failed' || turn.success === false))
    .slice(-5)
  if (failedTurns.length === 0) {
    return null
  }

  return [
    '<recent_action_errors>',
    ...failedTurns.map((turn) =>
      [
        `- Step ${turn.index}`,
        `action=${turn.preview}`,
        turn.executionResult
          ? `feedback=${truncateRetainedText(turn.executionResult, PROMPT_HISTORY_RESULT_MAX_LENGTH)}`
          : null,
      ]
        .filter(Boolean)
        .join(' | '),
    ),
    '</recent_action_errors>',
  ].join('\n')
}

function formatPendingUserMessages(messages?: readonly string[]) {
  const pendingMessages = messages?.map((message) => message.trim()).filter(Boolean) ?? []
  if (pendingMessages.length === 0) {
    return null
  }

  return [
    '<pending_user_messages>',
    ...pendingMessages.map(
      (message) => `- ${truncatePromptContextText(message, PENDING_USER_MESSAGE_MAX_LENGTH)}`,
    ),
    '</pending_user_messages>',
  ].join('\n')
}

function formatSharedState({
  thread,
  pendingUserMessages,
}: {
  thread?: AgentThread
  pendingUserMessages?: readonly string[]
}) {
  if (!thread) {
    return null
  }

  const completedTurns = thread.turns.filter(isCompletedTurn)
  const failedTurns = completedTurns.filter(
    (turn) => turn.status === 'failed' || turn.success === false,
  )
  const recentTurns = completedTurns.slice(-SHARED_STATE_RECENT_TURNS)
  const pendingMessageCount =
    pendingUserMessages?.filter((message) => message.trim()).length ??
    thread.pendingUserMessages.length
  const lastCompletedStep = completedTurns.at(-1)?.index ?? thread.stepNumber
  const lines = [
    '<shared_state>',
    `Status: ${thread.status}`,
    `Last completed step: ${lastCompletedStep}`,
    `Completed turns: ${completedTurns.length}`,
    failedTurns.length > 0 ? `Failed turns: ${failedTurns.length}` : null,
    thread.contextCompactedThroughStep > 0
      ? `Context compacted through step: ${thread.contextCompactedThroughStep}`
      : null,
    pendingMessageCount > 0 ? `Pending user messages: ${pendingMessageCount}` : null,
    thread.progressSummary ? `Progress summary: ${sanitizeTaskStateLine(thread.progressSummary)}` : null,
    formatOutcomeStreak(thread.actionOutcomes),
    recentTurns.length > 0
      ? [
          'Recent tool results:',
          ...recentTurns.map((turn) => formatSharedStateTurn(turn)),
        ].join('\n')
      : null,
    '</shared_state>',
  ].filter(Boolean) as string[]

  return lines.join('\n')
}

function formatSharedStateTurn(turn: AgentTurn) {
  const status =
    turn.status === 'done'
      ? 'done'
      : turn.success === false || turn.status === 'failed'
        ? 'failed'
        : turn.success === true || turn.status === 'executed'
          ? 'ok'
          : turn.status
  const result = turn.executionResult
    ? ` | result=${sanitizeTaskStateLine(
        truncateRetainedText(turn.executionResult, SHARED_STATE_RESULT_MAX_LENGTH),
      )}`
    : ''
  const tool = turn.toolName ? ` | tool=${sanitizeTaskStateLine(turn.toolName)}` : ''
  return `- #${turn.index} ${status}: ${sanitizeTaskStateLine(turn.preview)}${tool}${result}`
}

function formatOutcomeStreak(outcomes: readonly boolean[]) {
  if (outcomes.length === 0) {
    return null
  }

  return `Recent outcomes: ${outcomes
    .slice(-8)
    .map((success) => (success ? 'ok' : 'failed'))
    .join(' -> ')}`
}

function formatTaskState({
  thread,
  task,
  latestUserMessage,
  currentApp,
  deviceState,
  memoryEnabled,
  memoryItems,
}: {
  thread?: AgentThread
  task: string
  latestUserMessage?: string
  currentApp?: string
  deviceState?: DeviceState
  memoryEnabled: boolean
  memoryItems?: readonly string[]
}) {
  const resolvedCurrentApp = currentApp ?? deviceState?.app
  const resolvedCurrentPackage = deviceState?.packageName
  const previousTaskApp = thread
    ? findPreviousNonCurrentApp(thread, resolvedCurrentApp, resolvedCurrentPackage)
    : null
  const visitedApps = thread
    ? formatVisitedApps(thread, {
        app: resolvedCurrentApp,
        packageName: resolvedCurrentPackage,
      })
    : null
  const memory = memoryEnabled
    ? [...(memoryItems ?? []), ...(thread?.memory ?? [])]
        .slice(-TASK_STATE_MEMORY_ITEMS)
        .map((item) =>
          sanitizeTaskStateLine(truncateRetainedText(item, TASK_STATE_MEMORY_ITEM_MAX_LENGTH)),
        )
        .filter(Boolean)
    : []
  const helperAppGuidance = memoryEnabled
    ? [
        'Guidance: Preserve the original task while using helper apps.',
        'If SMS, Messages, Mail, Browser, or Authenticator is opened only to retrieve a verification code,',
        'store the code with note/remember, return to the previous task app, and continue the original flow.',
        'Do not restart the login flow or keep reopening the helper app unless the code is missing or stale.',
      ].join(' ')
    : [
        'Guidance: Preserve the original task while using helper apps.',
        'If SMS, Messages, Mail, Browser, or Authenticator is opened only to retrieve a verification code,',
        'return to the previous task app and continue the original flow without storing durable memory.',
        'Do not restart the login flow or keep reopening the helper app unless the code is missing or stale.',
      ].join(' ')

  return [
    '<task_state>',
    `Original task: ${sanitizePromptContextLine(task, TASK_CONTEXT_MAX_LENGTH)}`,
    latestUserMessage
      ? `Latest user message: ${sanitizePromptContextLine(
          latestUserMessage,
          TASK_CONTEXT_MAX_LENGTH,
        )}`
      : null,
    resolvedCurrentApp || resolvedCurrentPackage
      ? `Current app: ${formatAppReference({
          app: resolvedCurrentApp,
          packageName: resolvedCurrentPackage,
        })}`
      : null,
    previousTaskApp ? `Previous task app: ${formatAppReference(previousTaskApp)}` : null,
    visitedApps ? `Visited apps: ${visitedApps}` : null,
    thread?.lastActionPreview
      ? `Last action: ${sanitizeTaskStateLine(thread.lastActionPreview)}`
      : null,
    thread?.lastExecutionResult
      ? `Last result: ${sanitizeTaskStateLine(
          truncateRetainedText(thread.lastExecutionResult, TASK_STATE_MEMORY_ITEM_MAX_LENGTH),
        )}`
      : null,
    memory.length > 0 ? ['Durable memory:', ...memory.map((item) => `- ${item}`)].join('\n') : null,
    helperAppGuidance,
    '</task_state>',
  ]
    .filter(Boolean)
    .join('\n')
}

function findPreviousNonCurrentApp(
  thread: AgentThread,
  currentApp?: string,
  currentPackage?: string,
) {
  for (const turn of thread.turns.slice().reverse()) {
    const app = turn.deviceSnapshot.currentApp || turn.deviceSnapshot.deviceState.app
    const packageName = turn.deviceSnapshot.deviceState.packageName
    if (!isKnownAppReference(app, packageName)) {
      continue
    }
    if (isSameAppReference({ app, packageName }, { app: currentApp, packageName: currentPackage })) {
      continue
    }
    return { app, packageName }
  }

  return null
}

function formatVisitedApps(
  thread: AgentThread,
  current: { app?: string; packageName?: string },
) {
  const entries: Array<{ app?: string; packageName?: string }> = []
  for (const turn of thread.turns) {
    pushUniqueAppReference(entries, {
      app: turn.deviceSnapshot.currentApp || turn.deviceSnapshot.deviceState.app,
      packageName: turn.deviceSnapshot.deviceState.packageName,
    })
  }
  for (const packageName of thread.visitedPackages) {
    pushUniqueAppReference(entries, { packageName })
  }
  pushUniqueAppReference(entries, current)

  return entries
    .slice(-TASK_STATE_VISITED_APP_LIMIT)
    .map(formatAppReference)
    .join(' -> ')
}

function pushUniqueAppReference(
  entries: Array<{ app?: string; packageName?: string }>,
  candidate: { app?: string; packageName?: string },
) {
  if (!isKnownAppReference(candidate.app, candidate.packageName)) {
    return
  }
  if (entries.some((entry) => isSameAppReference(entry, candidate))) {
    return
  }
  entries.push(candidate)
}

function formatAppReference({
  app,
  packageName,
}: {
  app?: string
  packageName?: string
}) {
  const safeApp = sanitizeTaskStateLine(app)
  const safePackage = sanitizeTaskStateLine(packageName)
  if (safeApp && safePackage) {
    return `${safeApp} (${safePackage})`
  }
  return safeApp || safePackage
}

function isSameAppReference(
  left: { app?: string; packageName?: string },
  right: { app?: string; packageName?: string },
) {
  const leftPackage = left.packageName?.trim()
  const rightPackage = right.packageName?.trim()
  if (leftPackage && rightPackage) {
    return leftPackage === rightPackage
  }

  const leftApp = left.app?.trim()
  const rightApp = right.app?.trim()
  return Boolean(leftApp && rightApp && leftApp === rightApp)
}

function isKnownAppReference(app?: string, packageName?: string) {
  const safeApp = sanitizeTaskStateLine(app)
  const safePackage = sanitizeTaskStateLine(packageName)
  return Boolean(safePackage || (safeApp && safeApp !== 'Unknown'))
}

function sanitizeTaskStateLine(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function sanitizePromptContextLine(value: string, maxLength: number) {
  return sanitizeTaskStateLine(truncatePromptContextText(value, maxLength))
}

function truncatePromptContextText(value: string, maxLength: number) {
  return truncateRetainedText(value.trim(), maxLength)
}
