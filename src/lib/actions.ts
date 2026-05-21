export type ScreenSize = {
  width: number
  height: number
}

export type TapAction = {
  action: 'tap'
  x: number
  y: number
  message?: string
  risk?: 'sensitive'
  reason?: string
}

export type SwipeAction = {
  action: 'swipe'
  fromX: number
  fromY: number
  toX: number
  toY: number
  durationMs?: number
  reason?: string
}

export type LaunchAction = {
  action: 'launch'
  app: string
  packageName?: string
  reason?: string
}

export type InputTextAction = {
  action: 'input_text'
  text: string
  reason?: string
}

export type KeyAction = {
  action: 'key'
  key:
    | 'BACK'
    | 'HOME'
    | 'ENTER'
    | 'POWER'
    | 'APP_SWITCH'
    | 'MENU'
    | 'VOLUME_UP'
    | 'VOLUME_DOWN'
    | 'CAMERA'
    | 'SEARCH'
  reason?: string
}

export type BackAction = {
  action: 'back'
  reason?: string
}

export type HomeAction = {
  action: 'home'
  reason?: string
}

export type LongPressAction = {
  action: 'long_press'
  x: number
  y: number
  durationMs: number
  reason?: string
}

export type DoubleTapAction = {
  action: 'double_tap'
  x: number
  y: number
  reason?: string
}

export type WaitAction = {
  action: 'wait'
  ms: number
  reason?: string
}

export type TakeOverAction = {
  action: 'take_over'
  message: string
  reason?: string
}

export type NoteAction = {
  action: 'note'
  message: string
  reason?: string
}

export type InteractAction = {
  action: 'interact'
  message: string
  reason?: string
}

export type CallApiAction = {
  action: 'call_api'
  instruction: string
  reason?: string
}

export type DoneAction = {
  action: 'done'
  summary?: string
  reason?: string
}

export type AgentAction =
  | TapAction
  | SwipeAction
  | LaunchAction
  | InputTextAction
  | KeyAction
  | BackAction
  | HomeAction
  | LongPressAction
  | DoubleTapAction
  | WaitAction
  | TakeOverAction
  | NoteAction
  | InteractAction
  | CallApiAction
  | DoneAction

export class ActionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionValidationError'
  }
}

export function parseModelAction(raw: string, screen?: ScreenSize): AgentAction {
  let candidate: unknown

  try {
    candidate = JSON.parse(extractJsonObject(raw))
  } catch {
    candidate = parseFunctionLikeAction(raw)
    if (!candidate) {
      throw new ActionValidationError('Model response did not contain valid action JSON.')
    }
  }

  return validateAction(candidate, screen)
}

export function validateAction(candidate: unknown, screen?: ScreenSize): AgentAction {
  if (!isRecord(candidate)) {
    throw new ActionValidationError('Action must be a JSON object.')
  }

  if (typeof candidate.action !== 'string') {
    throw new ActionValidationError('Action must include an action name.')
  }

  const action = canonicalActionName(candidate.action)

  switch (action) {
    case 'launch': {
      const app = readFirstString(candidate, ['app', 'appName', 'name', 'package', 'packageName'])
      const packageName = optionalString(candidate, 'packageName') ?? optionalPackageNameFromApp(app)
      return withReason(packageName ? { action, app, packageName } : { action, app }, candidate)
    }
    case 'tap': {
      const { x, y } = readPoint(candidate, screen)
      assertPointWithinScreen(x, y, screen)
      return withTapMetadata({ action, x, y }, candidate)
    }
    case 'swipe': {
      const { fromX, fromY, toX, toY } = readSwipePoints(candidate, screen)
      assertPointWithinScreen(fromX, fromY, screen)
      assertPointWithinScreen(toX, toY, screen)
      const durationMs =
        'durationMs' in candidate
          ? clamp(readInteger(candidate, 'durationMs'), 100, 2000)
          : 'duration' in candidate
            ? clamp(readInteger(candidate, 'duration'), 100, 2000)
            : 400
      return withReason({ action, fromX, fromY, toX, toY, durationMs }, candidate)
    }
    case 'input_text': {
      const text = readFirstString(candidate, ['text', 'content', 'input', 'value'])
      if (hasControlCharacters(text)) {
        throw new ActionValidationError('input_text cannot contain control characters.')
      }
      if (text.length > 500) {
        throw new ActionValidationError('input_text is limited to 500 characters.')
      }
      return withReason({ action, text }, candidate)
    }
    case 'key': {
      const key = readString(candidate, 'key')
      if (!isSupportedKey(key)) {
        throw new ActionValidationError(`Unsupported key "${key}".`)
      }
      return withReason({ action, key }, candidate)
    }
    case 'back':
      return withReason({ action }, candidate)
    case 'home':
      return withReason({ action }, candidate)
    case 'long_press': {
      const { x, y } = readPoint(candidate, screen)
      assertPointWithinScreen(x, y, screen)
      const durationMs =
        'durationMs' in candidate ? clamp(readInteger(candidate, 'durationMs'), 500, 5000) : 800
      return withReason({ action, x, y, durationMs }, candidate)
    }
    case 'double_tap': {
      const { x, y } = readPoint(candidate, screen)
      assertPointWithinScreen(x, y, screen)
      return withReason({ action, x, y }, candidate)
    }
    case 'wait': {
      const ms =
        'seconds' in candidate
          ? clamp(readInteger(candidate, 'seconds') * 1000, 100, 10000)
          : 'durationMs' in candidate
            ? clamp(readInteger(candidate, 'durationMs'), 100, 10000)
            : clamp(readInteger(candidate, 'ms'), 100, 10000)
      return withReason({ action, ms }, candidate)
    }
    case 'take_over': {
      const message = optionalString(candidate, 'message') ?? optionalString(candidate, 'reason') ?? 'Manual takeover requested.'
      return withReason({ action, message }, candidate)
    }
    case 'note': {
      const message = optionalString(candidate, 'message') ?? optionalString(candidate, 'content') ?? optionalString(candidate, 'text') ?? 'Observation noted.'
      return withReason({ action, message }, candidate)
    }
    case 'interact': {
      const message =
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'instruction') ??
        optionalString(candidate, 'content') ??
        'User interaction required.'
      return withReason({ action, message }, candidate)
    }
    case 'call_api': {
      const instruction =
        optionalString(candidate, 'instruction') ??
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'content') ??
        'Summarize the recorded context.'
      return withReason({ action, instruction }, candidate)
    }
    case 'done': {
      const summary =
        typeof candidate.summary === 'string' && candidate.summary.trim()
          ? candidate.summary.trim()
          : undefined
      return withReason(summary ? { action, summary } : { action }, candidate)
    }
    default:
      throw new ActionValidationError(`Unsupported action "${action}".`)
  }
}

