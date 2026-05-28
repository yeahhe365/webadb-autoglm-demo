import {
  Activity,
  ArrowDown,
  Layers3,
  LoaderCircle,
  MessageSquare,
  Send,
  Square,
  SquarePen,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
} from 'react'
import type { AppCopy } from '../lib/appCopy'
import type { AgentStep } from '../lib/agent'
import type { BusyTask } from '../lib/busyTask'
import type { AgentSessionSummary } from '../hooks/useAgentSessionHistory'
import type { InteractionStreamItem } from '../lib/interactionStream'
import type { AgentConversationMessage } from '../lib/openAiTypes'
import type { AgentThreadSummary } from '../lib/threadStore'
import { AgentStepCard } from './AgentStepCard'
import { ChatHistorySidebar } from './ChatHistorySidebar'
import { LazyMarkdownContent } from './LazyMarkdownContent'
import { PendingActionCard } from './PendingActionCard'

type ChatPanelProps = {
  activeThreadId: string
  busyTask: BusyTask | null
  chatInput: string
  conversation: AgentConversationMessage[]
  interactionItems?: InteractionStreamItem[]
  copy: AppCopy
  historySidebarOpen: boolean
  pendingStep: AgentStep | null
  sessionSummary?: AgentSessionSummary
  threadSummaries: AgentThreadSummary[]
  onChatInputChange: (value: string) => void
  onCloseHistorySidebar: () => void
  onDeleteThread: (threadId: string) => void
  onExecutePendingStep: () => void
  onSelectThread: (threadId: string) => void
  onStartNewChat: () => void
  onStopRun: () => void
  onSubmitChatMessage: () => void
  onToggleHistorySidebar: () => void
}

const MAX_RENDERED_CHAT_ITEMS = 160

