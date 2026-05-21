import { describe, expect, it, vi } from 'vitest'
import type { DeviceBackend } from '../adapters/deviceBackend'
import { createAgentRunner, createAgentSession, recordAgentStep, runAgentStep } from './agent'
import type { OpenAiClient } from './openAiClient'

function fakeDevice(): DeviceBackend & { executed: string[] } {
  const executed: string[] = []
  return {
    executed,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getCurrentApp: vi.fn(async () => 'Chrome'),
    getDeviceState: vi.fn(async () => ({
      app: 'Chrome',
      packageName: 'com.android.chrome',
      activity: 'com.google.android.apps.chrome.Main',
      orientation: 'portrait' as const,
      keyboard: 'com.android.adbkeyboard/.AdbIME',
    })),
    screenshot: vi.fn(async () => ({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,abc',
      screen: { width: 1080, height: 2400 },
    })),
    execute: vi.fn(async (action) => {
      executed.push(action.action)
      return action.action
    }),
  }
}

function fakePreprocessedDevice(): DeviceBackend & { executedActions: unknown[] } {
  const executedActions: unknown[] = []
  return {
    executedActions,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getCurrentApp: vi.fn(async () => 'Chrome'),
    getDeviceState: vi.fn(async () => ({ app: 'Chrome' })),
    screenshot: vi.fn(async () => ({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,raw',
      screen: { width: 1000, height: 2000 },
      modelDataUrl: 'data:image/png;base64,model',
      modelScreen: { width: 500, height: 1000 },
    })),
    execute: vi.fn(async (action) => {
      executedActions.push(action)
      return action.action
    }),
  }
}

describe('runAgentStep', () => {
  it('captures the screen, asks the model, and validates the action', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200,"reason":"open"}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
        task: 'Open app',
        promptMode: 'canonical-json',
      })

    expect(step.action).toEqual({ action: 'tap', x: 100, y: 200, reason: 'open' })
    expect(step.preview).toBe('tap (100, 200) - open')
    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshotDataUrl: 'data:image/png;base64,abc',
        screen: { width: 1080, height: 2400 },
        currentApp: 'Chrome',
        deviceState: expect.objectContaining({
          packageName: 'com.android.chrome',
          activity: 'com.google.android.apps.chrome.Main',
        }),
      }),
    )
  })

  it('passes previous session history and current app into model requests', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open Chrome')
    session.history.push({
      step: 1,
      currentApp: 'System Home',
      actionPreview: 'launch Chrome',
      executionResult: 'monkey -p com.android.chrome',
    })
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200}'),
    }

    await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      session,
    })

    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        currentApp: 'Chrome',
        history: session.history,
      }),
    )
  })

  it('asks the model about preprocessed screenshot pixels and stores mapped execution coordinates', async () => {
    const device = fakePreprocessedDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":250,"y":500,"reason":"open"}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
    })

    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshotDataUrl: 'data:image/png;base64,model',
        screen: { width: 500, height: 1000 },
        deviceScreen: { width: 1000, height: 2000 },
      }),
    )
    expect(step.action).toEqual({ action: 'tap', x: 250, y: 500, reason: 'open' })
    expect(step.executionAction).toEqual({ action: 'tap', x: 500, y: 1000, reason: 'open' })
  })

  it('continues with an unknown current app when app detection fails', async () => {
    const device = fakeDevice()
    vi.mocked(device.getDeviceState).mockRejectedValueOnce(new Error('dumpsys failed'))
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
    })

    expect(step.currentApp).toBe('Unknown')
    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        currentApp: 'Unknown',
        deviceState: { app: 'Unknown' },
      }),
    )
  })
})

describe('createAgentRunner', () => {
  it('stops after preparing a manual-review action', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      autoExecute: false,
      maxSteps: 5,
    })

    expect(result.status).toBe('awaiting_review')
    expect(device.executed).toEqual([])
  })

  it('stops when the model returns done', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      autoExecute: true,
      maxSteps: 5,
    })

    expect(result.status).toBe('done')
    expect(device.executed).toEqual([])
  })

  it('stops for manual takeover even when auto-execute is enabled', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"Take_over","message":"login required"}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      autoExecute: true,
      maxSteps: 5,
    })

    expect(result.status).toBe('awaiting_takeover')
    expect(device.executed).toEqual([])
  })

  it('stops at the max step limit', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"wait","ms":100}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      autoExecute: true,
      maxSteps: 2,
    })

    expect(result.status).toBe('max_steps')
    expect(device.executed).toEqual(['wait', 'wait'])
  })

  it('auto-executes coordinates mapped back to the device screen', async () => {
    const device = fakePreprocessedDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":250,"y":500}'),
    }
    const runner = createAgentRunner({ device, client })

    await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      autoExecute: true,
      maxSteps: 1,
    })

    expect(device.executedActions).toEqual([{ action: 'tap', x: 500, y: 1000 }])
  })

  it('records executed steps in the session history for the next model call', async () => {
    const session = createAgentSession('Open app')
    const step = {
      index: 1,
      screenshot: {
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,abc',
        screen: { width: 1080, height: 2400 },
      },
      currentApp: 'Chrome',
      deviceState: {
        app: 'Chrome',
        packageName: 'com.android.chrome',
      },
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action: { action: 'tap', x: 100, y: 200 } as const,
      executionAction: { action: 'tap', x: 100, y: 200 } as const,
      preview: 'tap (100, 200)',
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    }

    recordAgentStep(session, step, 'input tap 100 200')

    expect(session.history).toEqual([
      {
        step: 1,
        currentApp: 'Chrome',
        actionPreview: 'tap (100, 200)',
        executionResult: 'input tap 100 200',
      },
    ])
  })

  it('stops before executing a fourth consecutive wait action', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"wait","ms":100}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      autoExecute: true,
      maxSteps: 10,
    })

    expect(result.status).toBe('loop_guard')
    expect(device.executed).toEqual(['wait', 'wait', 'wait'])
    expect(result.reason).toContain('wait')
  })

  it('stops before executing a repeated identical action too many times', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      promptMode: 'canonical-json',
      autoExecute: true,
      maxSteps: 10,
    })

    expect(result.status).toBe('loop_guard')
    expect(device.executed).toEqual(['tap', 'tap', 'tap'])
    expect(result.reason).toContain('tap (100, 200)')
  })
})
