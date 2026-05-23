import { describe, expect, it } from 'vitest'
import { createAgentThread, startThreadTurn } from './agentThread'
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

  it('uses only recent turns for prompt history', () => {
    const thread = createAgentThread('Scroll list', { id: 'thread-recent', now: 1000 })
    for (let index = 1; index <= 5; index += 1) {
      startThreadTurn(thread, {
        id: `turn-${index}`,
        index,
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
    expect(thread.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'context_compaction',
        compactedThroughStep: 4,
      }),
    )
  })
})