export function ChatPanel({
  activeThreadId,
  busyTask,
  chatInput,
  conversation,
  interactionItems,
  copy,
  historySidebarOpen,
  pendingStep,
  threadSummaries,
  onChatInputChange,
  onCloseHistorySidebar,
  onDeleteThread,
  onExecutePendingStep,
  onSelectThread,
  onStartNewChat,
  onStopRun,
  onSubmitChatMessage,
  onToggleHistorySidebar,
  sessionSummary,
}: ChatPanelProps) {
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatStreamRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowOutputRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const chatIsEmpty = chatInput.trim().length === 0
  const isBusy = Boolean(busyTask)
  const canStopRun = busyTask?.id === 'run-agent'
  const items =
    interactionItems ?? conversation.map<InteractionStreamItem>((message) => messageToItem(message))
  const visibleItems = useMemo(
    () => items.slice(Math.max(0, items.length - MAX_RENDERED_CHAT_ITEMS)),
    [items],
  )
  const activeStepId = isAgentStepBusyTask(busyTask) ? findLatestOpenStepId(visibleItems) : null
  const chatInputRows = Math.min(6, Math.max(1, chatInput.split('\n').length))
  const sessionStripVisible =
    Boolean(busyTask) ||
    Boolean(sessionSummary && shouldShowSessionSummary(sessionSummary))
  const submitChatIfNotEmpty = () => {
    if (!chatIsEmpty) {
      onSubmitChatMessage()
    }
  }
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return
    }

    event.preventDefault()
    submitChatIfNotEmpty()
  }
  const handleChatInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChatInputChange(event.target.value)
    resizeComposer(event.currentTarget)
  }
  const handleStartNewChat = () => {
    onStartNewChat()
    chatInputRef.current?.focus()
  }
  const handleHistoryNewChat = () => {
    handleStartNewChat()
    onCloseHistorySidebar()
  }
  const focusComposerShell = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('button, textarea, input, label')) {
      return
    }

    chatInputRef.current?.focus()
  }
  const handleStreamScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    const isNearBottom = distanceFromBottom < 96
    shouldFollowOutputRef.current = isNearBottom
    setShowScrollToBottom(!isNearBottom)
  }
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const stream = chatStreamRef.current
    if (!stream) {
      return
    }

    if (typeof stream.scrollTo === 'function') {
      stream.scrollTo({ top: stream.scrollHeight, behavior })
    } else {
      stream.scrollTop = stream.scrollHeight
    }
    shouldFollowOutputRef.current = true
    setShowScrollToBottom(false)
  }

  useEffect(() => {
    const input = chatInputRef.current
    if (input) {
      resizeComposer(input)
    }
  }, [chatInput])

  useEffect(() => {
    if (shouldFollowOutputRef.current) {
      scrollToBottom('auto')
    }
  }, [visibleItems.length, busyTask?.id, pendingStep?.index])

  return (
    <section className="chat-shell" aria-label={copy.chat}>
      {historySidebarOpen ? (
        <button
          type="button"
          className="chat-history-backdrop"
          aria-label={copy.closeHistorySidebar}
          onClick={onCloseHistorySidebar}
        />
      ) : null}
      <ChatHistorySidebar
        activeThreadId={activeThreadId}
        busyTask={busyTask}
        copy={copy}
        isOpen={historySidebarOpen}
        onClose={onCloseHistorySidebar}
        onDeleteThread={onDeleteThread}
        onNewChat={handleHistoryNewChat}
        onSelectThread={onSelectThread}
        threadSummaries={threadSummaries}
      />
      <div className="panel-title conversation-panel-title chat-shell-header">
        <div className="panel-title-main">
          <button
            type="button"
            className="chat-history-toggle"
            aria-expanded={historySidebarOpen}
            aria-label={historySidebarOpen ? copy.closeHistorySidebar : copy.openHistorySidebar}
            title={historySidebarOpen ? copy.closeHistorySidebar : copy.openHistorySidebar}
            onClick={onToggleHistorySidebar}
          >
            <IconSidebarToggle size={18} strokeWidth={2} />
          </button>
          <h2 className="visually-hidden">{copy.chat}</h2>
        </div>
        <button
          type="button"
          className="panel-title-action"
          aria-label={copy.newChat}
          onClick={handleStartNewChat}
          disabled={isBusy}
          title={busyTask ? copy.waitForCurrentRun : copy.newChat}
        >
          <SquarePen size={16} strokeWidth={2} />
          {copy.newChat}
        </button>
      </div>
      {sessionStripVisible && sessionSummary ? (
        <div className="chat-session-strip" aria-label={copy.sessionState}>
          <span className={`chat-session-pill status-${sessionSummary.status}`}>
            {busyTask ? (
              <LoaderCircle className="chat-run-status-spinner" size={13} />
            ) : (
              <Activity size={13} />
            )}
            {formatSessionStatus(sessionSummary.status, copy)}
          </span>
          {sessionSummary.stepNumber > 0 ? (
            <span className="chat-session-pill">
              {copy.sessionStep(sessionSummary.stepNumber)}
            </span>
          ) : null}
          {sessionSummary.pendingUserMessageCount > 0 ? (
            <span className="chat-session-pill queued">
              <MessageSquare size={13} />
              {copy.queuedMessages(sessionSummary.pendingUserMessageCount)}
            </span>
          ) : null}
          {sessionSummary.contextCompactedThroughStep > 0 ? (
            <span className="chat-session-pill compacted">
              <Layers3 size={13} />
              {copy.contextCompactedThroughStep(sessionSummary.contextCompactedThroughStep)}
            </span>
          ) : null}
          {sessionSummary.latestStatusMessage ? (
            <span className="chat-session-message" title={sessionSummary.latestStatusMessage}>
              {sessionSummary.latestStatusMessage}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="chat-stream"
        aria-label={copy.conversation}
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={handleStreamScroll}
        ref={chatStreamRef}
        role="log"
      >
        {visibleItems.length === 0 && !pendingStep ? (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">
              <MessageSquare size={22} aria-hidden="true" />
            </div>
            <strong>{copy.noMessages}</strong>
          </div>
        ) : null}
        {visibleItems.map((item) =>
          item.type === 'step' ? (
            <AgentStepCard
              copy={copy}
              isActive={item.turn.id === activeStepId}
              key={item.id}
              turn={item.turn}
            />
          ) : (
            <article className={`chat-message ${item.message.role}`} key={item.id}>
              <span className="visually-hidden">
                {formatConversationRole(item.message.role, copy)}
              </span>
              <LazyMarkdownContent className="chat-message-content" content={item.message.content} />
            </article>
          ),
        )}
        {isBusy ? (
          <div className="chat-run-status" role="status">
            <LoaderCircle className="chat-run-status-spinner" size={14} />
            <span>{busyTask?.label ?? copy.runAgentTask}</span>
          </div>
        ) : null}
        {pendingStep ? (
          <PendingActionCard
            busyTask={busyTask}
            copy={copy}
            onExecutePendingStep={onExecutePendingStep}
            pendingStep={pendingStep}
          />
        ) : null}
      </div>
      {showScrollToBottom ? (
        <button
          type="button"
          className="chat-scroll-bottom"
          aria-label={copy.scrollToLatest}
          title={copy.scrollToLatest}
          onClick={() => scrollToBottom()}
        >
          <ArrowDown size={16} />
        </button>
      ) : null}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          submitChatIfNotEmpty()
        }}
      >
        <div className="chat-input-frame" onClick={focusComposerShell}>
          <label className="chat-input-label">
            <span className="visually-hidden">{copy.chatMessage}</span>
            <textarea
              ref={chatInputRef}
              className="chat-input"
              value={chatInput}
              onChange={handleChatInputChange}
              onKeyDown={handleComposerKeyDown}
              rows={chatInputRows}
              placeholder={copy.chatPlaceholder}
            />
          </label>
          <div className="chat-input-actions">
            <span className="chat-input-action-spacer" aria-hidden="true" />
            {canStopRun ? (
              <button
                type="button"
                className="chat-send chat-stop"
                onClick={onStopRun}
                title={copy.stopRun}
                aria-label={copy.stopRun}
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="chat-send primary"
                disabled={chatIsEmpty}
                title={chatIsEmpty ? copy.typeMessageFirst : copy.send}
                aria-label={copy.send}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  )
}

function resizeComposer(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`
}

function IconSidebarToggle({
  size,
  strokeWidth,
}: {
  size: number
  strokeWidth: number
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" x2="20" y1="8" y2="8" />
      <line x1="4" x2="14" y1="16" y2="16" />
    </svg>
  )
}

function findLatestOpenStepId(items: readonly InteractionStreamItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.type === 'step' && !item.turn.completedAt) {
      return item.turn.id
    }
  }
  return null
}

function isAgentStepBusyTask(busyTask: BusyTask | null) {
  return busyTask?.id === 'execute-action' || busyTask?.id === 'run-agent'
}

function shouldShowSessionSummary(summary: AgentSessionSummary) {
  return (
    summary.status !== 'idle' ||
    summary.stepNumber > 0 ||
    summary.pendingUserMessageCount > 0 ||
    summary.contextCompactedThroughStep > 0
  )
}

function formatSessionStatus(status: AgentSessionSummary['status'], copy: AppCopy) {
  switch (status) {
    case 'running':
      return copy.sessionStatusRunning
    case 'awaiting_review':
      return copy.sessionStatusAwaitingReview
    case 'awaiting_takeover':
      return copy.sessionStatusAwaitingTakeover
    case 'done':
      return copy.sessionStatusDone
    case 'stopped':
      return copy.sessionStatusStopped
    case 'error':
      return copy.sessionStatusError
    case 'idle':
    default:
      return copy.sessionStatusIdle
  }
}

function messageToItem(message: AgentConversationMessage): InteractionStreamItem {
  return {
    type: 'message',
    id: `message-${message.id}`,
    message,
  }
}

function formatConversationRole(role: 'user' | 'assistant' | 'observation', copy: AppCopy) {
  if (role === 'assistant') {
    return copy.assistant
  }
  if (role === 'observation') {
    return copy.observation
  }
  return copy.user
}
