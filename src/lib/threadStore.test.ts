import { describe, expect, it } from 'vitest'
import type { DeviceScreenshot } from '../adapters/deviceTypes'
import type { AgentAction } from './actionTypes'
import {
  addThreadEvent,
  createAgentThread,
  recallThreadScreenshot,
  recordThreadScreenshot,
  recordThreadTurnExecution,
  recordThreadUserMessage,
  startThreadTurn,
} from './agentThread'
import {
  createMemoryThreadStore,
  createSettingsSnapshot,
} from './threadStore'

const screenshot: DeviceScreenshot = {
  bytes: new Uint8Array([1, 2, 3]),
  dataUrl: 'data:image/png;base64,raw',
  modelDataUrl: 'data:image/png;base64,model',
  modelScreen: { width: 540, height: 1200 },
  screen: { width: 1080, height: 2400 },
}

describe('thread store', () => {
  it('saves, loads, lists, deletes, and clears persisted threads', async () => {
    const store = createMemoryThreadStore()
    const first = createAgentThread('First task', { id: 'thread-1', now: 1000 })
    const second = createAgentThread('Second task', { id: 'thread-2', now: 2000 })

    await store.save(first)
    await store.save(second)

    expect(await store.load('thread-1')).toEqual(first)
    expect(await store.loadLatest()).toEqual(second)
    expect(await store.list()).toEqual([
      expect.objectContaining({ id: 'thread-2', title: 'Second task' }),
      expect.objectContaining({ id: 'thread-1', title: 'First task' }),
    ])

    await store.delete('thread-2')

    expect(await store.load('thread-2')).toBeNull()
    expect(await store.loadLatest()).toEqual(first)

    await store.clear()

    expect(await store.load('thread-1')).toBeNull()
    expect(await store.loadLatest()).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('stores a snapshot clone instead of the mutable source object', async () => {
    const store = createMemoryThreadStore()
    const thread = createAgentThread('Mutable task', { id: 'thread-mutable', now: 1000 })

    await store.save(thread)
    recordThreadUserMessage(thread, 'Follow-up after save', { now: 2000 })

    const loaded = await store.load('thread-mutable')

    expect(loaded?.messages.map((message) => message.content)).toEqual(['Mutable task'])
  })

  it('compacts screenshot media when cloning stored threads', async () => {
    const store = createMemoryThreadStore()
    const thread = createAgentThread('Use screen', { id: 'thread-screenshot', now: 1000 })
    const action: AgentAction = { action: 'tap', x: 100, y: 200 }
    const turn = startThreadTurn(thread, {
      id: 'turn-screenshot',
      index: 1,
      task: 'Use screen',
      promptContext: 'prompt',
      modelOutput: '{"action":"tap","x":100,"y":200}',
      action,
      executionAction: action,
      preview: 'tap (100, 200)',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        screenshot,
      },
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
      now: 1100,
    })
    turn.deviceSnapshot.screenshot = screenshot
    const snapshotEvent = thread.events.find((event) => event.type === 'device_snapshot')
    if (snapshotEvent?.type === 'device_snapshot') {
      snapshotEvent.screenshot = screenshot
    }
    thread.lastScreenshot = screenshot
    thread.deviceSnapshot = {
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
      screenshot,
    }
    recordThreadScreenshot(thread, {
      step: 1,
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
      screenshot,
      now: 1200,
    })
    recallThreadScreenshot(thread, { action: 'view_screenshot', step: 1 }, { now: 1300 })

    await store.save(thread)
    const loaded = await store.load('thread-screenshot')

    expect(loaded?.lastScreenshot).toEqual({
      dataUrl: 'data:image/png;base64,model',
      modelScreen: { width: 540, height: 1200 },
      screen: { width: 1080, height: 2400 },
    })
    expect(loaded?.lastScreenshot?.bytes).toBeUndefined()
    expect(loaded?.lastScreenshot?.modelDataUrl).toBeUndefined()
    expect(loaded?.turns[0].deviceSnapshot.screenshot).toBeUndefined()
    expect(loaded?.events.find((event) => event.type === 'device_snapshot')).not.toHaveProperty(
      'screenshot',
    )
    expect(loaded?.events.find((event) => event.type === 'assistant_action')).not.toHaveProperty(
      'modelOutput',
    )
    expect(loaded?.screenshotReferences[0].screenshot).toEqual({
      dataUrl: 'data:image/png;base64,model',
      modelScreen: { width: 540, height: 1200 },
      screen: { width: 1080, height: 2400 },
    })
    expect(loaded?.activeScreenshotRecall?.screenshot).toEqual({
      dataUrl: 'data:image/png;base64,model',
      modelScreen: { width: 540, height: 1200 },
      screen: { width: 1080, height: 2400 },
    })
  })

  it('persists compact thread records instead of retaining old large fields', async () => {
    const store = createMemoryThreadStore()
    const thread = createAgentThread('Long task', { id: 'thread-large', now: 1000 })
    const action: AgentAction = { action: 'wait', ms: 100 }
    const longText = 'x'.repeat(9000)

    for (let index = 1; index <= 14; index += 1) {
      const turn = startThreadTurn(thread, {
        id: `turn-${index}`,
        index,
        task: 'Long task',
        promptContext: `prompt-${index}-${longText}`,
        modelOutput: `model-${index}-${longText}`,
        action,
        executionAction: action,
        preview: `wait ${index}`,
        deviceSnapshot: {
          currentApp: 'Chrome',
          deviceState: { app: 'Chrome' },
        },
        timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
        now: 1000 + index,
      })
      recordThreadTurnExecution(thread, turn.id, {
        executionResult: `result-${index}-${longText}`,
        success: true,
        now: 2000 + index,
      })
    }

    for (let index = 0; index < 260; index += 1) {
      addThreadEvent(
        thread,
        {
          type: 'status_change',
          status: 'running',
          message: `status ${index}`,
        },
        { now: 3000 + index },
      )
    }

    await store.save(thread)
    const loaded = await store.load('thread-large')

    expect(loaded?.turns[0].promptContext).toBe('')
    expect(loaded?.turns[0].modelOutput).toBe('')
    expect(loaded?.turns.at(-1)?.promptContext).toBe('')
    expect(loaded?.turns.at(-1)?.modelOutput).toContain('model-14')
    expect(loaded?.turns.at(-1)?.modelOutput.length).toBeLessThan(thread.turns.at(-1)?.modelOutput.length ?? 0)
    expect(
      loaded?.messages
        .filter((message) => message.role === 'observation')
        .every((message) => message.content.length <= 4000),
    ).toBe(true)
    expect(loaded?.events.length).toBeLessThanOrEqual(240)
  })

  it('creates redacted settings snapshots without API keys', () => {
    const snapshot = createSettingsSnapshot({
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-key',
        model: 'vision-model',
        reasoningEffort: 'xhigh',
        stream: true,
      },
      autoExecute: true,
      maxSteps: 12,
      confirmSensitiveActions: true,
      unrestrictedMode: true,
      preferAdbKeyboard: false,
      actionSettleMs: 700,
      doubleTapIntervalMs: 80,
      keyboardStepMs: 25,
    })

    expect(snapshot).toEqual({
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        model: 'vision-model',
        reasoningEffort: 'xhigh',
        stream: true,
      },
      autoExecute: true,
      maxSteps: 12,
      confirmSensitiveActions: true,
      unrestrictedMode: true,
      preferAdbKeyboard: false,
      actionSettleMs: 700,
      doubleTapIntervalMs: 80,
      keyboardStepMs: 25,
    })
    expect(JSON.stringify(snapshot)).not.toContain('secret-key')
  })
})
