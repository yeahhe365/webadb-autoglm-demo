import type { ScreenSize } from './actions'

export type ModelConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type CompletionRequest = ModelConfig & {
  task: string
  screenshotDataUrl: string
  screen: ScreenSize
}

type ChatMessage =
  | {
      role: 'system'
      content: string
    }
  | {
      role: 'user'
      content: Array<
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
    }

export type ChatCompletionPayload = {
  model: string
  temperature: number
  max_tokens: number
  response_format: {
    type: 'json_object'
  }
  messages: ChatMessage[]
}

export type OpenAiClient = {
  completeAction(request: CompletionRequest): Promise<string>
}

export class OpenAiClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAiClientError'
  }
}

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function buildChatCompletionPayload({
  model,
  task,
  screenshotDataUrl,
  screen,
}: Pick<CompletionRequest, 'model' | 'task' | 'screenshotDataUrl' | 'screen'>): ChatCompletionPayload {
  return {
    model,
    temperature: 0.1,
    max_tokens: 600,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You are a phone-control agent for an Android device.',
          'Inspect the screenshot and choose exactly one next action.',
          'Return only one JSON object. No markdown, no prose.',
          'Supported canonical JSON actions:',
          '{"action":"launch","app":"Settings|Chrome|YouTube|京东|package.name","reason":"short reason"}',
          '{"action":"tap","x":number,"y":number,"reason":"short reason"}',
          '{"action":"swipe","fromX":number,"fromY":number,"toX":number,"toY":number,"durationMs":number,"reason":"short reason"}',
          '{"action":"input_text","text":"Unicode text to type","reason":"short reason"}',
          '{"action":"key","key":"BACK|HOME|ENTER|POWER|APP_SWITCH|MENU","reason":"short reason"}',
          '{"action":"back","reason":"short reason"}',
          '{"action":"home","reason":"short reason"}',
          '{"action":"long_press","x":number,"y":number,"durationMs":number,"reason":"short reason"}',
          '{"action":"double_tap","x":number,"y":number,"reason":"short reason"}',
          '{"action":"wait","ms":number,"reason":"short reason"}',
          '{"action":"take_over","message":"what the human must do"}',
          '{"action":"note","message":"short observation"}',
          '{"action":"done","summary":"what was completed"}',
          'Open-AutoGLM style actions such as Launch, Tap with element [0-1000,0-1000], Type, Swipe, Back, Home, Long Press, Double Tap, Wait, and Take_over are accepted, but canonical JSON is preferred.',
          'Do not invent shell commands. Do not interact with payments, passwords, or destructive actions.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Task: ${task}`,
              `Screen size: ${screen.width}x${screen.height}.`,
              'Coordinates use Android screen pixels with origin at the top-left.',
            ].join('\n'),
          },
          {
            type: 'image_url',
            image_url: { url: screenshotDataUrl },
          },
        ],
      },
    ],
  }
}

export function extractAssistantText(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new OpenAiClientError('No assistant content returned by model.')
  }

  const content = response.choices[0]?.message?.content
  if (typeof content === 'string' && content.trim()) {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
    if (text) {
      return text
    }
  }

  throw new OpenAiClientError('No assistant content returned by model.')
}

export function createOpenAiClient(fetcher: typeof fetch = fetch): OpenAiClient {
  return {
    async completeAction(request) {
      const url = `${normalizeBaseUrl(request.baseUrl)}/chat/completions`
      const response = await fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildChatCompletionPayload(request)),
      })

      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }

      if (!response.ok) {
        throw new OpenAiClientError(formatApiError(response.status, body))
      }

      return extractAssistantText(body)
    },
  }
}

function formatApiError(status: number, body: unknown) {
  if (isRecord(body)) {
    const error = body.error
    if (isRecord(error) && typeof error.message === 'string') {
      return `Model API failed with ${status}: ${error.message}`
    }
  }
  return `Model API failed with ${status}.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
