import { describe, expect, it } from 'vitest'
import {
  AUTO_GLM_ACTION_SETTLE_DELAY_MS,
  AUTO_GLM_DOUBLE_TAP_INTERVAL_MS,
  DEFAULT_DEVICE_TIMING,
  buildInputCommand,
  buildInputCommandSequence,
  encodeAdbKeyboardText,
  getSensitiveActionMessage,
  escapeInputText,
  findAdbKeyboardIme,
  isAndroidInputTextSafe,
  isAdbKeyboardInstalled,
  keyToAndroidKeyCode,
  parseCurrentAppFromDumpsys,
  parseDeviceStateFromDumpsys,
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

  it('uses custom settle and double-tap timing when provided', () => {
    expect(
      buildInputCommandSequence(
        { action: 'double_tap', x: 10, y: 20 },
        {
          ...DEFAULT_DEVICE_TIMING,
          actionSettleMs: 250,
          doubleTapIntervalMs: 80,
        },
      ),
    ).toEqual([
      ['input', 'tap', '10', '20'],
      { waitMs: 80 },
      ['input', 'tap', '10', '20'],
      { waitMs: 250 },
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
    expect(isAdbKeyboardInstalled('com.zhipu.autoglm.keyboard/.AdbIME')).toBe(true)
    expect(isAdbKeyboardInstalled('com.autoglm.keyboard/.AutoGLMKeyboardIME')).toBe(true)
    expect(isAdbKeyboardInstalled('com.android.inputmethod.latin/.LatinIME')).toBe(false)
  })

  it('selects the detected AutoGLM-compatible keyboard IME', () => {
    expect(
      findAdbKeyboardIme(`com.android.inputmethod.latin/.LatinIME\ncom.zhipu.autoglm.keyboard/.AdbIME`),
    ).toBe('com.zhipu.autoglm.keyboard/.AdbIME')
    expect(findAdbKeyboardIme('com.autoglm.keyboard/.AutoGLMKeyboardIME')).toBe(
      'com.autoglm.keyboard/.AutoGLMKeyboardIME',
    )
  })

  it('encodes Unicode text for ADB Keyboard base64 input', () => {
    expect(encodeAdbKeyboardText('测试发送')).toBe('5rWL6K+V5Y+R6YCB')
    expect(encodeAdbKeyboardText('hello world')).toBe('aGVsbG8gd29ybGQ=')
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

describe('parseCurrentAppFromDumpsys', () => {
  it('detects the focused package and maps it to a known app label', () => {
    const output = 'mCurrentFocus=Window{abc u0 com.tencent.mm/.ui.LauncherUI}'

    expect(parseCurrentAppFromDumpsys(output)).toBe('微信')
  })

  it('returns the package name when the focused app is unknown', () => {
    const output = 'mFocusedApp=ActivityRecord{abc u0 com.example.notes/.MainActivity t12}'

    expect(parseCurrentAppFromDumpsys(output)).toBe('com.example.notes')
  })

  it('falls back to System Home when no focus line is present', () => {
    expect(parseCurrentAppFromDumpsys('no focused window')).toBe('System Home')
  })

  it('skips focus lines without a package and keeps looking', () => {
    const output = [
      'mCurrentFocus=null',
      'mFocusedApp=ActivityRecord{abc u0 com.android.chrome/com.google.android.apps.chrome.Main t12}',
    ].join('\n')

    expect(parseCurrentAppFromDumpsys(output)).toBe('chrome')
  })
})

describe('parseDeviceStateFromDumpsys', () => {
  it('extracts app label, package, activity, and orientation', () => {
    const output = [
      'mCurrentFocus=Window{abc u0 com.tencent.mm/.ui.LauncherUI}',
      'mCurrentAppOrientation=1',
    ].join('\n')

    expect(parseDeviceStateFromDumpsys(output)).toEqual({
      app: '微信',
      packageName: 'com.tencent.mm',
      activity: '.ui.LauncherUI',
      orientation: 'portrait',
    })
  })

  it('uses package names for unknown apps and detects landscape orientation', () => {
    const output = [
      'mFocusedApp=ActivityRecord{abc u0 com.example.notes/com.example.notes.MainActivity t12}',
      'mCurrentAppOrientation=0',
    ].join('\n')

    expect(parseDeviceStateFromDumpsys(output)).toEqual({
      app: 'com.example.notes',
      packageName: 'com.example.notes',
      activity: 'com.example.notes.MainActivity',
      orientation: 'landscape',
    })
  })
})

describe('getSensitiveActionMessage', () => {
  it('asks for confirmation on sensitive tap actions', () => {
    expect(
      getSensitiveActionMessage({
        action: 'tap',
        x: 100,
        y: 200,
        message: '确认付款',
      }),
    ).toBe('确认付款')
    expect(
      getSensitiveActionMessage({
        action: 'tap',
        x: 100,
        y: 200,
        risk: 'sensitive',
      }),
    ).toBe('Sensitive tap at (100, 200)')
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
