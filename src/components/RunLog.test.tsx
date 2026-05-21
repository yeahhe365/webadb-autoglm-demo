// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunLog, type LogEntry } from './RunLog'

afterEach(() => {
  cleanup()
})

describe('RunLog', () => {
  it('renders saved screenshot thumbnails and opens them enlarged', () => {
    const logs: LogEntry[] = [
      {
        id: 1,
        time: '10:30:00',
        tone: 'info',
        title: 'Step 1: tap (100, 200)',
        detail: 'model output',
        screenshot: {
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 955, height: 2048 },
        },
      },
    ]

    render(<RunLog logs={logs} onClear={vi.fn()} />)

    expect(screen.getByAltText('Screenshot for Step 1: tap (100, 200)').getAttribute('src')).toBe(
      'data:image/png;base64,abc123',
    )

    fireEvent.click(screen.getByRole('button', { name: /open screenshot/i }))

    expect(screen.getByRole('dialog', { name: /screenshot/i })).toBeTruthy()
    expect(
      screen.getByAltText('Expanded screenshot for Step 1: tap (100, 200)').getAttribute('src'),
    ).toBe('data:image/png;base64,abc123')
    expect(screen.getByText('955x2048')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /close screenshot/i }))

    expect(screen.queryByRole('dialog', { name: /screenshot/i })).toBeNull()
  })
})
