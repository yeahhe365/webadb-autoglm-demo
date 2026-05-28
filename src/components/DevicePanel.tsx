import {
  Cable,
  Camera,
  Usb,
  Unplug,
} from 'lucide-react'
import type { AppCopy } from '../lib/appCopy'
import type { DeviceControlActions, DeviceControlState } from '../lib/deviceControlTypes'
import { formatCurrentAppLabel } from './deviceDisplay'

export type DevicePanelProps = {
  copy: AppCopy
  state: DeviceControlState
  actions: DeviceControlActions
  sectionId?: string
}

export function DevicePanel({
  actions,
  copy,
  sectionId,
  state,
}: DevicePanelProps) {
  const {
    busyTask,
    connected,
    deviceInfo,
    deviceState,
    currentApp,
  } = state
  const {
    onCaptureScreen,
    onConnectDevice,
    onDisconnectDevice,
  } = actions
  const isBusy = Boolean(busyTask)
  const currentAppLabel = formatCurrentAppLabel(currentApp, copy)

  return (
    <section className="config-panel-group" id={sectionId} aria-label={copy.device}>
      <div className="panel-title">
        <Usb size={18} />
        <h2>{copy.device}</h2>
      </div>
      <div className="device-box">
        <span>{deviceInfo?.name || copy.noDevice}</span>
        {connected && deviceInfo ? (
          <details className="device-details">
            <summary>{copy.deviceDetails}</summary>
            <small>{copy.serial}: {deviceInfo.serial}</small>
            <small>{copy.currentApp}: {currentAppLabel}</small>
            {deviceState.packageName ? (
              <small>{copy.package}: {deviceState.packageName}</small>
            ) : null}
            {deviceState.activity ? <small>{copy.activity}: {deviceState.activity}</small> : null}
            {deviceState.keyboard ? <small>{copy.keyboard}: {deviceState.keyboard}</small> : null}
          </details>
        ) : (
          <>
            <small>{copy.usbDebuggingRequired}</small>
            <small>{copy.currentApp}: {currentAppLabel}</small>
          </>
        )}
      </div>
      <div className="button-row">
        <button
          type="button"
          onClick={onConnectDevice}
          disabled={isBusy || connected}
        >
          <Cable size={16} />
          {copy.connect}
        </button>
        <button type="button" onClick={onDisconnectDevice} disabled={isBusy || !connected}>
          <Unplug size={16} />
          {copy.disconnect}
        </button>
      </div>
      <button
        type="button"
        className="wide"
        onClick={onCaptureScreen}
        disabled={isBusy || !connected}
      >
        <Camera size={16} />
        {copy.capture}
      </button>
    </section>
  )
}
