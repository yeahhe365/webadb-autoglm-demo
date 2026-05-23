import { describe, expect, it } from 'vitest'
import type { DeviceScreenshot } from '../adapters/deviceTypes'
import type { AgentAction } from './actionTypes'
import {
  addThreadEvent,
  createAgentThread,
  recordThreadTurnExecution,
  recordThreadUserMessage,
  startThreadTurn,
} from './agentThread'

const screenshot: DeviceScreenshot = {
  bytes: new Uint8Array([1, 2, 3]),
  dataUrl: 'data:image/png;base64,abc',
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
        status: 'executed',
        promptContext: 'Task: Open Bluetooth',
        modelOutput: '{"action":"tap","x":100,"y":200,"reason":"open"}',
        executionResult: 'input tap 100 200',
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

    addThreadEvent(thread, {
      type: 'status_change',
      status: 'running',
      message: 'Run started',
    }, { now: 1100 })

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
})
