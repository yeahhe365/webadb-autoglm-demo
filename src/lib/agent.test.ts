import { describe, expect, it, vi } from 'vitest'
import type { DeviceBackend } from '../adapters/deviceTypes'
import {
  createAgentRunner,
  createAgentSession,
  queueUserMessage,
  recordAgentStep,
  runAgentStep,
} from './agent'
import type { OpenAiClient } from './openAiTypes'

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
    getInstalledApps: vi.fn(async () => [
      { label: 'Gmail', packageName: 'com.google.android.gm' },
      { packageName: 'com.android.chrome' },
    ]),
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

  it('reports a fresh device snapshot before asking the model', async () => {
    const device = fakeDevice()
    const snapshots: unknown[] = []
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => {
        expect(snapshots).toHaveLength(1)
        return '{"action":"done","summary":"fresh screenshot shown"}'
      }),
    }

    await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot)
      },
    })

    expect(snapshots[0]).toEqual(
      expect.objectContaining({
        currentApp: 'Chrome',
        deviceState: expect.objectContaining({ packageName: 'com.android.chrome' }),
        index: 1,
        screenshot: expect.objectContaining({ dataUrl: 'data:image/png;base64,abc' }),
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
      session,
    })

    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        currentApp: 'Chrome',
        history: session.history,
      }),
    )
  })

  it('records model output in a structured turn instead of the visible transcript', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open Chrome')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200,"reason":"open"}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open Chrome',
      session,
    })

    expect(step.turnId).toBe(session.turns[0].id)
    expect(step.promptContext).toContain('Task: Open Chrome')
    expect(session.turns[0]).toEqual(
      expect.objectContaining({
        index: 1,
        modelOutput: '{"action":"tap","x":100,"y":200,"reason":"open"}',
        preview: 'tap (100, 200) - open',
        status: 'planned',
      }),
    )
    expect(session.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Open Chrome' }),
    ])
  })

  it('passes the built prompt context into model requests and stores it on the turn', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open Settings')
    session.contextSummary = 'Earlier context: Settings is already open.'
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open Settings',
      session,
    })

    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        promptContext: expect.stringContaining('Earlier context: Settings is already open.'),
      }),
    )
    expect(step.promptContext).toContain('Earlier context: Settings is already open.')
    expect(session.turns[0].promptContext).toBe(step.promptContext)
  })

  it('passes the current app card into model requests when a package matches', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
    }

    await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open a new tab',
    })

    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        appCard: expect.stringContaining('Chrome App Card'),
      }),
    )
  })

  it('passes installed launchable apps into model requests when the backend supports it', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
    }

    await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open Gmail',
    })

    expect(device.getInstalledApps).toHaveBeenCalled()
    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        installedApps: [
          { label: 'Gmail', packageName: 'com.google.android.gm' },
          { packageName: 'com.android.chrome' },
        ],
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
    })

    expect(step.currentApp).toBe('Unknown')
    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        currentApp: 'Unknown',
        deviceState: { app: 'Unknown' },
      }),
    )
  })

  it('repairs invalid model actions once before returning the step', async () => {
    const device = fakeDevice()
    const client = {
      completeAction: vi.fn(async () => '{"action":"tap","x":9999,"y":200}'),
      repairAction: vi.fn(async () => '{"action":"tap","x":100,"y":200,"reason":"fixed"}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
    })

    expect(step.modelOutput).toBe('{"action":"tap","x":100,"y":200,"reason":"fixed"}')
    expect(step.action).toEqual({ action: 'tap', x: 100, y: 200, reason: 'fixed' })
    expect(step.preview).toBe('tap (100, 200) - fixed')
    expect(client.repairAction).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidOutput: '{"action":"tap","x":9999,"y":200}',
        validationError: expect.stringContaining('outside the current screen'),
        screenshotDataUrl: 'data:image/png;base64,abc',
        screen: { width: 1080, height: 2400 },
        currentApp: 'Chrome',
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
      autoExecute: true,
      maxSteps: 1,
    })

    expect(device.executedActions).toEqual([{ action: 'tap', x: 500, y: 1000 }])
  })

  it('waits for the executed-action callback before starting the next step', async () => {
    const events: string[] = []
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => {
        events.push(`model-${vi.mocked(client.completeAction).mock.calls.length}`)
        return '{"action":"wait","ms":100}'
      }),
    }
    const runner = createAgentRunner({ device, client })

    await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 2,
      onExecuted: async () => {
        events.push('executed-callback-start')
        await Promise.resolve()
        events.push('executed-callback-end')
      },
    })

    expect(events).toEqual([
      'model-1',
      'executed-callback-start',
      'executed-callback-end',
      'model-2',
      'executed-callback-start',
      'executed-callback-end',
    ])
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
    expect(session.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'observation',
        content: 'input tap 100 200',
      }),
    )
  })

  it('keeps device state, visits, and action outcomes in shared run state', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open Chrome')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      session,
    })
    recordAgentStep(session, step, 'input tap 100 200', true)

    expect(session.currentApp).toBe('Chrome')
    expect(session.deviceState).toEqual(
      expect.objectContaining({
        packageName: 'com.android.chrome',
        activity: 'com.google.android.apps.chrome.Main',
      }),
    )
    expect(session.lastScreenshot?.screen).toEqual({ width: 1080, height: 2400 })
    expect(session.visitedPackages).toEqual(['com.android.chrome'])
    expect(session.visitedActivities).toEqual(['com.google.android.apps.chrome.Main'])
    expect(session.actionOutcomes).toEqual([true])
    expect(session.lastActionPreview).toBe('tap (100, 200)')
    expect(session.lastExecutionResult).toBe('input tap 100 200')
  })

  it('records failed executions in shared run state', () => {
    const session = createAgentSession('Open app')
    const step = {
      index: 1,
      screenshot: {
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,abc',
        screen: { width: 1080, height: 2400 },
      },
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action: { action: 'tap', x: 100, y: 200 } as const,
      executionAction: { action: 'tap', x: 100, y: 200 } as const,
      preview: 'tap (100, 200)',
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    }

    recordAgentStep(session, step, 'Sensitive action blocked', false)

    expect(session.actionOutcomes).toEqual([false])
    expect(session.errorDescriptions).toEqual(['Sensitive action blocked'])
    expect(session.lastExecutionResult).toBe('Sensitive action blocked')
  })

  it('keeps running when a new user message is queued while the model finishes', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open Settings')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => {
        if (vi.mocked(client.completeAction).mock.calls.length === 1) {
          queueUserMessage(session, 'Now open Bluetooth')
          return '{"action":"done","summary":"settings opened"}'
        }
        return '{"action":"done","summary":"bluetooth opened"}'
      }),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open Settings',
      autoExecute: true,
      maxSteps: 3,
      session,
    })

    expect(result.status).toBe('done')
    expect(client.completeAction).toHaveBeenCalledTimes(2)
    expect(session.pendingUserMessages).toEqual([])
    expect(client.completeAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Now open Bluetooth' }),
        ]),
      }),
    )
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
      autoExecute: true,
      maxSteps: 10,
    })

    expect(result.status).toBe('loop_guard')
    expect(device.executed).toEqual(['tap', 'tap', 'tap'])
    expect(result.reason).toContain('tap (100, 200)')
  })
})
