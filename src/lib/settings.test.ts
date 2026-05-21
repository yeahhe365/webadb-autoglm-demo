import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
  type SettingsStorage,
} from './settings'

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage {
  const values = { ...initial }
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value
    }),
  }
}

describe('settings persistence', () => {
  it('uses gpt-5.5 as the default model', () => {
    expect(DEFAULT_SETTINGS.modelConfig.model).toBe('gpt-5.5')
  })

  it('loads defaults when no persisted settings exist', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('loads all persisted setting fields', () => {
    const persisted: AppSettings = {
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'custom-model',
      },
      task: 'Open Chrome',
      maxSteps: 12,
      autoExecute: false,
      preferAdbKeyboard: true,
      promptMode: 'autoglm-native',
      confirmSensitiveActions: false,
      streamResponses: true,
      actionSettleMs: 350,
      doubleTapIntervalMs: 75,
      keyboardStepMs: 450,
    }

    expect(
      loadSettings(
        memoryStorage({
          'webadb-autoglm-settings': JSON.stringify(persisted),
        }),
      ),
    ).toEqual(persisted)
  })

  it('keeps old individual keys as migration fallback', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webadb-demo-base-url': 'https://old.example.com/v1',
          'webadb-demo-model': 'old-model',
        }),
      ).modelConfig,
    ).toEqual({
      baseUrl: 'https://old.example.com/v1',
      apiKey: '',
      model: 'old-model',
    })
  })

  it('saves all settings under one key', () => {
    const storage = memoryStorage()
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5.5',
      },
    }

    saveSettings(settings, storage)

    expect(storage.setItem).toHaveBeenCalledWith('webadb-autoglm-settings', JSON.stringify(settings))
  })

  it('normalizes new optimization settings when they are missing or invalid', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webadb-autoglm-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            promptMode: 'invalid-mode',
            streamResponses: 'yes',
            actionSettleMs: -1,
            doubleTapIntervalMs: 10000,
            keyboardStepMs: Number.NaN,
          }),
        }),
      ),
    ).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps old combined settings key as a migration fallback', () => {
    const persisted: AppSettings = {
      ...DEFAULT_SETTINGS,
      task: 'Migrated task',
    }

    expect(
      loadSettings(
        memoryStorage({
          'webadb-demo-settings': JSON.stringify(persisted),
        }),
      ),
    ).toEqual(persisted)
  })
})
