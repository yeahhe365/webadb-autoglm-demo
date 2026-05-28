import {
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Usb,
} from 'lucide-react'
import type { AppCopy } from '../lib/appCopy'
import type { ActionProtocol } from '../lib/actionProtocol'
import type { ModelConfig } from '../lib/openAiTypes'
import { ConfigRail, type ConfigRailItem } from './ConfigRail'
import { CONFIG_TARGET_IDS, type ConfigTarget } from './configTargets'
import { DeviceHomeOptionsSection } from './DeviceHomeOptionsSection'
import { DevicePanel } from './DevicePanel'
import { DeviceToolsSection } from './DeviceToolsSection'
import type {
  DeviceControlActions,
  DeviceControlOptions,
  DeviceControlState,
} from '../lib/deviceControlTypes'
import { ModelPanel } from './ModelPanel'

export type ConfigSidebarProps = {
  copy: AppCopy
  deviceActions: DeviceControlActions
  deviceOptions: DeviceControlOptions
  deviceState: DeviceControlState
  isOpen: boolean
  memoryEnabled: boolean
  modelConfig: ModelConfig
  actionProtocol: ActionProtocol
  onActionProtocolChange: (value: ActionProtocol) => void
  onModelConfigChange: <Key extends keyof ModelConfig>(
    key: Key,
    value: ModelConfig[Key],
  ) => void
  onMemoryEnabledChange: (value: boolean) => void
  onScreenBlackoutDuringAutoControlChange: (value: boolean) => void
  onSelectTarget: (target: ConfigTarget) => void
  onStreamResponsesChange: (value: boolean) => void
  onToggleOpen: () => void
  screenBlackoutDuringAutoControl: boolean
  streamResponses: boolean
}

export function ConfigSidebar({
  copy,
  deviceActions,
  deviceOptions,
  deviceState,
  isOpen,
  memoryEnabled,
  modelConfig,
  actionProtocol,
  onActionProtocolChange,
  onModelConfigChange,
  onMemoryEnabledChange,
  onScreenBlackoutDuringAutoControlChange,
  onSelectTarget,
  onStreamResponsesChange,
  onToggleOpen,
  screenBlackoutDuringAutoControl,
  streamResponses,
}: ConfigSidebarProps) {
  const railItems: ConfigRailItem<ConfigTarget>[] = [
    { icon: Bot, label: copy.model, target: 'model' },
    { icon: Usb, label: copy.device, target: 'device' },
  ]

  return (
    <aside
      aria-label={copy.configurationPanel}
      className={
        isOpen
          ? 'panel config-panel config-panel-expanded'
          : 'panel config-panel config-panel-collapsed'
      }
    >
      <div className="config-sidebar-header">
        {isOpen ? <span className="config-sidebar-title">{copy.configurationPanel}</span> : null}
        <button
          type="button"
          className="icon-button config-sidebar-toggle"
          aria-expanded={isOpen}
          aria-label={isOpen ? copy.collapseConfigurationPanel : copy.expandConfigurationPanel}
          title={isOpen ? copy.collapseConfigurationPanel : copy.expandConfigurationPanel}
          onClick={onToggleOpen}
        >
          {isOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
      </div>

      {isOpen ? (
        <div className="config-panel-content">
          <section
            className="config-panel-group"
            id={CONFIG_TARGET_IDS.model}
            aria-label={copy.model}
          >
            <ModelPanel
              copy={copy}
              actionProtocol={actionProtocol}
              modelConfig={modelConfig}
              onActionProtocolChange={onActionProtocolChange}
              onModelConfigChange={onModelConfigChange}
              onStreamResponsesChange={onStreamResponsesChange}
              streamResponses={streamResponses}
            />
          </section>

          <DevicePanel
            actions={deviceActions}
            copy={copy}
            sectionId={CONFIG_TARGET_IDS.device}
            state={deviceState}
          />

          <DeviceToolsSection actions={deviceActions} copy={copy} state={deviceState} />

          <DeviceHomeOptionsSection
            actions={deviceActions}
            copy={copy}
            memoryEnabled={memoryEnabled}
            onMemoryEnabledChange={onMemoryEnabledChange}
            onScreenBlackoutDuringAutoControlChange={onScreenBlackoutDuringAutoControlChange}
            options={deviceOptions}
            screenBlackoutDuringAutoControl={screenBlackoutDuringAutoControl}
          />
        </div>
      ) : (
        <ConfigRail
          copy={copy}
          items={railItems}
          onSelect={onSelectTarget}
        />
      )}
    </aside>
  )
}
