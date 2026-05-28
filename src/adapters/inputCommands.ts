import type { AgentAction, KeyAction } from '../lib/actionTypes'
import { resolveAppPackage } from './appPackages'
import { escapeInputText } from './adbKeyboard'
import { DEFAULT_DEVICE_TIMING } from './deviceTiming'
import {
  DeviceBackendError,
  type DeviceCommandStep,
  type DeviceTimingConfig,
  type InstalledApp,
} from './deviceTypes'
import { resolveInstalledAppPackage } from './installedApps'

export function buildInputCommand(action: AgentAction): readonly string[] | null {
  const sequence = buildInputCommandSequence(action)
  const first = sequence[0]
  return Array.isArray(first) ? first : null
}

export function buildInputCommandSequence(
  action: AgentAction,
  timing: DeviceTimingConfig = DEFAULT_DEVICE_TIMING,
  installedApps?: readonly InstalledApp[],
): DeviceCommandStep[] {
  switch (action.action) {
    case 'launch': {
      const packageName =
        action.packageName ??
        resolveInstalledAppPackage(action.app, installedApps) ??
        resolveAppPackage(action.app)
      if (!packageName) {
        throw new DeviceBackendError(`No package mapping found for "${action.app}".`)
      }
      return [['monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']]
    }
    case 'tap':
      return [['input', 'tap', String(action.x), String(action.y)]]
    case 'swipe':
      return [
        [
          'input',
          'swipe',
          String(action.fromX),
          String(action.fromY),
          String(action.toX),
          String(action.toY),
          String(action.durationMs ?? 400),
        ],
      ]
    case 'input_text': {
      const sequence: DeviceCommandStep[] = action.clear
        ? [
            ['input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A'],
            { waitMs: timing.keyboardStepMs },
            ['input', 'keyevent', 'KEYCODE_DEL'],
            { waitMs: timing.keyboardStepMs },
          ]
        : []
      sequence.push(['input', 'text', escapeInputText(action.text)])
      return sequence
    }
    case 'open_url':
      return [['am', 'start', '-a', 'android.intent.action.VIEW', '-d', action.url]]
    case 'set_clipboard':
      return []
    case 'paste':
      return [['input', 'keyevent', 'KEYCODE_PASTE']]
    case 'key':
      return [['input', 'keyevent', keyToAndroidKeyCode(action.key)]]
    case 'back':
      return [['input', 'keyevent', 'KEYCODE_BACK']]
    case 'home':
      return [['input', 'keyevent', 'KEYCODE_HOME']]
    case 'long_press':
      return [
        [
          'input',
          'swipe',
          String(action.x),
          String(action.y),
          String(action.x),
          String(action.y),
          String(action.durationMs),
        ],
      ]
    case 'double_tap':
      return [
        ['input', 'tap', String(action.x), String(action.y)],
        { waitMs: timing.doubleTapIntervalMs },
        ['input', 'tap', String(action.x), String(action.y)],
      ]
    case 'interact':
      throw new DeviceBackendError(`Manual interaction required: ${action.message}`)
    case 'call_api':
      throw new DeviceBackendError(`Unsupported call_api action: ${action.instruction}`)
    case 'type_secret':
      throw new DeviceBackendError('type_secret must be resolved by the action tool registry.')
    case 'custom_tool':
      throw new DeviceBackendError('custom_tool does not execute on the Android device.')
    case 'view_screenshot':
      throw new DeviceBackendError('view_screenshot must be handled by the action tool registry.')
    case 'sequence':
      throw new DeviceBackendError('sequence must be expanded by the action tool registry.')
    case 'repeat':
      throw new DeviceBackendError('repeat must be expanded by the action tool registry.')
    case 'note':
    case 'take_over':
    case 'wait':
    case 'done':
      return []
  }
}

export function keyToAndroidKeyCode(key: KeyAction['key']) {
  const keycodes: Record<KeyAction['key'], string> = {
    APP_SWITCH: 'KEYCODE_APP_SWITCH',
    BACK: 'KEYCODE_BACK',
    CAMERA: 'KEYCODE_CAMERA',
    ENTER: 'KEYCODE_ENTER',
    HOME: 'KEYCODE_HOME',
    MENU: 'KEYCODE_MENU',
    POWER: 'KEYCODE_POWER',
    SEARCH: 'KEYCODE_SEARCH',
    VOLUME_DOWN: 'KEYCODE_VOLUME_DOWN',
    VOLUME_UP: 'KEYCODE_VOLUME_UP',
  }

  return keycodes[key]
}
