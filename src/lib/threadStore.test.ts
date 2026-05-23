import { describe, expect, it } from 'vitest'
import { createAgentThread, recordThreadUserMessage } from './agentThread'
import {
  createMemoryThreadStore,
  createSettingsSnapshot,
} from './threadStore'

describe('thread store', () => {
  it('saves, loads, lists, and deletes persisted threads', async () => {
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
  })

  it('stores a snapshot clone instead of the mutable source object', async () => {
    const store = createMemoryThreadStore()
    const thread = createAgentThread('Mutable task', { id: 'thread-mutable', now: 1000 })

    await store.save(thread)
    recordThreadUserMessage(thread, 'Follow-up after save', { now: 2000 })

    const loaded = await store.load('thread-mutable')

    expect(loaded?.messages.map((message) => message.content)).toEqual(['Mutable task'])
  })

  it('creates redacted settings snapshots without API keys', () => {
    const snapshot = createSettingsSnapshot({
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-key',
        model: 'vision-model',
        stream: true,
      },
      autoExecute: true,
      maxSteps: 12,
      confirmSensitiveActions: true,
      preferAdbKeyboard: false,
      actionSettleMs: 700,
      doubleTapIntervalMs: 80,
      keyboardStepMs: 25,
    })

    expect(snapshot).toEqual({
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        model: 'vision-model',
        stream: true,
      },
      autoExecute: true,
      maxSteps: 12,
      confirmSensitiveActions: true,
      preferAdbKeyboard: false,
      actionSettleMs: 700,
      doubleTapIntervalMs: 80,
      keyboardStepMs: 25,
    })
    expect(JSON.stringify(snapshot)).not.toContain('secret-key')
  })
})
