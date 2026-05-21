import { describe, expect, it, vi } from 'vitest'
import {
  buildChatCompletionPayload,
  createOpenAiClient,
  extractAssistantText,
  normalizeBaseUrl,
} from './openAiClient'

describe('normalizeBaseUrl', () => {
  it('removes trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1///')).toBe('https://api.example.com/v1')
  })
})

describe('buildChatCompletionPayload', () => {
  it('builds an OpenAI-compatible multimodal request', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      deviceScreen: { width: 1440, height: 3120 },
      promptMode: 'canonical-json',
    })

    expect(payload).toMatchObject({
      model: 'agent-model',
      temperature: 0.1,
      response_format: { type: 'json_object' },
    })
    expect(payload.messages[1].content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('Open settings'),
      },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,abc123' },
      },
    ])
  })

  it('describes screenshot coordinates and device mapping in the user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 955, height: 2048 },
      deviceScreen: { width: 1080, height: 2316 },
      promptMode: 'canonical-json',
    })

    const userMessage = payload.messages[1]
    if (userMessage.role !== 'user' || userMessage.content[0].type !== 'text') {
      throw new Error('Expected first user content item to be text.')
    }

    const userText = userMessage.content[0].text
    expect(userText).toContain('"model_screen_size":"955x2048"')
    expect(userText).toContain('"device_screen_size":"1080x2316"')
    expect(userText).toContain('"coordinate_mode":"screenshot_pixels"')
    expect(userText).toContain('"grid_divisions":10')
    expect(userText).toContain('major_lines_only')
    expect(userText).toContain('mapped back to native device pixels')
  })

  it('includes current app and previous step history in the user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      currentApp: 'Chrome',
      deviceState: {
        app: 'Chrome',
        packageName: 'com.android.chrome',
        activity: 'com.google.android.apps.chrome.Main',
        orientation: 'portrait',
        keyboard: 'com.android.adbkeyboard/.AdbIME',
      },
      promptMode: 'canonical-json',
      history: [
        {
          step: 1,
          currentApp: 'System Home',
          actionPreview: 'launch Chrome',
          executionResult: 'monkey -p com.android.chrome',
        },
      ],
    })

    const userMessage = payload.messages[1]
    expect(userMessage.role).toBe('user')
    if (userMessage.role !== 'user' || userMessage.content[0].type !== 'text') {
      throw new Error('Expected first user content item to be text.')
    }
    const userText = userMessage.content[0].text
    expect(userText).toContain('"current_app":"Chrome"')
    expect(userText).toContain('"package_name":"com.android.chrome"')
    expect(userText).toContain('"activity":"com.google.android.apps.chrome.Main"')
    expect(userText).toContain('"keyboard":"com.android.adbkeyboard/.AdbIME"')
    expect(userText).toContain('Step 1')
    expect(userText).toContain('launch Chrome')
    expect(userText).toContain('monkey -p com.android.chrome')
  })

  it('enables streaming when requested by the model config', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      promptMode: 'canonical-json',
      stream: true,
    })

    expect(payload.stream).toBe(true)
  })

  it('uses Open-AutoGLM native mode without forcing JSON response format', () => {
    const payload = buildChatCompletionPayload({
      model: 'autoglm-phone',
      task: '打开京东',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      promptMode: 'autoglm-native',
    })

    expect(payload.response_format).toBeUndefined()
    expect(payload.messages[0].content).toContain('do(action="Launch"')
    expect(payload.messages[0].content).toContain('finish(message=')
  })
})

describe('extractAssistantText', () => {
  it('reads assistant content from a chat completion response', () => {
    expect(
      extractAssistantText({
        choices: [{ message: { content: '{"action":"done"}' } }],
      }),
    ).toBe('{"action":"done"}')
  })

  it('rejects empty completion responses', () => {
    expect(() => extractAssistantText({ choices: [] })).toThrow('No assistant content')
  })
})

describe('createOpenAiClient', () => {
  it('posts to /chat/completions with bearer auth', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"done"}' } }] }),
    })) as unknown as typeof fetch
    const client = createOpenAiClient(fetcher)

    const text = await client.completeAction({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'secret',
      model: 'agent-model',
      task: 'Finish',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 10, height: 20 },
      promptMode: 'canonical-json',
    })

    expect(text).toBe('{"action":"done"}')
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
      }),
    )
  })

  it('aggregates streamed chat completion chunks', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"choices":[{"delta":{"content":"{\\"action\\":"}}]}\n\n',
              'data: {"choices":[{"delta":{"content":"\\"done\\"}"}}]}\n\n',
              'data: [DONE]\n\n',
            ].join(''),
          ),
        )
        controller.close()
      },
    })
    const fetcher = vi.fn(async () => ({
      ok: true,
      body,
      json: async () => {
        throw new Error('streaming responses should not be read as JSON')
      },
    })) as unknown as typeof fetch
    const client = createOpenAiClient(fetcher)

    const text = await client.completeAction({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'secret',
      model: 'agent-model',
      stream: true,
      task: 'Finish',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 10, height: 20 },
      promptMode: 'canonical-json',
    })

    expect(text).toBe('{"action":"done"}')
  })
})
