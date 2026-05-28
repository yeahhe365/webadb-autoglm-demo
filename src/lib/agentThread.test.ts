import { describe, expect, it } from 'vitest'
import type { DeviceScreenshot } from '../adapters/deviceTypes'
import type { AgentAction } from './actionTypes'
import {
  createAgentThread,
  recoverInterruptedThread,
  recordThreadFinalResponse,
  recordThreadStatus,
  recordThreadTurnExecution,
  recordThreadUserMessage,
  startThreadTurn,
} from './agentThread'

const screenshot: DeviceScreenshot = {
  bytes: new Uint8Array([1, 2, 3]),
  dataUrl: 'data:image/png;base64,abc',
  modelDataUrl: 'data:image/png;base64,model',
  modelScreen: { width: 540, height: 1200 },
  screen: { width: 1080, height: 2400 },
}

describe('agent thread model', () => {
  it('creates a persistent thread with user-visible messages and metadata', () => {
    const thread = createAgentThread('Open Settings', {
      id: 'thread-1',
      now: 1000,
      settingsSnapshot: {
        modelConfig: {
          baseUrl: 'https://api.example.com/v1',
          model: 'vision-model',
          reasoningEffort: 'low',
          stream: true,
        },
        autoExecute: true,
        maxSteps: 8,
      },
    })

    expect(thread).toEqual(
      expect.objectContaining({
        id: 'thread-1',
        title: 'Open Settings',
        status: 'idle',
        task: 'Open Settings',
        contextSummary: '',
        createdAt: 1000,
        updatedAt: 1000,
        settingsSnapshot: {
          modelConfig: {
            baseUrl: 'https://api.example.com/v1',
            model: 'vision-model',
            reasoningEffort: 'low',
            stream: true,
          },
          autoExecute: true,
          maxSteps: 8,
        },
      }),
    )
    expect(thread.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Open Settings' }),
    ])
    expect(thread.events).toEqual([
      expect.objectContaining({ type: 'user_message', message: 'Open Settings' }),
    ])
    expect(thread.turns).toEqual([])
  })

  it('records typed user message, device, assistant action, and execution events', () => {
    const thread = createAgentThread('', { id: 'thread-2', now: 1000 })
    const message = recordThreadUserMessage(thread, 'Open Bluetooth', { now: 1100 })
    const action: AgentAction = { action: 'tap', x: 100, y: 200, reason: 'open' }
    const turn = startThreadTurn(thread, {
      id: 'turn-1',
      index: 1,
      task: 'Open Bluetooth',
      latestUserMessage: message.content,
      promptContext: 'Task: Open Bluetooth',
      modelOutput: '{"action":"tap","x":100,"y":200,"reason":"open"}',
      action,
      executionAction: action,
      preview: 'tap (100, 200) - open',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings', packageName: 'com.android.settings' },
        screenshot,
      },
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
      now: 1200,
    })

    recordThreadTurnExecution(thread, turn.id, {
      executionResult: 'input tap 100 200',
      toolName: 'tap',
      success: true,
      now: 1300,
    })

    expect(thread.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Open Bluetooth' }),
      expect.objectContaining({ role: 'observation', content: 'input tap 100 200' }),
    ])
    expect(thread.turns).toEqual([
      expect.objectContaining({
        id: 'turn-1',
        deviceSnapshot: {
          currentApp: 'Settings',
          deviceState: { app: 'Settings', packageName: 'com.android.settings' },
        },
        status: 'executed',
        promptContext: 'Task: Open Bluetooth',
        modelOutput: '{"action":"tap","x":100,"y":200,"reason":"open"}',
        executionResult: 'input tap 100 200',
        toolName: 'tap',
        success: true,
        completedAt: 1300,
      }),
    ])
    expect(thread.events.map((event) => event.type)).toEqual([
      'user_message',
      'device_snapshot',
      'assistant_action',
      'action_execution',
    ])
    expect(thread.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action_execution',
          toolName: 'tap',
        }),
      ]),
    )
    expect(thread.lastScreenshot).toEqual({
      dataUrl: 'data:image/png;base64,model',
      modelScreen: { width: 540, height: 1200 },
      screen: { width: 1080, height: 2400 },
    })
    expect(JSON.stringify(thread.turns)).not.toContain('base64')
    expect(JSON.stringify(thread.events)).not.toContain('base64')
    expect(thread.history).toEqual([
      {
        step: 1,
        currentApp: 'Settings',
        actionPreview: 'tap (100, 200) - open',
        executionResult: 'input tap 100 200',
      },
    ])
  })

  it('allows extra status events without changing the user-visible transcript', () => {
    const thread = createAgentThread('Inspect screen', { id: 'thread-3', now: 1000 })

    recordThreadStatus(thread, 'running', 'Run started', { now: 1100 })

    expect(thread.status).toBe('running')
    expect(thread.messages.map((message) => message.content)).toEqual(['Inspect screen'])
    expect(thread.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'status_change',
        status: 'running',
        message: 'Run started',
      }),
    )
  })

  it('recovers a persisted running thread as stopped with planned turns left reviewable', () => {
    const thread = createAgentThread('Continue interrupted run', { id: 'thread-recover', now: 1000 })
    recordThreadStatus(thread, 'running', 'Run agent', { now: 1100 })
    const action: AgentAction = { action: 'tap', x: 100, y: 200 }
    startThreadTurn(thread, {
      id: 'turn-planned',
      index: 1,
      task: 'Continue interrupted run',
      latestUserMessage: 'Continue interrupted run',
      promptContext: 'Task: Continue interrupted run',
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action,
      executionAction: action,
      preview: 'tap (100, 200)',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings', packageName: 'com.android.settings' },
        screenshot,
      },
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
      now: 1200,
    })

    const recovered = recoverInterruptedThread(thread, 'Browser was refreshed.', { now: 1300 })

    expect(recovered).toBe(true)
    expect(thread.status).toBe('stopped')
    expect(thread.turns[0].status).toBe('awaiting_review')
    expect(thread.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'status_change',
        status: 'stopped',
        message: 'Browser was refreshed.',
      }),
    )
  })

  it('replaces a provisional done summary with the final assistant response', () => {
    const thread = createAgentThread('Open Bluetooth', { id: 'thread-final', now: 1000 })
    const action: AgentAction = { action: 'done', summary: 'Bluetooth is open.' }
    const turn = startThreadTurn(thread, {
      id: 'turn-final',
      index: 1,
      task: 'Open Bluetooth',
      latestUserMessage: 'Open Bluetooth',
      promptContext: 'Task: Open Bluetooth',
      modelOutput: '{"action":"done","summary":"Bluetooth is open."}',
      action,
      executionAction: action,
      preview: 'done - Bluetooth is open.',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings', packageName: 'com.android.settings' },
        screenshot,
      },
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
      now: 1100,
    })

    recordThreadTurnExecution(thread, turn.id, { now: 1200 })
    const final = recordThreadFinalResponse(thread, 'All set. Bluetooth settings is open.', {
      now: 1300,
    })

    expect(final.content).toBe('All set. Bluetooth settings is open.')
    expect(thread.messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(thread.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'assistant_message',
          messageId: final.id,
          message: 'All set. Bluetooth settings is open.',
        }),
      ]),
    )
  })
})
