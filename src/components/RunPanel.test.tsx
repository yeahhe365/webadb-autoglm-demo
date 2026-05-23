// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStep } from '../lib/agent'
import { APP_COPY } from '../lib/appCopy'
import { RunPanel } from './RunPanel'

function renderRunPanel(overrides: Partial<Parameters<typeof RunPanel>[0]> = {}) {
  const props: Parameters<typeof RunPanel>[0] = {
    autoExecute: false,
    busyTask: null,
    canRun: false,
    chatInput: '',
    conversation: [],
    copy: APP_COPY['en-US'],
    logsCount: 0,
    onAutoExecuteChange: vi.fn(),
    onChatInputChange: vi.fn(),
    onExecutePendingStep: vi.fn(),
    onExportRunLog: vi.fn(),
    onPlanNextStep: vi.fn(),
    onResetSession: vi.fn(),
    onRunAutoLoop: vi.fn(),
    onStartNewChat: vi.fn(),
    onStopRun: vi.fn(),
    onSubmitChatMessage: vi.fn(),
    onTaskTemplateSelect: vi.fn(),
    pendingStep: null,
    taskTemplates: [],
    ...overrides,
  }

  return render(<RunPanel {...props} />)
}

describe('RunPanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('keeps chat, conversation management, and agent run actions in separate regions', () => {
    renderRunPanel()

    const title = screen.getByRole('heading', { name: 'Chat' }).closest('.panel-title')
    expect(title).toBeTruthy()
    expect(within(title as HTMLElement).getByRole('button', { name: /new chat/i })).toBeTruthy()

    const sendButton = screen.getByRole('button', { name: /^send$/i })
    expect(sendButton.closest('.composer-actions')).toBeTruthy()
    expect(sendButton.closest('.agent-run-actions')).toBeNull()

    const runButton = screen.getByRole('button', { name: /plan next step/i })
    expect(runButton.closest('.agent-run-actions')).toBeTruthy()
    expect(runButton.className).toContain('primary')
    expect(screen.queryByRole('button', { name: /^run$/i })).toBeNull()
  })

  it('renders the conversation as a persistent chat stream with a bottom composer', () => {
    renderRunPanel({
      conversation: [
        { id: 'u1', role: 'user', content: 'Open Settings.' },
        { id: 'o1', role: 'observation', content: 'Current app: Settings.' },
        { id: 'a1', role: 'assistant', content: 'Done.' },
      ],
    })

    expect(screen.queryByRole('button', { name: 'Conversation' })).toBeNull()

    const chatShell = document.querySelector('.chat-shell')
    const chatStream = document.querySelector('.chat-stream')
    const composer = document.querySelector('.chat-composer')

    expect(chatShell).toBeTruthy()
    expect(chatStream).toBeTruthy()
    expect(composer).toBeTruthy()
    expect(chatShell?.contains(chatStream)).toBe(true)
    expect(chatShell?.contains(composer)).toBe(true)
    expect(within(chatStream as HTMLElement).getByText('Open Settings.')).toBeTruthy()
    expect(within(chatStream as HTMLElement).getByText('Current app: Settings.')).toBeTruthy()
    expect(within(chatStream as HTMLElement).getByText('Done.')).toBeTruthy()
    expect(composer?.compareDocumentPosition(chatStream as HTMLElement)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    )
  })

  it('shows exactly one primary agent action for the selected run mode', () => {
    renderRunPanel({ autoExecute: false, canRun: true })

    const manualPrimaryButtons = document.querySelectorAll('.agent-run-actions button.primary')
    expect(manualPrimaryButtons).toHaveLength(1)
    expect(screen.getByRole('button', { name: /plan next step/i })).toBeTruthy()

    cleanup()
    renderRunPanel({ autoExecute: true, canRun: true })

    const autoPrimaryButtons = document.querySelectorAll('.agent-run-actions button.primary')
    expect(autoPrimaryButtons).toHaveLength(1)
    expect(screen.getByRole('button', { name: /run agent/i })).toBeTruthy()
  })

  it('shows the running state from a stable busy id instead of the display label', () => {
    renderRunPanel({
      autoExecute: true,
      busyTask: { id: 'run-agent' },
      canRun: false,
    })

    expect(screen.getByRole('button', { name: /running/i })).toBeTruthy()
  })

  it('keeps a stop control visible in the primary run actions while busy', () => {
    renderRunPanel({
      autoExecute: true,
      busyTask: { id: 'run-agent' },
      canRun: false,
    })

    const stopButton = screen.getByRole('button', { name: /^stop$/i })

    expect(stopButton.closest('.agent-run-actions')).toBeTruthy()
    expect(stopButton.hasAttribute('disabled')).toBe(false)
  })

  it('explains disabled chat and run actions without showing an inert execute button', () => {
    renderRunPanel()

    expect(screen.getByRole('button', { name: /^send$/i }).getAttribute('title')).toBe(
      'Type a message first.',
    )
    expect(screen.getByRole('button', { name: /plan next step/i }).getAttribute('title')).toBe(
      'Connect a device, configure the model, and send or choose a task first.',
    )
    expect(screen.queryByRole('button', { name: /^execute$/i })).toBeNull()
  })

  it('does not keep max steps in the run panel after moving it to settings', () => {
    renderRunPanel()

    expect(screen.queryByLabelText(/max steps/i)).toBeNull()
  })

  it('hides the pending action panel when there is no pending step', () => {
    renderRunPanel({ pendingStep: null })

    expect(document.querySelector('.pending-action')).toBeNull()
    expect(screen.queryByText('Pending action')).toBeNull()
    expect(screen.queryByText('None')).toBeNull()
  })

  it('keeps the pending action panel for a real pending step', () => {
    const pendingStep = {
      index: 2,
      action: {
        action: 'tap',
        x: 120,
        y: 240,
      },
      preview: 'tap at 120, 240',
    } as AgentStep

    renderRunPanel({ pendingStep })

    const pendingAction = document.querySelector('.pending-action')
    expect(pendingAction).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('Pending action')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('Step 2')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('tap (120, 240)')).toBeTruthy()
    expect(
      within(pendingAction as HTMLElement).getByRole('button', { name: /^execute$/i }),
    ).toBeTruthy()
  })
})
