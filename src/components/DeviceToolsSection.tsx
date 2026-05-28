import {
  AppWindow,
  ClipboardCheck,
  Keyboard,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { AppCopy } from '../lib/appCopy'
import type {
  DeviceControlActions,
  DeviceControlState,
} from '../lib/deviceControlTypes'
import { InstalledAppsDialog } from './InstalledAppsSection'

export type DeviceToolsSectionProps = {
  actions: DeviceControlActions
  copy: AppCopy
  state: DeviceControlState
}

export function DeviceToolsSection({ actions, copy, state }: DeviceToolsSectionProps) {
  const [installedAppsOpen, setInstalledAppsOpen] = useState(false)
  const isBusy = Boolean(state.busyTask)

  return (
    <section className="config-panel-group" aria-label={copy.tools}>
      <div className="panel-title">
        <ClipboardCheck size={18} />
        <h2>{copy.tools}</h2>
      </div>
      <div className="home-device-tool-actions">
        <button
          type="button"
          className="home-device-tool-button"
          onClick={actions.onConfigureAdbKeyboard}
          disabled={isBusy || !state.connected}
          title={
            isBusy
              ? copy.waitForCurrentRun
              : state.connected
                ? copy.configureTextInput
                : copy.noDevice
          }
        >
          <DeviceToolTitle icon={Keyboard} label={copy.configureTextInput} />
        </button>
        <button
          type="button"
          className="home-device-tool-button"
          onClick={actions.onRunDoctor}
          disabled={isBusy}
          title={isBusy ? copy.waitForCurrentRun : copy.runDoctor}
        >
          <DeviceToolTitle icon={ClipboardCheck} label={copy.runDoctor} />
        </button>
        <button
          type="button"
          className="home-device-tool-button"
          onClick={() => setInstalledAppsOpen(true)}
        >
          <DeviceToolTitle icon={AppWindow} label={copy.installedApps} />
        </button>
      </div>

      <DeviceDoctorResults copy={copy} results={state.doctorResults} />

      {installedAppsOpen ? (
        <InstalledAppsDialog
          busyTask={state.busyTask}
          connected={state.connected}
          copy={copy}
          installedApps={state.installedApps}
          onClose={() => setInstalledAppsOpen(false)}
          onLaunchInstalledApp={actions.onLaunchInstalledApp}
        />
      ) : null}
    </section>
  )
}

type DeviceToolTitleProps = {
  icon: LucideIcon
  label: string
}

function DeviceToolTitle({ icon: Icon, label }: DeviceToolTitleProps) {
  return (
    <span className="home-device-tool-title">
      <span className="home-device-tool-icon">
        <Icon size={17} />
      </span>
      <span>{label}</span>
    </span>
  )
}

type DeviceDoctorResultsProps = {
  copy: AppCopy
  results: DeviceControlState['doctorResults']
}

function DeviceDoctorResults({ copy, results }: DeviceDoctorResultsProps) {
  if (results.length === 0) {
    return null
  }

  return (
    <details className="compact-section home-device-doctor-results" open>
      <summary>
        <DeviceToolTitle icon={ClipboardCheck} label={copy.doctorChecks} />
      </summary>
      <section className="doctor-results" aria-label={copy.doctorChecks}>
        <div className="doctor-check-list">
          {results.map((result) => (
            <article className={`doctor-check ${result.status}`} key={result.id}>
              <span>{result.status.toUpperCase()}</span>
              <div>
                <strong>{result.title}</strong>
                <p>{result.detail}</p>
                {result.fix ? <small>{result.fix}</small> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </details>
  )
}
