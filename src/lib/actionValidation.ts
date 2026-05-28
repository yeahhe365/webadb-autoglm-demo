import {
  canonicalActionName,
  isSupportedKey,
  normalizeActionName,
  normalizeKey,
} from './actionAliases'
import { ActionValidationError } from './actionTypes'
import type {
  AgentAction,
  ExecutableAtomicAction,
  ScreenSize,
  TapAction,
} from './actionTypes'

const MAX_SEQUENCE_ACTIONS = 8
const MAX_REPEAT_COUNT = 10
const MAX_REPEAT_DELAY_MS = 5000
const MAX_COMPOSITE_ACTION_DEPTH = 1

export function validateAction(candidate: unknown, screen?: ScreenSize): AgentAction {
  return validateActionAtDepth(candidate, screen, 0)
}

function validateActionAtDepth(
  candidate: unknown,
  screen: ScreenSize | undefined,
  depth: number,
): AgentAction {
  if (!isRecord(candidate)) {
    throw new ActionValidationError('Action must be a JSON object.')
  }

  if (typeof candidate.action !== 'string') {
    throw new ActionValidationError('Action must include an action name.')
  }

  const rawAction = normalizeActionName(candidate.action)
  const action = canonicalActionName(candidate.action)

  switch (action) {
    case 'launch': {
      const app = readFirstString(candidate, [
        'app',
        'appName',
        'name',
        'package',
        'packageName',
        'package_name',
        'text',
        'app_id',
        'bundle_id',
      ])
      const packageName =
        optionalString(candidate, 'packageName') ??
        optionalString(candidate, 'package_name') ??
        optionalString(candidate, 'app_id') ??
        optionalString(candidate, 'bundle_id') ??
        optionalPackageNameFromApp(app)
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
      const defaultDurationMs = 'coordinate' in candidate && 'coordinate2' in candidate ? 1000 : 400
      const durationMs = readSwipeDurationMs(candidate, defaultDurationMs)
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
      const clear = readOptionalBoolean(candidate, ['clear', 'clearFirst', 'replace']) ?? false
      return withReason(clear ? { action, text, clear } : { action, text }, candidate)
    }
    case 'type_secret': {
      const secretId = readFirstString(candidate, ['secretId', 'secret_id', 'id'])
      const clear = readOptionalBoolean(candidate, ['clear', 'clearFirst', 'replace']) ?? false
      return withReason(clear ? { action, secretId, clear } : { action, secretId }, candidate)
    }
    case 'open_url': {
      const url = readFirstString(candidate, ['url', 'uri', 'deepLink', 'deep_link', 'link', 'text'])
      if (hasControlCharacters(url)) {
        throw new ActionValidationError('open_url cannot contain control characters.')
      }
      if (url.length > 2048) {
        throw new ActionValidationError('open_url is limited to 2048 characters.')
      }
      if (!hasUriScheme(url)) {
        throw new ActionValidationError('open_url must include a URI scheme such as https://.')
      }
      return withReason({ action, url }, candidate)
    }
    case 'set_clipboard': {
      const text = readFirstString(candidate, ['text', 'content', 'value'])
      if (hasNullCharacter(text)) {
        throw new ActionValidationError('set_clipboard cannot contain null characters.')
      }
      if (text.length > 4000) {
        throw new ActionValidationError('set_clipboard is limited to 4000 characters.')
      }
      return withReason({ action, text }, candidate)
    }
    case 'paste':
      return withReason({ action }, candidate)
    case 'key': {
      const key = normalizeKey(readFirstString(candidate, ['key', 'button']))
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
      const defaultDurationMs = rawAction === 'long_press_at' ? 1000 : 800
      const durationMs = readLongPressDurationMs(candidate, defaultDurationMs)
      return withReason({ action, x, y, durationMs }, candidate)
    }
    case 'double_tap': {
      const { x, y } = readPoint(candidate, screen)
      assertPointWithinScreen(x, y, screen)
      return withReason({ action, x, y }, candidate)
    }
    case 'wait': {
      const ms = readWaitDurationMs(candidate)
      return withReason({ action, ms }, candidate)
    }
    case 'take_over': {
      const message =
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'reason') ??
        'Manual takeover requested.'
      return withReason({ action, message }, candidate)
    }
    case 'note': {
      const message =
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'content') ??
        optionalString(candidate, 'text') ??
        optionalString(candidate, 'information') ??
        'Observation noted.'
      return withReason({ action, message }, candidate)
    }
    case 'interact': {
      const message =
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'instruction') ??
        optionalString(candidate, 'content') ??
        'User interaction required.'
      return withReason({ action: 'take_over', message }, candidate)
    }
    case 'call_api': {
      const instruction =
        optionalString(candidate, 'instruction') ??
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'content') ??
        'Summarize the recorded context.'
      return withReason(
        { action: 'take_over', message: `Unsupported call_api requested: ${instruction}` },
        candidate,
      )
    }
    case 'custom_tool': {
      const tool = readFirstString(candidate, ['tool', 'toolName', 'tool_name', 'name'])
      const input = readCustomToolInput(candidate)
      return withReason(
        input === undefined ? { action, tool } : { action, tool, input },
        candidate,
      )
    }
    case 'view_screenshot': {
      const ref =
        optionalString(candidate, 'ref') ??
        optionalString(candidate, 'id') ??
        optionalString(candidate, 'logId') ??
        optionalString(candidate, 'log_id') ??
        optionalString(candidate, 'screenshot') ??
        optionalString(candidate, 'screenshotRef') ??
        optionalString(candidate, 'screenshot_ref')
      const step = readOptionalPositiveInteger(candidate, ['step', 'logStep', 'log_step'])

      if (!ref && step === undefined) {
        throw new ActionValidationError('view_screenshot must include a ref or step.')
      }

      return withReason(
        {
          action,
          ...(ref ? { ref } : {}),
          ...(step === undefined ? {} : { step }),
        },
        candidate,
      )
    }
    case 'sequence': {
      assertCompositeActionDepth(depth)
      const actions = readActionList(candidate, screen, depth)
      return withReason({ action, actions }, candidate)
    }
    case 'repeat': {
      assertCompositeActionDepth(depth)
      const actionToRepeat = readRepeatAction(candidate, screen, depth)
      const count = readRepeatCount(candidate)
      const delayMs = readOptionalDelayMs(candidate)
      return withReason(
        delayMs === undefined
          ? { action, count, actionToRepeat }
          : { action, count, actionToRepeat, delayMs },
        candidate,
      )
    }
    case 'done': {
      const summary = readCompletionSummary(candidate)
      return withReason(summary ? { action, summary } : { action }, candidate)
    }
    default:
      throw new ActionValidationError(`Unsupported action "${action}".`)
  }
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

function readFiniteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ActionValidationError(`${key} must be a number.`)
  }
  return value
}

function readWaitDurationMs(record: Record<string, unknown>) {
  if ('duration' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'duration') * 1000), 100, 10000)
  }
  if ('seconds' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'seconds') * 1000), 100, 10000)
  }
  if ('durationMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'durationMs')), 100, 10000)
  }
  if ('ms' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'ms')), 100, 10000)
  }
  return 1000
}

function readSwipeDurationMs(record: Record<string, unknown>, defaultDurationMs: number) {
  if ('durationMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'durationMs')), 100, 2000)
  }
  if ('ms' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'ms')), 100, 2000)
  }
  if ('duration' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'duration') * 1000), 100, 2000)
  }
  return defaultDurationMs
}

function readLongPressDurationMs(record: Record<string, unknown>, defaultDurationMs: number) {
  if ('durationMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'durationMs')), 500, 5000)
  }
  if ('ms' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'ms')), 500, 5000)
  }
  if ('duration' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'duration') * 1000), 500, 5000)
  }
  return defaultDurationMs
}

function readDurationSeconds(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^-?\d+(\.\d+)?/)
    if (match) {
      return Number(match[0])
    }
  }
  throw new ActionValidationError(`${key} must be a number of seconds.`)
}

function readCompletionSummary(record: Record<string, unknown>) {
  const summary =
    optionalString(record, 'summary') ??
    optionalString(record, 'message') ??
    optionalString(record, 'reason')
  const success = readOptionalBoolean(record, ['success'])

  if (success === false && summary) {
    return `Failed: ${summary}`
  }
  return summary
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

function readOptionalBoolean(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (!(key in record)) {
      continue
    }
    const value = record[key]
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      if (/^true$/i.test(value)) {
        return true
      }
      if (/^false$/i.test(value)) {
        return false
      }
    }
    throw new ActionValidationError(`${key} must be a boolean.`)
  }
  return undefined
}

function readActionList(
  record: Record<string, unknown>,
  screen: ScreenSize | undefined,
  depth: number,
) {
  const value = record.actions ?? record.steps ?? record.sequence
  if (!Array.isArray(value)) {
    throw new ActionValidationError('sequence actions must be an array.')
  }
  if (value.length === 0) {
    throw new ActionValidationError('sequence must include at least one action.')
  }
  if (value.length > MAX_SEQUENCE_ACTIONS) {
    throw new ActionValidationError(`sequence is limited to ${MAX_SEQUENCE_ACTIONS} actions.`)
  }

  return value.map((item) => validateCompositeChildAction(item, screen, depth))
}

function readRepeatAction(
  record: Record<string, unknown>,
  screen: ScreenSize | undefined,
  depth: number,
) {
  const value =
    record.actionToRepeat ??
    record.action_to_repeat ??
    record.step ??
    record.toolAction ??
    record.tool_action ??
    record.tool
  if (value === undefined) {
    throw new ActionValidationError('repeat must include actionToRepeat.')
  }
  return validateCompositeChildAction(value, screen, depth)
}

