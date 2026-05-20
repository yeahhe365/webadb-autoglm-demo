import { Adb, AdbDaemonTransport } from '@yume-chan/adb'
import AdbWebCredentialStore from '@yume-chan/adb-credential-web'
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb'
import type { AgentAction } from '../lib/actions'
import {
  ADB_KEYBOARD_IME,
  AUTO_GLM_ACTION_SETTLE_DELAY_MS,
  buildInputCommandSequence,
  bytesToDataUrl,
  delay,
  DeviceBackendError,
  isAdbKeyboardInstalled,
  isAndroidInputTextSafe,
  parsePngSize,
  type DeviceCommandStep,
  type DeviceBackend,
  type DeviceInfo,
  type DeviceScreenshot,
} from './deviceBackend'

export class WebAdbDeviceBackend implements DeviceBackend {
  #adb: Adb | null = null
  #deviceInfo: DeviceInfo | null = null
  #preferAdbKeyboard = false

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

    return {
      bytes,
      dataUrl: bytesToDataUrl(bytes),
      screen,
    }
  }

  async execute(action: AgentAction): Promise<string> {
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

    const sequence = buildInputCommandSequence(action)
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
    await this.#assertAdbKeyboardInstalled()
    const enable = await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'enable', ADB_KEYBOARD_IME])
    const set = await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', ADB_KEYBOARD_IME])
    this.#preferAdbKeyboard = true
    return [enable.trim(), set.trim()].filter(Boolean).join('\n') || `Enabled ${ADB_KEYBOARD_IME}`
  }

  setPreferAdbKeyboard(value: boolean) {
    this.#preferAdbKeyboard = value
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
    await this.#assertAdbKeyboardInstalled()

    try {
      await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'enable', ADB_KEYBOARD_IME])
      await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', ADB_KEYBOARD_IME])
    } catch {
      throw new DeviceBackendError(
        'Chinese or complex text requires ADB Keyboard. Install com.android.adbkeyboard/.AdbIME on the device, then try again.',
      )
    }

    const command = ['am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', text]
    await adb.subprocess.noneProtocol.spawnWait(command)
    await delay(AUTO_GLM_ACTION_SETTLE_DELAY_MS)
    this.#preferAdbKeyboard = true
    return command.join(' ')
  }

  async #assertAdbKeyboardInstalled() {
    const imeList = await this.#requireAdb().subprocess.noneProtocol.spawnWaitText(['ime', 'list', '-s'])
    if (!isAdbKeyboardInstalled(imeList)) {
      throw new DeviceBackendError(
        'Chinese or complex text requires ADB Keyboard. Install com.android.adbkeyboard/.AdbIME on the device, then try again.',
      )
    }
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
