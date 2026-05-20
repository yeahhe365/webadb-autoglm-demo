import { describe, expect, it } from 'vitest'
import {
  AUTO_GLM_ACTION_SETTLE_DELAY_MS,
  AUTO_GLM_DOUBLE_TAP_INTERVAL_MS,
  buildInputCommand,
  buildInputCommandSequence,
  escapeInputText,
  isAndroidInputTextSafe,
  isAdbKeyboardInstalled,
  keyToAndroidKeyCode,
  parsePngSize,
  resolveAppPackage,
} from './deviceBackend'

describe('buildInputCommand', () => {
  it('builds tap commands', () => {
    expect(buildInputCommand({ action: 'tap', x: 12, y: 34 })).toEqual([
      'input',
      'tap',
      '12',
      '34',
    ])
  })

  it('builds swipe commands with duration', () => {
    expect(
      buildInputCommand({
        action: 'swipe',
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        durationMs: 500,
      }),
    ).toEqual(['input', 'swipe', '1', '2', '3', '4', '500'])
  })

  it('builds text commands with Android input escaping', () => {
    expect(buildInputCommand({ action: 'input_text', text: 'hello world' })).toEqual([
      'input',
      'text',
      'hello%sworld',
    ])
  })

  it('builds keyevent commands', () => {
    expect(buildInputCommand({ action: 'key', key: 'BACK' })).toEqual([
      'input',
      'keyevent',
      'KEYCODE_BACK',
    ])
  })

  it('returns null for non-input actions', () => {
    expect(buildInputCommand({ action: 'wait', ms: 250 })).toBeNull()
    expect(buildInputCommand({ action: 'done' })).toBeNull()
  })
})

describe('buildInputCommandSequence', () => {
  it('builds launch commands from package names and app labels', () => {
    expect(buildInputCommandSequence({ action: 'launch', app: 'Settings' })).toEqual([
      ['monkey', '-p', 'com.android.settings', '-c', 'android.intent.category.LAUNCHER', '1'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])
    expect(buildInputCommandSequence({ action: 'launch', app: 'com.example.app' })).toEqual([
      ['monkey', '-p', 'com.example.app', '-c', 'android.intent.category.LAUNCHER', '1'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])
  })

  it('builds long press and double tap command sequences', () => {
    expect(
      buildInputCommandSequence({ action: 'long_press', x: 10, y: 20, durationMs: 900 }),
    ).toEqual([
      ['input', 'swipe', '10', '20', '10', '20', '900'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])

    expect(buildInputCommandSequence({ action: 'double_tap', x: 10, y: 20 })).toEqual([
      ['input', 'tap', '10', '20'],
      { waitMs: AUTO_GLM_DOUBLE_TAP_INTERVAL_MS },
      ['input', 'tap', '10', '20'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])
  })

  it('builds back and home commands', () => {
    expect(buildInputCommandSequence({ action: 'back' })).toEqual([
      ['input', 'keyevent', 'KEYCODE_BACK'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])
    expect(buildInputCommandSequence({ action: 'home' })).toEqual([
      ['input', 'keyevent', 'KEYCODE_HOME'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])
  })

  it('waits for the UI to settle after primitive touch and text actions', () => {
    expect(buildInputCommandSequence({ action: 'tap', x: 12, y: 34 })).toEqual([
      ['input', 'tap', '12', '34'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])

    expect(
      buildInputCommandSequence({
        action: 'swipe',
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        durationMs: 500,
      }),
    ).toEqual([
      ['input', 'swipe', '1', '2', '3', '4', '500'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])

    expect(buildInputCommandSequence({ action: 'input_text', text: 'hello world' })).toEqual([
      ['input', 'text', 'hello%sworld'],
      { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS },
    ])
  })
})

describe('escapeInputText', () => {
  it('escapes whitespace for Android input text', () => {
    expect(escapeInputText(' a  b ')).toBe('%sa%s%sb%s')
  })

  it('detects text that Android input text can type reliably', () => {
    expect(isAndroidInputTextSafe('hello world 123')).toBe(true)
    expect(isAndroidInputTextSafe('test@example.com')).toBe(true)
    expect(isAndroidInputTextSafe('测试发送')).toBe(false)
    expect(isAndroidInputTextSafe('hello\nworld')).toBe(false)
    expect(isAndroidInputTextSafe('price is $5')).toBe(false)
  })

  it('detects whether ADB Keyboard is installed from ime list output', () => {
    expect(
      isAdbKeyboardInstalled(`com.android.inputmethod.latin/.LatinIME\ncom.android.adbkeyboard/.AdbIME`),
    ).toBe(true)
    expect(isAdbKeyboardInstalled('com.android.inputmethod.latin/.LatinIME')).toBe(false)
  })
})

describe('keyToAndroidKeyCode', () => {
  it('maps supported model keys to Android keycodes', () => {
    expect(keyToAndroidKeyCode('APP_SWITCH')).toBe('KEYCODE_APP_SWITCH')
  })
})

describe('resolveAppPackage', () => {
  it('maps common Open-AutoGLM app names to Android packages', () => {
    expect(resolveAppPackage('京东')).toBe('com.jingdong.app.mall')
    expect(resolveAppPackage('YouTube')).toBe('com.google.android.youtube')
  })
})

describe('parsePngSize', () => {
  it('extracts PNG dimensions from the IHDR chunk', () => {
    const png = new Uint8Array(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
    png[16] = 0x00
    png[17] = 0x00
    png[18] = 0x04
    png[19] = 0x38
    png[20] = 0x00
    png[21] = 0x00
    png[22] = 0x09
    png[23] = 0x60

    expect(parsePngSize(png)).toEqual({ width: 1080, height: 2400 })
  })

  it('rejects non-PNG bytes', () => {
    expect(() => parsePngSize(new Uint8Array([1, 2, 3]))).toThrow('PNG')
  })
})
