import type { DeviceScreenTree, DeviceState, InstalledApp } from '../adapters/deviceTypes'
import type { ActionProtocol } from './actionProtocol'
import type { CustomToolDescriptor, SecretDescriptor } from './agentResources'
import type { ScreenSize } from './actionTypes'
import type { ActionToolSignature } from './toolRegistry'

export const REASONING_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number]

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === 'string' &&
    REASONING_EFFORT_VALUES.includes(value as ReasoningEffort)
  )
}

export type ModelConfig = {
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: ReasoningEffort
  stream?: boolean
}

export type CompletionRequest = ModelConfig & {
  actionProtocol?: ActionProtocol
  task: string
  conversation?: readonly AgentConversationMessage[]
  screenshotDataUrl: string
  recalledScreenshots?: readonly PromptScreenshotAttachment[]
  screen: ScreenSize
  deviceScreen?: ScreenSize
  currentApp?: string
  deviceState?: DeviceState
  screenTree?: DeviceScreenTree
  history?: readonly AgentHistoryItem[]
  appCard?: string
  installedApps?: readonly InstalledApp[]
  memoryEnabled?: boolean
  memoryItems?: readonly string[]
  actionTools?: Record<string, ActionToolSignature>
  promptContext?: string
  customTools?: readonly CustomToolDescriptor[]
  secrets?: readonly SecretDescriptor[]
  unrestrictedMode?: boolean
  signal?: AbortSignal
}

export type PromptScreenshotAttachment = {
  label: string
  dataUrl: string
  screen: ScreenSize
  step?: number
  currentApp?: string
}

export type FinalResponseRequest = ModelConfig & {
  task: string
  conversation?: readonly AgentConversationMessage[]
  history?: readonly AgentHistoryItem[]
  currentApp?: string
  deviceState?: DeviceState
  progressSummary?: string
  signal?: AbortSignal
}

export type RepairActionRequest = CompletionRequest & {
  invalidOutput: string
  validationError: string
}

export type AgentHistoryItem = {
  step: number
  currentApp?: string
  actionPreview: string
  executionResult?: string
}

export type AgentConversationMessage = {
  id: string
  role: 'user' | 'assistant' | 'observation'
  content: string
}

export type UserContent =
  | string
  | Array<
      | {
          type: 'text'
          text: string
        }
      | {
          type: 'image_url'
          image_url: {
            url: string
          }
        }
    >

export type ChatMessage =
  | {
      role: 'system'
      content: string
    }
  | {
      role: 'assistant'
      content: string
    }
  | {
      role: 'user'
      content: UserContent
    }

export type ChatCompletionPayload = {
  model: string
  temperature: number
  max_tokens: number
  reasoning_effort?: ReasoningEffort
  stream?: boolean
  response_format?: {
    type: 'json_object'
  }
  messages: ChatMessage[]
}

export type OpenAiClient = {
  completeAction(request: CompletionRequest): Promise<string>
  completeFinalResponse?(request: FinalResponseRequest): Promise<string>
  repairAction?(request: RepairActionRequest): Promise<string>
}
