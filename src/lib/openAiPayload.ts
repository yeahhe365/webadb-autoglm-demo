import { buildSystemPrompt } from './prompts'
import { buildAgentPromptContext } from './contextBuilder'
import { UNKNOWN_APP_NAME } from './deviceState'
import type {
  AgentConversationMessage,
  ChatCompletionPayload,
  ChatMessage,
  CompletionRequest,
  FinalResponseRequest,
  PromptScreenshotAttachment,
  UserContent,
} from './openAiTypes'
import { formatPromptHistoryItem } from './promptContextFormatting'
import { truncateRetainedText } from './textRetention'

export const MAX_PROMPT_CONVERSATION_MESSAGES = 16
const MAX_PROMPT_OBSERVATION_MESSAGES = 6
const MAX_PROMPT_ASSISTANT_ACTION_MESSAGES = 4
const MAX_PROMPT_USER_MESSAGE_CHARS = 6000
const MAX_PROMPT_ASSISTANT_MESSAGE_CHARS = 6000
const MAX_PROMPT_OBSERVATION_CHARS = 4000

export function buildChatCompletionPayload({
  model,
  task,
  conversation,
  recalledScreenshots,
  screenshotDataUrl,
  screen,
  deviceScreen,
  currentApp,
  deviceState,
  screenTree,
  history = [],
  appCard,
  actionProtocol = 'webdroid_json',
  customTools,
  installedApps,
  promptContext,
  reasoningEffort,
  secrets,
  unrestrictedMode,
  memoryEnabled = false,
  memoryItems,
  actionTools,
  stream,
}: Pick<
  CompletionRequest,
  | 'model'
  | 'task'
  | 'conversation'
  | 'recalledScreenshots'
  | 'screenshotDataUrl'
  | 'screen'
  | 'deviceScreen'
  | 'currentApp'
  | 'deviceState'
  | 'screenTree'
  | 'history'
  | 'appCard'
  | 'actionProtocol'
  | 'customTools'
  | 'installedApps'
  | 'promptContext'
  | 'reasoningEffort'
  | 'secrets'
  | 'unrestrictedMode'
  | 'memoryEnabled'
  | 'memoryItems'
  | 'actionTools'
  | 'stream'
>): ChatCompletionPayload {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt({ actionProtocol, unrestrictedMode, memoryEnabled }),
    },
  ]

  const context =
    promptContext ??
    buildAgentPromptContext({
      task,
      history,
      screen,
      deviceScreen,
      currentApp,
      deviceState,
      screenTree,
      appCard,
      customTools,
      installedApps,
      memoryEnabled,
      memoryItems,
      actionTools,
      secrets,
      latestUserMessage: latestUserMessage(conversation),
    }).text
  const conversationMessages = selectConversationMessagesForPrompt(conversation)

  if (conversationMessages.length > 0) {
    for (const message of conversationMessages) {
      messages.push(toChatMessage(message))
    }
    const lastUserIndex = findLastUserMessageIndex(messages)
    if (lastUserIndex >= 0) {
      const lastUser = messages[lastUserIndex]
      if (lastUser.role === 'user') {
        const text = userContentText(lastUser.content)
        lastUser.content = multimodalUserContent(
          [text, context].filter(Boolean).join('\n\n'),
          screenshotDataUrl,
          recalledScreenshots,
        )
      }
    } else {
      messages.push(multimodalUserMessage(context, screenshotDataUrl, recalledScreenshots))
    }
  } else {
    messages.push(multimodalUserMessage(context, screenshotDataUrl, recalledScreenshots))
  }

  const payload: ChatCompletionPayload = {
    model,
    temperature: 0.1,
    max_tokens: 800,
    ...(actionProtocol === 'webdroid_json'
      ? { response_format: { type: 'json_object' as const } }
      : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(stream ? { stream: true } : {}),
    messages,
  }

  return payload
}

function selectConversationMessagesForPrompt(conversation?: readonly AgentConversationMessage[]) {
  const messages = conversation?.filter((message) => message.content.trim()) ?? []
  if (messages.length <= MAX_PROMPT_CONVERSATION_MESSAGES) {
    return capNoisyPromptMessages(messages)
  }

  const firstUser = messages.find((message) => message.role === 'user')
  const recentMessages = messages.slice(-MAX_PROMPT_CONVERSATION_MESSAGES)
  if (!firstUser || recentMessages.some((message) => message.id === firstUser.id)) {
    return capNoisyPromptMessages(recentMessages)
  }

  return capNoisyPromptMessages([firstUser, ...recentMessages])
}

function capNoisyPromptMessages(messages: readonly AgentConversationMessage[]) {
  let observationsKept = 0
  let assistantActionMessagesKept = 0
  const selected: AgentConversationMessage[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'observation') {
      observationsKept += 1
      if (observationsKept > MAX_PROMPT_OBSERVATION_MESSAGES) {
        continue
      }
    }
    if (message.role === 'assistant' && looksLikeActionMessage(message.content)) {
      assistantActionMessagesKept += 1
      if (assistantActionMessagesKept > MAX_PROMPT_ASSISTANT_ACTION_MESSAGES) {
        continue
      }
    }
    selected.push(message)
  }

  return selected.reverse()
}

