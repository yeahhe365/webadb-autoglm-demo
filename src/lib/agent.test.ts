import { describe, expect, it, vi } from 'vitest'
import type { DeviceBackend } from '../adapters/deviceTypes'
import {
  createAgentRunner,
  createAgentSession,
  nextAgentStepIndex,
  queueUserMessage,
  recordAgentStep,
  recordAgentStepExecutionDuration,
  runAgentStep,
  type AgentStep,
} from './agent'
import { OpenAiClientError } from './openAiErrors'
import type { OpenAiClient } from './openAiTypes'
import { ActionToolRegistry } from './toolRegistry'

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
    getScreenTree: vi.fn(async () => ({
      nodes: [
        {
          index: 0,
          text: 'Search',
          className: 'android.widget.EditText',
          clickable: true,
          bounds: { left: 24, top: 100, right: 1056, bottom: 180 },
        },
      ],
    })),
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
        screenTree: expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ text: 'Search' })]),
        }),
        promptContext: expect.stringContaining('<screen_tree>'),
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

  it('passes only prompt-safe custom tool and secret descriptors into model requests', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
    }

    await runAgentStep({
      device,
      client,
      customTools: [
        {
          name: 'lookup_order',
          description: 'Lookup a local fixture.',
          result: 'Local result that should not be sent in the prompt request.',
        },
      ],
      secrets: [
        {
          id: 'gmail_password',
          label: 'Gmail password',
          value: 'super-secret',
        },
      ],
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Log in',
    })

    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        customTools: [{ name: 'lookup_order', description: 'Lookup a local fixture.' }],
        secrets: [{ id: 'gmail_password', label: 'Gmail password' }],
        promptContext: expect.stringContaining('lookup_order: Lookup a local fixture.'),
      }),
    )
    const request = vi.mocked(client.completeAction).mock.calls[0][0]
    expect(JSON.stringify(request)).not.toContain('super-secret')
    expect(JSON.stringify(request)).not.toContain('Local result that should not be sent')
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

  it('retries an empty model response with compact non-streaming context', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open Settings')
    session.contextSummary = 'Earlier steps already navigated inside Settings.'
    session.messages.push(
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `o${index}`,
        role: 'observation' as const,
        content: `Executed old step ${index}`,
      })),
    )
    const client: OpenAiClient = {
      completeAction: vi
        .fn()
        .mockRejectedValueOnce(new OpenAiClientError('No assistant content returned by model.'))
        .mockResolvedValueOnce('{"action":"tap","x":100,"y":200,"reason":"retry"}'),
    }

    const step = await runAgentStep({
      device,
      client,
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        model: 'm',
        stream: true,
      },
      task: 'Open Settings',
      session,
    })

    expect(step.action).toEqual({ action: 'tap', x: 100, y: 200, reason: 'retry' })
    expect(client.completeAction).toHaveBeenCalledTimes(2)
    expect(client.completeAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation: [],
        stream: false,
        promptContext: expect.stringContaining('previous model response'),
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

  it('feeds recoverable execution failures back into the next model step', async () => {
    const device = fakeDevice()
    vi.mocked(device.execute).mockRejectedValueOnce(new Error('tap failed: stale coordinates'))
    const session = createAgentSession('Open app')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => {
        if (vi.mocked(client.completeAction).mock.calls.length === 1) {
          return '{"action":"tap","x":100,"y":200}'
        }
        return '{"action":"done","summary":"recovered"}'
      }),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 3,
      session,
    })

    expect(result.status).toBe('done')
    expect(client.completeAction).toHaveBeenCalledTimes(2)
    expect(session.turns[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        executionResult: 'tap failed: stale coordinates',
        success: false,
      }),
    )
    expect(client.completeAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        promptContext: expect.stringContaining('<recent_action_errors>'),
      }),
    )
    expect(client.completeAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        promptContext: expect.stringContaining('tap failed: stale coordinates'),
      }),
    )
  })

  it('stops before the next step when the run signal is aborted', async () => {
    const device = fakeDevice()
    const controller = new AbortController()
    controller.abort()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 5,
      signal: controller.signal,
    })

    expect(result.status).toBe('stopped')
    expect(client.completeAction).not.toHaveBeenCalled()
    expect(device.executed).toEqual([])
  })

  it('stops when the model returns done', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open app')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
      completeFinalResponse: vi.fn(async () => 'All set, the app is open.'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 5,
      session,
    })

    expect(result.status).toBe('done')
    expect(result.finalResponse).toBe('All set, the app is open.')
    expect(client.completeFinalResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'Open app',
        progressSummary: 'finished',
        conversation: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: 'finished' }),
        ]),
      }),
    )
    expect(session.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'All set, the app is open.' }),
    )
    expect(device.executed).toEqual([])
  })

  it('falls back to the done summary when final response generation is unavailable', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open app')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"finished"}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 5,
      session,
    })

    expect(result.status).toBe('done')
    expect(result.finalResponse).toBe('finished')
    expect(session.messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(session.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'finished' }),
    )
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

  it('continues through takeover actions in unrestricted mode', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi
        .fn()
        .mockResolvedValueOnce('{"action":"Take_over","message":"login required"}')
        .mockResolvedValueOnce('{"action":"done","summary":"finished"}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 5,
      unrestrictedMode: true,
    })

    expect(result.status).toBe('done')
    expect(device.executed).toEqual(['take_over'])
  })

  it('stops instead of executing legacy interact actions', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"Interact","message":"choose an account"}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 5,
    })

    expect(result.status).toBe('awaiting_takeover')
    expect(result.steps[0].action).toEqual({
      action: 'take_over',
      message: 'choose an account',
    })
    expect(device.executed).toEqual([])
  })

  it('routes local safety takeover decisions through the agent run status', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"input_text","text":"123456"}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Enter the verification code',
      autoExecute: true,
      maxSteps: 5,
    })

    expect(result.status).toBe('awaiting_takeover')
    expect(result.reason).toContain('manual takeover')
    expect(device.executed).toEqual([])
  })

  it('bypasses local safety takeover decisions in unrestricted mode', async () => {
    const device = fakeDevice()
    const client: OpenAiClient = {
      completeAction: vi
        .fn()
        .mockResolvedValueOnce('{"action":"input_text","text":"123456"}')
        .mockResolvedValueOnce('{"action":"done","summary":"finished"}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Enter the verification code',
      autoExecute: true,
      maxSteps: 5,
      unrestrictedMode: true,
    })

    expect(result.status).toBe('done')
    expect(device.executed).toEqual(['input_text'])
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

  it('returns retained run steps without screenshot image data or large prompt fields', async () => {
    const device = fakeDevice()
    const longModelOutput = `{"action":"tap","x":100,"y":200,"reason":"${'x'.repeat(6000)}"}`
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => longModelOutput),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: false,
      maxSteps: 1,
    })

    expect(result.steps[0].promptContext).toBeUndefined()
    expect(result.steps[0].screenshot.dataUrl).toBe('')
    expect(result.steps[0].screenshot.bytes).toBeUndefined()
    expect(result.steps[0].modelOutput.length).toBeLessThan(longModelOutput.length)
    expect(result.steps[0].modelOutput).toContain('[truncated]')
  })

  it('includes action execution time in the step total duration', () => {
    const step: AgentStep = {
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

    recordAgentStepExecutionDuration(step, 15.4)

    expect(step.timing.executionMs).toBe(15)
    expect(step.timing.totalMs).toBe(25)

    recordAgentStepExecutionDuration(step, 5)

    expect(step.timing.executionMs).toBe(5)
    expect(step.timing.totalMs).toBe(15)
  })

  it('returns auto-executed steps with execution time included', async () => {
    const device = fakeDevice()
    const registry = new ActionToolRegistry()
    registry.register('tap', {
      description: 'Delayed tap for timing assertions.',
      parameters: {},
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return 'input tap 100 200'
      },
    })
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200}'),
    }
    const runner = createAgentRunner({ device, client, toolRegistry: registry })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 1,
    })

    expect(result.steps[0].timing.executionMs).toBeGreaterThan(0)
    expect(result.steps[0].timing.totalMs).toBeGreaterThanOrEqual(
      result.steps[0].timing.executionMs ?? 0,
    )
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

  it('passes runtime action signatures into context and records the executed tool name', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Open app')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"tap","x":100,"y":200}'),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Open app',
      autoExecute: true,
      maxSteps: 1,
      session,
    })

    expect(result.status).toBe('max_steps')
    expect(client.completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionTools: expect.objectContaining({
          tap: expect.objectContaining({
            description: expect.stringContaining('Tap'),
          }),
        }),
        promptContext: expect.stringContaining('<available_action_tools>'),
      }),
    )
    expect(vi.mocked(client.completeAction).mock.calls[0][0].promptContext).toContain(
      'tap(x:number required, y:number required',
    )
    expect(session.turns[0].toolName).toBe('tap')
    expect(session.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action_execution',
          toolName: 'tap',
        }),
      ]),
    )
    expect(result.steps[0].toolName).toBe('tap')
  })

  it('lets the model recall a prior step screenshot and inspect it on the next turn', async () => {
    const device = fakeDevice()
    const screenshots = [
      'data:image/png;base64,screen-1',
      'data:image/png;base64,screen-2',
      'data:image/png;base64,screen-3',
    ]
    let screenshotCall = 0
    vi.mocked(device.screenshot).mockImplementation(async () => ({
      bytes: new Uint8Array(),
      dataUrl: screenshots[Math.min(screenshotCall++, screenshots.length - 1)],
      screen: { width: 1080, height: 2400 },
    }))
    const session = createAgentSession('Compare old screen')
    let modelCall = 0
    const recalledRequests: unknown[] = []
    const client: OpenAiClient = {
      completeAction: vi.fn(async (request) => {
        modelCall += 1
        if (modelCall === 1) {
          return '{"action":"wait","ms":100}'
        }
        if (modelCall === 2) {
          expect(request.promptContext).toContain('<available_screenshots>')
          expect(request.promptContext).toContain('step-1: step #1')
          return '{"action":"view_screenshot","step":1}'
        }

        recalledRequests.push(request.recalledScreenshots)
        expect(request.promptContext).toContain('<recalled_screenshot>')
        expect(request.promptContext).toContain('Attached recalled image: step-1')
        return '{"action":"done","summary":"compared"}'
      }),
    }
    const runner = createAgentRunner({ device, client })

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Compare old screen',
      autoExecute: true,
      maxSteps: 3,
      session,
    })

    expect(result.status).toBe('done')
    expect(session.turns[1].toolName).toBe('view_screenshot')
    expect(session.activeScreenshotRecall).toBeUndefined()
    expect(session.screenshotReferences.map((reference) => reference.id)).toEqual([
      'step-1',
      'step-2',
      'step-3',
    ])
    expect(recalledRequests).toEqual([
      [
        expect.objectContaining({
          dataUrl: 'data:image/png;base64,screen-1',
          label: 'step-1 from step #1',
          step: 1,
        }),
      ],
    ])
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

  it('does not remember note actions by default', () => {
    const session = createAgentSession('Open app')
    const onMemoryItem = vi.fn()
    const step: AgentStep = {
      index: 1,
      screenshot: {
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,abc',
        screen: { width: 1080, height: 2400 },
      },
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
      modelOutput: '{"action":"note","message":"Use the work account."}',
      action: { action: 'note', message: 'Use the work account.' },
      executionAction: { action: 'note', message: 'Use the work account.' },
      preview: 'note: Use the work account.',
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    }

    recordAgentStep(session, step, 'note', true, { onMemoryItem })

    expect(session.memory).toEqual([])
    expect(onMemoryItem).not.toHaveBeenCalled()
  })

  it('remembers note actions only when memory is enabled', () => {
    const session = createAgentSession('Open app')
    const onMemoryItem = vi.fn()
    const step: AgentStep = {
      index: 1,
      screenshot: {
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,abc',
        screen: { width: 1080, height: 2400 },
      },
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
      modelOutput: '{"action":"note","message":"Use the work account."}',
      action: { action: 'note', message: 'Use the work account.' },
      executionAction: { action: 'note', message: 'Use the work account.' },
      preview: 'note: Use the work account.',
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    }

    recordAgentStep(session, step, 'note', true, { memoryEnabled: true, onMemoryItem })

    expect(session.memory).toEqual(['Use the work account.'])
    expect(onMemoryItem).toHaveBeenCalledWith('Use the work account.')
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

  it('continues step numbering from restored session state', async () => {
    const device = fakeDevice()
    const session = createAgentSession('Continue task')
    session.stepNumber = 3
    session.history.push({
      step: 4,
      currentApp: 'Chrome',
      actionPreview: 'tap (10, 20)',
      executionResult: 'input tap 10 20',
    })
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"wait","ms":100}'),
    }
    const runner = createAgentRunner({ device, client })

    expect(nextAgentStepIndex(session)).toBe(5)

    const result = await runner.run({
      modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
      task: 'Continue task',
      autoExecute: true,
      maxSteps: 2,
      session,
    })

    expect(result.status).toBe('max_steps')
    expect(result.steps.map((step) => step.index)).toEqual([5, 6])
    expect(session.history.map((item) => item.step)).toEqual([4, 5, 6])
    expect(session.stepNumber).toBe(6)
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
        promptContext: expect.stringContaining('<pending_user_messages>\n- Now open Bluetooth'),
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
