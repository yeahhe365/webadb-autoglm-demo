import { useCallback, useRef } from 'react'
import type { DeviceBackend } from '../adapters/deviceTypes'
import {
  addUserMessage,
  createAgentRunner,
  queueUserMessage,
  recordAgentStepExecutionDuration,
  recordAgentFinalResponse,
  recordAgentStep,
  type AgentSession,
  type AgentStep,
} from '../lib/agent'
import { recordThreadStatus } from '../lib/agentThread'
import type { AgentAction } from '../lib/actionTypes'
import type { AppCopy } from '../lib/appCopy'
import type { ActionProtocol } from '../lib/actionProtocol'
import type { AppCardMap } from '../lib/appCards'
import type { CustomToolDefinition, SecretRecord } from '../lib/agentResources'
import type { BusyTask, BusyTaskId } from '../lib/busyTask'
import type { OpenAiClient, ModelConfig } from '../lib/openAiTypes'
import type { LogEntryInput } from '../lib/runLogEntries'
import {
  buildAgentStepTimeline,
  formatAgentStepDetail,
  toLogScreenshot,
} from '../lib/runLogEntries'
import type { ActionToolRegistry } from '../lib/toolRegistry'
import type { DeviceSnapshotUpdate } from './useDeviceController'

type RunTask = (id: BusyTaskId, label: string, action: () => Promise<void>) => Promise<void>

type UseAgentRunControllerInput = {
  actionProtocol: ActionProtocol
  actionToolRegistry: ActionToolRegistry
  addLog: (entry: LogEntryInput) => void
  appCards: AppCardMap
  backend: DeviceBackend
  busyTask: BusyTask | null
  canRunAgent: boolean
  chatInput: string
  client: OpenAiClient
  copy: AppCopy
  customTools: readonly CustomToolDefinition[]
  device: {
    applyDeviceSnapshot: (snapshot: DeviceSnapshotUpdate) => void
    confirmSensitiveAction: (message: string, action: AgentAction) => boolean | Promise<boolean>
    refreshDisplayedSnapshot: () => Promise<{
      screenshot: DeviceSnapshotUpdate['screenshot']
      deviceState: DeviceSnapshotUpdate['deviceState']
    }>
  }
  ensureSession: () => AgentSession
  maxSteps: number
  memoryEnabled: boolean
  memoryItems: readonly string[]
  modelConfig: ModelConfig
  onMemoryItem: (information: string) => void
  pendingStep: AgentStep | null
  runTask: RunTask
  setChatInput: (value: string) => void
  setError: (value: string | null) => void
  setPendingStep: (step: AgentStep | null) => void
  secrets: readonly SecretRecord[]
  screenBlackoutDuringAutoControl: boolean
  streamResponses: boolean
  syncConversation: () => void
  unrestrictedMode: boolean
}

