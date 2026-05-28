// @vitest-environment jsdom
/// <reference types="node" />

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createAgentThread } from './lib/agentThread'

const backendMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  screenshot: vi.fn(),
  getDeviceState: vi.fn(),
  getInputMethods: vi.fn(),
  getInstalledApps: vi.fn(),
  installAdbKeyboard: vi.fn(),
  enableAdbKeyboard: vi.fn(),
  startScreenBlackout: vi.fn(),
  stopScreenBlackout: vi.fn(),
  execute: vi.fn(),
  setPreferAdbKeyboard: vi.fn(),
  setTimingConfig: vi.fn(),
}))

const threadStoreMock = vi.hoisted(() => {
  const store = {
    save: vi.fn(),
    load: vi.fn(),
    loadLatest: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  }
  return {
    store,
    createIndexedDbThreadStore: vi.fn(() => store),
    createSettingsSnapshot: vi.fn(({ modelConfig, ...rest }) => ({
      ...rest,
      ...(modelConfig
        ? {
            modelConfig: {
              baseUrl: modelConfig.baseUrl,
              model: modelConfig.model,
              reasoningEffort: modelConfig.reasoningEffort,
              stream: modelConfig.stream,
            },
          }
        : {}),
    })),
  }
})

vi.mock('./adapters/webAdbBackend', () => ({
  WebAdbDeviceBackend: vi.fn(function MockWebAdbDeviceBackend() {
    return backendMock
  }),
  isWebUsbSupported: () => true,
}))

vi.mock('./lib/threadStore', () => ({
  createIndexedDbThreadStore: threadStoreMock.createIndexedDbThreadStore,
  createSettingsSnapshot: threadStoreMock.createSettingsSnapshot,
}))

function readMediaBlock(css: string, query: string) {
  const start = css.indexOf(`@media (${query}) {`)
  if (start < 0) {
    return ''
  }

  let depth = 0
  let hasOpened = false
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1
      hasOpened = true
    }
    if (css[index] === '}') {
      depth -= 1
    }
    if (hasOpened && depth === 0 && index > start) {
      return css.slice(start, index + 1)
    }
  }

  return css.slice(start)
}

function mockSystemColorScheme(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          listeners.add(listener)
        }
      }),
      removeEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          listeners.delete(listener)
        }
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const compactSectionCss = readFileSync('src/styles/compact-section.css', 'utf8')
const chatPanelCss = readFileSync('src/styles/chat-panel.css', 'utf8')
const configPanelCss = readFileSync('src/styles/config-panel.css', 'utf8')
const configRailCss = readFileSync('src/styles/config-rail.css', 'utf8')
const controlsCss = readFileSync('src/styles/controls.css', 'utf8')
const installedAppsCss = readFileSync('src/styles/installed-apps.css', 'utf8')
const layoutCss = readFileSync('src/styles/layout.css', 'utf8')
const responsiveCss = readFileSync('src/styles/responsive.css', 'utf8')
const runLogCss = readFileSync('src/styles/run-log.css', 'utf8')
const settingsDialogCss = readFileSync('src/styles/settings-dialog.css', 'utf8')
const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
  .version

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

async function settleAsyncWork() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

function connectDeviceFromPanel(buttonName: RegExp = /connect/i) {
  fireEvent.click(screen.getAllByRole('button', { name: buttonName })[0])
}

async function openInstalledAppsDialog() {
  const configPanel = document.querySelector('.config-panel') as HTMLElement
  fireEvent.click(within(configPanel).getByRole('button', { name: /installed apps/i }))
  return screen.findByRole('dialog', { name: /installed apps/i })
}

