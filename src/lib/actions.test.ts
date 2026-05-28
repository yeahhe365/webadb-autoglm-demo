import { describe, expect, it } from 'vitest'
import { buildActionPreview } from './actionPreview'
import {
  ActionValidationError,
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

  it('parses mobilerun function style actions', () => {
    expect(parseModelAction('<answer>click_at(x=100, y=200)</answer>', screen)).toEqual({
      action: 'tap',
      x: 100,
      y: 200,
    })
    expect(parseModelAction('complete(success=False, message="没有找到目标")', screen)).toEqual({
      action: 'done',
      summary: 'Failed: 没有找到目标',
    })
  })

  it('parses mobilerun XML tool calls', () => {
    expect(
      parseModelAction(
        [
          '<function_calls>',
          '<invoke name="click_at">',
          '<parameter name="x">100</parameter>',
          '<parameter name="y">200</parameter>',
          '</invoke>',
          '</function_calls>',
        ].join(''),
        screen,
      ),
    ).toEqual({
      action: 'tap',
      x: 100,
      y: 200,
    })

    expect(
      parseModelAction(
        [
          '<function_calls>',
          '<invoke name="custom_tool">',
          '<parameter name="tool">lookup_order</parameter>',
          '<parameter name="input">{"id":"123"}</parameter>',
          '</invoke>',
          '</function_calls>',
        ].join(''),
        screen,
      ),
    ).toEqual({
      action: 'custom_tool',
      tool: 'lookup_order',
      input: { id: '123' },
    })

    expect(
      parseModelAction(
        [
          '<function_calls>',
          '<invoke name="view_screenshot">',
          '<parameter name="ref">step-7</parameter>',
          '</invoke>',
          '</function_calls>',
        ].join(''),
        screen,
      ),
    ).toEqual({
      action: 'view_screenshot',
      ref: 'step-7',
    })
  })

  it('parses multiple mobilerun XML invokes as one sequence action', () => {
    expect(
      parseModelAction(
        [
          '<function_calls>',
          '<invoke name="click_at">',
          '<parameter name="x">100</parameter>',
          '<parameter name="y">200</parameter>',
          '</invoke>',
          '<invoke name="type_text">',
          '<parameter name="text">hello</parameter>',
          '<parameter name="clear">true</parameter>',
          '</invoke>',
          '</function_calls>',
        ].join(''),
        screen,
      ),
    ).toEqual({
      action: 'sequence',
      actions: [
        { action: 'tap', x: 100, y: 200 },
        { action: 'input_text', text: 'hello', clear: true },
      ],
    })
  })

  it('normalizes Open-AutoGLM Interact and Call_API actions to takeover', () => {
    expect(parseModelAction('do(action="Interact", message="请选择联系人")', screen)).toEqual({
      action: 'take_over',
      message: '请选择联系人',
    })
    expect(parseModelAction('do(action="Call_API", instruction="总结已记录页面")', screen)).toEqual({
      action: 'take_over',
      message: 'Unsupported call_api requested: 总结已记录页面',
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
    expect(validateAction({ action: 'wait' }, screen)).toEqual({
      action: 'wait',
      ms: 1000,
    })
    expect(validateAction({ action: 'wait', duration: 1.5 }, screen)).toEqual({
      action: 'wait',
      ms: 1500,
    })
    expect(validateAction({ action: 'wait', ms: 99 }, screen)).toEqual({
      action: 'wait',
      ms: 100,
    })
    expect(validateAction({ action: 'wait', ms: 70000 }, screen)).toEqual({
      action: 'wait',
      ms: 10000,
    })
  })

  it('accepts screenshot recall actions by ref or step', () => {
    expect(validateAction({ action: 'view_screenshot', ref: '#4' }, screen)).toEqual({
      action: 'view_screenshot',
      ref: '#4',
    })
    expect(validateAction({ action: 'recall_screenshot', step: '5' }, screen)).toEqual({
      action: 'view_screenshot',
      step: 5,
    })
    expect(parseModelAction('view_screenshot(ref="step-6")', screen)).toEqual({
      action: 'view_screenshot',
      ref: 'step-6',
    })
  })

  it('rejects input text with control characters', () => {
    expect(() => validateAction({ action: 'input_text', text: 'hello\nworld' }, screen)).toThrow(
      'control characters',
    )
  })

  it('accepts clear-before-type input actions', () => {
    expect(validateAction({ action: 'input_text', text: 'hello', clear: true }, screen)).toEqual({
      action: 'input_text',
      text: 'hello',
      clear: true,
    })
    expect(parseModelAction('do(action="Type", text="hello", clear=True)', screen)).toEqual({
      action: 'input_text',
      text: 'hello',
      clear: true,
    })
  })

  it('accepts URL, clipboard, and paste actions', () => {
    expect(validateAction({ action: 'open_url', url: 'https://example.com/search?q=webdroid' })).toEqual({
      action: 'open_url',
      url: 'https://example.com/search?q=webdroid',
    })
    expect(parseModelAction('do(action="Open URL", url="myapp://detail/123")')).toEqual({
      action: 'open_url',
      url: 'myapp://detail/123',
    })
    expect(validateAction({ action: 'set_clipboard', text: '测试\nhello' })).toEqual({
      action: 'set_clipboard',
      text: '测试\nhello',
    })
    expect(validateAction({ action: 'paste' })).toEqual({ action: 'paste' })
  })

  it('rejects unsafe URL and clipboard actions', () => {
    expect(() => validateAction({ action: 'open_url', url: 'example.com' }, screen)).toThrow(
      'URI scheme',
    )
    expect(() => validateAction({ action: 'set_clipboard', text: 'bad\0text' }, screen)).toThrow(
      'null characters',
    )
  })

  it('rejects non-boolean input clear values', () => {
    expect(() =>
      validateAction({ action: 'input_text', text: 'hello', clear: 'yes' }, screen),
    ).toThrow('clear must be a boolean')
  })

  it('rejects unsupported action names', () => {
    expect(() => validateAction({ action: 'shell', command: 'rm -rf /' }, screen)).toThrow(
      'Unsupported action',
    )
  })

  it('accepts bounded sequence and repeat actions', () => {
    expect(
      validateAction(
        {
          action: 'sequence',
          actions: [
            { action: 'tap', x: 100, y: 200 },
            { action: 'input_text', text: 'hello' },
          ],
          reason: 'fill form',
        },
        screen,
      ),
    ).toEqual({
      action: 'sequence',
      actions: [
        { action: 'tap', x: 100, y: 200 },
        { action: 'input_text', text: 'hello' },
      ],
      reason: 'fill form',
    })

    expect(
      validateAction(
        {
          action: 'repeat',
          count: 3,
          actionToRepeat: { action: 'swipe', direction: 'up' },
          delay: 0.25,
        },
        screen,
      ),
    ).toEqual({
      action: 'repeat',
      count: 3,
      actionToRepeat: {
        action: 'swipe',
        fromX: 540,
        fromY: 1800,
        toX: 540,
        toY: 600,
        durationMs: 400,
      },
      delayMs: 250,
    })
  })

  it('rejects unsafe or unbounded composite actions', () => {
    expect(() =>
      validateAction({ action: 'repeat', count: 11, actionToRepeat: { action: 'back' } }, screen),
    ).toThrow('between 1 and 10')

    expect(() =>
      validateAction({
        action: 'sequence',
        actions: [{ action: 'tap', x: 100, y: 200 }, { action: 'done' }],
      }, screen),
    ).toThrow('cannot be used inside a composite action')

    expect(() =>
      validateAction({
        action: 'sequence',
        actions: [{ action: 'view_screenshot', step: 1 }],
      }, screen),
    ).toThrow('cannot be used inside a composite action')

    expect(() =>
      validateAction({
        action: 'repeat',
        count: 2,
        actionToRepeat: {
          action: 'sequence',
          actions: [{ action: 'back' }],
        },
      }, screen),
    ).toThrow('Composite actions cannot be nested')
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

  it('accepts mobilerun action aliases with screenshot pixel coordinates', () => {
    expect(validateAction({ action: 'click_at', x: 100, y: 200 }, screen)).toEqual({
      action: 'tap',
      x: 100,
      y: 200,
    })
    expect(
      validateAction({ action: 'click_area', x1: 100, y1: 200, x2: 300, y2: 400 }, screen),
    ).toEqual({
      action: 'tap',
      x: 200,
      y: 300,
    })
    expect(validateAction({ action: 'tap', coordinate: [100, 200] }, screen)).toEqual({
      action: 'tap',
      x: 100,
      y: 200,
    })
    expect(validateAction({ action: 'long_press_at', x: 100, y: 200 }, screen)).toEqual({
      action: 'long_press',
      x: 100,
      y: 200,
      durationMs: 1000,
    })
    expect(
      validateAction(
        { action: 'swipe', coordinate: [100, 200], coordinate2: [300, 400], duration: 1.5 },
        screen,
      ),
    ).toEqual({
      action: 'swipe',
      fromX: 100,
      fromY: 200,
      toX: 300,
      toY: 400,
      durationMs: 1500,
    })
    expect(
      validateAction({ action: 'swipe', coordinate: [100, 200], coordinate2: [300, 400] }, screen),
    ).toEqual({
      action: 'swipe',
      fromX: 100,
      fromY: 200,
      toX: 300,
      toY: 400,
      durationMs: 1000,
    })
    expect(validateAction({ action: 'type_text', text: 'hello', clear: true }, screen)).toEqual({
      action: 'input_text',
      text: 'hello',
      clear: true,
    })
    expect(validateAction({ action: 'type_secret', secret_id: 'gmail', clear: true }, screen)).toEqual({
      action: 'type_secret',
      secretId: 'gmail',
      clear: true,
    })
    expect(validateAction({ action: 'system_button', button: 'recent apps' }, screen)).toEqual({
      action: 'key',
      key: 'APP_SWITCH',
    })
    expect(validateAction({ action: 'open_app', text: 'Gmail' }, screen)).toEqual({
      action: 'launch',
      app: 'Gmail',
    })
    expect(validateAction({ action: 'remember', information: '账号页已打开' }, screen)).toEqual({
      action: 'note',
      message: '账号页已打开',
    })
    expect(validateAction({ action: 'complete', success: true, message: '已完成' }, screen)).toEqual(
      {
        action: 'done',
        summary: '已完成',
      },
    )
    expect(validateAction({ action: 'custom_tool', tool: 'lookup_order' }, screen)).toEqual({
      action: 'custom_tool',
      tool: 'lookup_order',
    })
    expect(validateAction({ action: 'open_url', url: 'https://example.com' }, screen)).toEqual({
      action: 'open_url',
      url: 'https://example.com',
    })
    expect(validateAction({ action: 'set_clipboard', text: 'hello' }, screen)).toEqual({
      action: 'set_clipboard',
      text: 'hello',
    })
    expect(validateAction({ action: 'paste' }, screen)).toEqual({
      action: 'paste',
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
    expect(buildActionPreview({ action: 'input_text', text: 'query', clear: true })).toBe(
      'replace text with "query"',
    )
    expect(buildActionPreview({ action: 'open_url', url: 'https://example.com' })).toBe(
      'open url https://example.com',
    )
    expect(buildActionPreview({ action: 'set_clipboard', text: 'copy me' })).toBe(
      'set clipboard "copy me"',
    )
    expect(buildActionPreview({ action: 'paste' })).toBe('paste')
    expect(
      buildActionPreview({
        action: 'sequence',
        actions: [
          { action: 'tap', x: 100, y: 200 },
          { action: 'input_text', text: 'hello' },
        ],
      }),
    ).toBe('sequence 2 action(s): tap (100, 200); input text "hello"')
    expect(
      buildActionPreview({
        action: 'repeat',
        count: 2,
        actionToRepeat: { action: 'back' },
        delayMs: 100,
      }),
    ).toBe('repeat 2x back, 100ms delay')
    expect(buildActionPreview({ action: 'take_over', message: 'captcha' })).toBe(
      'take over: captcha',
    )
    expect(buildActionPreview({ action: 'interact', message: 'choose one' })).toBe(
      'interact: choose one',
    )
    expect(buildActionPreview({ action: 'call_api', instruction: 'summarize' })).toBe(
      'call api: summarize',
    )
    expect(buildActionPreview({ action: 'view_screenshot', step: 4 })).toBe(
      'view screenshot step #4',
    )
  })
})
