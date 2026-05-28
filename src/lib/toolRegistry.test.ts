import { describe, expect, it, vi } from 'vitest'
import type { DeviceBackend } from '../adapters/deviceTypes'
import { createAgentThread, recordThreadScreenshot } from './agentThread'
import { createDefaultActionToolRegistry } from './toolRegistry'

function fakeDevice(): DeviceBackend & { executed: string[] } {
  const executed: string[] = []
  return {
    executed,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getCurrentApp: vi.fn(async () => 'Chrome'),
    getDeviceState: vi.fn(async () => ({ app: 'Chrome' })),
    screenshot: vi.fn(async () => ({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,abc',
      screen: { width: 1080, height: 2400 },
    })),
    execute: vi.fn(async (action) => {
      executed.push(action.action)
      return `${action.action} executed`
    }),
  }
}

describe('ActionToolRegistry', () => {
  it('exposes action signatures from one registry', () => {
    const registry = createDefaultActionToolRegistry()
    const signatures = registry.getSignatures()

    expect(signatures.tap.description).toContain('Tap')
    expect(signatures.tap.parameters.x).toEqual(
      expect.objectContaining({ required: true, type: 'number' }),
    )
    expect(signatures.input_text.parameters.text).toEqual(
      expect.objectContaining({ required: true, type: 'string' }),
    )
    expect(signatures.input_text.parameters.clear).toEqual(
      expect.objectContaining({ required: false, type: 'boolean', default: false }),
    )
    expect(signatures.type_secret.parameters.secretId).toEqual(
      expect.objectContaining({ required: true, type: 'string' }),
    )
    expect(signatures.open_url.parameters.url).toEqual(
      expect.objectContaining({ required: true, type: 'string' }),
    )
    expect(signatures.set_clipboard.parameters.text).toEqual(
      expect.objectContaining({ required: true, type: 'string' }),
    )
    expect(signatures.paste.parameters).toEqual({})
    expect(signatures.custom_tool.parameters.tool).toEqual(
      expect.objectContaining({ required: true, type: 'string' }),
    )
    expect(signatures.view_screenshot.parameters.step).toEqual(
      expect.objectContaining({ required: false, type: 'number' }),
    )
    expect(signatures.sequence.parameters.actions).toEqual(
      expect.objectContaining({ required: true, type: 'list' }),
    )
    expect(signatures.repeat.parameters.count).toEqual(
      expect.objectContaining({ required: true, type: 'number' }),
    )
    expect(signatures.repeat.parameters.actionToRepeat).toEqual(
      expect.objectContaining({ required: true, type: 'object' }),
    )
    expect(signatures.wait.parameters.duration).toEqual(
      expect.objectContaining({ required: false, type: 'number', default: 1.0 }),
    )
    expect(signatures).not.toHaveProperty('interact')
    expect(signatures).not.toHaveProperty('call_api')
  })

  it('executes device actions through one normalized result shape', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      { action: 'tap', x: 100, y: 200 },
      { device },
    )

    expect(result).toEqual({
      success: true,
      summary: 'tap executed',
      toolName: 'tap',
    })
    expect(device.executed).toEqual(['tap'])
  })

  it('normalizes disabled tools without touching the device', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry(['tap'])

    expect(registry.getSignatures()).not.toHaveProperty('tap')

    const result = await registry.execute(
      { action: 'tap', x: 100, y: 200 },
      { device },
    )

    expect(result.success).toBe(false)
    expect(result.summary).toContain('disabled')
    expect(device.executed).toEqual([])
  })

  it('executes sequence actions through the same action registry', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      {
        action: 'sequence',
        actions: [
          { action: 'tap', x: 100, y: 200 },
          { action: 'input_text', text: 'hello' },
        ],
      },
      { device },
    )

    expect(result.success).toBe(true)
    expect(result.toolName).toBe('sequence')
    expect(result.summary).toContain('sequence completed 2 action(s).')
    expect(result.summary).toContain('action 1/2 tap: tap executed')
    expect(result.summary).toContain('action 2/2 input_text: input_text executed')
    expect(device.executed).toEqual(['tap', 'input_text'])
  })

  it('executes repeat actions the requested number of times', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      {
        action: 'repeat',
        count: 3,
        actionToRepeat: { action: 'back' },
      },
      { device },
    )

    expect(result.success).toBe(true)
    expect(result.toolName).toBe('repeat')
    expect(result.summary).toContain('repeat completed 3 action(s).')
    expect(result.summary).toContain('repeat 3/3 back: back executed')
    expect(device.executed).toEqual(['back', 'back', 'back'])
  })

  it('stops composite actions when a child action fails safety checks', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      {
        action: 'sequence',
        actions: [
          { action: 'tap', x: 100, y: 200 },
          { action: 'tap', x: 300, y: 400 },
        ],
      },
      { device, safetyContext: { task: 'Pay now and place order' } },
    )

    expect(result).toEqual({
      success: false,
      safetyDecision: 'block',
      summary: [
        'sequence stopped at action 1/2.',
        'action 1/2 tap: Safety policy blocked a payment, checkout, order, or money-transfer action.',
      ].join('\n'),
      toolName: 'sequence',
    })
    expect(device.executed).toEqual([])
  })

  it('applies local safety policy before executing device actions', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      { action: 'tap', x: 100, y: 200 },
      { device, safetyContext: { task: 'Pay now and place order' } },
    )

    expect(result).toEqual({
      success: false,
      summary: 'Safety policy blocked a payment, checkout, order, or money-transfer action.',
      toolName: 'tap',
      safetyDecision: 'block',
    })
    expect(device.executed).toEqual([])
  })

  it('bypasses local safety policy in unrestricted mode', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()
    const confirmSensitiveAction = vi.fn(async () => false)

    const result = await registry.execute(
      { action: 'tap', x: 100, y: 200 },
      {
        device,
        confirmSensitiveAction,
        safetyContext: { task: 'Pay now and place order' },
        unrestrictedMode: true,
      },
    )

    expect(result).toEqual({
      success: true,
      summary: 'tap executed',
      toolName: 'tap',
    })
    expect(confirmSensitiveAction).not.toHaveBeenCalled()
    expect(device.executed).toEqual(['tap'])
  })

  it('asks for local safety confirmation without relying on model risk metadata', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()
    const confirmSensitiveAction = vi.fn(async () => true)

    const result = await registry.execute(
      { action: 'tap', x: 100, y: 200 },
      {
        device,
        confirmSensitiveAction,
        safetyContext: { task: 'Allow Contacts permission' },
      },
    )

    expect(result).toEqual({
      success: true,
      summary: 'tap executed',
      toolName: 'tap',
    })
    expect(confirmSensitiveAction).toHaveBeenCalledWith(
      'Safety policy requires confirmation before authorization, permission, or account-setting changes.',
      { action: 'tap', x: 100, y: 200 },
    )
    expect(device.executed).toEqual(['tap'])
  })

  it('turns legacy fake actions into takeover results without touching the device', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    await expect(
      registry.execute({ action: 'interact', message: 'choose an account' }, { device }),
    ).resolves.toEqual({
      success: false,
      summary: 'choose an account',
      toolName: 'interact',
      safetyDecision: 'take_over',
    })
    await expect(
      registry.execute({ action: 'call_api', instruction: 'summarize notes' }, { device }),
    ).resolves.toEqual({
      success: false,
      summary: 'Unsupported call_api action: summarize notes',
      toolName: 'call_api',
      safetyDecision: 'take_over',
    })
    expect(device.executed).toEqual([])
  })

  it('types configured secrets without leaking the value in the result', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      { action: 'type_secret', secretId: 'gmail_password', clear: true },
      {
        device,
        secrets: [{ id: 'gmail_password', label: 'Gmail password', value: 'super-secret' }],
      },
    )

    expect(result).toEqual({
      success: true,
      summary: 'Typed secret "gmail_password".',
      toolName: 'type_secret',
    })
    expect(device.execute).toHaveBeenCalledWith({
      action: 'input_text',
      text: 'super-secret',
      clear: true,
      reason: undefined,
    }, {
      signal: undefined,
    })
    expect(result.summary).not.toContain('super-secret')
  })

  it('runs configured local custom tools', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      { action: 'custom_tool', tool: 'lookup_order', input: { id: '123' } },
      {
        device,
        customTools: [
          {
            name: 'lookup_order',
            description: 'Lookup a local order fixture.',
            result: 'Order 123 is ready.',
          },
        ],
      },
    )

    expect(result.success).toBe(true)
    expect(result.toolName).toBe('custom_tool')
    expect(result.summary).toContain('Order 123 is ready.')
    expect(result.summary).toContain('"id": "123"')
    expect(device.executed).toEqual([])
  })

  it('recalls stored screenshots without touching the device', async () => {
    const device = fakeDevice()
    const session = createAgentThread('Compare old screen')
    recordThreadScreenshot(session, {
      step: 3,
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
      screenshot: {
        dataUrl: 'data:image/png;base64,old',
        modelDataUrl: 'data:image/png;base64,old-model',
        modelScreen: { width: 540, height: 1200 },
        screen: { width: 1080, height: 2400 },
      },
      now: 1000,
    })
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      { action: 'view_screenshot', step: 3 },
      { device, screenshotRecallThread: session },
    )

    expect(result.success).toBe(true)
    expect(result.toolName).toBe('view_screenshot')
    expect(result.summary).toContain('Recalled screenshot step-3')
    expect(session.activeScreenshotRecall).toEqual(
      expect.objectContaining({
        id: 'step-3',
        screenshot: expect.objectContaining({ dataUrl: 'data:image/png;base64,old-model' }),
      }),
    )
    expect(device.executed).toEqual([])
  })

  it('blocks screenshot recall when that action tool is disabled', async () => {
    const device = fakeDevice()
    const session = createAgentThread('Compare old screen')
    recordThreadScreenshot(session, {
      step: 1,
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
      screenshot: {
        dataUrl: 'data:image/png;base64,old',
        screen: { width: 1080, height: 2400 },
      },
      now: 1000,
    })
    const registry = createDefaultActionToolRegistry(['view_screenshot'])

    expect(registry.getSignatures()).not.toHaveProperty('view_screenshot')

    const result = await registry.execute(
      { action: 'view_screenshot', step: 1 },
      { device, screenshotRecallThread: session },
    )

    expect(result.success).toBe(false)
    expect(result.summary).toContain('disabled')
    expect(session.activeScreenshotRecall).toBeUndefined()
    expect(device.executed).toEqual([])
  })

  it('does not request takeover for legacy interact actions in unrestricted mode', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    await expect(
      registry.execute(
        { action: 'interact', message: 'choose an account' },
        { device, unrestrictedMode: true },
      ),
    ).resolves.toEqual({
      success: true,
      summary: 'Ignored manual interaction request in unrestricted mode: choose an account',
      toolName: 'interact',
    })
    expect(device.executed).toEqual([])
  })
})