export function buildActionPreview(action: AgentAction): string {
  const suffix = action.reason ? ` - ${action.reason}` : ''

  switch (action.action) {
    case 'launch':
      return `launch ${action.app}${action.packageName ? ` (${action.packageName})` : ''}${suffix}`
    case 'tap':
      return `tap (${action.x}, ${action.y})${suffix}`
    case 'swipe':
      return `swipe (${action.fromX}, ${action.fromY}) -> (${action.toX}, ${action.toY}), ${
        action.durationMs ?? 400
      }ms${suffix}`
    case 'input_text':
      return `input text "${truncate(action.text, 48)}"${suffix}`
    case 'key':
      return `press ${action.key}${suffix}`
    case 'back':
      return `back${suffix}`
    case 'home':
      return `home${suffix}`
    case 'long_press':
      return `long press (${action.x}, ${action.y}), ${action.durationMs}ms${suffix}`
    case 'double_tap':
      return `double tap (${action.x}, ${action.y})${suffix}`
    case 'wait':
      return `wait ${action.ms}ms${suffix}`
    case 'take_over':
      return `take over: ${action.message}${suffix}`
    case 'note':
      return `note: ${action.message}${suffix}`
    case 'interact':
      return `interact: ${action.message}${suffix}`
    case 'call_api':
      return `call api: ${action.instruction}${suffix}`
    case 'done':
      return `done${action.summary ? `: ${action.summary}` : ''}${suffix}`
  }
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const body = fenced?.[1]?.trim() ?? trimmed
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new ActionValidationError('Model response did not contain a JSON object.')
  }

  return body.slice(start, end + 1)
}

function parseFunctionLikeAction(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/<\/?answer>/gi, '').trim()
  const match = cleaned.match(/\b(do|action|finish)\s*\(([\s\S]*?)\)/i)
  if (!match) {
    return null
  }

  const functionName = match[1].toLowerCase()
  const args = parseFunctionArguments(match[2])
  if (functionName === 'finish') {
    const summary =
      typeof args.message === 'string' && args.message.trim()
        ? args.message.trim()
        : typeof args.summary === 'string' && args.summary.trim()
          ? args.summary.trim()
          : undefined
    return summary ? { action: 'done', summary } : { action: 'done' }
  }

  return args
}

function parseFunctionArguments(args: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const pattern = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|[^,]+)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(args)) !== null) {
    result[match[1]] = parseFunctionValue(match[2].trim())
  }

  return result
}

function parseFunctionValue(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((part) => parseFunctionValue(part.trim()))
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }

  return value
}

function assertPointWithinScreen(x: number, y: number, screen?: ScreenSize) {
  if (!screen) {
    return
  }

  if (x < 0 || y < 0 || x >= screen.width || y >= screen.height) {
    throw new ActionValidationError(
      `Point (${x}, ${y}) is outside the current screen ${screen.width}x${screen.height}.`,
    )
  }
}

function readInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (!Number.isInteger(value)) {
    throw new ActionValidationError(`${key} must be an integer.`)
  }
  return value as number
}

function readFirstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = optionalString(record, key)
    if (value) {
      return value
    }
  }

  throw new ActionValidationError(`${keys[0]} must be a non-empty string.`)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new ActionValidationError(`${key} must be a non-empty string.`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function withReason<T extends AgentAction>(action: T, source: Record<string, unknown>): T {
  const reason = optionalString(source, 'reason') ?? optionalString(source, 'thought')
  if (!reason) {
    return action
  }

  return { ...action, reason } as T
}

function withTapMetadata(action: TapAction, source: Record<string, unknown>): TapAction {
  const base = withReason(action, source)
  const message = optionalString(source, 'message')
  const risk = optionalString(source, 'risk')

  if (risk && risk !== 'sensitive') {
    throw new ActionValidationError(`Unsupported tap risk "${risk}".`)
  }

  return {
    ...base,
    ...(message ? { message } : {}),
    ...(risk === 'sensitive' ? { risk } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSupportedKey(key: string): key is KeyAction['key'] {
  return [
    'BACK',
    'HOME',
    'ENTER',
    'POWER',
    'APP_SWITCH',
    'MENU',
    'VOLUME_UP',
    'VOLUME_DOWN',
    'CAMERA',
    'SEARCH',
  ].includes(key)
}

function canonicalActionName(action: string) {
  const normalized = action.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const aliases: Record<string, AgentAction['action']> = {
    click: 'tap',
    callapi: 'call_api',
    double_click: 'double_tap',
    finish: 'done',
    input: 'input_text',
    interact: 'interact',
    launch_app: 'launch',
    longpress: 'long_press',
    open_app: 'launch',
    press_back: 'back',
    press_home: 'home',
    takeover: 'take_over',
    type: 'input_text',
    type_name: 'input_text',
  }

  return aliases[normalized] ?? normalized
}

function readPoint(record: Record<string, unknown>, screen?: ScreenSize): { x: number; y: number } {
  if ('x' in record && 'y' in record) {
    return {
      x: readInteger(record, 'x'),
      y: readInteger(record, 'y'),
    }
  }

  const point =
    readNumberTuple(record.element) ??
    readNumberTuple(record.point) ??
    readNumberTuple(record.position) ??
    readNumberTuple(record.coordinate) ??
    readNumberTuple(record.coordinates)

  if (!point) {
    throw new ActionValidationError('Action must include x/y or element coordinates.')
  }

  return relativePointToScreen(point, screen)
}

function readSwipePoints(
  record: Record<string, unknown>,
  screen?: ScreenSize,
): { fromX: number; fromY: number; toX: number; toY: number } {
  if ('fromX' in record && 'fromY' in record && 'toX' in record && 'toY' in record) {
    return {
      fromX: readInteger(record, 'fromX'),
      fromY: readInteger(record, 'fromY'),
      toX: readInteger(record, 'toX'),
      toY: readInteger(record, 'toY'),
    }
  }

  const start =
    readNumberTuple(record.start) ??
    readNumberTuple(record.from) ??
    readNumberTuple(record.startPoint) ??
    readNumberTuple(record.start_point)
  const end =
    readNumberTuple(record.end) ??
    readNumberTuple(record.to) ??
    readNumberTuple(record.endPoint) ??
    readNumberTuple(record.end_point)

  if (start && end) {
    const from = relativePointToScreen(start, screen)
    const to = relativePointToScreen(end, screen)
    return {
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
    }
  }

  const direction = optionalString(record, 'direction')?.toLowerCase()
  if (!direction || !screen) {
    throw new ActionValidationError('Swipe must include start/end coordinates or a direction.')
  }

  const centerX = Math.round(screen.width / 2)
  const centerY = Math.round(screen.height / 2)
  const lowX = Math.round(screen.width * 0.25)
  const highX = Math.round(screen.width * 0.75)
  const lowY = Math.round(screen.height * 0.25)
  const highY = Math.round(screen.height * 0.75)

  if (direction === 'up') {
    return { fromX: centerX, fromY: highY, toX: centerX, toY: lowY }
  }
  if (direction === 'down') {
    return { fromX: centerX, fromY: lowY, toX: centerX, toY: highY }
  }
  if (direction === 'left') {
    return { fromX: highX, fromY: centerY, toX: lowX, toY: centerY }
  }
  if (direction === 'right') {
    return { fromX: lowX, fromY: centerY, toX: highX, toY: centerY }
  }

  throw new ActionValidationError(`Unsupported swipe direction "${direction}".`)
}

function readNumberTuple(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }

  const [x, y] = value
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return [x, y]
}

function relativePointToScreen([x, y]: [number, number], screen?: ScreenSize): { x: number; y: number } {
  if (!screen) {
    return { x: Math.round(x), y: Math.round(y) }
  }

  return {
    x: Math.round((x / 1000) * screen.width),
    y: Math.round((y / 1000) * screen.height),
  }
}

function optionalPackageNameFromApp(app: string): string | undefined {
  return app.includes('.') ? app : undefined
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`
}
