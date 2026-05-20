import type { AgentAction, KeyAction, ScreenSize } from '../lib/actions'

export type DeviceInfo = {
  serial: string
  name: string
}

export type DeviceScreenshot = {
  bytes: Uint8Array
  dataUrl: string
  screen: ScreenSize
}

export type DeviceCommandStep = readonly string[] | { waitMs: number }

export const AUTO_GLM_ACTION_SETTLE_DELAY_MS = 1000
export const AUTO_GLM_DOUBLE_TAP_INTERVAL_MS = 100
export const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME'

export type DeviceBackend = {
  connect(): Promise<DeviceInfo>
  disconnect(): Promise<void>
  screenshot(): Promise<DeviceScreenshot>
  execute(action: AgentAction): Promise<string>
}

export class DeviceBackendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceBackendError'
  }
}

export function buildInputCommand(action: AgentAction): readonly string[] | null {
  const sequence = buildInputCommandSequence(action)
  const first = sequence[0]
  return Array.isArray(first) ? first : null
}

export function buildInputCommandSequence(action: AgentAction): DeviceCommandStep[] {
  switch (action.action) {
    case 'launch': {
      const packageName = action.packageName ?? resolveAppPackage(action.app)
      if (!packageName) {
        throw new DeviceBackendError(`No package mapping found for "${action.app}".`)
      }
      return withActionSettle([
        ['monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
      ])
    }
    case 'tap':
      return withActionSettle([['input', 'tap', String(action.x), String(action.y)]])
    case 'swipe':
      return withActionSettle([
        [
          'input',
          'swipe',
          String(action.fromX),
          String(action.fromY),
          String(action.toX),
          String(action.toY),
          String(action.durationMs ?? 400),
        ],
      ])
    case 'input_text':
      return withActionSettle([['input', 'text', escapeInputText(action.text)]])
    case 'key':
      return withActionSettle([['input', 'keyevent', keyToAndroidKeyCode(action.key)]])
    case 'back':
      return withActionSettle([['input', 'keyevent', 'KEYCODE_BACK']])
    case 'home':
      return withActionSettle([['input', 'keyevent', 'KEYCODE_HOME']])
    case 'long_press':
      return withActionSettle([
        [
          'input',
          'swipe',
          String(action.x),
          String(action.y),
          String(action.x),
          String(action.y),
          String(action.durationMs),
        ],
      ])
    case 'double_tap':
      return withActionSettle([
        ['input', 'tap', String(action.x), String(action.y)],
        { waitMs: AUTO_GLM_DOUBLE_TAP_INTERVAL_MS },
        ['input', 'tap', String(action.x), String(action.y)],
      ])
    case 'note':
    case 'take_over':
    case 'wait':
    case 'done':
      return []
  }
}

function withActionSettle(sequence: DeviceCommandStep[]): DeviceCommandStep[] {
  return [...sequence, { waitMs: AUTO_GLM_ACTION_SETTLE_DELAY_MS }]
}

export function escapeInputText(text: string) {
  return text.replace(/\s/g, '%s')
}

export function isAndroidInputTextSafe(text: string) {
  return /^[A-Za-z0-9 .,@_:+\\/-]+$/.test(text)
}

export function isAdbKeyboardInstalled(imeListOutput: string) {
  return imeListOutput.split(/\s+/).includes(ADB_KEYBOARD_IME)
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

export function resolveAppPackage(app: string): string | undefined {
  const direct = app.trim()
  if (direct.includes('.')) {
    return direct
  }

  return APP_PACKAGES[normalizeAppName(direct)]
}

export function parsePngSize(bytes: Uint8Array): ScreenSize {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const isPng = signature.every((value, index) => bytes[index] === value)

  if (!isPng || bytes.length < 24) {
    throw new DeviceBackendError('Screenshot is not a valid PNG.')
  }

  return {
    width: readUInt32(bytes, 16),
    height: readUInt32(bytes, 20),
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType = 'image/png') {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return `data:${mimeType};base64,${btoa(binary)}`
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms))
}

const APP_PACKAGES: Record<string, string> = {
  alipay: 'com.eg.android.AlipayGphone',
  amazon: 'com.amazon.mShop.android.shopping',
  bilibili: 'tv.danmaku.bili',
  calendar: 'com.google.android.calendar',
  calculator: 'com.google.android.calculator',
  camera: 'com.android.camera',
  chrome: 'com.android.chrome',
  clock: 'com.google.android.deskclock',
  contacts: 'com.google.android.contacts',
  douyin: 'com.ss.android.ugc.aweme',
  ebay: 'com.ebay.mobile',
  files: 'com.google.android.documentsui',
  gmail: 'com.google.android.gm',
  googlemaps: 'com.google.android.apps.maps',
  instagram: 'com.instagram.android',
  jd: 'com.jingdong.app.mall',
  jdcom: 'com.jingdong.app.mall',
  maps: 'com.google.android.apps.maps',
  messages: 'com.google.android.apps.messaging',
  phone: 'com.google.android.dialer',
  photos: 'com.google.android.apps.photos',
  playstore: 'com.android.vending',
  pinduoduo: 'com.xunmeng.pinduoduo',
  qq: 'com.tencent.mobileqq',
  reddit: 'com.reddit.frontpage',
  settings: 'com.android.settings',
  taobao: 'com.taobao.taobao',
  telegram: 'org.telegram.messenger',
  tiktok: 'com.zhiliaoapp.musically',
  twitter: 'com.twitter.android',
  wechat: 'com.tencent.mm',
  whatsapp: 'com.whatsapp',
  x: 'com.twitter.android',
  xiaohongshu: 'com.xingin.xhs',
  youtube: 'com.google.android.youtube',
  zhihu: 'com.zhihu.android',
  京东: 'com.jingdong.app.mall',
  微信: 'com.tencent.mm',
  淘宝: 'com.taobao.taobao',
  支付宝: 'com.eg.android.AlipayGphone',
  抖音: 'com.ss.android.ugc.aweme',
  小红书: 'com.xingin.xhs',
  拼多多: 'com.xunmeng.pinduoduo',
  知乎: 'com.zhihu.android',
  微博: 'com.sina.weibo',
  美团: 'com.sankuai.meituan',
  饿了么: 'me.ele',
  高德地图: 'com.autonavi.minimap',
  百度地图: 'com.baidu.BaiduMap',
  网易云音乐: 'com.netease.cloudmusic',
}

function normalizeAppName(value: string) {
  return value.toLowerCase().replace(/[\s._-]+/g, '')
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}
