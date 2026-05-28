import { describe, expect, it } from 'vitest'
import {
  MAX_PROMPT_CONVERSATION_MESSAGES,
  buildChatCompletionPayload,
  buildFinalResponsePayload,
} from './openAiPayload'

describe('buildChatCompletionPayload', () => {
  it('builds an OpenAI-compatible multimodal request', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      deviceScreen: { width: 1440, height: 3120 },
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

  it('attaches recalled screenshots after the current screenshot', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Compare screens',
      screenshotDataUrl: 'data:image/png;base64,current',
      recalledScreenshots: [
        {
          label: 'step-3 from step #3',
          dataUrl: 'data:image/png;base64,old',
          screen: { width: 540, height: 1200 },
          step: 3,
          currentApp: 'Chrome',
        },
      ],
      screen: { width: 1080, height: 2400 },
    })

    const userMessage = payload.messages[1]
    if (userMessage.role !== 'user' || !Array.isArray(userMessage.content)) {
      throw new Error('Expected multimodal user message.')
    }

    expect(userMessage.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('Compare screens'),
      },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,current' },
      },
      {
        type: 'text',
        text: expect.stringContaining('Recalled screenshot attachment: step-3 from step #3.'),
      },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,old' },
      },
    ])
  })

  it('asks the model for canonical JSON instead of Open-AutoGLM actions', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
    })

    expect(payload.messages[0].content).toContain('Return only one JSON object')
    expect(payload.messages[0].content).toContain('"clear":boolean')
    expect(payload.messages[0].content).toContain('"action":"wait","duration":number')
    expect(payload.messages[0].content).toContain('"action":"view_screenshot"')
    expect(payload.messages[0].content).toContain('Mobilerun-compatible aliases')
    expect(payload.messages[0].content).not.toContain('"action":"interact"')
    expect(payload.messages[0].content).not.toContain('"action":"call_api"')
    expect(payload.messages[0].content).not.toContain('Open-AutoGLM')
    expect(payload.messages[0].content).not.toContain('do(action=')
  })

  it('can ask for Open-AutoGLM function actions explicitly', () => {
    const payload = buildChatCompletionPayload({
      actionProtocol: 'open_autoglm_function',
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
    })

    expect(payload.response_format).toBeUndefined()
    expect(payload.messages[0].content).toContain('<think>{short reason}</think>')
    expect(payload.messages[0].content).toContain('do(action="Tap"')
    expect(payload.messages[0].content).toContain('type_secret(secret_id=')
    expect(payload.messages[0].content).toContain('custom_tool(tool=')
    expect(payload.messages[0].content).toContain('view_screenshot(ref=')
    expect(payload.messages[0].content).toContain('0-1000 relative coordinate space')
  })

  it('can ask for mobilerun XML tool calls explicitly', () => {
    const payload = buildChatCompletionPayload({
      actionProtocol: 'mobilerun_xml',
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
    })

    expect(payload.response_format).toBeUndefined()
    expect(payload.messages[0].content).toContain('<function_calls>')
    expect(payload.messages[0].content).toContain('type_secret(secret_id,clear)')
    expect(payload.messages[0].content).toContain('custom_tool(tool,input)')
    expect(payload.messages[0].content).toContain('view_screenshot(ref,step)')
  })

  it('instructs the model not to request takeover in unrestricted mode', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      unrestrictedMode: true,
    })

    expect(payload.messages[0].content).toContain('Unrestricted mode is enabled')
    expect(payload.messages[0].content).toContain('do not return take_over')
    expect(payload.messages[0].content).toContain('continue autonomously')
  })

  it('keeps memory disabled by default in the system prompt and user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      memoryItems: ['Use the work account.'],
    })

    expect(payload.messages[0].content).toContain('Memory is disabled')
    expect(payload.messages[0].content).not.toContain('Use note/remember to store short durable facts')

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }
    expect(userMessage.content[0].text).not.toContain('Durable memory:')
    expect(userMessage.content[0].text).not.toContain('Use the work account.')
  })

  it('includes memory instructions and durable memory when enabled', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      memoryEnabled: true,
      memoryItems: ['Use the work account.'],
    })

    expect(payload.messages[0].content).toContain('Use note/remember to store short durable facts')

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }
    expect(userMessage.content[0].text).toContain('Durable memory:')
    expect(userMessage.content[0].text).toContain('- Use the work account.')
  })

  it('describes screenshot coordinates and device mapping in the user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 955, height: 2048 },
      deviceScreen: { width: 1080, height: 2316 },
    })

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
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
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
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

  it('includes app card guidance in the user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Search the web',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      currentApp: 'Chrome',
      deviceState: {
        app: 'Chrome',
        packageName: 'com.android.chrome',
      },
      appCard: '# Chrome App Card\n- Use the address bar for searches.',
    })

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }

    expect(userMessage.content[0].text).toContain('<app_card>')
    expect(userMessage.content[0].text).toContain('Chrome App Card')
    expect(userMessage.content[0].text).toContain('address bar')
  })

  it('includes installed launchable apps in the user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: '打开邮箱',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      installedApps: [
        { label: 'Gmail', packageName: 'com.google.android.gm' },
        { packageName: 'com.android.chrome' },
      ],
    })

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }

    expect(userMessage.content[0].text).toContain('<installed_apps>')
    expect(userMessage.content[0].text).toContain('Gmail: com.google.android.gm')
    expect(userMessage.content[0].text).toContain('chrome: com.android.chrome')
  })

  it('includes prompt-safe custom tools and secret ids in the user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Log in',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      customTools: [{ name: 'lookup_order', description: 'Lookup an order fixture.' }],
      secrets: [{ id: 'gmail_password', label: 'Gmail password' }],
    })

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }

    expect(userMessage.content[0].text).toContain('<available_custom_tools>')
    expect(userMessage.content[0].text).toContain('lookup_order: Lookup an order fixture.')
    expect(userMessage.content[0].text).toContain('<available_secrets>')
    expect(userMessage.content[0].text).toContain('gmail_password: Gmail password')
  })

  it('includes runtime action tool signatures in the user context', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      actionTools: {
        tap: {
          description: 'Tap a screen coordinate.',
          parameters: {
            x: { type: 'number', required: true },
            y: { type: 'number', required: true },
          },
        },
      },
    })

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }

    expect(userMessage.content[0].text).toContain('<available_action_tools>')
    expect(userMessage.content[0].text).toContain('tap(x:number required, y:number required)')
  })

  it('caps installed apps in the user context while keeping relevant matches', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open app44',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      installedApps: Array.from({ length: 45 }, (_, index) => ({
        packageName: `com.example.app${index}`,
      })),
    })

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }

    expect(userMessage.content[0].text).toContain('app44: com.example.app44')
    expect(userMessage.content[0].text).toContain('app0: com.example.app0')
    expect(userMessage.content[0].text).toContain('... truncated 5 more apps')
    expect(userMessage.content[0].text).not.toContain('app39: com.example.app39')
  })

  it('preserves conversation messages and injects current context into the latest user turn', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      conversation: [
        { id: 'u1', role: 'user', content: 'Open Settings.' },
        { id: 'a1', role: 'assistant', content: '{"action":"tap","x":100,"y":200}' },
        { id: 'o1', role: 'observation', content: 'Executed tap (100, 200)' },
        { id: 'u2', role: 'user', content: 'Now open the Bluetooth page.' },
      ],
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      currentApp: 'Settings',
    })

    expect(payload.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'user',
    ])
    expect(payload.messages[1]).toEqual({
      role: 'user',
      content: 'Open Settings.',
    })
    expect(payload.messages[2]).toEqual({
      role: 'assistant',
      content: '{"action":"tap","x":100,"y":200}',
    })
    expect(payload.messages[3]).toEqual({
      role: 'user',
      content: '<observation>\nExecuted tap (100, 200)\n</observation>',
    })

    const latestUserMessage = payload.messages[4]
    if (latestUserMessage.role !== 'user' || !Array.isArray(latestUserMessage.content)) {
      throw new Error('Expected latest user message to be multimodal.')
    }
    expect(latestUserMessage.content[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('Now open the Bluetooth page.'),
    })
    expect(latestUserMessage.content[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('"current_app":"Settings"'),
    })
    expect(latestUserMessage.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123' },
    })
  })

  it('trims long conversation history while keeping the original user task', () => {
    const conversation = [
      { id: 'u1', role: 'user' as const, content: 'Open Settings.' },
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `o${index}`,
        role: 'observation' as const,
        content: `Executed step ${index}`,
      })),
    ]

    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      conversation,
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      promptContext: 'Task: Open settings\nPrevious steps: latest compact summary',
    })

    expect(payload.messages.length).toBeLessThanOrEqual(MAX_PROMPT_CONVERSATION_MESSAGES + 2)
    expect(payload.messages[1]).toEqual({
      role: 'user',
      content: 'Open Settings.',
    })
    expect(payload.messages.some((message) => JSON.stringify(message).includes('Executed step 0'))).toBe(
      false,
    )
    expect(JSON.stringify(payload.messages.at(-1))).toContain('latest compact summary')
  })

  it('caps noisy observation messages inside the prompt conversation window', () => {
    const conversation = [
      { id: 'u1', role: 'user' as const, content: 'Open Settings.' },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `o${index}`,
        role: 'observation' as const,
        content: `Executed step ${index}`,
      })),
      { id: 'u2', role: 'user' as const, content: 'Continue.' },
    ]

    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      conversation,
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      promptContext: 'Task: Open settings',
    })

    const serialized = JSON.stringify(payload.messages)
    expect(serialized).not.toContain('Executed step 0')
    expect(serialized).not.toContain('Executed step 5')
    expect(serialized).toContain('Executed step 6')
    expect(serialized).toContain('Executed step 11')
    expect(serialized).toContain('Continue.')
  })

  it('truncates oversized conversation content before sending it to the model', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      conversation: [
        { id: 'u1', role: 'user', content: `Open Settings. ${'u'.repeat(7000)}` },
        { id: 'a1', role: 'assistant', content: `{"action":"note","message":"${'a'.repeat(7000)}"}` },
        { id: 'o1', role: 'observation', content: `tool output ${'o'.repeat(7000)}` },
        { id: 'u2', role: 'user', content: 'Continue.' },
      ],
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      promptContext: 'Task: Open settings',
    })

    const serialized = JSON.stringify(payload.messages)
    expect(serialized).toContain('[truncated]')
    expect(serialized).not.toContain('o'.repeat(5000))
    expect(serialized).not.toContain('a'.repeat(6500))
    expect(serialized).not.toContain('u'.repeat(6500))
  })

  it('enables streaming when requested by the model config', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
      stream: true,
    })

    expect(payload.stream).toBe(true)
  })

  it('passes reasoning effort through to action requests when configured', () => {
    const payload = buildChatCompletionPayload({
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
    })

    expect(payload.reasoning_effort).toBe('high')
  })

  it('uses a prebuilt prompt context when provided', () => {
    const payload = buildChatCompletionPayload({
      model: 'agent-model',
      task: 'Open settings',
      promptContext: 'Task: Open settings\n<context_summary>\nAlready opened Settings.\n</context_summary>',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
    })

    const userMessage = payload.messages[1]
    if (
      userMessage.role !== 'user' ||
      !Array.isArray(userMessage.content) ||
      userMessage.content[0].type !== 'text'
    ) {
      throw new Error('Expected first user content item to be text.')
    }

    expect(userMessage.content[0].text).toBe(
      'Task: Open settings\n<context_summary>\nAlready opened Settings.\n</context_summary>',
    )
    expect(userMessage.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123' },
    })
  })
})

describe('buildFinalResponsePayload', () => {
  it('builds a text-only final response request without JSON response format', () => {
    const payload = buildFinalResponsePayload({
      model: 'agent-model',
      reasoningEffort: 'medium',
      task: 'Open Bluetooth settings',
      conversation: [
        { id: 'u1', role: 'user', content: 'Open Bluetooth settings' },
        { id: 'a1', role: 'assistant', content: 'Bluetooth settings is open.' },
      ],
      history: [
        {
          step: 1,
          currentApp: 'Settings',
          actionPreview: 'tap Bluetooth',
          executionResult: 'input tap 200 300',
        },
      ],
      currentApp: 'Settings',
      progressSummary: 'Bluetooth settings is open.',
    })

    expect(payload.response_format).toBeUndefined()
    expect(payload.reasoning_effort).toBe('medium')
    expect(payload.messages[0].content).toContain('final user-facing answer')
    expect(payload.messages.at(-1)).toEqual({
      role: 'user',
      content: expect.stringContaining('Completed steps:'),
    })
    expect(payload.messages.at(-1)).toEqual({
      role: 'user',
      content: expect.stringContaining('Bluetooth settings is open.'),
    })
  })
})