function selectSettingsTab(settingsDialog: HTMLElement, name: RegExp) {
  fireEvent.click(within(settingsDialog).getByRole('tab', { name }))
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      }),
      clear: vi.fn(() => {
        values.clear()
      }),
    }
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    })
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-system-theme')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({
          quota: 64 * 1024 * 1024,
          usage: 5 * 1024 * 1024,
        })),
      },
    })

    backendMock.connect.mockResolvedValue({
      serial: 'device-1',
      name: 'Pixel',
    })
    backendMock.screenshot.mockResolvedValue({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
    })
    backendMock.getDeviceState.mockResolvedValue({
      app: 'Chrome',
      packageName: 'com.android.chrome',
      keyboard: 'com.android.adbkeyboard/.AdbIME',
    })
    backendMock.getInputMethods.mockResolvedValue('com.android.adbkeyboard/.AdbIME')
    backendMock.getInstalledApps.mockResolvedValue([
      {
        label: 'Gmail',
        packageName: 'com.google.android.gm',
      },
      {
        label: 'Chrome',
        packageName: 'com.android.chrome',
      },
    ])
    backendMock.installAdbKeyboard.mockResolvedValue('installed')
    backendMock.enableAdbKeyboard.mockResolvedValue('enabled')
    backendMock.startScreenBlackout.mockResolvedValue('screen dimmed')
    backendMock.stopScreenBlackout.mockResolvedValue('screen restored')
    backendMock.execute.mockResolvedValue('ok')
    threadStoreMock.store.save.mockResolvedValue(undefined)
    threadStoreMock.store.load.mockResolvedValue(null)
    threadStoreMock.store.loadLatest.mockResolvedValue(null)
    threadStoreMock.store.list.mockResolvedValue([])
    threadStoreMock.store.delete.mockResolvedValue(undefined)
    threadStoreMock.store.clear.mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn<typeof fetch>(async () =>
        jsonResponse({
          stargazers_count: 123,
          forks_count: 45,
          open_issues_count: 6,
        }),
      ),
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders the WebDroid Agent logo in the topbar', () => {
    render(<App />)

    const logo = screen.getByRole('img', { name: /webdroid agent logo/i })

    expect(logo.getAttribute('src')).toBe('/webdroid-agent-logo-128.png')
  })

  it('opens and closes the tutorial panel from the topbar', async () => {
    render(<App />)

    const tutorialButton = screen.getByRole('button', { name: /open tutorial/i })
    expect(tutorialButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: /tutorial/i })).toBeNull()

    fireEvent.click(tutorialButton)

    expect(tutorialButton.getAttribute('aria-expanded')).toBe('true')
    expect(tutorialButton.getAttribute('aria-controls')).toBe('tutorial-panel')
    expect(tutorialButton.getAttribute('aria-label')).toBe('Close tutorial')
    const tutorial = await screen.findByRole('region', { name: /tutorial/i })
    expect(within(tutorial).getByText('Quick start')).toBeTruthy()
    expect(within(tutorial).getByText('Connect Android device')).toBeTruthy()
    expect(within(tutorial).getByText('FAQ')).toBeTruthy()
    expect(
      within(tutorial).getByText(/If the connection fails, run adb kill-server/),
    ).toBeTruthy()
    expect(within(tutorial).getByText('What if taps land in the wrong place?')).toBeTruthy()

    fireEvent.click(tutorialButton)

    expect(tutorialButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: /tutorial/i })).toBeNull()

    fireEvent.click(tutorialButton)

    const reopenedTutorial = await screen.findByRole('region', { name: /tutorial/i })

    fireEvent.click(within(reopenedTutorial).getByRole('button', { name: /close tutorial/i }))

    expect(screen.queryByRole('region', { name: /tutorial/i })).toBeNull()
  })

  it('closes the tutorial panel when settings opens', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /open tutorial/i }))
    expect(await screen.findByRole('region', { name: /tutorial/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    expect(screen.queryByRole('region', { name: /tutorial/i })).toBeNull()
    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeTruthy()
  })

  it('shows the app version in settings', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    const dialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(dialog, /project/i)

    expect(within(dialog).getByText('Version')).toBeTruthy()
    expect(within(dialog).getByText(packageVersion)).toBeTruthy()
  })

  it('locks background scrolling while app modal dialogs are open', async () => {
    document.body.style.overflow = 'auto'
    document.body.style.overscrollBehavior = 'auto'

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('hidden')
      expect(document.body.style.overscrollBehavior).toBe('contain')
    })

    fireEvent.click(within(settingsDialog).getByRole('button', { name: /close settings/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /settings/i })).toBeNull()
      expect(document.body.style.overflow).toBe('auto')
      expect(document.body.style.overscrollBehavior).toBe('auto')
    })
  })

  it('clears run log entries from the log section', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    expect(screen.getAllByText('New chat started').length).toBeGreaterThan(0)

    fireEvent.click(document.querySelector('.log-drawer > summary') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: /clear/i }))

    expect(screen.queryByText('New chat started')).toBeNull()
    expect(screen.getAllByText('No events yet').length).toBeGreaterThan(0)
  })

  it('scrolls the run log drawer into view when it opens', async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      render(<App />)

      fireEvent.click(document.querySelector('.log-drawer > summary') as HTMLElement)

      await waitFor(() =>
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' }),
      )
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      })
    }
  })

  it('clears run log entries from settings', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    expect(screen.getAllByText('New chat started').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /data management/i)
    fireEvent.click(within(settingsDialog).getByRole('button', { name: /clear run log/i }))

    expect(screen.queryByText('New chat started')).toBeNull()
    expect(screen.getAllByText('No events yet').length).toBeGreaterThan(0)
  })

  it('renders advanced optimization controls', () => {
    render(<App />)

    const configPanel = document.querySelector('.config-panel') as HTMLElement
    fireEvent.click(screen.getByText('Model settings'))

    expect(screen.getByLabelText(/thinking depth/i)).toBeTruthy()
    expect(screen.getByLabelText(/stream model responses/i)).toBeTruthy()
    expect(within(configPanel).getByLabelText(/use adb keyboard for text/i)).toBeTruthy()
    expect(within(configPanel).getByLabelText(/confirm sensitive actions/i)).toBeTruthy()
    expect(within(configPanel).getByLabelText(/unrestricted mode/i)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /toolbox/i })).toBeNull()
  })

  it('persists the configured model thinking depth', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Model settings'))
    fireEvent.change(screen.getByLabelText(/thinking depth/i), {
      target: { value: 'high' },
    })

    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"reasoningEffort":"high"'),
    )
  })

  it('keeps model and device connection controls in the left configuration panel', () => {
    render(<App />)

    const configPanel = document.querySelector('.config-panel')
    expect(configPanel).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Model settings')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Device')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Tools')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Enable ADB text input')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Run Doctor')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Installed apps')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Device options')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Use ADB Keyboard for text')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Confirm sensitive actions')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Unrestricted mode')).toBeTruthy()
    expect(within(configPanel as HTMLElement).queryByText('Preferences')).toBeNull()
    expect(within(configPanel as HTMLElement).getByLabelText(/memory/i)).toBeTruthy()
    expect(
      within(configPanel as HTMLElement).getByLabelText(/dim screen during auto control/i),
    ).toBeTruthy()
    expect(within(configPanel as HTMLElement).queryByText('Direct commands')).toBeNull()
    expect(screen.queryByRole('button', { name: /open toolbox/i })).toBeNull()
    expect(screen.queryByRole('dialog', { name: /toolbox/i })).toBeNull()
  })

  it('keeps the collapsed configuration rail focused on model and device only', () => {
    render(<App />)

    const configPanel = document.querySelector('.config-panel')
    expect(configPanel).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /collapse configuration panel/i }))

    expect(configPanel?.classList.contains('config-panel-collapsed')).toBe(true)
    expect(screen.queryByText('Model settings')).toBeNull()

    const rail = screen.getByRole('navigation', { name: /configuration/i })
    expect(within(rail).getByRole('button', { name: /open model/i })).toBeTruthy()
    expect(within(rail).getByRole('button', { name: /open device/i })).toBeTruthy()
    expect(within(rail).queryByRole('button', { name: /open toolbox/i })).toBeNull()
    expect(within(rail).queryByRole('button', { name: /open tools/i })).toBeNull()
  })

  it('gives the chat panel more width when the configuration panel is collapsed', () => {
    expect(layoutCss).toMatch(
      /\.workspace-config-collapsed\s*\{[\s\S]*grid-template-columns:\s*64px\s+minmax\(304px,\s*334px\)\s+minmax\(294px,\s*1fr\)/,
    )
  })

  it('does not expose the removed AutoGLM native prompt mode', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Model settings'))

    expect(screen.queryByLabelText(/prompt mode/i)).toBeNull()
    expect(screen.queryByText(/autoglm native/i)).toBeNull()
  })

  it('labels sensitive action confirmation by its full action scope', () => {
    render(<App />)

    const configPanel = document.querySelector('.config-panel') as HTMLElement
    expect(within(configPanel).getByLabelText(/confirm sensitive actions/i)).toBeTruthy()
    expect(within(configPanel).getByLabelText(/unrestricted mode/i)).toBeTruthy()
    expect(within(configPanel).queryByLabelText(/confirm sensitive taps/i)).toBeNull()
    expect(screen.queryByRole('dialog', { name: /toolbox/i })).toBeNull()
  })

  it('collapses model settings behind the current model name', () => {
    render(<App />)

    expect(screen.getByText('gpt-5.5')).toBeTruthy()
    const detailsToggle = screen.getByText('Model settings')
    const details = detailsToggle.closest('details')

    expect(details).toBeTruthy()
    expect(details?.hasAttribute('open')).toBe(false)
  })

  it('toggles API key visibility in model settings', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Model settings'))
    const apiKeyInput = screen.getByLabelText(/^api key$/i) as HTMLInputElement

    expect(apiKeyInput.type).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: /show api key/i }))

    expect(apiKeyInput.type).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: /hide api key/i }))

    expect(apiKeyInput.type).toBe('password')
  })

  it('keeps device tools directly available in the homepage configuration panel', () => {
    render(<App />)

    const configPanel = document.querySelector('.config-panel')
    expect(configPanel).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Device options')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByRole('button', { name: /enable adb text input/i })).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByRole('button', { name: /run doctor/i })).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByRole('button', { name: /installed apps/i })).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Installed apps').closest('details')).toBeNull()
    expect(within(configPanel as HTMLElement).queryByText('Direct commands')).toBeNull()
    expect(screen.queryByRole('dialog', { name: /toolbox/i })).toBeNull()
    expect(screen.queryByText('Advanced/debug')).toBeNull()
    const logDrawer = document.querySelector('.log-drawer')
    expect(logDrawer).toBeTruthy()
    expect(logDrawer?.hasAttribute('open')).toBe(false)
    expect(document.querySelector('.chat-shell')).toBeTruthy()
  })

  it('places text input and virtual keys below the screenshot preview', () => {
    render(<App />)

    const phoneColumn = document.querySelector('.phone-column') as HTMLElement
    const quickControls = document.querySelector('.device-quick-controls') as HTMLElement

    expect(phoneColumn).toBeTruthy()
    expect(phoneColumn.children[0]?.classList.contains('phone-stage')).toBe(true)
    expect(phoneColumn.children[1]).toBe(quickControls)
    expect(within(quickControls).getByLabelText(/^text$/i)).toBeTruthy()
    expect(within(quickControls).getByRole('button', { name: /run type/i })).toBeTruthy()
    expect(within(quickControls).getByRole('button', { name: /^back$/i })).toBeTruthy()
    expect(within(quickControls).getByRole('button', { name: /^home$/i })).toBeTruthy()
    expect(within(quickControls).getByRole('button', { name: /^enter$/i })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /toolbox/i })).toBeNull()
  })

  it('runs text input from the screenshot preview controls', async () => {
    render(<App />)

    await connectDeviceFromPanel()
    expect(await screen.findByText('Pixel')).toBeTruthy()

    const quickControls = document.querySelector('.device-quick-controls') as HTMLElement
    fireEvent.change(within(quickControls).getByLabelText(/^text$/i), {
      target: { value: 'hello' },
    })
    fireEvent.click(within(quickControls).getByRole('button', { name: /run type/i }))

    await waitFor(() =>
      expect(backendMock.execute).toHaveBeenCalledWith({ action: 'input_text', text: 'hello' }),
    )
  })

  it('renders homepage device tools as compact action cards', () => {
    render(<App />)

    const configPanel = document.querySelector('.config-panel') as HTMLElement

    expect(configPanel.querySelector('.home-device-tool-actions')).toBeTruthy()
    expect(configPanel.querySelectorAll('.home-device-tool-button')).toHaveLength(3)
    for (const label of [
      'Enable ADB text input',
      'Run Doctor',
    ]) {
      const option = within(configPanel).getByText(label)
      expect(option.closest('.home-device-tool-title')).toBeTruthy()
      expect(option.closest('.home-device-tool-button')).toBeTruthy()
    }
    const installedApps = within(configPanel).getByText('Installed apps')
    expect(installedApps.closest('.home-device-tool-title')).toBeTruthy()
    expect(installedApps.closest('.home-device-tool-button')).toBeTruthy()
    expect(installedApps.closest('details')).toBeNull()
    expect(screen.queryByRole('dialog', { name: /toolbox/i })).toBeNull()
  })

  it('styles collapsed sections as compact tool rows with custom affordances', () => {
    expect(compactSectionCss).toContain('.compact-section > summary::marker')
    expect(compactSectionCss).toContain('.compact-section > summary::-webkit-details-marker')
    expect(compactSectionCss).toContain('.compact-section > summary::before')
    expect(compactSectionCss).toContain('.compact-section > summary::after')
    expect(compactSectionCss).toMatch(/\.compact-section > summary:hover[\s\S]*background:/)
    expect(compactSectionCss).toMatch(/\.compact-section > summary:focus-visible[\s\S]*outline:/)
    expect(compactSectionCss).toMatch(/\.compact-section\[open\] > summary::after[\s\S]*rotate/)
    expect(compactSectionCss).toContain('.compact-section .direct-command-panel')
  })

  it('keeps persistent shell controls aligned to the 8px corner system', () => {
    expect(controlsCss).toMatch(
      /input,\s*[\r\n]+select,\s*[\r\n]+textarea\s*\{[^}]*border-radius:\s*8px/,
    )
    expect(controlsCss).toMatch(/[\r\n]button\s*\{[^}]*border-radius:\s*8px/)
    expect(controlsCss).toMatch(/\.icon-button\s*\{[\s\S]*border-radius:\s*8px/)
    expect(configPanelCss).toMatch(
      /\.config-sidebar-toggle\s*\{[\s\S]*border-radius:\s*8px/,
    )
    expect(configRailCss).toMatch(/\.config-rail-button\s*\{[\s\S]*border-radius:\s*8px/)
    expect(runLogCss).toMatch(/\.log-empty-state\s*\{[\s\S]*border-radius:\s*8px/)
    expect(settingsDialogCss).toMatch(
      /\.settings-tool-search button\s*\{[\s\S]*border-radius:\s*8px/,
    )
  })

  it('styles setting checkboxes as switch controls', () => {
    expect(controlsCss).toContain('.toggle input[type="checkbox"]')
    expect(controlsCss).toMatch(/appearance:\s*none/)
    expect(controlsCss).toMatch(/border-radius:\s*999px/)
    expect(controlsCss).toContain('input[type="checkbox"]::before')
    expect(controlsCss).toContain('input[type="checkbox"]:checked')
    expect(controlsCss).toMatch(/transform:\s*translateX\(20px\)/)
  })

  it('keeps installed-app search and launch rows usable on narrow screens', () => {
    const narrowInstalledAppsCss = readMediaBlock(installedAppsCss, 'max-width: 520px')

    expect(installedAppsCss).toContain('.installed-app-dialog-page')
    expect(installedAppsCss).toContain('.installed-app-dialog-panel')
    expect(installedAppsCss).toMatch(
      /\.installed-app-dialog-panel\s*\{[\s\S]*width:\s*min\(92vw,\s*620px\)/,
    )
    expect(installedAppsCss).toMatch(/\.search-field\s*\{[\s\S]*width:\s*100%/)
    expect(installedAppsCss).toMatch(
      /\.search-field > span:last-child\s*\{[\s\S]*width:\s*100%/,
    )
    expect(narrowInstalledAppsCss).toMatch(
      /\.installed-app-row\s*\{[\s\S]*grid-template-columns:\s*1fr/,
    )
    expect(narrowInstalledAppsCss).toMatch(/\.installed-app-row button\s*\{[\s\S]*width:\s*100%/)
    expect(installedAppsCss).toContain('.search-clear-button')
    expect(installedAppsCss).toContain('.installed-app-empty')
  })

  it('keeps action tool toggles compact and usable in settings', () => {
    expect(settingsDialogCss).toContain('.settings-tool-availability')
    expect(settingsDialogCss).toContain('.settings-tool-summary')
    expect(settingsDialogCss).toContain('.settings-tool-search')
    expect(settingsDialogCss).toContain('.settings-tool-filters')
    expect(settingsDialogCss).toContain('.settings-tool-list')
    expect(settingsDialogCss).toContain('.settings-tool-row')
    expect(settingsDialogCss).toContain('border-radius: 8px')
    expect(settingsDialogCss).toMatch(
      /\.settings-tool-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/,
    )
    const narrowSettingsCss = readMediaBlock(settingsDialogCss, 'max-width: 560px')
    expect(narrowSettingsCss).toMatch(
      /\.settings-tool-row\s*\{[\s\S]*grid-template-columns:\s*1fr/,
    )
    expect(narrowSettingsCss).toMatch(
      /\.settings-tool-summary\s*\{[\s\S]*margin-left:\s*0/,
    )
  })

  it('matches the AMC settings shell and sidebar treatment', () => {
    expect(settingsDialogCss).toMatch(
      /\.settings-panel\s*\{[\s\S]*height:\s*min\(85dvh,\s*800px\)/,
    )
    expect(settingsDialogCss).toMatch(
      /\.settings-panel\s*\{[\s\S]*width:\s*min\(90vw,\s*1120px\)/,
    )
    expect(settingsDialogCss).toMatch(
      /\.settings-sidebar\s*\{[\s\S]*flex:\s*0 0 256px/,
    )
    expect(settingsDialogCss).toMatch(
      /\.settings-tab-button\.is-active\s*\{[\s\S]*background:\s*var\(--surface-muted\)/,
    )
    expect(settingsDialogCss).not.toContain('box-shadow: inset 3px 0 0 var(--accent)')
    expect(settingsDialogCss).not.toContain('box-shadow: inset 0 -2px 0 var(--accent)')
    expect(settingsDialogCss).not.toContain(
      'border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);',
    )
    expect(settingsDialogCss).not.toContain(
      'border-left: 1px solid color-mix(in srgb, var(--border) 70%, transparent);',
    )
  })

  it('opens settings with repository stats from the top right', async () => {
    render(<App />)

    expect(screen.queryByRole('button', { name: /^about$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    expect(settingsDialog).toBeTruthy()
    expect((within(settingsDialog).getByLabelText(/max steps/i) as HTMLInputElement).value).toBe('50')
    expect(within(settingsDialog).queryByLabelText(/memory/i)).toBeNull()
    expect(within(settingsDialog).queryByLabelText(/dim screen during auto control/i)).toBeNull()
    const configPanel = document.querySelector('.config-panel') as HTMLElement
    const screenBlackoutToggle = within(configPanel).getByLabelText(
      /dim screen during auto control/i,
    ) as HTMLInputElement
    expect(screenBlackoutToggle.checked).toBe(false)
    const memoryToggle = within(configPanel).getByLabelText(/memory/i) as HTMLInputElement
    expect(memoryToggle.checked).toBe(false)
    fireEvent.click(memoryToggle)
    expect(memoryToggle.checked).toBe(true)
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"memoryEnabled":true'),
    )
    fireEvent.click(screenBlackoutToggle)
    expect(screenBlackoutToggle.checked).toBe(true)
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"screenBlackoutDuringAutoControl":true'),
    )
    selectSettingsTab(settingsDialog, /project/i)
    expect(screen.getByRole('link', { name: /github repository/i }).getAttribute('href')).toBe(
      'https://github.com/yeahhe365/WebDroid-Agent',
    )
    expect(await screen.findByText('123')).toBeTruthy()
    expect(screen.getByText('45')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()
    selectSettingsTab(settingsDialog, /data management/i)
    expect(await screen.findByText('5 MB of 64 MB')).toBeTruthy()
    const cacheMeter = screen.getByLabelText(/local cache usage/i)
    expect(cacheMeter.getAttribute('value')).toBe(String(5 * 1024 * 1024))
    expect(cacheMeter.getAttribute('max')).toBe(String(64 * 1024 * 1024))
  })

  it('allows large max steps before displaying and persisting settings', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    const maxStepsInput = await screen.findByLabelText(/max steps/i) as HTMLInputElement
    fireEvent.change(maxStepsInput, { target: { value: '500' } })

    expect(maxStepsInput.value).toBe('500')
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"maxSteps":500'),
    )
  })

  it('persists manually disabled action tools from settings', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /resources/i)

    const tapTool = within(settingsDialog).getByLabelText(/toggle tap/i) as HTMLInputElement
    expect(tapTool.checked).toBe(true)

    fireEvent.click(tapTool)

    expect(tapTool.checked).toBe(false)
    expect(
      within(tapTool.closest('.settings-tool-row') as HTMLElement).getByText('Disabled'),
    ).toBeTruthy()
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"disabledActionTools":["tap"]'),
    )
  })

  it('shows the screenshot recall tool as a toggleable action tool', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /resources/i)

    const toolSearch = within(settingsDialog).getByLabelText(/search action tools/i)
    fireEvent.change(toolSearch, { target: { value: 'screenshot' } })

    expect(within(settingsDialog).getByText('View screenshot')).toBeTruthy()
    expect(within(settingsDialog).getByText('view_screenshot')).toBeTruthy()

    const recallTool = within(settingsDialog).getByLabelText(/toggle view screenshot/i)
    fireEvent.click(recallTool)

    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"disabledActionTools":["view_screenshot"]'),
    )
  })

  it('filters action tools by enabled and disabled state', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /resources/i)

    fireEvent.click(within(settingsDialog).getByRole('button', { name: /^disabled$/i }))
    expect(within(settingsDialog).getByText('No disabled tools.')).toBeTruthy()

    fireEvent.click(within(settingsDialog).getByRole('button', { name: /^all$/i }))
    fireEvent.click(within(settingsDialog).getByLabelText(/toggle tap/i))
    fireEvent.click(within(settingsDialog).getByRole('button', { name: /^disabled$/i }))

    expect(within(settingsDialog).getByText('Tap')).toBeTruthy()
    expect(within(settingsDialog).getByText('tap')).toBeTruthy()
    expect(within(settingsDialog).queryByText('Launch')).toBeNull()

    fireEvent.click(within(settingsDialog).getByRole('button', { name: /^enabled$/i }))

    expect(within(settingsDialog).queryByText('Tap')).toBeNull()
    expect(within(settingsDialog).getByText('Launch')).toBeTruthy()
    expect(within(settingsDialog).getByText('20/21 enabled')).toBeTruthy()
  })

  it('searches action tool toggles in settings', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /resources/i)

    const toolSearch = within(settingsDialog).getByLabelText(/search action tools/i)
    fireEvent.change(toolSearch, { target: { value: 'url' } })

    expect(within(settingsDialog).getByText('Open URL')).toBeTruthy()
    expect(within(settingsDialog).getByText('open_url')).toBeTruthy()
    expect(within(settingsDialog).queryByText('Tap')).toBeNull()

    fireEvent.change(toolSearch, { target: { value: 'zzzz' } })
    expect(within(settingsDialog).getByText('No tools match "zzzz"')).toBeTruthy()

    fireEvent.click(within(settingsDialog).getByRole('button', { name: /clear tool search/i }))
    expect((toolSearch as HTMLInputElement).value).toBe('')
    expect(within(settingsDialog).getByText('Tap')).toBeTruthy()
  })

  it('shows an unavailable local cache state when storage estimates are unsupported', async () => {
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: undefined,
    })

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /data management/i)

    expect(await screen.findByText('Unavailable in this browser')).toBeTruthy()
  })

  it('retries repository stats after settings reopen if the first request was canceled', async () => {
    let resolveFirstRequest: (value: Response) => void = () => {}
    const firstRequest = new Promise<Response>((resolve) => {
      resolveFirstRequest = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => firstRequest)
      .mockImplementation(async () =>
        jsonResponse({
          stargazers_count: 123,
          forks_count: 45,
          open_issues_count: 6,
        }),
      )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    })

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /close settings/i }))

    resolveFirstRequest(
      jsonResponse({
        stargazers_count: 999,
        forks_count: 999,
        open_issues_count: 999,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /project/i)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('123')).toBeTruthy()
    expect(screen.getByText('45')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()
  })

  it('changes and persists the theme mode from settings', async () => {
    render(<App />)

    expect(document.documentElement.dataset.theme).toBe('system')
    expect(screen.queryByRole('button', { name: /theme:/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    const themeSelect = await screen.findByLabelText(/theme/i)
    fireEvent.change(themeSelect, { target: { value: 'light' } })
    expect(document.documentElement.dataset.theme).toBe('light')

    fireEvent.change(themeSelect, { target: { value: 'dark' } })
    expect(document.documentElement.dataset.theme).toBe('dark')

    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"themeMode":"dark"'),
    )
  })

  it('tracks system dark mode only while the theme is set to system', async () => {
    mockSystemColorScheme(true)

    render(<App />)

    expect(document.documentElement.dataset.theme).toBe('system')
    expect(document.documentElement.dataset.systemTheme).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const themeSelect = await screen.findByLabelText(/theme/i)

    fireEvent.change(themeSelect, { target: { value: 'light' } })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.systemTheme).toBeUndefined()

    fireEvent.change(themeSelect, { target: { value: 'system' } })
    expect(document.documentElement.dataset.theme).toBe('system')
    expect(document.documentElement.dataset.systemTheme).toBe('dark')
  })

  it('changes and persists the app language from settings', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    const languageSelect = await screen.findByLabelText(/language/i)
    fireEvent.change(languageSelect, { target: { value: 'zh-CN' } })

    expect(screen.getByRole('button', { name: /^设置$/i })).toBeTruthy()
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'webdroid-agent-settings',
      expect.stringContaining('"languageMode":"zh-CN"'),
    )
  })

  it('does not reload the latest persisted thread when only the app language changes', async () => {
    const restoredThread = createAgentThread('Resume Wi-Fi settings', {
      id: 'restored-thread',
      now: 1000,
    })
    threadStoreMock.store.loadLatest.mockResolvedValue(restoredThread)

    render(<App />)

    const conversation = screen.getByLabelText('Conversation')
    expect(await within(conversation).findByText('Resume Wi-Fi settings')).toBeTruthy()
    await waitFor(() => expect(threadStoreMock.store.loadLatest).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const languageSelect = await screen.findByLabelText(/language/i)
    fireEvent.change(languageSelect, { target: { value: 'zh-CN' } })

    await settleAsyncWork()

    expect(threadStoreMock.store.loadLatest).toHaveBeenCalledTimes(1)
    expect(within(conversation).getByText('Resume Wi-Fi settings')).toBeTruthy()
  })

  it('localizes screenshot preview labels after changing language', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const languageSelect = await screen.findByLabelText(/language/i)
    fireEvent.change(languageSelect, { target: { value: 'zh-CN' } })
    fireEvent.click(screen.getByRole('button', { name: /^关闭设置$/i }))

    await connectDeviceFromPanel(/^连接$/i)

    expect(await screen.findByRole('button', { name: '打开截图：Android 截图' })).toBeTruthy()
  })

  it('keeps follow-up user messages in a continuous chat transcript', () => {
    render(<App />)

    expect(screen.queryByText('What can I help with?')).toBeNull()

    fireEvent.change(screen.getByLabelText(/chat message/i), {
      target: { value: 'Now open the Bluetooth page.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    const conversation = screen.getByLabelText('Conversation')
    expect(within(conversation).getByText('Now open the Bluetooth page.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))

    const emptyConversation = screen.getByLabelText('Conversation')
    expect(within(emptyConversation).queryByText('Now open the Bluetooth page.')).toBeNull()
    expect(within(emptyConversation).queryByText('What can I help with?')).toBeNull()
  })

  it('restores the latest persisted thread on startup', async () => {
    const restoredThread = createAgentThread('Resume Bluetooth settings', {
      id: 'restored-thread',
      now: 1000,
    })
    restoredThread.currentApp = 'Settings'
    restoredThread.deviceState = {
      app: 'Settings',
      packageName: 'com.android.settings',
    }
    restoredThread.lastScreenshot = {
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,restored',
      screen: { width: 1080, height: 2400 },
    }
    restoredThread.deviceSnapshot = {
      currentApp: 'Settings',
      deviceState: restoredThread.deviceState,
      screenshot: restoredThread.lastScreenshot,
    }
    threadStoreMock.store.loadLatest.mockResolvedValue(restoredThread)

    render(<App />)

    const conversation = screen.getByLabelText('Conversation')

    expect(await within(conversation).findByText('Resume Bluetooth settings')).toBeTruthy()
    expect(screen.getAllByText(/Current app: Settings/i).length).toBeGreaterThan(0)
    expect(screen.getByAltText('Android screenshot').getAttribute('src')).toBe(
      'data:image/png;base64,restored',
    )
  })

  it('persists chat updates after the thread store is ready', async () => {
    render(<App />)

    await waitFor(() => expect(threadStoreMock.store.list).toHaveBeenCalled())
    expect(threadStoreMock.store.save).not.toHaveBeenCalled()
    threadStoreMock.store.save.mockClear()

    fireEvent.change(screen.getByLabelText(/chat message/i), {
      target: { value: 'Persist this follow-up.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() =>
      expect(threadStoreMock.store.save).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Persist this follow-up.' }),
          ]),
        }),
      ),
    )
  })

  it('opens history, restores a selected thread, and deletes history rows', async () => {
    const latestThread = createAgentThread('Latest task', {
      id: 'thread-latest',
      now: 2000,
    })
    const olderThread = createAgentThread('Older task', {
      id: 'thread-older',
      now: 1000,
    })
    threadStoreMock.store.loadLatest.mockResolvedValue(latestThread)
    threadStoreMock.store.list.mockResolvedValue([
      {
        id: latestThread.id,
        title: latestThread.title,
        task: latestThread.task,
        status: latestThread.status,
        createdAt: latestThread.createdAt,
        updatedAt: latestThread.updatedAt,
      },
      {
        id: olderThread.id,
        title: olderThread.title,
        task: olderThread.task,
        status: olderThread.status,
        createdAt: olderThread.createdAt,
        updatedAt: olderThread.updatedAt,
      },
    ])
    threadStoreMock.store.load.mockResolvedValue(olderThread)

    render(<App />)

    const conversation = screen.getByLabelText('Conversation')
    expect(await within(conversation).findByText('Latest task')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /open history sidebar/i }))
    expect(await screen.findByRole('complementary', { name: /history/i })).toBeTruthy()
    expect(screen.getByText('Older task')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /open chat older task/i }))

    await waitFor(() => expect(threadStoreMock.store.load).toHaveBeenCalledWith('thread-older'))
    expect(within(conversation).getByText('Older task')).toBeTruthy()
    expect(within(conversation).queryByText('Latest task')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open history sidebar/i }))
    fireEvent.click(await screen.findByRole('button', { name: /delete chat older task/i }))

    await waitFor(() => expect(threadStoreMock.store.delete).toHaveBeenCalledWith('thread-older'))
  })

  it('clears saved chat history from settings and resets the active conversation', async () => {
    const latestThread = createAgentThread('Latest task', {
      id: 'thread-latest',
      now: 2000,
    })
    const olderThread = createAgentThread('Older task', {
      id: 'thread-older',
      now: 1000,
    })
    threadStoreMock.store.loadLatest.mockResolvedValue(latestThread)
    threadStoreMock.store.list.mockResolvedValue([
      {
        id: latestThread.id,
        title: latestThread.title,
        task: latestThread.task,
        status: latestThread.status,
        createdAt: latestThread.createdAt,
        updatedAt: latestThread.updatedAt,
      },
      {
        id: olderThread.id,
        title: olderThread.title,
        task: olderThread.task,
        status: olderThread.status,
        createdAt: olderThread.createdAt,
        updatedAt: olderThread.updatedAt,
      },
    ])

    render(<App />)

    const conversation = screen.getByLabelText('Conversation')
    expect(await within(conversation).findByText('Latest task')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /open history sidebar/i }))
    expect(await screen.findByText('Older task')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    selectSettingsTab(settingsDialog, /data management/i)
    fireEvent.click(within(settingsDialog).getByRole('button', { name: /clear chat history/i }))

    await waitFor(() => expect(threadStoreMock.store.clear).toHaveBeenCalledTimes(1))
    expect(within(conversation).queryByText('Latest task')).toBeNull()
    expect(screen.queryByText('Older task')).toBeNull()
    expect(screen.getAllByText('Chat history cleared').length).toBeGreaterThan(0)
  })

  it('does not expose task template controls in the chat flow', () => {
    render(<App />)

    expect(screen.queryByLabelText(/task template/i)).toBeNull()
    expect(screen.queryByText(/choose a template/i)).toBeNull()
  })

  it('captures and displays a screenshot immediately after connecting', async () => {
    render(<App />)

    await connectDeviceFromPanel()

    expect(await screen.findByAltText('Android screenshot')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /open screenshot for android screenshot/i }))

    expect(await screen.findByRole('dialog', { name: /android screenshot/i })).toBeTruthy()
    expect(screen.getByAltText('Expanded screenshot for Android screenshot')).toBeTruthy()
  })

  it('stops the connect flow when the initial screenshot capture fails', async () => {
    backendMock.screenshot.mockRejectedValueOnce(new Error('camera offline'))

    render(<App />)

    await connectDeviceFromPanel()

    await waitFor(() => expect(screen.getAllByText('camera offline').length).toBeGreaterThan(0))
    await settleAsyncWork()
    expect(backendMock.getInstalledApps).not.toHaveBeenCalled()
  })

  it('runs device doctor checks from the homepage tools section', async () => {
    render(<App />)

    fireEvent.click(screen.getByText('Model settings'))
    fireEvent.change(screen.getByLabelText(/^api key$/i), {
      target: { value: 'secret' },
    })
    await connectDeviceFromPanel()
    expect(await screen.findByText('Pixel')).toBeTruthy()

    const configPanel = document.querySelector('.config-panel') as HTMLElement
    fireEvent.click(within(configPanel).getByRole('button', { name: /run doctor/i }))

    expect(await within(configPanel).findByText('Doctor checks')).toBeTruthy()
    const doctorChecks = within(configPanel).getByLabelText('Doctor checks')
    expect(within(doctorChecks).getByText('WebUSB')).toBeTruthy()
    expect(within(doctorChecks).getByText('Screenshot')).toBeTruthy()
    expect(within(doctorChecks).getByText('Screen size')).toBeTruthy()
    expect(within(doctorChecks).getByText('Current app')).toBeTruthy()
    expect(within(doctorChecks).getByText('ADB Keyboard')).toBeTruthy()
    expect(within(doctorChecks).getByText('Model API')).toBeTruthy()
    expect(within(doctorChecks).getByText('1080x2400')).toBeTruthy()
    expect(within(doctorChecks).getByText(/package=com\.android\.chrome/)).toBeTruthy()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    )
  })

  it('downloads, installs, and enables ADB Keyboard from the homepage tools section', async () => {
    const apkBytes = new Uint8Array([80, 75, 3, 4])
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(apkBytes))
    backendMock.getInputMethods.mockResolvedValueOnce('')

    render(<App />)

    await connectDeviceFromPanel()
    expect(await screen.findByText('Pixel')).toBeTruthy()

    const configPanel = document.querySelector('.config-panel') as HTMLElement
    fireEvent.click(within(configPanel).getByRole('button', { name: /enable adb text input/i }))

    await waitFor(() => expect(backendMock.installAdbKeyboard).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/senzhk/ADBKeyBoard/master/ADBKeyboard.apk',
    )
    expect(Array.from(backendMock.installAdbKeyboard.mock.calls[0][0])).toEqual([
      80,
      75,
      3,
      4,
    ])
    expect(backendMock.enableAdbKeyboard).toHaveBeenCalled()
    expect((await screen.findAllByText('ADB text input enabled')).length).toBeGreaterThan(0)
  })

  it('refreshes the displayed screenshot after a direct device action returns', async () => {
    backendMock.screenshot
      .mockResolvedValueOnce({
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,before',
        screen: { width: 1080, height: 2400 },
      })
      .mockResolvedValueOnce({
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,after',
        screen: { width: 1080, height: 2400 },
      })

    render(<App />)

    await connectDeviceFromPanel()
    const screenshot = await screen.findByAltText('Android screenshot')
    expect(screenshot.getAttribute('src')).toBe('data:image/png;base64,before')

    const quickControls = document.querySelector('.device-quick-controls') as HTMLElement
    fireEvent.click(within(quickControls).getByRole('button', { name: /^back$/i }))

    await waitFor(() => {
      expect(screen.getByAltText('Android screenshot').getAttribute('src')).toBe(
        'data:image/png;base64,after',
      )
    })
  })

  it('runs tap actions generated by clicking the live screenshot', async () => {
    render(<App />)

    await connectDeviceFromPanel()
    expect(await screen.findByAltText('Android screenshot')).toBeTruthy()

    const layer = screen.getByLabelText('Screenshot interaction layer')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
      bottom: 620,
      height: 600,
      left: 10,
      right: 280,
      top: 20,
      width: 270,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(layer, { clientX: 145, clientY: 320 })
    fireEvent.mouseUp(layer, { clientX: 145, clientY: 320 })
    fireEvent.click(screen.getByRole('button', { name: 'Run generated action' }))

    await waitFor(() =>
      expect(backendMock.execute).toHaveBeenCalledWith({ action: 'tap', x: 540, y: 1200 }),
    )
  })

  it('maps screenshot-generated actions from model pixels back to device pixels', async () => {
    backendMock.screenshot.mockResolvedValueOnce({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,raw',
      screen: { width: 1080, height: 2400 },
      modelDataUrl: 'data:image/png;base64,model',
      modelScreen: { width: 540, height: 1200 },
    })

    render(<App />)

    await connectDeviceFromPanel()
    expect((await screen.findByAltText('Android screenshot')).getAttribute('src')).toBe(
      'data:image/png;base64,model',
    )

    const layer = screen.getByLabelText('Screenshot interaction layer')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
      bottom: 620,
      height: 600,
      left: 10,
      right: 280,
      top: 20,
      width: 270,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(layer, { clientX: 145, clientY: 320 })
    fireEvent.mouseUp(layer, { clientX: 145, clientY: 320 })
    fireEvent.click(screen.getByRole('button', { name: 'Run generated action' }))

    await waitFor(() => {
      expect(backendMock.execute).toHaveBeenCalledWith({ action: 'tap', x: 540, y: 1200 })
    })
  })

  it('searches installed apps and launches the selected package', async () => {
    render(<App />)

    await connectDeviceFromPanel()
    expect(await screen.findByText('Pixel')).toBeTruthy()

    const installedAppsDialog = await openInstalledAppsDialog()
    const appSearch = await within(installedAppsDialog).findByLabelText(/app search/i)
    fireEvent.change(appSearch, { target: { value: 'gm' } })

    expect(within(installedAppsDialog).getByText('Gmail')).toBeTruthy()
    expect(within(installedAppsDialog).getByText('com.google.android.gm')).toBeTruthy()
    expect(within(installedAppsDialog).queryByText('Chrome')).toBeNull()

    fireEvent.click(within(installedAppsDialog).getByRole('button', { name: /launch gmail/i }))

    await waitFor(() =>
      expect(backendMock.execute).toHaveBeenCalledWith({
        action: 'launch',
        app: 'Gmail',
        packageName: 'com.google.android.gm',
      }),
    )
  })

  it('shows a clear no-match state for installed app search', async () => {
    render(<App />)

    await connectDeviceFromPanel()
    expect(await screen.findByText('Pixel')).toBeTruthy()

    const installedAppsDialog = await openInstalledAppsDialog()
    const appSearch = await within(installedAppsDialog).findByLabelText(/app search/i)
    fireEvent.change(appSearch, { target: { value: 'maps' } })

    expect(within(installedAppsDialog).getByText('No apps match "maps"')).toBeTruthy()
    expect(within(installedAppsDialog).queryByText('Gmail')).toBeNull()
    expect(within(installedAppsDialog).queryByText('Chrome')).toBeNull()

    fireEvent.click(within(installedAppsDialog).getByRole('button', { name: /clear app search/i }))

    expect((appSearch as HTMLInputElement).value).toBe('')
    expect(within(installedAppsDialog).getByText('Gmail')).toBeTruthy()
    expect(within(installedAppsDialog).getByText('Chrome')).toBeTruthy()
    expect(within(installedAppsDialog).queryByRole('button', { name: /clear app search/i })).toBeNull()
  })

  it('searches installed apps by known display names when Android labels are missing', async () => {
    backendMock.getInstalledApps.mockResolvedValue([
      {
        label: 'null icon=0x0 banner=0x0',
        packageName: 'com.android.mms',
      },
      {
        label: 'null icon=0x7f0804b7 banner=0x0',
        packageName: 'com.android.contacts',
      },
      {
        label: 'Chrome',
        packageName: 'com.android.chrome',
      },
    ])

    render(<App />)

    await connectDeviceFromPanel()
    expect(await screen.findByText('Pixel')).toBeTruthy()

    const installedAppsDialog = await openInstalledAppsDialog()
    const appSearch = await within(installedAppsDialog).findByLabelText(/app search/i)
    fireEvent.change(appSearch, { target: { value: '短信' } })

    expect(within(installedAppsDialog).getByText('短信')).toBeTruthy()
    expect(within(installedAppsDialog).getByText('com.android.mms')).toBeTruthy()
    expect(within(installedAppsDialog).queryByText(/null icon=/)).toBeNull()
    expect(within(installedAppsDialog).queryByText('Chrome')).toBeNull()

    fireEvent.click(within(installedAppsDialog).getByRole('button', { name: /launch 短信/i }))

    await waitFor(() =>
      expect(backendMock.execute).toHaveBeenCalledWith({
        action: 'launch',
        app: '短信',
        packageName: 'com.android.mms',
      }),
    )
  })

  it('collapses connected device details behind the device name', async () => {
    render(<App />)

    await connectDeviceFromPanel()

    expect(await screen.findByText('Pixel')).toBeTruthy()
    const detailsToggle = await screen.findByText('Device details')
    const details = detailsToggle.closest('details')

    expect(details).toBeTruthy()
    expect(details?.hasAttribute('open')).toBe(false)
  })

  it('keeps the top bar horizontal at tablet-width viewports', () => {
    const tabletBreakpoint = readMediaBlock(responsiveCss, 'max-width: 1160px')

    expect(tabletBreakpoint).not.toMatch(/\.topbar\s*\{[\s\S]*?flex-direction:\s*column/)
  })

  it('keeps the empty mobile chat compact enough to reveal the device preview', () => {
    const mobileBreakpoint = readMediaBlock(responsiveCss, 'max-width: 620px')
    const narrowBreakpoint = readMediaBlock(responsiveCss, 'max-width: 360px')

    expect(chatPanelCss).toMatch(/\.chat-empty-icon\s*\{[\s\S]*border-radius:\s*8px/)
    expect(mobileBreakpoint).toMatch(
      /\.chat-shell:has\(\.chat-empty-state\)\s*\{[\s\S]*min-height:\s*clamp\(390px,\s*54dvh,\s*500px\)/,
    )
    expect(mobileBreakpoint).toMatch(
      /\.chat-stream:has\(\.chat-empty-state\)\s*\{[\s\S]*padding-bottom:\s*94px/,
    )
    expect(narrowBreakpoint).toMatch(/\.chat-empty-state\s*\{[\s\S]*transform:\s*none/)
    expect(narrowBreakpoint).toMatch(/\.chat-empty-icon\s*\{[\s\S]*border-radius:\s*8px/)
    expect(narrowBreakpoint).toMatch(/\.chat-empty-icon\s*\{[\s\S]*height:\s*42px/)
  })

  it('lets the configuration panel use normal page scrolling in single-column layouts', () => {
    const singleColumnBreakpoint = readMediaBlock(responsiveCss, 'max-width: 900px')

    expect(singleColumnBreakpoint).toMatch(
      /\.config-panel-expanded\s*\{[\s\S]*max-height:\s*none/,
    )
    expect(singleColumnBreakpoint).toMatch(
      /\.config-panel-expanded\s*\{[\s\S]*overflow:\s*visible/,
    )
    expect(singleColumnBreakpoint).toMatch(
      /\.config-panel-expanded \.config-sidebar-header\s*\{[\s\S]*position:\s*static/,
    )
  })

  it('uses an AMC-style horizontal settings nav on narrow screens', () => {
    const mobileSettingsCss = readMediaBlock(settingsDialogCss, 'max-width: 760px')
    const narrowSettingsCss = readMediaBlock(settingsDialogCss, 'max-width: 560px')

    expect(mobileSettingsCss).toMatch(
      /\.settings-panel\s*\{[\s\S]*flex-direction:\s*column/,
    )
    expect(mobileSettingsCss).toMatch(
      /\.settings-nav\s*\{[\s\S]*flex-direction:\s*row/,
    )
    expect(mobileSettingsCss).toMatch(/\.settings-nav\s*\{[\s\S]*overflow-x:\s*auto/)
    expect(mobileSettingsCss).toMatch(/\.settings-tab-button\s*\{[\s\S]*width:\s*auto/)
    expect(narrowSettingsCss).not.toMatch(/\.settings-nav\s*\{[\s\S]*display:\s*grid/)
    expect(narrowSettingsCss).not.toContain('grid-template-columns: repeat(4')
    expect(narrowSettingsCss).not.toMatch(/\.settings-nav-group\s*\{[\s\S]*display:\s*contents/)
  })

  it('keeps project repository stats compact on narrow settings screens', () => {
    const narrowSettingsCss = readMediaBlock(settingsDialogCss, 'max-width: 560px')

    expect(narrowSettingsCss).toMatch(
      /\.repository-stats\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    )
    expect(narrowSettingsCss).toMatch(/\.repository-stats div\s*\{[\s\S]*text-align:\s*center/)
    expect(narrowSettingsCss).toMatch(/\.repository-stats strong\s*\{[\s\S]*font-size:\s*21px/)
  })

  it('gives resource JSON editors more reading room on narrow settings screens', () => {
    const narrowSettingsCss = readMediaBlock(settingsDialogCss, 'max-width: 560px')

    expect(narrowSettingsCss).toMatch(
      /\.settings-resource-management textarea\s*\{[\s\S]*min-height:\s*210px/,
    )
  })

  it('keeps settings tab accessible names free of compact-label duplication', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    const tabs = within(settingsDialog).getAllByRole('tab')

    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Preferences',
      'Resources',
      'Data management',
      'Project',
    ])
    expect(within(settingsDialog).getByRole('tab', { name: 'Preferences' })).toBeTruthy()
    expect(within(settingsDialog).queryByRole('tab', { name: /preferences.*prefs/i })).toBeNull()
    expect(within(settingsDialog).queryByRole('tab', { name: /data management.*data/i })).toBeNull()
  })

  it('does not show the connection idle status in the top bar', () => {
    render(<App />)

    expect(screen.queryByText('idle')).toBeNull()
  })

  it('does not show the browser-based agent eyebrow in the top bar', () => {
    render(<App />)

    expect(screen.queryByText(/browser-based android agent/i)).toBeNull()
  })

  it('shows a black phone preview before ADB is connected', () => {
    const { container } = render(<App />)

    expect(container.querySelector('.phone-stage')).toBeTruthy()
    expect(container.querySelector('.phone-frame')).toBeTruthy()
    expect(container.querySelector('.phone-screen-placeholder')).toBeTruthy()
  })
})
