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
  clear?: boolean
  reason?: string
}

export type TypeSecretAction = {
  action: 'type_secret'
  secretId: string
  clear?: boolean
  reason?: string
}

export type OpenUrlAction = {
  action: 'open_url'
  url: string
  reason?: string
}

export type SetClipboardAction = {
  action: 'set_clipboard'
  text: string
  reason?: string
}

export type PasteAction = {
  action: 'paste'
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

export type CustomToolAction = {
  action: 'custom_tool'
  tool: string
  input?: unknown
  reason?: string
}

export type ViewScreenshotAction = {
  action: 'view_screenshot'
  ref?: string
  step?: number
  reason?: string
}

export type ExecutableAtomicAction =
  | TapAction
  | SwipeAction
  | LaunchAction
  | InputTextAction
  | TypeSecretAction
  | OpenUrlAction
  | SetClipboardAction
  | PasteAction
  | KeyAction
  | BackAction
  | HomeAction
  | LongPressAction
  | DoubleTapAction
  | WaitAction
  | NoteAction
  | CustomToolAction

export type SequenceAction = {
  action: 'sequence'
  actions: ExecutableAtomicAction[]
  reason?: string
}

export type RepeatAction = {
  action: 'repeat'
  count: number
  actionToRepeat: ExecutableAtomicAction
  delayMs?: number
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
  | TypeSecretAction
  | OpenUrlAction
  | SetClipboardAction
  | PasteAction
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
  | CustomToolAction
  | ViewScreenshotAction
  | SequenceAction
  | RepeatAction
  | DoneAction

export class ActionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionValidationError'
  }
}
