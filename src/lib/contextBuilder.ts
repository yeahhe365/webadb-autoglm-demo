import type { DeviceState, InstalledApp } from '../adapters/deviceTypes'
import { getInstalledAppDisplayName } from '../adapters/installedApps'
import type { ScreenSize } from './actionTypes'
import {
  addThreadEvent,
  type AgentThread,
  type AgentTurn,
} from './agentThread'
import { buildScreenshotContext } from './screenshotCoordinates'
import type { AgentHistoryItem } from './openAiTypes'

export type BuildAgentPromptContextInput = {
  thread?: AgentThread
  task: string
  latestUserMessage?: string
  screen: ScreenSize
  deviceScreen?: ScreenSize
  currentApp?: string
  deviceState?: DeviceState
  appCard?: string
  installedApps?: readonly InstalledApp[]
  maxRecentTurns?: number
}

export type BuiltAgentPromptContext = {
  text: string
  history: AgentHistoryItem[]
  latestUserMessage?: string
}

export function buildAgentPromptContext({
  thread,
  task,
  latestUserMessage,
  screen,
  deviceScreen,
  currentApp,
  deviceState,
  appCard,
  installedApps,
  maxRecentTurns = 12,
}: BuildAgentPromptContextInput): BuiltAgentPromptContext {
  const state = deviceState ?? { app: currentApp ?? 'Unknown' }
  const history = thread ? historyFromRecentTurns(thread, maxRecentTurns) : []
  const screenInfo = JSON.stringify({
    current_app: currentApp ?? state.app ?? 'Unknown',
    ...(state.packageName ? { package_name: state.packageName } : {}),
    ...(state.activity ? { activity: state.activity } : {}),
    ...(state.orientation ? { orientation: state.orientation } : {}),
    ...(state.keyboard ? { keyboard: state.keyboard } : {}),
    ...buildScreenshotContext({ modelScreen: screen, deviceScreen }),
  })
  const canonicalCoordinateInstruction = [
    'Coordinates use pixels in the attached screenshot.',
    'Use numeric x/y labels on major grid lines as anchors; do not answer with grid-cell numbers.',
    'Your screenshot coordinates are mapped back to native device pixels before execution.',
  ].join(' ')

  const lines = [
    `Task: ${task}`,
    latestUserMessage ? `Latest user message: ${latestUserMessage}` : null,
    thread?.contextSummary ? `<context_summary>\n${thread.contextSummary}\n</context_summary>` : null,
    `Screen Info: ${screenInfo}`,
    appCard ? `<app_card>\n${appCard}\n</app_card>` : null,
    formatInstalledApps(installedApps),
    'Treat the latest user message as the current instruction. Use earlier messages, observations, and context summary only as context.',
    canonicalCoordinateInstruction,
  ].filter(Boolean) as string[]

  if (history.length > 0) {
    lines.push('Previous steps:')
    for (const item of history) {
      lines.push(formatHistoryItem(item))
    }
  }

  return {
    text: lines.join('\n'),
    history,
    latestUserMessage,
  }
}

export function historyFromRecentTurns(thread: AgentThread, maxRecentTurns = 12) {
  if (thread.turns.length === 0) {
    return thread.history.slice(-maxRecentTurns)
  }
  return thread.turns.slice(-maxRecentTurns).map(turnToHistoryItem)
}

export function compactThreadContext(
  thread: AgentThread,
  options: { keepRecentTurns?: number; now?: number } = {},
) {
  const keepRecentTurns = options.keepRecentTurns ?? 12
  const cutoffIndex = Math.max(0, thread.turns.length - keepRecentTurns)
  const turnsToCompact = thread.turns
    .slice(0, cutoffIndex)
    .filter((turn) => turn.index > thread.contextCompactedThroughStep)

  if (turnsToCompact.length === 0) {
    return null
  }

  const summary = turnsToCompact.map(formatTurnSummary).join('\n')
  thread.contextSummary = [thread.contextSummary, summary].filter(Boolean).join('\n')
  thread.memory = thread.contextSummary ? [thread.contextSummary] : []
  thread.contextCompactedThroughStep = turnsToCompact.at(-1)?.index ?? thread.contextCompactedThroughStep
  for (const turn of turnsToCompact) {
    turn.compacted = true
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
    executionResult: turn.executionResult,
  }
}

function formatHistoryItem(item: AgentHistoryItem) {
  const details = [
    item.currentApp ? `app=${item.currentApp}` : null,
    `action=${item.actionPreview}`,
    item.executionResult ? `result=${item.executionResult}` : null,
  ]
    .filter(Boolean)
    .join(' | ')
  return `Step ${item.step}: ${details}`
}

function formatTurnSummary(turn: AgentTurn) {
  return formatHistoryItem(turnToHistoryItem(turn))
}

function formatInstalledApps(installedApps?: readonly InstalledApp[]) {
  const apps = installedApps?.filter((app) => app.packageName.trim()) ?? []
  if (apps.length === 0) {
    return null
  }

  const lines = apps
    .slice(0, 40)
    .map((app) => `${getInstalledAppDisplayName(app)}: ${app.packageName}`)

  return [`<installed_apps>`, ...lines, `</installed_apps>`].join('\n')
}
