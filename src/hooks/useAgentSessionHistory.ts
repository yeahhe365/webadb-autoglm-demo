import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createAgentSession, type AgentSession } from '../lib/agent'
import { recoverInterruptedThread, type AgentThreadStatus } from '../lib/agentThread'
import type { AppCopy } from '../lib/appCopy'
import { buildInteractionStream } from '../lib/interactionStream'
import type { AgentConversationMessage } from '../lib/openAiTypes'
import type { LogEntryInput } from '../lib/runLogEntries'
import { toLogScreenshot } from '../lib/runLogEntries'
import type { AppSettings } from '../lib/settings'
import {
  createIndexedDbThreadStore,
  createSettingsSnapshot,
  type AgentThreadSummary,
} from '../lib/threadStore'
import { useLatestValue } from './useLatestValue'

type UseAgentSessionHistoryInput = {
  addLog: (entry: LogEntryInput) => void
  copy: AppCopy
  currentSettings: AppSettings
  initialSettings: AppSettings
  onSessionStateChange: (session: AgentSession) => void
}

type DeleteHistoryThreadResult = {
  deleted: boolean
  resetActiveThread: boolean
}

export type AgentSessionSummary = {
  status: AgentThreadStatus
  stepNumber: number
  turnCount: number
  pendingUserMessageCount: number
  contextCompactedThroughStep: number
  latestStatusMessage?: string
  updatedAt: number
}