function looksLikeActionMessage(content: string) {
  const text = content.trim()
  return (
    text.startsWith('{') ||
    text.startsWith('<function_calls>') ||
    text.startsWith('<think>') ||
    text.startsWith('<answer>')
  )
}

export function buildFinalResponsePayload({
  model,
  task,
  conversation,
  history = [],
  currentApp,
  deviceState,
  progressSummary,
  reasoningEffort,
  stream,
}: Pick<
  FinalResponseRequest,
  | 'model'
  | 'task'
  | 'conversation'
  | 'history'
  | 'currentApp'
  | 'deviceState'
  | 'progressSummary'
  | 'reasoningEffort'
  | 'stream'
>): ChatCompletionPayload {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildFinalResponseSystemPrompt(),
    },
  ]

  for (const message of conversation?.filter((item) => item.content.trim()) ?? []) {
    messages.push(toChatMessage(message))
  }

  messages.push({
    role: 'user',
    content: buildFinalResponseContext({
      task,
      history,
      currentApp,
      deviceState,
      progressSummary,
    }),
  })

  return {
    model,
    temperature: 0.2,
    max_tokens: 700,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(stream ? { stream: true } : {}),
    messages,
  }
}

function buildFinalResponseSystemPrompt() {
  return [
    'You are WebDroid Agent writing the final user-facing answer after completing Android control steps.',
    'Write concise natural language, like a Codex final response after tool steps complete.',
    'Do not return JSON. Markdown is allowed.',
    'State what was completed, mention any important caveat only if the recorded steps show one, and avoid inventing unseen results.',
  ].join('\n')
}

function buildFinalResponseContext({
  task,
  history,
  currentApp,
  deviceState,
  progressSummary,
}: Pick<
  FinalResponseRequest,
  'task' | 'history' | 'currentApp' | 'deviceState' | 'progressSummary'
>) {
  const lines = [
    `Original task: ${task}`,
    progressSummary ? `Completion summary: ${progressSummary}` : null,
    `Current app: ${currentApp ?? deviceState?.app ?? UNKNOWN_APP_NAME}`,
    deviceState?.packageName ? `Package: ${deviceState.packageName}` : null,
    'Write the final answer now.',
  ].filter(Boolean) as string[]

  if (history && history.length > 0) {
    lines.push('', 'Completed steps:')
    for (const item of history.slice(-12)) {
      lines.push(formatPromptHistoryItem(item))
    }
  }

  return lines.join('\n')
}

function multimodalUserMessage(
  text: string,
  screenshotDataUrl: string,
  recalledScreenshots?: readonly PromptScreenshotAttachment[],
): ChatMessage {
  return {
    role: 'user',
    content: multimodalUserContent(text, screenshotDataUrl, recalledScreenshots),
  }
}

function multimodalUserContent(
  text: string,
  screenshotDataUrl: string,
  recalledScreenshots: readonly PromptScreenshotAttachment[] = [],
): Exclude<UserContent, string> {
  return [
    {
      type: 'text',
      text,
    },
    {
      type: 'image_url',
      image_url: { url: screenshotDataUrl },
    },
    ...recalledScreenshots.flatMap((screenshot) => [
      {
        type: 'text' as const,
        text: formatRecalledScreenshotAttachment(screenshot),
      },
      {
        type: 'image_url' as const,
        image_url: { url: screenshot.dataUrl },
      },
    ]),
  ]
}

function formatRecalledScreenshotAttachment(screenshot: PromptScreenshotAttachment) {
  return [
    `Recalled screenshot attachment: ${screenshot.label}.`,
    screenshot.currentApp ? `App: ${screenshot.currentApp}.` : null,
    screenshot.step === undefined ? null : `Step: #${screenshot.step}.`,
    `Image size: ${screenshot.screen.width}x${screenshot.screen.height}.`,
  ]
    .filter(Boolean)
    .join(' ')
}

function toChatMessage(message: AgentConversationMessage): ChatMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: truncateRetainedText(message.content, MAX_PROMPT_ASSISTANT_MESSAGE_CHARS),
    }
  }

  if (message.role === 'observation') {
    return {
      role: 'user',
      content: `<observation>\n${truncateRetainedText(
        message.content,
        MAX_PROMPT_OBSERVATION_CHARS,
      )}\n</observation>`,
    }
  }

  return {
    role: 'user',
    content: truncateRetainedText(message.content, MAX_PROMPT_USER_MESSAGE_CHARS),
  }
}

function findLastUserMessageIndex(messages: readonly ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return index
    }
  }
  return -1
}

function latestUserMessage(conversation?: readonly AgentConversationMessage[]) {
  if (!conversation) {
    return undefined
  }
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index]
    if (message.role === 'user' && message.content.trim()) {
      return message.content.trim()
    }
  }
  return undefined
}

function userContentText(content: UserContent) {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}
