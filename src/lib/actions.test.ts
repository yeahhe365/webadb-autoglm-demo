import { describe, expect, it } from 'vitest'
import {
  ActionValidationError,
  buildActionPreview,
  parseModelAction,
  validateAction,
} from './actions'

const screen = { width: 1080, height: 2400 }

describe('parseModelAction', () => {
  it('extracts a JSON object from a fenced model response', () => {
    const action = parseModelAction('```json\n{"action":"tap","x":320,"y":700,"reason":"open"}\n```')

    expect(action).toEqual({
      action: 'tap',
      x: 320,
      y: 700,
      reason: 'open',
    })
  })

  it('rejects non-JSON model responses', () => {
    expect(() => parseModelAction('tap the center of the screen')).toThrow(ActionValidationError)
  })

  it('normalizes Open-AutoGLM JSON actions with relative element coordinates', () => {
    const action = parseModelAction(
      '{"_metadata":"do","action":"Tap","element":[500,100],"thought":"press search","message":"重要操作"}',
      screen,
    )

    expect(action).toEqual({
      action: 'tap',
      x: 540,
      y: 240,
      reason: 'press search',
      message: '重要操作',
    })
  })

  it('parses Open-AutoGLM function style actions', () => {
    const action = parseModelAction('<answer>do(action="Launch", app="京东")</answer>')

    expect(action).toEqual({
      action: 'launch',
      app: '京东',
    })
  })

  it('parses Open-AutoGLM finish function style actions', () => {
    const action = parseModelAction('<think>完成了</think><answer>finish(message="已完成任务")</answer>')

    expect(action).toEqual({
      action: 'done',
      summary: '已完成任务',
    })
  })

  it('parses Open-AutoGLM Interact and Call_API actions', () => {
    expect(parseModelAction('do(action="Interact", message="请选择联系人")', screen)).toEqual({
      action: 'interact',
      message: '请选择联系人',
    })
    expect(parseModelAction('do(action="Call_API", instruction="总结已记录页面")', screen)).toEqual({
      action: 'call_api',
      instruction: '总结已记录页面',
    })
  })
})

describe('validateAction', () => {
  it('accepts tap coordinates within the screen bounds', () => {
    expect(validateAction({ action: 'tap', x: 1079, y: 2399 }, screen)).toEqual({
      action: 'tap',
      x: 1079,
      y: 2399,
    })
  })

  it('rejects tap coordinates outside the screen bounds', () => {
    expect(() => validateAction({ action: 'tap', x: 1080, y: 200 }, screen)).toThrow(
      'outside the current screen',
    )
  })

  it('normalizes wait durations to a safe range', () => {
    expect(validateAction({ action: 'wait', ms: 99 }, screen)).toEqual({
      action: 'wait',
      ms: 100,
    })
    expect(validateAction({ action: 'wait', ms: 70000 }, screen)).toEqual({
      action: 'wait',
      ms: 10000,
    })
  })

  it('rejects input text with control characters', () => {
    expect(() => validateAction({ action: 'input_text', text: 'hello\nworld' }, screen)).toThrow(
      'control characters',
    )
  })

  it('rejects unsupported action names', () => {
    expect(() => validateAction({ action: 'shell', command: 'rm -rf /' }, screen)).toThrow(
      'Unsupported action',
    )
  })

  it('preserves sensitive tap metadata for confirmation before execution', () => {
    expect(
      validateAction(
        {
          action: 'tap',
          x: 100,
          y: 200,
          message: '确认支付',
          risk: 'sensitive',
        },
        screen,
      ),
    ).toEqual({
      action: 'tap',
      x: 100,
      y: 200,
      message: '确认支付',
      risk: 'sensitive',
    })
  })

  it('supports Open-AutoGLM Launch, Type, Back, Home, Long Press, Double Tap, and Take_over', () => {
    expect(validateAction({ action: 'Launch', app: 'Settings' }, screen)).toEqual({
      action: 'launch',
      app: 'Settings',
    })
    expect(validateAction({ action: 'Type', text: 'hello' }, screen)).toEqual({
      action: 'input_text',
      text: 'hello',
    })
    expect(validateAction({ action: 'Back' }, screen)).toEqual({ action: 'back' })
    expect(validateAction({ action: 'Home' }, screen)).toEqual({ action: 'home' })
    expect(validateAction({ action: 'Long Press', element: [500, 500] }, screen)).toEqual({
      action: 'long_press',
      x: 540,
      y: 1200,
      durationMs: 800,
    })
    expect(validateAction({ action: 'Double Tap', element: [250, 750] }, screen)).toEqual({
      action: 'double_tap',
      x: 270,
      y: 1800,
    })
    expect(validateAction({ action: 'Take_over', message: 'login required' }, screen)).toEqual({
      action: 'take_over',
      message: 'login required',
    })
    expect(validateAction({ action: 'Note', message: 'record page' }, screen)).toEqual({
      action: 'note',
      message: 'record page',
    })
  })

  it('turns direction swipes into screen-relative coordinates', () => {
    expect(validateAction({ action: 'Swipe', direction: 'up' }, screen)).toEqual({
      action: 'swipe',
      fromX: 540,
      fromY: 1800,
      toX: 540,
      toY: 600,
      durationMs: 400,
    })
  })
})

describe('buildActionPreview', () => {
  it('formats actions for manual review', () => {
    const preview = buildActionPreview({
      action: 'swipe',
      fromX: 400,
      fromY: 1800,
      toX: 400,
      toY: 500,
      durationMs: 450,
      reason: 'scroll list',
    })

    expect(preview).toBe('swipe (400, 1800) -> (400, 500), 450ms - scroll list')
  })

  it('formats launch and takeover actions', () => {
    expect(buildActionPreview({ action: 'launch', app: 'Settings' })).toBe('launch Settings')
    expect(buildActionPreview({ action: 'take_over', message: 'captcha' })).toBe(
      'take over: captcha',
    )
    expect(buildActionPreview({ action: 'interact', message: 'choose one' })).toBe(
      'interact: choose one',
    )
    expect(buildActionPreview({ action: 'call_api', instruction: 'summarize' })).toBe(
      'call api: summarize',
    )
  })
})
