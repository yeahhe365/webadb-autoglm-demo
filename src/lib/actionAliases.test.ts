import { describe, expect, it } from 'vitest'
import {
  canonicalActionName,
  isSupportedKey,
  normalizeActionName,
  normalizeKey,
} from './actionAliases'

describe('actionAliases', () => {
  it('normalizes action names before alias lookup', () => {
    expect(normalizeActionName('Click At')).toBe('click_at')
    expect(normalizeActionName('repeat-action')).toBe('repeat_action')
  })

  it('returns canonical action names for model-specific aliases', () => {
    expect(canonicalActionName('Click At')).toBe('tap')
    expect(canonicalActionName('repeat-action')).toBe('repeat')
    expect(canonicalActionName('Open URL')).toBe('open_url')
    expect(canonicalActionName('recall screenshot')).toBe('view_screenshot')
  })

  it('normalizes supported Android key aliases', () => {
    expect(normalizeKey('recent apps')).toBe('APP_SWITCH')
    expect(normalizeKey('volume-down-button')).toBe('VOLUME_DOWN')
    expect(isSupportedKey(normalizeKey('home button'))).toBe(true)
    expect(isSupportedKey('UNKNOWN')).toBe(false)
  })
})
