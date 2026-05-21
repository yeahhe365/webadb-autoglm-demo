import { Adb, AdbDaemonTransport } from '@yume-chan/adb'
import AdbWebCredentialStore from '@yume-chan/adb-credential-web'
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb'
import type { AgentAction } from '../lib/actions'
import { preprocessScreenshotForModel } from './screenshotPreprocess'
import {
  DEFAULT_DEVICE_TIMING,
  assertSensitiveActionConfirmed,
  buildInputCommandSequence,
  bytesToDataUrl,
  delay,
  DeviceBackendError,
  encodeAdbKeyboardText,
  findAdbKeyboardIme,
  isAndroidInputTextSafe,
  parseDeviceStateFromDumpsys,
  parsePngSize,
  type DeviceCommandStep,
  type DeviceBackend,
  type DeviceInfo,
  type DeviceScreenshot,
  type DeviceState,
  type DeviceTimingConfig,
  type ExecuteActionOptions,
} from './deviceBackend'

export class WebAdbDeviceBackend implements DeviceBackend {
  #adb: Adb | null = null
  #deviceInfo: DeviceInfo | null = null
  #preferAdbKeyboard = false
  #timing: DeviceTimingConfig = DEFAULT_DEVICE_TIMING

  get isConnected() {
    return this.#adb !== null
  }

  get deviceInfo() {
    return this.#deviceInfo
  }

