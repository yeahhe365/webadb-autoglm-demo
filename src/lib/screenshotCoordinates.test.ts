import { describe, expect, it } from 'vitest'
import {
  buildScreenshotContext,
  chooseGridDivisions,
  fitDimensionsToMaxSide,
  mapActionCoordinates,
  modelScreenshotView,
} from './screenshotCoordinates'

describe('fitDimensionsToMaxSide', () => {
  it('keeps small screenshots unchanged', () => {
    expect(fitDimensionsToMaxSide({ width: 1080, height: 1920 })).toEqual({
      width: 1080,
      height: 1920,
    })
  })

  it('scales the longest side down to the model limit', () => {
    expect(fitDimensionsToMaxSide({ width: 1080, height: 2316 })).toEqual({
      width: 955,
      height: 2048,
    })
  })
})

describe('chooseGridDivisions', () => {
  it('adapts grid density to the model screenshot size', () => {
    expect(chooseGridDivisions({ width: 360, height: 720 })).toBe(6)
    expect(chooseGridDivisions({ width: 900, height: 1600 })).toBe(8)
    expect(chooseGridDivisions({ width: 955, height: 2048 })).toBe(10)
  })
})

describe('buildScreenshotContext', () => {
  it('describes the model coordinate space and native device mapping', () => {
    expect(
      buildScreenshotContext({
        modelScreen: { width: 955, height: 2048 },
        deviceScreen: { width: 1080, height: 2316 },
      }),
    ).toEqual({
      model_screen_size: '955x2048',
      device_screen_size: '1080x2316',
      coordinate_mode: 'screenshot_pixels',
      coordinate_origin: 'top_left',
      grid_divisions: 10,
      grid_labels: 'major_lines_only',
      execution_mapping: 'model_coordinates_are_mapped_back_to_device_pixels',
      resized: true,
    })
  })
})

describe('mapActionCoordinates', () => {
  const modelScreen = { width: 500, height: 1000 }
  const deviceScreen = { width: 1000, height: 2000 }

  it('maps tap coordinates from model screenshot pixels to device pixels', () => {
    expect(
      mapActionCoordinates(
        { action: 'tap', x: 250, y: 500, reason: 'open', message: 'confirm', risk: 'sensitive' },
        modelScreen,
        deviceScreen,
      ),
    ).toEqual({
      action: 'tap',
      x: 500,
      y: 1000,
      reason: 'open',
      message: 'confirm',
      risk: 'sensitive',
    })
  })

  it('maps all touch points on swipe and press actions', () => {
    expect(
      mapActionCoordinates(
        {
          action: 'swipe',
          fromX: 50,
          fromY: 100,
          toX: 450,
          toY: 900,
          durationMs: 600,
          reason: 'scroll',
        },
        modelScreen,
        deviceScreen,
      ),
    ).toEqual({
      action: 'swipe',
      fromX: 100,
      fromY: 200,
      toX: 900,
      toY: 1800,
      durationMs: 600,
      reason: 'scroll',
    })

    expect(
      mapActionCoordinates(
        { action: 'long_press', x: 125, y: 250, durationMs: 900 },
        modelScreen,
        deviceScreen,
      ),
    ).toEqual({ action: 'long_press', x: 250, y: 500, durationMs: 900 })

    expect(
      mapActionCoordinates({ action: 'double_tap', x: 400, y: 750 }, modelScreen, deviceScreen),
    ).toEqual({ action: 'double_tap', x: 800, y: 1500 })
  })

  it('leaves non-coordinate actions unchanged', () => {
    expect(
      mapActionCoordinates({ action: 'input_text', text: 'hello' }, modelScreen, deviceScreen),
    ).toEqual({ action: 'input_text', text: 'hello' })
  })
})

describe('modelScreenshotView', () => {
  it('prefers preprocessed screenshots when available', () => {
    expect(
      modelScreenshotView({
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,raw',
        screen: { width: 1000, height: 2000 },
        modelDataUrl: 'data:image/png;base64,model',
        modelScreen: { width: 500, height: 1000 },
      }),
    ).toEqual({
      dataUrl: 'data:image/png;base64,model',
      screen: { width: 500, height: 1000 },
    })
  })
})
