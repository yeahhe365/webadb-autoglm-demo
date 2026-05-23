import type { DeviceState, InstalledApp } from '../adapters/deviceTypes'
import type { ScreenSize } from './actionTypes'

export type ModelConfig = {
  baseUrl: string
  apiKey: string
  model: string
  stream?: boolean
}

export type CompletionRequest = ModelConfig & {
  task: string
  conversation?: readonly AgentConversationMessage[]
  screenshotDataUrl: string
  screen: ScreenSize
  deviceScreen?: ScreenSize
  currentApp?: string
  deviceState?: DeviceState
  history?: readonly AgentHistoryItem[]
  appCard?: string
  installedApps?: readonly InstalledApp[]
  promptContext?: string
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
  stream?: boolean
  response_format?: {
    type: 'json_object'
  }
  messages: ChatMessage[]
}

export type OpenAiClient = {
  completeAction(request: CompletionRequest): Promise<string>
  repairAction?(request: RepairActionRequest): Promise<string>
}
