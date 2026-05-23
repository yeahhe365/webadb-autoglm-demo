import {
  AlertTriangle,
  ScanEye,
  Settings as SettingsIcon,
  Usb,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ADB_KEYBOARD_APK_URL } from './adapters/deviceCommands'
import type { DeviceInfo, DeviceScreenshot, DeviceState, InstalledApp } from './adapters/deviceTypes'
import { getInstalledAppDisplayName } from './adapters/installedApps'
import { WebAdbDeviceBackend, isWebUsbSupported } from './adapters/webAdbBackend'
import { buildActionPreview } from './lib/actionPreview'
import type { AgentAction } from './lib/actionTypes'
import {
  addUserMessage,
  createAgentRunner,
  createAgentSession,
  queueUserMessage,
  recordAgentStep,
  runAgentStep,
  type AgentSession,
  type AgentStep,
} from './lib/agent'
import {
  formatDoctorResults,
  runDeviceDoctor,
  summarizeDoctorResults,
  type DoctorCheckResult,
} from './lib/deviceDoctor'
import { createOpenAiClient } from './lib/openAiClient'
import type { ModelConfig } from './lib/openAiTypes'
import {
  createIndexedDbThreadStore,
  createSettingsSnapshot,
} from './lib/threadStore'
import { APP_COPY, resolveLocale } from './lib/appCopy'
import { useBusyTask } from './hooks/useBusyTask'
import { useDeviceBackendPreferences } from './hooks/useDeviceBackendPreferences'
import { useDocumentPreferences } from './hooks/useDocumentPreferences'
import { usePersistedSettings } from './hooks/usePersistedSettings'
import { useRepositoryStats } from './hooks/useRepositoryStats'
import { useRunLog } from './hooks/useRunLog'
import { modelScreenshotView } from './lib/screenshotCoordinates'
import { loadSettings, type AppSettings } from './lib/settings'
import { TASK_TEMPLATES } from './lib/taskTemplates'
import { createDefaultActionToolRegistry } from './lib/toolRegistry'
import {
  buildAgentStepTimeline,
  formatAgentStepDetail,
  formatScreenCaptureDetail,
  toLogScreenshot,
} from './lib/runLogEntries'
import { DevicePanel } from './components/DevicePanel'
import { ModelPanel } from './components/ModelPanel'
import { PhoneStage } from './components/PhoneStage'
import { RunLog } from './components/RunLog'
import { RunPanel } from './components/RunPanel'
import { SettingsDialog } from './components/SettingsDialog'

type DeviceSnapshotUpdate = {
  currentApp: string
  deviceState: DeviceState
  screenshot: DeviceScreenshot
}

