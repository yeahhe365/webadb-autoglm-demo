// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

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
})