export function useAgentRunController({
  actionProtocol,
  actionToolRegistry,
  addLog,
  appCards,
  backend,
  busyTask,
  canRunAgent,
  chatInput,
  client,
  copy,
  customTools,
  device,
  ensureSession,
  maxSteps,
  memoryEnabled,
  memoryItems,
  modelConfig,
  onMemoryItem,
  pendingStep,
  runTask,
  setChatInput,
  setError,
  setPendingStep,
  secrets,
  screenBlackoutDuringAutoControl,
  streamResponses,
  syncConversation,
  unrestrictedMode,
}: UseAgentRunControllerInput) {
  const abortRef = useRef<AbortController | null>(null)

  const executePendingStep = useCallback(async () => {
    if (!pendingStep) {
      return
    }

    await runTask('execute-action', copy.executeActionTask, async () => {
      if (pendingStep.action.action === 'done') {
        recordAgentStep(ensureSession(), pendingStep, undefined, undefined, {
          memoryEnabled,
          onMemoryItem,
        })
        const finalResponse = await recordAgentFinalResponse({
          client,
          modelConfig: { ...modelConfig, stream: streamResponses },
          session: ensureSession(),
          task: ensureSession().task,
        })
        addLog({ tone: 'ok', title: copy.taskComplete, detail: finalResponse })
        recordThreadStatus(ensureSession(), 'done', finalResponse)
        setPendingStep(null)
        syncConversation()
        return
      }

      recordThreadStatus(ensureSession(), 'running', copy.executeActionTask)
      syncConversation()
      const executionStartedAt = performance.now()
      const result = await actionToolRegistry.execute(pendingStep.executionAction, {
        device: backend,
        confirmSensitiveAction: device.confirmSensitiveAction,
        unrestrictedMode,
        safetyContext: {
          task: ensureSession().task,
          currentApp: pendingStep.currentApp,
          deviceState: pendingStep.deviceState,
          modelOutput: pendingStep.modelOutput,
        },
        customTools,
        secrets,
        screenshotRecallThread: ensureSession(),
      })
      recordAgentStepExecutionDuration(pendingStep, performance.now() - executionStartedAt)
      pendingStep.toolName = result.toolName
      recordAgentStep(ensureSession(), pendingStep, result.summary, result.success, {
        memoryEnabled,
        onMemoryItem,
      })
      addLog({
        tone: result.success ? 'ok' : 'error',
        title: result.success
          ? copy.executedAction(pendingStep.preview)
          : copy.failedAction(pendingStep.preview),
        detail: result.summary,
        screenshot: toLogScreenshot(pendingStep.screenshot),
        timeline: buildAgentStepTimeline(pendingStep, result.summary),
      })
      if (!result.success) {
        setError(result.summary)
        recordThreadStatus(
          ensureSession(),
          result.safetyDecision === 'take_over' ? 'awaiting_takeover' : 'awaiting_review',
          result.summary,
        )
      } else {
        recordThreadStatus(ensureSession(), 'idle')
      }
      await device.refreshDisplayedSnapshot()
      setPendingStep(null)
      syncConversation()
    })
  }, [
    actionToolRegistry,
    addLog,
    backend,
    client,
    copy,
    customTools,
    device,
    ensureSession,
    memoryEnabled,
    onMemoryItem,
    modelConfig,
    pendingStep,
    runTask,
    setError,
    setPendingStep,
    secrets,
    streamResponses,
    syncConversation,
    unrestrictedMode,
  ])

  const runAutoLoop = useCallback(async () => {
    const session = ensureSession()
    const abortController = new AbortController()
    abortRef.current = abortController

    await runTask('run-agent', copy.runAgentTask, async () => {
      let screenBlackoutActive = false
      try {
        recordThreadStatus(session, 'running', copy.runAgentTask)
        syncConversation()
        screenBlackoutActive = await startScreenBlackoutForAutoControl({
          addLog,
          backend,
          copy,
          enabled: screenBlackoutDuringAutoControl,
        })
        const runner = createAgentRunner({ device: backend, client, toolRegistry: actionToolRegistry })
        const result = await runner.run({
          modelConfig: { ...modelConfig, stream: streamResponses },
          actionProtocol,
          task: session.task,
          autoExecute: true,
          appCards,
          customTools,
          maxSteps,
          memoryEnabled,
          memoryItems,
          session,
          secrets,
          signal: abortController.signal,
          onMemoryItem,
          confirmSensitiveAction: device.confirmSensitiveAction,
          unrestrictedMode,
          onSnapshot: device.applyDeviceSnapshot,
          onStep: (step) => {
            device.applyDeviceSnapshot(step)
            setPendingStep(step.action.action === 'done' ? null : step)
            addLog({
              tone: 'info',
              title: copy.stepPreview(step.index, step.preview),
              detail: formatAgentStepDetail(step),
              screenshot: toLogScreenshot(step.screenshot),
              timeline: buildAgentStepTimeline(step),
            })
            syncConversation()
          },
          onExecuted: async (step, commandResult) => {
            addLog({
              tone: 'ok',
              title: copy.executedAction(step.preview),
              detail: commandResult,
              screenshot: toLogScreenshot(step.screenshot),
              timeline: buildAgentStepTimeline(step, commandResult),
            })
            await device.refreshDisplayedSnapshot()
            syncConversation()
          },
        })

        if (result.status === 'done') {
          addLog({ tone: 'ok', title: copy.taskComplete, detail: result.finalResponse })
          recordThreadStatus(session, 'done', result.finalResponse)
        }
        if (result.status === 'max_steps') {
          addLog({ tone: 'warn', title: copy.maxStepsReached, detail: `${maxSteps} steps` })
          recordThreadStatus(session, 'awaiting_review', `${copy.maxStepsReached}: ${maxSteps}`)
        }
        if (result.status === 'stopped') {
          addLog({ tone: 'warn', title: copy.runStopped })
          recordThreadStatus(session, 'stopped', copy.runStopped)
        }
        if (result.status === 'awaiting_review') {
          addLog({ tone: 'warn', title: copy.stepStatusAwaitingReview, detail: result.reason })
          recordThreadStatus(session, 'awaiting_review', result.reason)
        }
        if (result.status === 'awaiting_takeover') {
          addLog({ tone: 'warn', title: copy.manualTakeoverRequested })
          recordThreadStatus(session, 'awaiting_takeover', result.reason)
        }
        if (result.status === 'loop_guard') {
          addLog({ tone: 'warn', title: copy.loopGuardStopped, detail: result.reason })
          recordThreadStatus(session, 'stopped', result.reason ?? copy.loopGuardStopped)
        }
        if (result.status !== 'awaiting_takeover') {
          setPendingStep(null)
        }
        syncConversation()
      } catch (caught) {
        const message = formatCaughtError(caught)
        recordThreadStatus(session, 'error', message)
        syncConversation()
        throw caught
      } finally {
        if (screenBlackoutActive) {
          await stopScreenBlackoutForAutoControl({ addLog, backend, copy })
        }
        if (abortRef.current === abortController) {
          abortRef.current = null
        }
      }
    })
  }, [
    actionToolRegistry,
    actionProtocol,
    addLog,
    appCards,
    backend,
    client,
    copy,
    customTools,
    device,
    ensureSession,
    maxSteps,
    memoryEnabled,
    memoryItems,
    modelConfig,
    onMemoryItem,
    runTask,
    screenBlackoutDuringAutoControl,
    secrets,
    setPendingStep,
    streamResponses,
    syncConversation,
    unrestrictedMode,
  ])

  const submitChatMessage = useCallback(async () => {
    const message = chatInput.trim()
    if (!message) {
      return
    }

    setChatInput('')
    const session = ensureSession()

    if (busyTask) {
      queueUserMessage(session, message)
      syncConversation()
      addLog({ tone: 'info', title: copy.userMessageQueued, detail: message })
      return
    }

    addUserMessage(session, message)
    syncConversation()
    addLog({ tone: 'info', title: copy.userMessage, detail: message })

    if (!canRunAgent) {
      return
    }

    await runAutoLoop()
  }, [
    addLog,
    busyTask,
    canRunAgent,
    chatInput,
    copy,
    ensureSession,
    runAutoLoop,
    setChatInput,
    syncConversation,
  ])

  const stopCurrentRun = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
    executePendingStep,
    stopCurrentRun,
    submitChatMessage,
  }
}

async function startScreenBlackoutForAutoControl({
  addLog,
  backend,
  copy,
  enabled,
}: {
  addLog: (entry: LogEntryInput) => void
  backend: DeviceBackend
  copy: AppCopy
  enabled: boolean
}) {
  if (!enabled) {
    return false
  }

  if (!backend.startScreenBlackout) {
    addLog({ tone: 'warn', title: copy.screenBlackoutStartFailed })
    return false
  }

  try {
    await backend.startScreenBlackout()
    return true
  } catch (caught) {
    addLog({
      tone: 'warn',
      title: copy.screenBlackoutStartFailed,
      detail: formatCaughtError(caught),
    })
    return false
  }
}

async function stopScreenBlackoutForAutoControl({
  addLog,
  backend,
  copy,
}: {
  addLog: (entry: LogEntryInput) => void
  backend: DeviceBackend
  copy: AppCopy
}) {
  if (!backend.stopScreenBlackout) {
    return
  }

  try {
    await backend.stopScreenBlackout()
  } catch (caught) {
    addLog({
      tone: 'error',
      title: copy.screenBlackoutRestoreFailed,
      detail: formatCaughtError(caught),
    })
  }
}

function formatCaughtError(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught)
}
