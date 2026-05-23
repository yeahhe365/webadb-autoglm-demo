import type { InstalledApp } from '../adapters/deviceTypes'
import { getInstalledAppDisplayName } from '../adapters/installedApps'
import { buildSystemPrompt } from './prompts'
import { buildScreenshotContext } from './screenshotCoordinates'
import type {
  AgentConversationMessage,
  ChatCompletionPayload,
  ChatMessage,
  CompletionRequest,
  UserContent,
} from './openAiTypes'

export function buildChatCompletionPayload({
  model,
  task,
  conversation,
  screenshotDataUrl,
  screen,
  deviceScreen,
  currentApp,
  deviceState,
  history = [],
  appCard,
  installedApps,
  promptContext,
  stream,
}: Pick<
  CompletionRequest,
  | 'model'
  | 'task'
  | 'conversation'
  | 'screenshotDataUrl'
  | 'screen'
  | 'deviceScreen'
  | 'currentApp'
  | 'deviceState'
  | 'history'
  | 'appCard'
  | 'installedApps'
  | 'promptContext'
  | 'stream'
>): ChatCompletionPayload {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(),
    },
  ]

  const context =
    promptContext ??
    buildUserContext({
      task,
      screen,
      deviceScreen,
      currentApp,
      deviceState,
      history,
      appCard,
      installedApps,
      latestUserMessage: latestUserMessage(conversation),
    })
  const conversationMessages = conversation?.filter((message) => message.content.trim()) ?? []

  if (conversationMessages.length > 0) {
    for (const message of conversationMessages) {
      messages.push(toChatMessage(message))
    }
    const lastUserIndex = findLastUserMessageIndex(messages)
    if (lastUserIndex >= 0) {
      const lastUser = messages[lastUserIndex]
      if (lastUser.role === 'user') {
        const text = userContentText(lastUser.content)
        lastUser.content = [
          {
            type: 'text',
            text: [text, context].filter(Boolean).join('\n\n'),
          },
          {
            type: 'image_url',
            image_url: { url: screenshotDataUrl },
          },
        ]
      }
    } else {
      messages.push(multimodalUserMessage(context, screenshotDataUrl))
    }
  } else {
    messages.push(multimodalUserMessage(context, screenshotDataUrl))
  }

  const payload: ChatCompletionPayload = {
    model,
    temperature: 0.1,
    max_tokens: 800,
    response_format: { type: 'json_object' },
    ...(stream ? { stream: true } : {}),
    messages,
  }

  return payload
}

function buildUserContext({
  task,
  screen,
  deviceScreen,
  currentApp,
  deviceState,
  history,
  appCard,
  installedApps,
  latestUserMessage,
}: Pick<
  CompletionRequest,
  | 'task'
  | 'screen'
  | 'deviceScreen'
  | 'currentApp'
  | 'deviceState'
  | 'history'
  | 'appCard'
  | 'installedApps'
> & {
  latestUserMessage?: string
}) {
  const historyEntries = history ?? []
  const screenInfo = JSON.stringify({
    current_app: currentApp ?? deviceState?.app ?? 'Unknown',
    ...(deviceState?.packageName ? { package_name: deviceState.packageName } : {}),
    ...(deviceState?.activity ? { activity: deviceState.activity } : {}),
    ...(deviceState?.orientation ? { orientation: deviceState.orientation } : {}),
    ...(deviceState?.keyboard ? { keyboard: deviceState.keyboard } : {}),
    ...buildScreenshotContext({ modelScreen: screen, deviceScreen }),
  })
  const canonicalCoordinateInstruction = [
    'Coordinates use pixels in the attached screenshot.',
    'Use numeric x/y labels on major grid lines as anchors; do not answer with grid-cell numbers.',
    'Your screenshot coordinates are mapped back to native device pixels before execution.',
  ].join(' ')

  const lines = [
    `Task: ${task}`,
    latestUserMessage ? `Latest user message: ${latestUserMessage}` : null,
    `Screen Info: ${screenInfo}`,
    appCard ? `<app_card>\n${appCard}\n</app_card>` : null,
    formatInstalledApps(installedApps),
    'Treat the latest user message as the current instruction. Use earlier messages and observations only as context.',
    canonicalCoordinateInstruction,
  ].filter(Boolean) as string[]

  if (historyEntries.length > 0) {
    lines.push('Previous steps:')
    for (const item of historyEntries.slice(-12)) {
      lines.push(
        [
          `Step ${item.step}`,
          item.currentApp ? `app=${item.currentApp}` : null,
          `action=${item.actionPreview}`,
          item.executionResult ? `result=${item.executionResult}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
      )
    }
  }

  return lines.join('\n')
}

function formatInstalledApps(installedApps?: readonly InstalledApp[]) {
  const apps = installedApps?.filter((app) => app.packageName.trim()) ?? []
  if (apps.length === 0) {
    return null
  }

  const lines = apps
    .slice(0, 40)
    .map((app) => `${getInstalledAppDisplayName(app)}: ${app.packageName}`)

  return [`<installed_apps>`, ...lines, `</installed_apps>`].join('\n')
}

function multimodalUserMessage(text: string, screenshotDataUrl: string): ChatMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text,
      },
      {
        type: 'image_url',
        image_url: { url: screenshotDataUrl },
      },
    ],
  }
}

function toChatMessage(message: AgentConversationMessage): ChatMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
    }
  }

  if (message.role === 'observation') {
    return {
      role: 'user',
      content: `<observation>\n${message.content}\n</observation>`,
    }
  }

  return {
    role: 'user',
    content: message.content,
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