  async connect(): Promise<DeviceInfo> {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER
    if (!manager) {
      throw new DeviceBackendError('WebUSB is not available in this browser.')
    }

    const device = await manager.requestDevice()
    if (!device) {
      throw new DeviceBackendError('No Android ADB device was selected.')
    }

    const connection = await device.connect()
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: new AdbWebCredentialStore('webadb-autoglm'),
    })

    this.#adb = new Adb(transport)
    this.#deviceInfo = {
      serial: device.serial,
      name: device.name || transport.banner.model || 'Android device',
    }

    return this.#deviceInfo
  }

  async disconnect() {
    await this.#adb?.close()
    this.#adb = null
    this.#deviceInfo = null
  }

  async screenshot(): Promise<DeviceScreenshot> {
    const adb = this.#requireAdb()
    const bytes = await adb.subprocess.noneProtocol.spawnWait(['screencap', '-p'])
    const screen = parsePngSize(bytes)
    const dataUrl = bytesToDataUrl(bytes)
    let modelScreenshot: { modelDataUrl: string; modelScreen: typeof screen } | undefined

    try {
      modelScreenshot = await preprocessScreenshotForModel({ dataUrl, screen })
    } catch {
      modelScreenshot = { modelDataUrl: dataUrl, modelScreen: screen }
    }

    return {
      bytes,
      dataUrl,
      screen,
      ...modelScreenshot,
    }
  }

  async getCurrentApp(): Promise<string> {
    return (await this.getDeviceState()).app
  }

  async getDeviceState(): Promise<DeviceState> {
    const adb = this.#requireAdb()
    const [windowOutput, keyboard] = await Promise.all([
      adb.subprocess.noneProtocol.spawnWaitText(['dumpsys', 'window']),
      this.#getCurrentInputMethod().catch(() => undefined),
    ])
    return {
      ...parseDeviceStateFromDumpsys(windowOutput),
      ...(keyboard ? { keyboard } : {}),
    }
  }

  async execute(action: AgentAction, options?: ExecuteActionOptions): Promise<string> {
    if (action.action === 'wait') {
      await delay(action.ms)
      return `Waited ${action.ms}ms.`
    }

    if (action.action === 'take_over') {
      return action.message
    }

    if (action.action === 'note') {
      return action.message
    }

    if (action.action === 'done') {
      return action.summary || 'Task completed.'
    }

    if (action.action === 'input_text' && (this.#preferAdbKeyboard || !isAndroidInputTextSafe(action.text))) {
      return await this.#inputTextWithAdbKeyboard(action.text)
    }

    await assertSensitiveActionConfirmed(action, options)

    const sequence = buildInputCommandSequence(action, this.#timing)
    if (sequence.length === 0) {
      return 'No device command required.'
    }

    const executed: string[] = []
    for (const step of sequence) {
      await this.#executeCommandStep(step)
      executed.push(isWaitStep(step) ? `wait ${step.waitMs}ms` : step.join(' '))
    }

    return executed.join('\n')
  }

  async enableAdbKeyboard(): Promise<string> {
    const adb = this.#requireAdb()
    const keyboardIme = await this.#detectAdbKeyboardIme()
    const enable = await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'enable', keyboardIme])
    const set = await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', keyboardIme])
    this.#preferAdbKeyboard = true
    return [enable.trim(), set.trim()].filter(Boolean).join('\n') || `Enabled ${keyboardIme}`
  }

  setPreferAdbKeyboard(value: boolean) {
    this.#preferAdbKeyboard = value
  }

  setTimingConfig(value: DeviceTimingConfig) {
    this.#timing = value
  }

  async #executeCommandStep(step: DeviceCommandStep) {
    if (isWaitStep(step)) {
      await delay(step.waitMs)
      return
    }

    await this.#requireAdb().subprocess.noneProtocol.spawnWait(step)
  }

  async #inputTextWithAdbKeyboard(text: string) {
    const adb = this.#requireAdb()
    const keyboardIme = await this.#detectAdbKeyboardIme()
    const originalIme = await this.#getCurrentInputMethod()
    const executed: string[] = []

    try {
      await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'enable', keyboardIme])
      executed.push(`ime enable ${keyboardIme}`)
      await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', keyboardIme])
      executed.push(`ime set ${keyboardIme}`)
      await this.#sendAdbKeyboardText('')
      executed.push('am broadcast -a ADB_INPUT_B64 --es msg <empty>')
      await delay(this.#timing.keyboardStepMs)

      await adb.subprocess.noneProtocol.spawnWait(['am', 'broadcast', '-a', 'ADB_CLEAR_TEXT'])
      executed.push('am broadcast -a ADB_CLEAR_TEXT')
      await delay(this.#timing.keyboardStepMs)

      const command = await this.#sendAdbKeyboardText(text)
      executed.push(command.join(' '))
      await delay(this.#timing.keyboardStepMs)
    } catch {
      throw new DeviceBackendError(
        'ADB Keyboard or AutoGLM Keyboard was detected but did not accept the text broadcast. Re-enable the keyboard on the device, then try again.',
      )
    } finally {
      if (originalIme && originalIme !== keyboardIme) {
        await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', originalIme])
        await delay(this.#timing.keyboardStepMs)
      }
    }

    this.#preferAdbKeyboard = true
    return executed.join('\n')
  }

  async #sendAdbKeyboardText(text: string) {
    const command = ['am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', encodeAdbKeyboardText(text)]
    const adb = this.#requireAdb()
    await adb.subprocess.noneProtocol.spawnWait(command)
    return command
  }

  async #detectAdbKeyboardIme() {
    const imeList = await this.#requireAdb().subprocess.noneProtocol.spawnWaitText(['ime', 'list', '-s'])
    const keyboardIme = findAdbKeyboardIme(imeList)
    if (!keyboardIme) {
      throw new DeviceBackendError(
        'Chinese or complex text requires ADB Keyboard or AutoGLM Keyboard. Install and enable it on the device, then try again.',
      )
    }
    return keyboardIme
  }

  async #getCurrentInputMethod() {
    const result = await this.#requireAdb().subprocess.noneProtocol.spawnWaitText([
      'settings',
      'get',
      'secure',
      'default_input_method',
    ])
    return result.trim()
  }

  #requireAdb() {
    if (!this.#adb) {
      throw new DeviceBackendError('Connect an Android device first.')
    }

    return this.#adb
  }
}

export function isWebUsbSupported() {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

function isWaitStep(step: DeviceCommandStep): step is { waitMs: number } {
  return !Array.isArray(step)
}
