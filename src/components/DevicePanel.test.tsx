// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_COPY } from '../lib/appCopy'
import { DevicePanel } from './DevicePanel'

type DevicePanelTestProps = Parameters<typeof DevicePanel>[0]

function createDevicePanelProps(
  overrides: Partial<DevicePanelTestProps> = {},
): DevicePanelTestProps {
  const props: DevicePanelTestProps = {
    actions: {
      onActionSettleMsChange: vi.fn(),
      onCaptureScreen: vi.fn(),
      onConfirmSensitiveActionsChange: vi.fn(),
      onConfigureAdbKeyboard: vi.fn(),
      onConnectDevice: vi.fn(),
      onDisconnectDevice: vi.fn(),
      onDoubleTapIntervalMsChange: vi.fn(),
      onKeyboardStepMsChange: vi.fn(),
      onLaunchInstalledApp: vi.fn(),
      onPreferAdbKeyboardChange: vi.fn(),
      onRunDirectAction: vi.fn(),
      onRunDoctor: vi.fn(),
      onUnrestrictedModeChange: vi.fn(),
    },
    copy: APP_COPY['zh-CN'],
    state: {
      busyTask: null,
      connected: false,
      currentApp: 'Unknown',
      deviceInfo: null,
      doctorResults: [],
      deviceState: { app: 'Unknown' },
      installedApps: [],
    },
  }

  return {
    ...props,
    ...overrides,
    actions: {
      ...props.actions,
      ...overrides.actions,
    },
    state: {
      ...props.state,
      ...overrides.state,
    },
  }
}

function renderDevicePanel(overrides: Partial<DevicePanelTestProps> = {}) {
  const props = createDevicePanelProps(overrides)

  return render(<DevicePanel {...props} />)
}

describe('DevicePanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('keeps ADB recovery guidance out of the device panel help button', () => {
    renderDevicePanel()

    expect(screen.queryByRole('button', { name: 'ADB 连接帮助' })).toBeNull()
    expect(document.querySelector('.adb-help')).toBeNull()
  })

  it('localizes the unknown current app label for the device summary', () => {
    renderDevicePanel()

    expect(screen.getByText('当前应用: 未知')).toBeTruthy()
    expect(screen.queryByText('当前应用: Unknown')).toBeNull()
  })

  it('keeps toolbox launch controls out of the compact device panel', () => {
    renderDevicePanel()

    expect(screen.queryByRole('button', { name: '打开工具箱' })).toBeNull()
  })

  it('launches WebUSB selection from the connect button', () => {
    const onConnectDevice = vi.fn()
    renderDevicePanel({
      actions: {
        ...createDevicePanelProps().actions,
        onConnectDevice,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '连接' }))

    expect(onConnectDevice).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