function App() {
  const abortRef = useRef<AbortController | null>(null)
  const settings = useMemo(() => loadSettings(), [])
  const initialSession = useMemo(() => {
    const session = createAgentSession(settings.task)
    session.settingsSnapshot = createSettingsSnapshot(settings)
    return session
  }, [settings])
  const sessionRef = useRef<AgentSession>(initialSession)
  const [conversation, setConversation] = useState(() => [...initialSession.messages])
  const [backend] = useState(() => new WebAdbDeviceBackend())
  const client = useMemo(() => createOpenAiClient(), [])
  const actionToolRegistry = useMemo(() => createDefaultActionToolRegistry(), [])
  const threadStore = useMemo(() => createIndexedDbThreadStore(), [])
  const [threadStoreReady, setThreadStoreReady] = useState(false)
  const [modelConfig, setModelConfig] = useState<ModelConfig>(settings.modelConfig)
  const [task, setTask] = useState(settings.task)
  const [chatInput, setChatInput] = useState('')
  const [maxSteps, setMaxSteps] = useState(settings.maxSteps)
  const [autoExecute, setAutoExecute] = useState(settings.autoExecute)
  const [preferAdbKeyboard, setPreferAdbKeyboard] = useState(settings.preferAdbKeyboard)
  const [confirmSensitiveActions, setConfirmSensitiveActions] = useState(
    settings.confirmSensitiveActions,
  )
  const [streamResponses, setStreamResponses] = useState(settings.streamResponses)
  const [actionSettleMs, setActionSettleMs] = useState(settings.actionSettleMs)
  const [doubleTapIntervalMs, setDoubleTapIntervalMs] = useState(settings.doubleTapIntervalMs)
  const [keyboardStepMs, setKeyboardStepMs] = useState(settings.keyboardStepMs)
  const [themeMode, setThemeMode] = useState(settings.themeMode)
  const [languageMode, setLanguageMode] = useState(settings.languageMode)
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [currentApp, setCurrentApp] = useState<string>('Unknown')
  const [deviceState, setDeviceState] = useState<DeviceState>({ app: 'Unknown' })
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [doctorResults, setDoctorResults] = useState<DoctorCheckResult[]>([])
  const [screenshot, setScreenshot] = useState<DeviceScreenshot | null>(null)
  const [pendingStep, setPendingStep] = useState<AgentStep | null>(null)
  const { logs, addLog, clearLogs } = useRunLog()
  const { busyTask, error, runTask, setError } = useBusyTask(({ label, message }) => {
    addLog({ tone: 'error', title: label, detail: message })
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { repositoryStats, repositoryStatsStatus } = useRepositoryStats(settingsOpen)

  const connected = deviceInfo !== null
  const hasModelConfig = Boolean(modelConfig.baseUrl && modelConfig.apiKey && modelConfig.model)
  const hasConversation = conversation.some((message) => message.role === 'user')
  const canRun = connected && !busyTask && hasModelConfig && hasConversation
  const displayedScreenshot = screenshot ? modelScreenshotView(screenshot) : null
  const activeLocale = useMemo(() => resolveLocale(languageMode), [languageMode])
  const copy = APP_COPY[activeLocale]
  const taskTemplates = TASK_TEMPLATES[activeLocale]
  const currentSettings = useMemo<AppSettings>(
    () => ({
      modelConfig,
      task,
      maxSteps,
      autoExecute,
      preferAdbKeyboard,
      confirmSensitiveActions,
      streamResponses,
      actionSettleMs,
      doubleTapIntervalMs,
      keyboardStepMs,
      themeMode,
      languageMode,
    }),
    [
      actionSettleMs,
      autoExecute,
      confirmSensitiveActions,
      doubleTapIntervalMs,
      keyboardStepMs,
      languageMode,
      maxSteps,
      modelConfig,
      preferAdbKeyboard,
      streamResponses,
      task,
      themeMode,
    ],
  )
  useDocumentPreferences(themeMode, activeLocale)
  useDeviceBackendPreferences(backend, {
    actionSettleMs,
    doubleTapIntervalMs,
    keyboardStepMs,
    preferAdbKeyboard,
  })
  usePersistedSettings(currentSettings)

  useEffect(() => {
    let cancelled = false

    void threadStore
      .loadLatest()
      .then((restoredThread) => {
        if (cancelled || !restoredThread) {
          return
        }

        sessionRef.current = restoredThread
        applySessionState(restoredThread)
        addLog({
          tone: 'info',
          title: 'Agent context restored',
          detail: restoredThread.title,
          screenshot: toLogScreenshot(
            restoredThread.lastScreenshot ?? restoredThread.deviceSnapshot?.screenshot,
          ),
        })
      })
      .catch((caught) => {
        if (cancelled) {
          return
        }
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: 'Agent context restore skipped', detail: message })
      })
      .finally(() => {
        if (!cancelled) {
          setThreadStoreReady(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [addLog, threadStore])

  useEffect(() => {
    if (!threadStoreReady) {
      return
    }
    sessionRef.current.settingsSnapshot = createSettingsSnapshot(currentSettings)
    void threadStore.save(sessionRef.current)
  }, [currentSettings, threadStore, threadStoreReady])

  function updateConfig<Key extends keyof ModelConfig>(key: Key, value: ModelConfig[Key]) {
    setModelConfig((current) => {
      return { ...current, [key]: value }
    })
  }

  function applyDeviceSnapshot({ currentApp, deviceState, screenshot }: DeviceSnapshotUpdate) {
    setScreenshot(screenshot)
    setCurrentApp(currentApp)
    setDeviceState(deviceState)
  }

  async function refreshDisplayedSnapshot() {
    const nextScreenshot = await backend.screenshot()
    const nextDeviceState = await backend.getDeviceState()
    applyDeviceSnapshot({
      screenshot: nextScreenshot,
      currentApp: nextDeviceState.app,
      deviceState: nextDeviceState,
    })
    return { screenshot: nextScreenshot, deviceState: nextDeviceState }
  }

  function logScreenCapture(nextScreenshot: DeviceScreenshot, nextDeviceState: DeviceState) {
    addLog({
      tone: 'ok',
      title: 'Screen captured',
      detail: formatScreenCaptureDetail(nextScreenshot, nextDeviceState),
      screenshot: toLogScreenshot(nextScreenshot),
    })
  }

  function ensureSession() {
    return sessionRef.current
  }

  function applySessionState(session: AgentSession) {
    setConversation([...session.messages])
    setTask(session.task)
    setCurrentApp(session.currentApp)
    setDeviceState(session.deviceState)
    setScreenshot(session.lastScreenshot ?? session.deviceSnapshot?.screenshot ?? null)
  }

  function persistSession(session = sessionRef.current) {
    if (!threadStoreReady) {
      return
    }
    session.settingsSnapshot = createSettingsSnapshot(currentSettings)
    void threadStore.save(session)
  }

  function syncConversation() {
    applySessionState(sessionRef.current)
    persistSession()
  }

  function resetSession() {
    sessionRef.current = createAgentSession(task)
    sessionRef.current.settingsSnapshot = createSettingsSnapshot(currentSettings)
    setPendingStep(null)
    syncConversation()
    addLog({ tone: 'info', title: 'Agent context reset' })
  }

  function startNewChat() {
    sessionRef.current = createAgentSession('')
    sessionRef.current.settingsSnapshot = createSettingsSnapshot(currentSettings)
    setChatInput('')
    setPendingStep(null)
    syncConversation()
    addLog({ tone: 'info', title: 'New chat started' })
  }

  function applyTaskTemplate(prompt: string) {
    setChatInput(prompt)
  }

  function confirmSensitiveAction(message: string) {
    if (!confirmSensitiveActions) {
      return true
    }

    return window.confirm(
      [
        `${copy.sensitiveActionTitle}:`,
        '',
        message,
        '',
        copy.sensitiveActionPrompt,
      ].join('\n'),
    )
  }

  function exportRunLog() {
    const payload = {
      exportedAt: new Date().toISOString(),
      device: deviceInfo,
      currentApp,
      deviceState,
      model: {
        ...modelConfig,
        apiKey: modelConfig.apiKey ? '<redacted>' : '',
      },
      streamResponses,
      timing: {
        actionSettleMs,
        doubleTapIntervalMs,
        keyboardStepMs,
      },
      autoExecute,
      maxSteps,
      task,
      session: sessionRef.current,
      logs,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `webdroid-agent-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    addLog({ tone: 'ok', title: 'Run log exported' })
  }

  async function connectDevice() {
    await runTask('connect-device', 'Connect device', async () => {
      const info = await backend.connect()
      setDeviceInfo(info)
      addLog({ tone: 'ok', title: 'Device connected', detail: `${info.name} (${info.serial})` })
      const { screenshot: nextScreenshot, deviceState: nextDeviceState } =
        await refreshDisplayedSnapshot()
      logScreenCapture(nextScreenshot, nextDeviceState)
      await refreshInstalledApps()
    })
  }

  async function disconnectDevice() {
    await runTask('disconnect-device', 'Disconnect device', async () => {
      await backend.disconnect()
      setDeviceInfo(null)
      setCurrentApp('Unknown')
      setDeviceState({ app: 'Unknown' })
      setInstalledApps([])
      setDoctorResults([])
      setScreenshot(null)
      setPendingStep(null)
      addLog({ tone: 'info', title: 'Device disconnected' })
    })
  }

  async function captureScreen() {
    await runTask('capture-screen', 'Capture screen', async () => {
      const { screenshot: nextScreenshot, deviceState: nextDeviceState } =
        await refreshDisplayedSnapshot()
      logScreenCapture(nextScreenshot, nextDeviceState)
    })
  }

  async function refreshInstalledApps() {
    if (!backend.getInstalledApps) {
      setInstalledApps([])
      return
    }

    try {
      setInstalledApps(await backend.getInstalledApps())
    } catch {
      setInstalledApps([])
    }
  }

  async function enableAdbKeyboard() {
    await runTask('enable-adb-keyboard', 'Enable ADB Keyboard', async () => {
      const result = await backend.enableAdbKeyboard()
      setPreferAdbKeyboard(true)
      addLog({ tone: 'ok', title: 'ADB Keyboard enabled', detail: result })
    })
  }

  async function installAdbKeyboard() {
    await runTask('install-adb-keyboard', copy.installAdbKeyboard, async () => {
      if (typeof fetch !== 'function') {
        throw new Error('This browser cannot download the ADB Keyboard APK.')
      }

      const response = await fetch(ADB_KEYBOARD_APK_URL)
      if (!response.ok) {
        throw new Error(`Failed to download ADB Keyboard APK: HTTP ${response.status}.`)
      }

      const apkBytes = new Uint8Array(await response.arrayBuffer())
      const installResult = await backend.installAdbKeyboard(apkBytes)
      const enableResult = await backend.enableAdbKeyboard()
      setPreferAdbKeyboard(true)
      const nextDeviceState = await backend.getDeviceState().catch(() => null)
      if (nextDeviceState) {
        setCurrentApp(nextDeviceState.app)
        setDeviceState(nextDeviceState)
      }
      addLog({
        tone: 'ok',
        title: copy.adbKeyboardInstalled,
        detail: [installResult, enableResult].filter(Boolean).join('\n'),
      })
    })
  }

  async function runDoctor() {
    await runTask('run-doctor', copy.runDoctor, async () => {
      const results = await runDeviceDoctor({
        connected,
        device: backend,
        deviceInfo,
        fetcher: globalThis.fetch,
        isWebUsbSupported,
        modelConfig,
      })
      setDoctorResults(results)
      addLog({
        tone: results.some((result) => result.status === 'error')
          ? 'error'
          : results.some((result) => result.status === 'warn')
            ? 'warn'
            : 'ok',
        title: copy.doctorSummary,
        detail: [summarizeDoctorResults(results), formatDoctorResults(results)].join('\n\n'),
      })
    })
  }

  async function runDirectAction(action: AgentAction) {
    await runTask('direct-command', copy.directCommand, async () => {
      const result = await backend.execute(action)
      addLog({
        tone: 'ok',
        title: copy.directCommand,
        detail: [buildActionPreview(action), result].filter(Boolean).join('\n'),
      })
      await refreshDisplayedSnapshot()
    })
  }

  function launchInstalledApp(app: InstalledApp) {
    void runDirectAction({
      action: 'launch',
      app: getInstalledAppDisplayName(app),
      packageName: app.packageName,
    })
  }

  function toggleAdbKeyboard(value: boolean) {
    setPreferAdbKeyboard(value)
    backend.setPreferAdbKeyboard(value)
  }

  async function planNextStep() {
    await runTask('plan-next-step', 'Plan next action', async () => {
      const session = ensureSession()
      const step = await runAgentStep({
        device: backend,
        client,
        modelConfig: { ...modelConfig, stream: streamResponses },
        task: session.task,
        session,
        index: session.history.length + 1,
        onSnapshot: applyDeviceSnapshot,
      })
      applyDeviceSnapshot(step)
      setPendingStep(step)
      syncConversation()
      addLog({
        tone: 'info',
        title: `Step ${step.index}: ${step.preview}`,
        detail: formatAgentStepDetail(step),
        screenshot: toLogScreenshot(step.screenshot),
        timeline: buildAgentStepTimeline(step),
      })
    })
  }

  async function executePendingStep() {
    if (!pendingStep) {
      return
    }

    await runTask('execute-action', 'Execute action', async () => {
      if (pendingStep.action.action === 'done') {
        recordAgentStep(ensureSession(), pendingStep)
        addLog({ tone: 'ok', title: 'Task complete', detail: pendingStep.action.summary })
        setPendingStep(null)
        syncConversation()
        return
      }

      const result = await actionToolRegistry.execute(pendingStep.executionAction, {
        device: backend,
        confirmSensitiveAction,
      })
      recordAgentStep(ensureSession(), pendingStep, result.summary, result.success)
      addLog({
        tone: result.success ? 'ok' : 'error',
        title: result.success ? `Executed ${pendingStep.preview}` : `Failed ${pendingStep.preview}`,
        detail: result.summary,
        screenshot: toLogScreenshot(pendingStep.screenshot),
        timeline: buildAgentStepTimeline(pendingStep, result.summary),
      })
      if (!result.success) {
        setError(result.summary)
      }
      await refreshDisplayedSnapshot()
      setPendingStep(null)
      syncConversation()
    })
  }

  async function runAutoLoop() {
    const controller = new AbortController()
    abortRef.current = controller
    const session = ensureSession()

    await runTask('run-agent', 'Run agent', async () => {
      const runner = createAgentRunner({ device: backend, client, toolRegistry: actionToolRegistry })
      const result = await runner.run({
        modelConfig: { ...modelConfig, stream: streamResponses },
        task: session.task,
        autoExecute: true,
        maxSteps,
        session,
        signal: controller.signal,
        confirmSensitiveAction,
        onSnapshot: applyDeviceSnapshot,
        onStep: (step) => {
          applyDeviceSnapshot(step)
          setPendingStep(step.action.action === 'done' ? null : step)
          addLog({
            tone: 'info',
            title: `Step ${step.index}: ${step.preview}`,
            detail: formatAgentStepDetail(step),
            screenshot: toLogScreenshot(step.screenshot),
            timeline: buildAgentStepTimeline(step),
          })
          syncConversation()
        },
        onExecuted: async (step, commandResult) => {
          addLog({
            tone: 'ok',
            title: `Executed ${step.preview}`,
            detail: commandResult,
            screenshot: toLogScreenshot(step.screenshot),
            timeline: buildAgentStepTimeline(step, commandResult),
          })
          await refreshDisplayedSnapshot()
          syncConversation()
        },
      })

      if (result.status === 'done') {
        addLog({ tone: 'ok', title: 'Task complete' })
      }
      if (result.status === 'max_steps') {
        addLog({ tone: 'warn', title: 'Max steps reached', detail: `${maxSteps} steps` })
      }
      if (result.status === 'stopped') {
        addLog({ tone: 'warn', title: 'Run stopped' })
      }
      if (result.status === 'awaiting_takeover') {
        addLog({ tone: 'warn', title: 'Manual takeover requested' })
      }
      if (result.status === 'loop_guard') {
        addLog({ tone: 'warn', title: 'Loop guard stopped the run', detail: result.reason })
      }
      if (result.status !== 'awaiting_takeover') {
        setPendingStep(null)
      }
      syncConversation()
    })
  }

  async function submitChatMessage() {
    const message = chatInput.trim()
    if (!message) {
      return
    }

    setChatInput('')
    const session = ensureSession()

    if (busyTask) {
      queueUserMessage(session, message)
      syncConversation()
      addLog({ tone: 'info', title: 'User message queued', detail: message })
      return
    }

    addUserMessage(session, message)
    syncConversation()
    addLog({ tone: 'info', title: 'User message', detail: message })

    if (!connected || !hasModelConfig) {
      return
    }

    if (autoExecute) {
      await runAutoLoop()
    } else {
      await planNextStep()
    }
  }

  function stopRun() {
    abortRef.current?.abort()
    addLog({ tone: 'warn', title: 'Stop requested' })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <img
            alt="WebDroid Agent logo"
            className="app-logo"
            src="/webdroid-agent-logo.png"
          />
          <h1>WebDroid Agent</h1>
        </div>
        <div className="topbar-actions">
          <div className="status-strip">
            <span className={isWebUsbSupported() ? 'status ok' : 'status warn'}>
              <Usb size={16} />
              WebUSB {isWebUsbSupported() ? copy.webUsbReady : copy.webUsbMissing}
            </span>
            <span className="status">
              <ScanEye size={16} />
              {copy.currentApp}: {currentApp}
            </span>
          </div>
          <button type="button" className="settings-button" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={16} />
            {copy.settings}
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsDialog
          copy={copy}
          languageMode={languageMode}
          maxSteps={maxSteps}
          onClose={() => setSettingsOpen(false)}
          onLanguageModeChange={setLanguageMode}
          onMaxStepsChange={setMaxSteps}
          onThemeModeChange={setThemeMode}
          repositoryStats={repositoryStats}
          repositoryStatsStatus={repositoryStatsStatus}
          themeMode={themeMode}
        />
      ) : null}

      {error ? (
        <div className="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="workspace">
        <aside className="panel config-panel">
          <ModelPanel
            copy={copy}
            modelConfig={modelConfig}
            onModelConfigChange={updateConfig}
            onStreamResponsesChange={setStreamResponses}
            streamResponses={streamResponses}
          />

          <DevicePanel
            actionSettleMs={actionSettleMs}
            busyTask={busyTask}
            connected={connected}
            copy={copy}
            currentApp={currentApp}
            deviceInfo={deviceInfo}
            doctorResults={doctorResults}
            deviceState={deviceState}
            doubleTapIntervalMs={doubleTapIntervalMs}
            installedApps={installedApps}
            keyboardStepMs={keyboardStepMs}
            onActionSettleMsChange={setActionSettleMs}
            onCaptureScreen={captureScreen}
            onConfirmSensitiveActionsChange={setConfirmSensitiveActions}
            onConnectDevice={connectDevice}
            onDisconnectDevice={disconnectDevice}
            onDoubleTapIntervalMsChange={setDoubleTapIntervalMs}
            onEnableAdbKeyboard={enableAdbKeyboard}
            onInstallAdbKeyboard={installAdbKeyboard}
            onKeyboardStepMsChange={setKeyboardStepMs}
            onLaunchInstalledApp={launchInstalledApp}
            onPreferAdbKeyboardChange={toggleAdbKeyboard}
            onRunDirectAction={runDirectAction}
            onRunDoctor={runDoctor}
            preferAdbKeyboard={preferAdbKeyboard}
            confirmSensitiveActions={confirmSensitiveActions}
          />
        </aside>

        <PhoneStage
          copy={copy}
          displayedScreenshot={displayedScreenshot}
          onRunInteractiveAction={runDirectAction}
          pendingStep={pendingStep}
        />

        <aside className="panel run-panel">
          <RunPanel
            autoExecute={autoExecute}
            busyTask={busyTask}
            canRun={canRun}
            chatInput={chatInput}
            conversation={conversation}
            copy={copy}
            logsCount={logs.length}
            onAutoExecuteChange={setAutoExecute}
            onChatInputChange={setChatInput}
            onExecutePendingStep={executePendingStep}
            onExportRunLog={exportRunLog}
            onPlanNextStep={planNextStep}
            onResetSession={resetSession}
            onRunAutoLoop={runAutoLoop}
            onStartNewChat={startNewChat}
            onStopRun={stopRun}
            onSubmitChatMessage={submitChatMessage}
            onTaskTemplateSelect={applyTaskTemplate}
            pendingStep={pendingStep}
            taskTemplates={taskTemplates}
          />
        </aside>
      </section>

      <RunLog
        logs={logs}
        onClear={clearLogs}
        labels={{
          clear: copy.clear,
          empty: copy.noEvents,
          title: copy.runLog,
          closeScreenshotPreview: copy.closeScreenshotPreview,
          openScreenshotFor: copy.openScreenshotFor,
          screenshotDialogFor: copy.screenshotDialogFor,
          screenshotFor: (title) => `${copy.androidScreenshot}: ${title}`,
          expandedScreenshotFor: (title) => `${copy.expandedAndroidScreenshot}: ${title}`,
        }}
      />
    </main>
  )
}

export default App
