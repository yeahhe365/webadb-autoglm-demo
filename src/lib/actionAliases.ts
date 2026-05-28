import type { AgentAction, KeyAction } from './actionTypes'

export const ACTION_ALIASES: Record<string, AgentAction['action']> = {
  callapi: 'call_api',
  click: 'tap',
  click_area: 'tap',
  click_at: 'tap',
  complete: 'done',
  double_click: 'double_tap',
  finish: 'done',
  input: 'input_text',
  interact: 'interact',
  launch_app: 'launch',
  longpress: 'long_press',
  long_press_at: 'long_press',
  open_app: 'launch',
  open_bundle_id: 'launch',
  open_deeplink: 'open_url',
  open_link: 'open_url',
  open_url: 'open_url',
  paste_text: 'paste',
  press_back: 'back',
  press_button: 'key',
  press_home: 'home',
  remember: 'note',
  recall_screenshot: 'view_screenshot',
  repeat_action: 'repeat',
  repeated_action: 'repeat',
  sequence_actions: 'sequence',
  set_clipboard: 'set_clipboard',
  set_clipboard_text: 'set_clipboard',
  system_button: 'key',
  tap_area: 'tap',
  tap_at: 'tap',
  takeover: 'take_over',
  type: 'input_text',
  type_direct: 'input_text',
  type_name: 'input_text',
  type_secret: 'type_secret',
  type_text: 'input_text',
  type_text_direct: 'input_text',
  view_log_screenshot: 'view_screenshot',
  view_previous_screenshot: 'view_screenshot',
  view_screenshot: 'view_screenshot',
}

const KEY_ALIASES: Record<string, KeyAction['key']> = {
  APP_SWITCHER: 'APP_SWITCH',
  BACK_BUTTON: 'BACK',
  ENTER_KEY: 'ENTER',
  HOME_BUTTON: 'HOME',
  RECENT: 'APP_SWITCH',
  RECENT_APPS: 'APP_SWITCH',
  RECENTS: 'APP_SWITCH',
  RETURN: 'ENTER',
  VOLDOWN: 'VOLUME_DOWN',
  VOLUP: 'VOLUME_UP',
  VOLUME_DOWN_BUTTON: 'VOLUME_DOWN',
  VOLUME_UP_BUTTON: 'VOLUME_UP',
}

export function canonicalActionName(action: string) {
  const normalized = normalizeActionName(action)
  return ACTION_ALIASES[normalized] ?? normalized
}

export function normalizeActionName(action: string) {
  return action.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function normalizeKey(key: string) {
  const normalized = key.trim().toUpperCase().replace(/[\s-]+/g, '_')
  return KEY_ALIASES[normalized] ?? normalized
}

export function isSupportedKey(key: string): key is KeyAction['key'] {
  return [
    'APP_SWITCH',
    'BACK',
    'CAMERA',
    'ENTER',
    'HOME',
    'MENU',
    'POWER',
    'SEARCH',
    'VOLUME_DOWN',
    'VOLUME_UP',
  ].includes(key)
}
