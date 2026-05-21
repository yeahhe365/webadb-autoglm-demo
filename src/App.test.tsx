// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const backendMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  screenshot: vi.fn(),
  getDeviceState: vi.fn(),
  enableAdbKeyboard: vi.fn(),
  execute: vi.fn(),
  setPreferAdbKeyboard: vi.fn(),
  setTimingConfig: vi.fn(),
}))

vi.mock('./adapters/webAdbBackend', () => ({
  WebAdbDeviceBackend: vi.fn(function MockWebAdbDeviceBackend() {
    return backendMock
  }),
  isWebUsbSupported: () => true,
}))

describe('App run log', () => {
  beforeEach(() => {
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
    })
    backendMock.enableAdbKeyboard.mockResolvedValue('enabled')
    backendMock.execute.mockResolvedValue('ok')
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('clears run log entries from the log section', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(screen.getByText('Agent context reset')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    expect(screen.queryByText('Agent context reset')).toBeNull()
    expect(screen.getByText('No events yet')).toBeTruthy()
  })

  it('renders advanced optimization controls', () => {
    render(<App />)

    expect(screen.getByLabelText(/stream model responses/i)).toBeTruthy()
    expect(screen.getByLabelText(/action settle/i)).toBeTruthy()
    expect(screen.getByLabelText(/double tap interval/i)).toBeTruthy()
    expect(screen.getByLabelText(/keyboard step/i)).toBeTruthy()
  })

  it('captures and displays a screenshot immediately after connecting', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])

    expect(await screen.findByAltText('Android screenshot')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /open screenshot for android screenshot/i }))

    expect(await screen.findByRole('dialog', { name: /android screenshot/i })).toBeTruthy()
    expect(screen.getByAltText('Expanded screenshot for Android screenshot')).toBeTruthy()
  })
})
