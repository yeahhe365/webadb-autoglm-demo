import { describe, expect, it } from 'vitest'
import {
  createAgentThread,
  recallThreadScreenshot,
  recordThreadScreenshot,
  recordThreadTurnExecution,
  startThreadTurn,
} from './agentThread'
import type { AgentAction } from './actionTypes'
import {
  buildAgentPromptContext,
  compactThreadContext,
  historyFromRecentTurns,
} from './contextBuilder'

const action: AgentAction = { action: 'tap', x: 100, y: 200 }
const timing = { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 }

describe('context builder', () => {
  it('builds prompt context from summary, latest user message, device state, and app metadata', () => {
    const thread = createAgentThread('Open Settings', { id: 'thread-context', now: 1000 })
    thread.contextSummary = 'Earlier context: user opened Settings and inspected Wi-Fi.'
    startThreadTurn(thread, {
      id: 'turn-1',
      index: 1,
      status: 'executed',
      task: 'Open Settings',
      latestUserMessage: 'Open Settings',
      promptContext: 'old prompt',
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action,
      executionAction: action,
      preview: 'tap (100, 200)',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings', packageName: 'com.android.settings' },
      },
      timing,
      now: 1100,
    })

    const context = buildAgentPromptContext({
      thread,
      task: 'Open Bluetooth',
      latestUserMessage: 'Open Bluetooth',
      screen: { width: 1080, height: 2400 },
      deviceScreen: { width: 1440, height: 3120 },
      currentApp: 'Settings',
      deviceState: {
        app: 'Settings',
        packageName: 'com.android.settings',
        activity: 'com.android.settings.Settings',
        keyboard: 'com.android.adbkeyboard/.AdbIME',
      },
      appCard: '# Settings App Card\n- Search is fastest.',
      installedApps: [
        { label: 'Settings', packageName: 'com.android.settings' },
        { packageName: 'com.android.chrome' },
      ],
      maxRecentTurns: 2,
    })

    expect(context.text).toContain('Task: Open Bluetooth')
    expect(context.text).toContain('Latest user message: Open Bluetooth')
    expect(context.text).toContain('Earlier context: user opened Settings')
    expect(context.text).toContain('"current_app":"Settings"')
    expect(context.text).toContain('"device_screen_size":"1440x3120"')
    expect(context.text).toContain('<app_card>')
    expect(context.text).toContain('Settings App Card')
    expect(context.text).toContain('<installed_apps>')
    expect(context.text).toContain('Settings: com.android.settings')
    expect(context.text).toContain('Previous steps:')
    expect(context.text).toContain('Step 1')
  })

  it('caps the installed app prompt list while keeping the requested app', () => {
    const installedApps = Array.from({ length: 45 }, (_, index) => ({
      packageName: `com.example.app${index}`,
    }))

    const context = buildAgentPromptContext({
      task: 'Open app44',
      screen: { width: 1080, height: 2400 },
      installedApps,
    })

    expect(context.text).toContain('app44: com.example.app44')
    expect(context.text).toContain('app0: com.example.app0')
    expect(context.text).toContain('... truncated 5 more apps')
    expect(context.text).not.toContain('app39: com.example.app39')
  })

  it('uses only recent turns for prompt history', () => {
    const thread = createAgentThread('Scroll list', { id: 'thread-recent', now: 1000 })
    for (let index = 1; index <= 5; index += 1) {
      startThreadTurn(thread, {
        id: `turn-${index}`,
        index,
        status: 'executed',
        task: 'Scroll list',
        promptContext: 'prompt',
        modelOutput: '{"action":"wait","ms":100}',
        action: { action: 'wait', ms: 100 },
        executionAction: { action: 'wait', ms: 100 },
        preview: `wait ${index}`,
        deviceSnapshot: {
          currentApp: 'Chrome',
          deviceState: { app: 'Chrome' },
        },
        timing,
        now: 1000 + index,
      })
    }

    const recent = historyFromRecentTurns(thread, 2)

    expect(recent.map((item) => item.step)).toEqual([4, 5])
    expect(recent.map((item) => item.actionPreview)).toEqual(['wait 4', 'wait 5'])
  })

  it('summarizes older turns once while keeping full turn records', () => {
    const thread = createAgentThread('Find item', { id: 'thread-compact', now: 1000 })
    for (let index = 1; index <= 6; index += 1) {
      startThreadTurn(thread, {
        id: `turn-${index}`,
        index,
        status: 'executed',
        task: 'Find item',
        promptContext: 'prompt',
        modelOutput: '{"action":"wait","ms":100}',
        action: { action: 'wait', ms: 100 },
        executionAction: { action: 'wait', ms: 100 },
        preview: `wait ${index}`,
        deviceSnapshot: {
          currentApp: 'Chrome',
          deviceState: { app: 'Chrome' },
        },
        timing,
        now: 1000 + index,
      })
    }

    const first = compactThreadContext(thread, { keepRecentTurns: 2, now: 2000 })
    const second = compactThreadContext(thread, { keepRecentTurns: 2, now: 3000 })

    expect(first).toContain('Step 1: app=Chrome | action=wait 1')
    expect(first).toContain('Step 4: app=Chrome | action=wait 4')
    expect(second).toBeNull()
    expect(thread.contextSummary).toContain('Step 1')
    expect(thread.contextCompactedThroughStep).toBe(4)
    expect(thread.turns).toHaveLength(6)
    expect(thread.turns[0].promptContext).toBe('')
    expect(thread.turns[0].modelOutput).toBe('')
    expect(thread.turns[3].promptContext).toBe('')
    expect(thread.turns[3].modelOutput).toBe('')
    expect(thread.turns[4].promptContext).toBe('prompt')
    expect(thread.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'context_compaction',
        compactedThroughStep: 4,
      }),
    )
  })

  it('keeps planned turns out of prompt history until they are executed', () => {
    const thread = createAgentThread('Open Settings', { id: 'thread-planned', now: 1000 })
    startThreadTurn(thread, {
      id: 'turn-planned',
      index: 1,
      task: 'Open Settings',
      promptContext: 'prompt',
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action,
      executionAction: action,
      preview: 'tap (100, 200)',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings' },
      },
      timing,
      now: 1100,
    })

    const context = buildAgentPromptContext({
      thread,
      task: 'Open Settings',
      screen: { width: 1080, height: 2400 },
      currentApp: 'Settings',
      deviceState: { app: 'Settings' },
    })

    expect(context.history).toEqual([])
    expect(context.text).not.toContain('Previous steps:')
  })

  it('includes queued user steering separately from durable transcript messages', () => {
    const context = buildAgentPromptContext({
      task: 'Open Settings',
      latestUserMessage: 'Open Bluetooth',
      pendingUserMessages: ['Open Bluetooth', 'Then show paired devices'],
      screen: { width: 1080, height: 2400 },
      currentApp: 'Settings',
      deviceState: { app: 'Settings' },
    })

    expect(context.text).toContain('<pending_user_messages>')
    expect(context.text).toContain('- Open Bluetooth')
    expect(context.text).toContain('- Then show paired devices')
  })

  it('keeps durable memory out of prompt context by default', () => {
    const thread = createAgentThread('Open Gmail')
    thread.memory = ['Use the work Gmail account.']

    const context = buildAgentPromptContext({
      thread,
      task: 'Open Gmail',
      memoryItems: ['Verification code is 123456.'],
      screen: { width: 1080, height: 2400 },
      currentApp: 'Gmail',
      deviceState: { app: 'Gmail' },
    })

    expect(context.text).not.toContain('Durable memory:')
    expect(context.text).not.toContain('Use the work Gmail account.')
    expect(context.text).not.toContain('Verification code is 123456.')
    expect(context.text).toContain('without storing durable memory')
    expect(context.text).not.toContain('store the code with note/remember')
  })

  it('includes local and thread memory only when memory is enabled', () => {
    const thread = createAgentThread('Open Gmail')
    thread.memory = ['Use the work Gmail account.']

    const context = buildAgentPromptContext({
      thread,
      task: 'Open Gmail',
      memoryEnabled: true,
      memoryItems: ['Verification code is 123456.'],
      screen: { width: 1080, height: 2400 },
      currentApp: 'Gmail',
      deviceState: { app: 'Gmail' },
    })

    expect(context.text).toContain('Durable memory:')
    expect(context.text).toContain('- Verification code is 123456.')
    expect(context.text).toContain('- Use the work Gmail account.')
    expect(context.text).toContain('store the code with note/remember')
  })

  it('includes runtime action tool signatures when provided', () => {
    const context = buildAgentPromptContext({
      task: 'Open Settings',
      actionTools: {
        tap: {
          description: 'Tap a screen coordinate.',
          parameters: {
            x: { type: 'number', required: true },
            y: { type: 'number', required: true },
            message: { type: 'string', required: false },
          },
        },
        back: {
          description: 'Press Android Back.',
          parameters: {},
        },
      },
      screen: { width: 1080, height: 2400 },
      currentApp: 'Settings',
      deviceState: { app: 'Settings' },
    })

    expect(context.text).toContain('<available_action_tools>')
    expect(context.text).toContain('Choose only one listed action tool')
    expect(context.text).toContain('tap(x:number required, y:number required, message:string optional)')
    expect(context.text).toContain('back(): Press Android Back.')
  })

  it('lists old screenshot references only when the recall tool is available', () => {
    const thread = createAgentThread('Compare screens')
    recordThreadScreenshot(thread, {
      step: 2,
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
      screenshot: {
        dataUrl: 'data:image/png;base64,old',
        modelScreen: { width: 540, height: 1200 },
        screen: { width: 1080, height: 2400 },
      },
      now: 1000,
    })

    const withTool = buildAgentPromptContext({
      thread,
      task: 'Compare screens',
      actionTools: {
        view_screenshot: {
          description: 'Recall an earlier screenshot.',
          parameters: {
            step: { type: 'number', required: false },
          },
        },
      },
      screen: { width: 1080, height: 2400 },
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
    })
    const withoutTool = buildAgentPromptContext({
      thread,
      task: 'Compare screens',
      screen: { width: 1080, height: 2400 },
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
    })

    expect(withTool.text).toContain('<available_screenshots>')
    expect(withTool.text).toContain('step-2: step #2')
    expect(withoutTool.text).not.toContain('<available_screenshots>')
  })

  it('describes an active recalled screenshot in prompt context', () => {
    const thread = createAgentThread('Compare screens')
    recordThreadScreenshot(thread, {
      step: 3,
      currentApp: 'Settings',
      deviceState: { app: 'Settings' },
      screenshot: {
        dataUrl: 'data:image/png;base64,old',
        modelScreen: { width: 500, height: 1000 },
        screen: { width: 1000, height: 2000 },
      },
      now: 1000,
    })
    recallThreadScreenshot(thread, { action: 'view_screenshot', ref: 'step-3' }, { now: 1100 })

    const context = buildAgentPromptContext({
      thread,
      task: 'Compare screens',
      screen: { width: 1080, height: 2400 },
      currentApp: 'Settings',
      deviceState: { app: 'Settings' },
    })

    expect(context.text).toContain('<recalled_screenshot>')
    expect(context.text).toContain('Attached recalled image: step-3')
    expect(context.text).toContain('Screen: 500x1000')
  })

  it('truncates prompt-supplied context fields before sending them to the model', () => {
    const context = buildAgentPromptContext({
      task: `Open Settings ${'t'.repeat(3000)}`,
      latestUserMessage: `Latest ${'u'.repeat(3000)}`,
      pendingUserMessages: [`Pending ${'p'.repeat(3000)}`],
      appCard: `# Huge app card\n${'a'.repeat(7000)}`,
      customTools: [
        {
          name: 'lookup',
          description: `Tool description ${'d'.repeat(1200)}`,
        },
      ],
      actionTools: {
        tap: {
          description: `Tap ${'x'.repeat(1200)}`,
          parameters: {
            x: { type: 'number', required: true },
          },
        },
      },
      screen: { width: 1080, height: 2400 },
      currentApp: 'Settings',
      deviceState: { app: 'Settings' },
    })

    expect(context.text).toContain('[truncated]')
    expect(context.text).not.toContain('t'.repeat(2600))
    expect(context.text).not.toContain('u'.repeat(2600))
    expect(context.text).not.toContain('p'.repeat(1600))
    expect(context.text).not.toContain('a'.repeat(5600))
    expect(context.text).not.toContain('d'.repeat(800))
    expect(context.text).not.toContain('x'.repeat(800))
  })

  it('surfaces recent failed action feedback for recovery planning', () => {
    const thread = createAgentThread('Open app', { id: 'thread-errors', now: 1000 })
    const turn = startThreadTurn(thread, {
      id: 'turn-failed',
      index: 1,
      task: 'Open app',
      promptContext: 'prompt',
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action,
      executionAction: action,
      preview: 'tap (100, 200)',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
      },
      timing,
      now: 1100,
    })
    recordThreadTurnExecution(thread, turn.id, {
      executionResult: 'tap failed: stale coordinates',
      success: false,
      now: 1200,
    })

    const context = buildAgentPromptContext({
      thread,
      task: 'Open app',
      screen: { width: 1080, height: 2400 },
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
    })

    expect(context.text).toContain('<recent_action_errors>')
    expect(context.text).toContain('action=tap (100, 200)')
    expect(context.text).toContain('feedback=tap failed: stale coordinates')
    expect(context.text).toContain('do not repeat the exact same failed action')
  })

  it('adds a compact shared state block with recent tool results', () => {
    const thread = createAgentThread('Open Settings', { id: 'thread-shared-state', now: 1000 })
    const firstTurn = startThreadTurn(thread, {
      id: 'turn-ok',
      index: 1,
      task: 'Open Settings',
      promptContext: 'prompt',
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action,
      executionAction: action,
      preview: 'tap (100, 200)',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings' },
      },
      timing,
      now: 1100,
    })
    recordThreadTurnExecution(thread, firstTurn.id, {
      executionResult: 'input tap 100 200',
      success: true,
      now: 1200,
    })
    const secondTurn = startThreadTurn(thread, {
      id: 'turn-failed',
      index: 2,
      task: 'Open Settings',
      promptContext: 'prompt',
      modelOutput: '{"action":"tap","x":300,"y":400}',
      action: { action: 'tap', x: 300, y: 400 },
      executionAction: { action: 'tap', x: 300, y: 400 },
      preview: 'tap (300, 400)',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings' },
      },
      timing,
      now: 1300,
    })
    recordThreadTurnExecution(thread, secondTurn.id, {
      executionResult: 'tap failed',
      success: false,
      now: 1400,
    })
    thread.pendingUserMessages.push({
      id: 'pending-1',
      message: 'Use search instead',
      queuedAtStep: 2,
    })

    const context = buildAgentPromptContext({
      thread,
      task: 'Open Settings',
      pendingUserMessages: ['Use search instead'],
      screen: { width: 1080, height: 2400 },
      currentApp: 'Settings',
      deviceState: { app: 'Settings' },
    })

    expect(context.text).toContain('<shared_state>')
    expect(context.text).toContain('Completed turns: 2')
    expect(context.text).toContain('Failed turns: 1')
    expect(context.text).toContain('Pending user messages: 1')
    expect(context.text).toContain('Recent outcomes: ok -> failed')
    expect(context.text).toContain('- #1 ok: tap (100, 200) | result=input tap 100 200')
    expect(context.text).toContain('- #2 failed: tap (300, 400) | result=tap failed')
  })

  it('does not count planned turns against the recent turn compaction window', () => {
    const thread = createAgentThread('Find item', { id: 'thread-compact-planned', now: 1000 })
    for (let index = 1; index <= 3; index += 1) {
      startThreadTurn(thread, {
        id: `turn-executed-${index}`,
        index,
        status: 'executed',
        task: 'Find item',
        promptContext: 'prompt',
        modelOutput: '{"action":"wait","ms":100}',
        action: { action: 'wait', ms: 100 },
        executionAction: { action: 'wait', ms: 100 },
        preview: `wait ${index}`,
        deviceSnapshot: {
          currentApp: 'Chrome',
          deviceState: { app: 'Chrome' },
        },
        timing,
        now: 1000 + index,
      })
    }
    startThreadTurn(thread, {
      id: 'turn-planned',
      index: 4,
      task: 'Find item',
      promptContext: 'prompt',
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action,
      executionAction: action,
      preview: 'tap (100, 200)',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
      },
      timing,
      now: 1100,
    })

    const summary = compactThreadContext(thread, { keepRecentTurns: 3, now: 2000 })

    expect(summary).toBeNull()
    expect(thread.contextSummary).toBe('')
  })
})
