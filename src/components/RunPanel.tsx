import {
  Check,
  CircleStop,
  Download,
  Loader2,
  MessageSquare,
  Plus,
  Play,
  RotateCcw,
  Send,
  StepForward,
} from 'lucide-react'
import { buildActionPreview } from '../lib/actionPreview'
import type { AgentAction } from '../lib/actionTypes'
import type { AppCopy } from '../lib/appCopy'
import type { AgentStep } from '../lib/agent'
import type { BusyTask } from '../lib/busyTask'
import type { AgentConversationMessage } from '../lib/openAiTypes'
import type { TaskTemplate } from '../lib/taskTemplates'

export type RunPanelProps = {
  autoExecute: boolean
  busyTask: BusyTask | null
  canRun: boolean
  chatInput: string
  conversation: AgentConversationMessage[]
  copy: AppCopy
  logsCount: number
  pendingStep: AgentStep | null
  taskTemplates: TaskTemplate[]
  onAutoExecuteChange: (value: boolean) => void
  onChatInputChange: (value: string) => void
  onExecutePendingStep: () => void
  onExportRunLog: () => void
  onPlanNextStep: () => void
  onResetSession: () => void
  onRunAutoLoop: () => void
  onStartNewChat: () => void
  onStopRun: () => void
  onSubmitChatMessage: () => void
  onTaskTemplateSelect: (prompt: string) => void
}

export function RunPanel({
  autoExecute,
  busyTask,
  canRun,
  chatInput,
  conversation,
  copy,
  logsCount,
  onAutoExecuteChange,
  onChatInputChange,
  onExecutePendingStep,
  onExportRunLog,
  onPlanNextStep,
  onResetSession,
  onRunAutoLoop,
  onStartNewChat,
  onStopRun,
  onSubmitChatMessage,
  onTaskTemplateSelect,
  pendingStep,
  taskTemplates,
}: RunPanelProps) {
  const chatIsEmpty = chatInput.trim().length === 0
  const runActionLabel = autoExecute ? copy.runAgent : copy.planNextStep
  const isBusy = Boolean(busyTask)
  const canStopRun = busyTask?.id === 'run-agent'
  const isRunningAgent = canStopRun
  const runActionTitle = busyTask ? copy.waitForCurrentRun : copy.runUnavailable
  const runActionDisabled = !canRun
  const runAction = autoExecute ? onRunAutoLoop : onPlanNextStep
  const runIcon =
    isRunningAgent ? (
      <Loader2 className="spin" size={16} />
    ) : autoExecute ? (
      <Play size={16} />
    ) : (
      <StepForward size={16} />
    )

  return (
    <>
      <section className="chat-shell" aria-label={copy.chat}>
        <div className="panel-title run-panel-title chat-shell-header">
          <div className="panel-title-main">
            <MessageSquare size={18} />
            <h2>{copy.chat}</h2>
          </div>
          <button
            type="button"
            className="panel-title-action"
            onClick={onStartNewChat}
            disabled={isBusy}
            title={busyTask ? copy.waitForCurrentRun : copy.newChat}
          >
            <Plus size={16} />
            {copy.newChat}
          </button>
        </div>
        <div className="chat-stream" aria-label={copy.conversation}>
          {conversation.length === 0 ? <p className="muted">{copy.noMessages}</p> : null}
          {conversation.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <span>{formatConversationRole(message.role, copy)}</span>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
        <div className="chat-composer">
          <label className="chat-input-label">
            <span>{copy.chatMessage}</span>
            <textarea
              value={chatInput}
              onChange={(event) => onChatInputChange(event.target.value)}
              rows={3}
              placeholder={copy.chatPlaceholder}
            />
          </label>
          <div className="composer-actions">
            <button
              type="button"
              className="wide primary"
              onClick={onSubmitChatMessage}
              disabled={chatIsEmpty}
              title={chatIsEmpty ? copy.typeMessageFirst : copy.send}
            >
              <Send size={16} />
              {copy.send}
            </button>
          </div>
        </div>
      </section>

      <details className="compact-section">
        <summary>{copy.taskTemplate}</summary>
        <label>
          {copy.taskTemplate}
          <select
            value=""
            onChange={(event) => {
              const template = taskTemplates.find((candidate) => candidate.id === event.target.value)
              if (template) {
                onTaskTemplateSelect(template.prompt)
              }
            }}
            disabled={isBusy}
          >
            <option value="">{copy.chooseTaskTemplate}</option>
            {taskTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
        </label>
      </details>

      <section className="agent-run-actions" aria-label={copy.agentRun}>
        <div className="run-mode" role="radiogroup" aria-label={copy.executionMode}>
          <span className="run-mode-label">{copy.executionMode}</span>
          <label className="run-mode-option">
            <input
              type="radio"
              name="execution-mode"
              checked={!autoExecute}
              onChange={() => onAutoExecuteChange(false)}
              disabled={isBusy}
            />
            <span>
              <StepForward size={16} />
              {copy.manualMode}
            </span>
          </label>
          <label className="run-mode-option">
            <input
              type="radio"
              name="execution-mode"
              checked={autoExecute}
              onChange={() => onAutoExecuteChange(true)}
              disabled={isBusy}
            />
            <span>
              <Play size={16} />
              {copy.autoMode}
            </span>
          </label>
        </div>
        <div className={canStopRun ? 'run-action-row stopping' : 'run-action-row'}>
          <button
            type="button"
            className="wide primary run-cta"
            onClick={runAction}
            disabled={runActionDisabled}
            title={runActionDisabled ? runActionTitle : runActionLabel}
          >
            {runIcon}
            {isRunningAgent ? copy.running : runActionLabel}
          </button>
          {canStopRun ? (
            <button type="button" className="danger run-stop" onClick={onStopRun}>
              <CircleStop size={16} />
              {copy.stop}
            </button>
          ) : null}
        </div>
      </section>

      <details className="compact-section">
        <summary>{copy.runOptions}</summary>
        <div className="run-options-panel">
          <div className="button-row">
            <button type="button" onClick={onResetSession} disabled={isBusy}>
              <RotateCcw size={16} />
              {copy.reset}
            </button>
            <button type="button" onClick={onExportRunLog} disabled={logsCount === 0}>
              <Download size={16} />
              {copy.export}
            </button>
          </div>
        </div>
      </details>

      {pendingStep ? (
        <div className="pending-action ready">
          <div className="pending-header">
            <span>{copy.pendingAction}</span>
            <small>{copy.step} {pendingStep.index}</small>
          </div>
          <p>{buildActionPreview(pendingStep.action)}</p>
          <button
            type="button"
            className="wide primary"
            onClick={onExecutePendingStep}
            disabled={isBusy}
            title={busyTask ? copy.waitForCurrentRun : pendingActionLabel(pendingStep.action.action, copy)}
          >
            <Check size={16} />
            {pendingActionLabel(pendingStep.action.action, copy)}
          </button>
        </div>
      ) : null}
    </>
  )
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

function pendingActionLabel(action: AgentAction['action'] | undefined, copy: AppCopy) {
  if (
    action === 'take_over' ||
    action === 'note' ||
    action === 'interact' ||
    action === 'call_api'
  ) {
    return copy.acknowledge
  }
  if (action === 'done') {
    return copy.finish
  }
  return copy.execute
}
