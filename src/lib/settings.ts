import type { ModelConfig } from './openAiClient'
import type { PromptMode } from './prompts'

export type AppSettings = {
  modelConfig: ModelConfig
  task: string
  maxSteps: number
  autoExecute: boolean
  preferAdbKeyboard: boolean
  promptMode: PromptMode
  confirmSensitiveActions: boolean
  streamResponses: boolean
  actionSettleMs: number
  doubleTapIntervalMs: number
  keyboardStepMs: number
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const SETTINGS_KEY = 'webadb-autoglm-settings'
const LEGACY_SETTINGS_KEY = 'webadb-demo-settings'
const LEGACY_BASE_URL_KEY = 'webadb-demo-base-url'
const LEGACY_MODEL_KEY = 'webadb-demo-model'

export const DEFAULT_SETTINGS: AppSettings = {
  modelConfig: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-5.5',
  },
  task: 'Open Settings and show the Wi-Fi page.',
  maxSteps: 50,
  autoExecute: true,
  preferAdbKeyboard: false,
  promptMode: 'canonical-json',
  confirmSensitiveActions: true,
  streamResponses: false,
  actionSettleMs: 1000,
  doubleTapIntervalMs: 100,
  keyboardStepMs: 1000,
}

export function loadSettings(storage: SettingsStorage = localStorage): AppSettings {
  const raw = storage.getItem(SETTINGS_KEY) ?? storage.getItem(LEGACY_SETTINGS_KEY)
  if (raw) {
    try {
      return normalizeSettings(JSON.parse(raw))
    } catch {
      return loadLegacySettings(storage)
    }
  }

  return loadLegacySettings(storage)
}

export function saveSettings(settings: AppSettings, storage: SettingsStorage = localStorage) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)))
}

function loadLegacySettings(storage: SettingsStorage): AppSettings {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    modelConfig: {
      ...DEFAULT_SETTINGS.modelConfig,
      baseUrl: storage.getItem(LEGACY_BASE_URL_KEY) || DEFAULT_SETTINGS.modelConfig.baseUrl,
      model: storage.getItem(LEGACY_MODEL_KEY) || DEFAULT_SETTINGS.modelConfig.model,
    },
  })
}

function normalizeSettings(candidate: unknown): AppSettings {
  if (!isRecord(candidate)) {
    return DEFAULT_SETTINGS
  }

  const modelConfig = isRecord(candidate.modelConfig) ? candidate.modelConfig : {}

  return {
    modelConfig: {
      baseUrl: readString(modelConfig.baseUrl, DEFAULT_SETTINGS.modelConfig.baseUrl),
      apiKey: readString(modelConfig.apiKey, DEFAULT_SETTINGS.modelConfig.apiKey),
      model: readString(modelConfig.model, DEFAULT_SETTINGS.modelConfig.model),
    },
    task: readString(candidate.task, DEFAULT_SETTINGS.task),
    maxSteps: clamp(readNumber(candidate.maxSteps, DEFAULT_SETTINGS.maxSteps), 1, 200),
    autoExecute: readBoolean(candidate.autoExecute, DEFAULT_SETTINGS.autoExecute),
    preferAdbKeyboard: readBoolean(candidate.preferAdbKeyboard, DEFAULT_SETTINGS.preferAdbKeyboard),
    promptMode: readPromptMode(candidate.promptMode, DEFAULT_SETTINGS.promptMode),
    confirmSensitiveActions: readBoolean(
      candidate.confirmSensitiveActions,
      DEFAULT_SETTINGS.confirmSensitiveActions,
    ),
    streamResponses: readBoolean(candidate.streamResponses, DEFAULT_SETTINGS.streamResponses),
    actionSettleMs: readRangeNumber(candidate.actionSettleMs, DEFAULT_SETTINGS.actionSettleMs, 100, 5000),
    doubleTapIntervalMs: readRangeNumber(
      candidate.doubleTapIntervalMs,
      DEFAULT_SETTINGS.doubleTapIntervalMs,
      20,
      1000,
    ),
    keyboardStepMs: readRangeNumber(candidate.keyboardStepMs, DEFAULT_SETTINGS.keyboardStepMs, 100, 5000),
  }
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readRangeNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = readNumber(value, fallback)
  return number >= min && number <= max ? number : fallback
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readPromptMode(value: unknown, fallback: PromptMode): PromptMode {
  return value === 'canonical-json' || value === 'autoglm-native' ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
