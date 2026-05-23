// @vitest-environment jsdom
/// <reference types="node" />

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createAgentThread } from './lib/agentThread'
import responsiveCss from './styles/responsive.css?raw'

const backendMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  screenshot: vi.fn(),
  getDeviceState: vi.fn(),
  getInputMethods: vi.fn(),
  getInstalledApps: vi.fn(),
  installAdbKeyboard: vi.fn(),
  enableAdbKeyboard: vi.fn(),
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
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1
    }
    if (css[index] === '}') {
      depth -= 1
    }
    if (depth === 0 && index > start) {
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

async function settleAsyncWork() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
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
    backendMock.execute.mockResolvedValue('ok')
    threadStoreMock.store.save.mockResolvedValue(undefined)
    threadStoreMock.store.load.mockResolvedValue(null)
    threadStoreMock.store.loadLatest.mockResolvedValue(null)
    threadStoreMock.store.list.mockResolvedValue([])
    threadStoreMock.store.delete.mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          stargazers_count: 123,
          forks_count: 45,
          open_issues_count: 6,
        }),
      }),
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders the WebDroid Agent logo in the topbar', () => {
    render(<App />)

    const logo = screen.getByRole('img', { name: /webdroid agent logo/i })

    expect(logo.getAttribute('src')).toBe('/webdroid-agent-logo.png')
  })

  it('clears run log entries from the log section', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Run options'))
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(screen.getByText('Agent context reset')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    expect(screen.queryByText('Agent context reset')).toBeNull()
    expect(screen.getByText('No events yet')).toBeTruthy()
  })

  it('renders advanced optimization controls', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Model settings'))
    fireEvent.click(screen.getByText('Device options'))

    expect(screen.getByLabelText(/stream model responses/i)).toBeTruthy()
    expect(screen.getByLabelText(/action settle/i)).toBeTruthy()
    expect(screen.getByLabelText(/double tap interval/i)).toBeTruthy()
    expect(screen.getByLabelText(/keyboard step/i)).toBeTruthy()
  })

  it('keeps model and ADB configuration in the left configuration panel', () => {
    render(<App />)

    const configPanel = document.querySelector('.config-panel')
    expect(configPanel).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Model settings')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Device options')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Direct commands')).toBeTruthy()
    expect(within(configPanel as HTMLElement).getByText('Installed apps')).toBeTruthy()
  })

  it('does not expose the removed AutoGLM native prompt mode', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Model settings'))

    expect(screen.queryByLabelText(/prompt mode/i)).toBeNull()
    expect(screen.queryByText(/autoglm native/i)).toBeNull()
  })

  it('labels sensitive action confirmation by its full action scope', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Device options'))
    expect(screen.getByLabelText(/confirm sensitive actions/i)).toBeTruthy()
    expect(screen.queryByLabelText(/confirm sensitive taps/i)).toBeNull()
  })

  it('collapses model settings behind the current model name', () => {
    render(<App />)

    expect(screen.getByText('gpt-5.5')).toBeTruthy()
    const detailsToggle = screen.getByText('Model settings')
    const details = detailsToggle.closest('details')

    expect(details).toBeTruthy()
    expect(details?.hasAttribute('open')).toBe(false)
  })

  it('keeps low-frequency homepage sections collapsed by default', () => {
    render(<App />)

    for (const summary of ['Run options', 'Installed apps', 'Direct commands', 'Device options']) {
      const details = screen.getByText(summary).closest('details')
      expect(details).toBeTruthy()
      expect(details?.hasAttribute('open')).toBe(false)
    }
    expect(document.querySelector('.chat-shell')).toBeTruthy()
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

  it('opens settings with repository stats from the top right', async () => {
    render(<App />)

    expect(screen.queryByRole('button', { name: /^about$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    const settingsDialog = await screen.findByRole('dialog', { name: /settings/i })
    expect(settingsDialog).toBeTruthy()
    expect((within(settingsDialog).getByLabelText(/max steps/i) as HTMLInputElement).value).toBe('50')
    expect(screen.getByRole('link', { name: /github repository/i }).getAttribute('href')).toBe(
      'https://github.com/yeahhe365/WebDroid-Agent',
    )
    expect(await screen.findByText('123')).toBeTruthy()
    expect(screen.getByText('45')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()
  })

  it('retries repository stats after settings reopen if the first request was canceled', async () => {
    let resolveFirstRequest: (value: Response) => void = () => {}
    const firstRequest = new Promise<Response>((resolve) => {
      resolveFirstRequest = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          stargazers_count: 123,
          forks_count: 45,
          open_issues_count: 6,
        }),
      } as unknown as Response)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    })

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /close settings/i }))

    resolveFirstRequest({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        stargazers_count: 999,
        forks_count: 999,
        open_issues_count: 999,
      }),
    } as unknown as Response)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

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

  it('localizes screenshot preview labels after changing language', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    const languageSelect = await screen.findByLabelText(/language/i)
    fireEvent.change(languageSelect, { target: { value: 'zh-CN' } })
    fireEvent.click(screen.getByRole('button', { name: /^关闭设置$/i }))

    fireEvent.click(screen.getAllByRole('button', { name: /^连接$/i })[0])

    expect(await screen.findByRole('button', { name: '打开截图：Android 截图' })).toBeTruthy()
  })

  it('keeps follow-up user messages in a continuous chat transcript', () => {
    render(<App />)

    expect(screen.getByText('Open Settings and show the Wi-Fi page.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/chat message/i), {
      target: { value: 'Now open the Bluetooth page.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    const conversation = screen.getByLabelText('Conversation')
    expect(within(conversation).getByText('Open Settings and show the Wi-Fi page.')).toBeTruthy()
    expect(within(conversation).getByText('Now open the Bluetooth page.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))

    const emptyConversation = screen.getByLabelText('Conversation')
    expect(within(emptyConversation).queryByText('Open Settings and show the Wi-Fi page.')).toBeNull()
    expect(within(emptyConversation).queryByText('Now open the Bluetooth page.')).toBeNull()
    expect(within(emptyConversation).getByText('No messages yet')).toBeTruthy()
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

    await waitFor(() => expect(threadStoreMock.store.save).toHaveBeenCalled())
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

  it('fills the chat input from a task template without sending it', () => {
    render(<App />)

    const templateSelect = screen.getByLabelText(/task template/i)
    fireEvent.change(templateSelect, { target: { value: 'launch-app' } })

    expect((screen.getByLabelText(/chat message/i) as HTMLTextAreaElement).value).toBe(
      'Launch the app named <app name>, wait until it is fully visible, and report the current screen.',
    )
    const conversation = screen.getByLabelText('Conversation')
    expect(within(conversation).queryByText(/Launch the app named/)).toBeNull()
  })

  it('captures and displays a screenshot immediately after connecting', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])

    expect(await screen.findByAltText('Android screenshot')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /open screenshot for android screenshot/i }))

    expect(await screen.findByRole('dialog', { name: /android screenshot/i })).toBeTruthy()
    expect(screen.getByAltText('Expanded screenshot for Android screenshot')).toBeTruthy()
  })

  it('stops the connect flow when the initial screenshot capture fails', async () => {
    backendMock.screenshot.mockRejectedValueOnce(new Error('camera offline'))

    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])

    await waitFor(() => expect(screen.getAllByText('camera offline').length).toBeGreaterThan(0))
    await settleAsyncWork()
    expect(backendMock.getInstalledApps).not.toHaveBeenCalled()
  })

  it('runs device doctor checks from the device panel', async () => {
    render(<App />)

    fireEvent.click(screen.getByText('Model settings'))
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])
    expect(await screen.findByText('Pixel')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /run doctor/i }))

    expect(await screen.findByText('Doctor checks')).toBeTruthy()
    fireEvent.click(screen.getByText('Doctor checks'))
    const doctorChecks = screen.getByLabelText('Doctor checks')
    expect(within(doctorChecks).getByText('WebUSB')).toBeTruthy()
    expect(within(doctorChecks).getByText('Screenshot')).toBeTruthy()
    expect(within(doctorChecks).getByText('Screen size')).toBeTruthy()
    expect(within(doctorChecks).getByText('Current app')).toBeTruthy()
    expect(within(doctorChecks).getByText('ADB Keyboard')).toBeTruthy()
    expect(within(doctorChecks).getByText('Model API')).toBeTruthy()
    expect(within(doctorChecks).getByText('1080x2400')).toBeTruthy()
    expect(within(doctorChecks).getByText(/Chrome/)).toBeTruthy()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    )
  })

  it('downloads, installs, and enables ADB Keyboard from the device panel', async () => {
    const apkBytes = new Uint8Array([80, 75, 3, 4])
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(apkBytes.buffer),
    } as unknown as Response)

    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])
    expect(await screen.findByText('Pixel')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /install adb keyboard/i }))

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
    expect(await screen.findByText('ADB Keyboard installed')).toBeTruthy()
  })

  it('runs direct tap commands from the device panel', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])
    expect(await screen.findByText('Pixel')).toBeTruthy()

    fireEvent.click(screen.getByText('Direct commands'))
    fireEvent.change(screen.getByLabelText(/tap x/i), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText(/tap y/i), { target: { value: '340' } })
    fireEvent.click(screen.getByRole('button', { name: /run tap/i }))

    expect(backendMock.execute).toHaveBeenCalledWith({ action: 'tap', x: 120, y: 340 })
    expect(await screen.findByText('Direct command')).toBeTruthy()
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

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])
    const screenshot = await screen.findByAltText('Android screenshot')
    expect(screenshot.getAttribute('src')).toBe('data:image/png;base64,before')

    fireEvent.click(screen.getByText('Direct commands'))
    fireEvent.click(screen.getByRole('button', { name: /run tap/i }))

    await waitFor(() => {
      expect(screen.getByAltText('Android screenshot').getAttribute('src')).toBe(
        'data:image/png;base64,after',
      )
    })
  })

  it('runs tap actions generated by clicking the live screenshot', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])
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

    expect(backendMock.execute).toHaveBeenCalledWith({ action: 'tap', x: 540, y: 1200 })
  })

  it('searches installed apps and launches the selected package', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])
    expect(await screen.findByText('Pixel')).toBeTruthy()

    fireEvent.click(screen.getByText('Installed apps'))
    const appSearch = await screen.findByLabelText(/app search/i)
    fireEvent.change(appSearch, { target: { value: 'gm' } })

    expect(screen.getByText('Gmail')).toBeTruthy()
    expect(screen.getByText('com.google.android.gm')).toBeTruthy()
    expect(screen.queryByText('Chrome')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /launch gmail/i }))

    expect(backendMock.execute).toHaveBeenCalledWith({
      action: 'launch',
      app: 'Gmail',
      packageName: 'com.google.android.gm',
    })
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

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])
    expect(await screen.findByText('Pixel')).toBeTruthy()

    fireEvent.click(screen.getByText('Installed apps'))
    const appSearch = await screen.findByLabelText(/app search/i)
    fireEvent.change(appSearch, { target: { value: '短信' } })

    expect(screen.getByText('短信')).toBeTruthy()
    expect(screen.getByText('com.android.mms')).toBeTruthy()
    expect(screen.queryByText(/null icon=/)).toBeNull()
    expect(screen.queryByText('Chrome')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /launch 短信/i }))

    expect(backendMock.execute).toHaveBeenCalledWith({
      action: 'launch',
      app: '短信',
      packageName: 'com.android.mms',
    })
  })

  it('collapses connected device details behind the device name', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])

    expect(await screen.findByText('Pixel')).toBeTruthy()
    const detailsToggle = await screen.findByText('Device details')
    const details = detailsToggle.closest('details')

    expect(details).toBeTruthy()
    expect(details?.hasAttribute('open')).toBe(false)
  })

  it('keeps the top bar horizontal at tablet-width viewports', () => {
    const tabletBreakpoint = readMediaBlock(responsiveCss, 'max-width: 1120px')

    expect(tabletBreakpoint).not.toMatch(/\.topbar\s*\{[\s\S]*?flex-direction:\s*column/)
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