export function useAgentSessionHistory({
  addLog,
  copy,
  currentSettings,
  initialSettings,
  onSessionStateChange,
}: UseAgentSessionHistoryInput) {
  const initialSession = useMemo(() => createSessionWithSettings(initialSettings), [initialSettings])
  const sessionRef = useRef<AgentSession>(initialSession)
  const [conversation, setConversation] = useState<AgentConversationMessage[]>(() => [
    ...initialSession.messages,
  ])
  const [interactionItems, setInteractionItems] = useState(() =>
    buildInteractionStream(initialSession),
  )
  const [sessionSummary, setSessionSummary] = useState(() => summarizeSession(initialSession))
  const threadStore = useMemo(() => createIndexedDbThreadStore(), [])
  const [threadStoreReady, setThreadStoreReady] = useState(false)
  const [threadSummaries, setThreadSummaries] = useState<AgentThreadSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState(initialSession.id)
  const copyRef = useLatestValue(copy)

  const applyThreadSummaries = useCallback((summaries: AgentThreadSummary[]) => {
    setThreadSummaries(summaries.filter(isVisibleThreadSummary))
  }, [])

  const applySessionState = useCallback(
    (session: AgentSession) => {
      setActiveThreadId(session.id)
      setConversation([...session.messages])
      setInteractionItems(buildInteractionStream(session))
      setSessionSummary(summarizeSession(session))
      onSessionStateChange(session)
    },
    [onSessionStateChange],
  )

  const refreshThreadSummaries = useCallback(() => {
    if (!threadStoreReady) {
      return
    }

    void threadStore
      .list()
      .then(applyThreadSummaries)
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
      })
  }, [addLog, applyThreadSummaries, copyRef, threadStore, threadStoreReady])

  const persistSession = useCallback(
    (session = sessionRef.current) => {
      if (!threadStoreReady) {
        return
      }
      if (!sessionHasHistoryContent(session)) {
        refreshThreadSummaries()
        return
      }

      session.settingsSnapshot = createSettingsSnapshot(currentSettings)
      void threadStore
        .save(session)
        .then(() => threadStore.list())
        .then(applyThreadSummaries)
        .catch((caught) => {
          const message = caught instanceof Error ? caught.message : String(caught)
          addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        })
    },
    [
      addLog,
      applyThreadSummaries,
      copyRef,
      currentSettings,
      refreshThreadSummaries,
      threadStore,
      threadStoreReady,
    ],
  )
  const persistSessionRef = useLatestValue(persistSession)

  const syncConversation = useCallback(() => {
    applySessionState(sessionRef.current)
    persistSession()
  }, [applySessionState, persistSession])

  const startNewSession = useCallback(() => {
    sessionRef.current = createSessionWithSettings(currentSettings)
    syncConversation()
  }, [currentSettings, syncConversation])

  const selectHistoryThread = useCallback(
    async (threadId: string) => {
      try {
        const selectedThread = await threadStore.load(threadId)
        if (!selectedThread) {
          refreshThreadSummaries()
          return false
        }

        const recovered = recoverInterruptedThread(
          selectedThread,
          copyRef.current.previousRunInterrupted,
        )
        sessionRef.current = selectedThread
        applySessionState(selectedThread)
        addLog({
          tone: 'info',
          title: copyRef.current.agentContextRestored,
          detail: selectedThread.title,
          screenshot: toLogScreenshot(
            selectedThread.lastScreenshot ?? selectedThread.deviceSnapshot?.screenshot,
          ),
        })
        if (recovered) {
          persistSessionRef.current(selectedThread)
        }
        return true
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        return false
      }
    },
    [addLog, applySessionState, copyRef, persistSessionRef, refreshThreadSummaries, threadStore],
  )

  const deleteHistoryThread = useCallback(
    async (threadId: string): Promise<DeleteHistoryThreadResult> => {
      try {
        await threadStore.delete(threadId)
        const resetActiveThread = threadId === sessionRef.current.id
        if (resetActiveThread) {
          sessionRef.current = createSessionWithSettings(currentSettings)
          applySessionState(sessionRef.current)
        }

        const summaries = await threadStore.list()
        applyThreadSummaries(summaries)
        return { deleted: true, resetActiveThread }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        return { deleted: false, resetActiveThread: false }
      }
    },
    [addLog, applySessionState, applyThreadSummaries, copyRef, currentSettings, threadStore],
  )

  const clearHistoryThreads = useCallback(async () => {
    try {
      await threadStore.clear()
      sessionRef.current = createSessionWithSettings(currentSettings)
      applySessionState(sessionRef.current)
      setThreadSummaries([])
      addLog({ tone: 'info', title: copyRef.current.chatHistoryCleared })
      return true
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
      return false
    }
  }, [addLog, applySessionState, copyRef, currentSettings, threadStore])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const restoredThread = await threadStore.loadLatest()
        if (!cancelled && restoredThread) {
          const recovered = recoverInterruptedThread(
            restoredThread,
            copyRef.current.previousRunInterrupted,
          )
          sessionRef.current = restoredThread
          applySessionState(restoredThread)
          addLog({
            tone: 'info',
            title: copyRef.current.agentContextRestored,
            detail: restoredThread.title,
            screenshot: toLogScreenshot(
              restoredThread.lastScreenshot ?? restoredThread.deviceSnapshot?.screenshot,
            ),
          })
          if (recovered) {
            persistSessionRef.current(restoredThread)
          }
        }
      } catch (caught) {
        if (cancelled) {
          return
        }
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
      }

      try {
        const summaries = await threadStore.list()
        if (!cancelled) {
          applyThreadSummaries(summaries)
        }
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught)
          addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        }
      } finally {
        if (!cancelled) {
          setThreadStoreReady(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [addLog, applySessionState, applyThreadSummaries, copyRef, persistSessionRef, threadStore])

  useEffect(() => {
    if (!threadStoreReady) {
      return
    }
    persistSession()
  }, [persistSession, threadStoreReady])

  return {
    activeThreadId,
    clearHistoryThreads,
    conversation,
    deleteHistoryThread,
    ensureSession: () => sessionRef.current,
    interactionItems,
    selectHistoryThread,
    sessionSummary,
    startNewSession,
    syncConversation,
    threadSummaries,
  }
}

function summarizeSession(session: AgentSession): AgentSessionSummary {
  const latestStatusEvent = [...session.events]
    .reverse()
    .find((event) => event.type === 'status_change')

  return {
    status: session.status,
    stepNumber: session.stepNumber,
    turnCount: session.turns.length,
    pendingUserMessageCount: session.pendingUserMessages.length,
    contextCompactedThroughStep: session.contextCompactedThroughStep,
    ...(latestStatusEvent?.type === 'status_change' && latestStatusEvent.message
      ? { latestStatusMessage: latestStatusEvent.message }
      : {}),
    updatedAt: session.updatedAt,
  }
}

function createSessionWithSettings(settings: AppSettings) {
  const session = createAgentSession('')
  session.settingsSnapshot = createSettingsSnapshot(settings)
  return session
}

function sessionHasHistoryContent(session: AgentSession) {
  return (
    session.task.trim().length > 0 ||
    session.messages.length > 0 ||
    session.turns.length > 0 ||
    session.history.length > 0
  )
}

function isVisibleThreadSummary(summary: AgentThreadSummary) {
  return (
    summary.task.trim().length > 0 ||
    summary.status !== 'idle' ||
    summary.createdAt !== summary.updatedAt
  )
}
