import { Settings2 } from 'lucide-react'
import type { AppCopy } from '../lib/appCopy'
import type { DeviceControlActions, DeviceControlOptions } from '../lib/deviceControlTypes'

export type DeviceHomeOptionsSectionProps = {
  actions: Pick<
    DeviceControlActions,
    'onConfirmSensitiveActionsChange' | 'onPreferAdbKeyboardChange' | 'onUnrestrictedModeChange'
  >
  copy: AppCopy
  memoryEnabled: boolean
  onMemoryEnabledChange: (value: boolean) => void
  onScreenBlackoutDuringAutoControlChange: (value: boolean) => void
  options: Pick<DeviceControlOptions, 'confirmSensitiveActions' | 'preferAdbKeyboard' | 'unrestrictedMode'>
  screenBlackoutDuringAutoControl: boolean
}

export function DeviceHomeOptionsSection({
  actions,
  copy,
  memoryEnabled,
  onMemoryEnabledChange,
  onScreenBlackoutDuringAutoControlChange,
  options,
  screenBlackoutDuringAutoControl,
}: DeviceHomeOptionsSectionProps) {
  return (
    <section className="config-panel-group" aria-label={copy.deviceOptions}>
      <div className="panel-title">
        <Settings2 size={18} />
        <h2>{copy.deviceOptions}</h2>
      </div>
      <div className="home-device-options-panel">
        <label className="toggle">
          <input
            type="checkbox"
            checked={options.preferAdbKeyboard}
            onChange={(event) => actions.onPreferAdbKeyboardChange(event.target.checked)}
          />
          <span>{copy.useAdbKeyboard}</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={options.confirmSensitiveActions}
            disabled={options.unrestrictedMode}
            onChange={(event) => actions.onConfirmSensitiveActionsChange(event.target.checked)}
          />
          <span>{copy.confirmSensitiveActions}</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={options.unrestrictedMode}
            onChange={(event) => actions.onUnrestrictedModeChange(event.target.checked)}
          />
          <span>{copy.unrestrictedMode}</span>
        </label>
        <label className="toggle" title={copy.memoryHelp}>
          <input
            type="checkbox"
            checked={memoryEnabled}
            onChange={(event) => onMemoryEnabledChange(event.target.checked)}
          />
          <span>{copy.memory}</span>
        </label>
        <label className="toggle" title={copy.screenBlackoutDuringAutoControlHelp}>
          <input
            type="checkbox"
            checked={screenBlackoutDuringAutoControl}
            onChange={(event) => onScreenBlackoutDuringAutoControlChange(event.target.checked)}
          />
          <span>{copy.screenBlackoutDuringAutoControl}</span>
        </label>
      </div>
    </section>
  )
}