function readRepeatCount(record: Record<string, unknown>) {
  const raw = record.count ?? record.times ?? record.repeat
  if (!Number.isInteger(raw)) {
    throw new ActionValidationError('repeat count must be an integer.')
  }

  const count = raw as number
  if (count < 1 || count > MAX_REPEAT_COUNT) {
    throw new ActionValidationError(`repeat count must be between 1 and ${MAX_REPEAT_COUNT}.`)
  }
  return count
}

function readOptionalDelayMs(record: Record<string, unknown>) {
  if ('delayMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'delayMs')), 0, MAX_REPEAT_DELAY_MS)
  }
  if ('delay_ms' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'delay_ms')), 0, MAX_REPEAT_DELAY_MS)
  }
  if ('delay' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'delay') * 1000), 0, MAX_REPEAT_DELAY_MS)
  }
  return undefined
}

function validateCompositeChildAction(
  candidate: unknown,
  screen: ScreenSize | undefined,
  depth: number,
) {
  const action = validateActionAtDepth(candidate, screen, depth + 1)
  if (!isCompositeChildAction(action)) {
    throw new ActionValidationError(`"${action.action}" cannot be used inside a composite action.`)
  }
  return action
}

function assertCompositeActionDepth(depth: number) {
  if (depth >= MAX_COMPOSITE_ACTION_DEPTH) {
    throw new ActionValidationError('Composite actions cannot be nested.')
  }
}

function isCompositeChildAction(action: AgentAction): action is ExecutableAtomicAction {
  return ![
    'call_api',
    'done',
    'interact',
    'repeat',
    'sequence',
    'take_over',
    'view_screenshot',
  ].includes(action.action)
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

function readPoint(record: Record<string, unknown>, screen?: ScreenSize): { x: number; y: number } {
  if ('x' in record && 'y' in record) {
    return {
      x: readInteger(record, 'x'),
      y: readInteger(record, 'y'),
    }
  }

  const areaCenter = readAreaCenter(record)
  if (areaCenter) {
    return tupleToScreenPoint(areaCenter)
  }

  const element = readNumberTuple(record.element)
  if (element) {
    return relativePointToScreen(element, screen)
  }

  const point =
    readNumberTuple(record.point) ??
    readNumberTuple(record.position) ??
    readNumberTuple(record.coordinate) ??
    readNumberTuple(record.coordinates)

  if (!point) {
    throw new ActionValidationError('Action must include x/y or element coordinates.')
  }

  return tupleToScreenPoint(point)
}

function readOptionalPositiveInteger(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (!(key in record)) {
      continue
    }
    const value = record[key]
    if (Number.isInteger(value) && (value as number) > 0) {
      return value as number
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      const parsed = Number(value.trim())
      if (parsed > 0) {
        return parsed
      }
    }
    throw new ActionValidationError(`${key} must be a positive integer.`)
  }
  return undefined
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
    readNumberTuple(record.coordinate) ??
    readNumberTuple(record.start) ??
    readNumberTuple(record.from) ??
    readNumberTuple(record.startPoint) ??
    readNumberTuple(record.start_point)
  const end =
    readNumberTuple(record.coordinate2) ??
    readNumberTuple(record.end) ??
    readNumberTuple(record.to) ??
    readNumberTuple(record.endPoint) ??
    readNumberTuple(record.end_point)

  if (start && end) {
    const from = tupleToScreenPoint(start)
    const to = tupleToScreenPoint(end)
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

function readAreaCenter(record: Record<string, unknown>): [number, number] | null {
  if ('x1' in record && 'y1' in record && 'x2' in record && 'y2' in record) {
    return [
      Math.round((readInteger(record, 'x1') + readInteger(record, 'x2')) / 2),
      Math.round((readInteger(record, 'y1') + readInteger(record, 'y2')) / 2),
    ]
  }

  const area = readNumberTuple4(record.area) ?? readNumberTuple4(record.bounds)
  if (!area) {
    return null
  }

  return [Math.round((area[0] + area[2]) / 2), Math.round((area[1] + area[3]) / 2)]
}

function readNumberTuple4(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null
  }

  const [x1, y1, x2, y2] = value
  if (
    typeof x1 !== 'number' ||
    typeof y1 !== 'number' ||
    typeof x2 !== 'number' ||
    typeof y2 !== 'number' ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    return null
  }

  return [x1, y1, x2, y2]
}

function readCustomToolInput(record: Record<string, unknown>) {
  if ('input' in record) {
    return record.input
  }
  if ('arguments' in record) {
    return record.arguments
  }
  if ('args' in record) {
    return record.args
  }
  if ('parameters' in record) {
    return record.parameters
  }
  return undefined
}

function tupleToScreenPoint([x, y]: [number, number]) {
  return { x: Math.round(x), y: Math.round(y) }
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

function hasNullCharacter(value: string) {
  return value.includes('\0')
}

function hasUriScheme(value: string) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
