import type { DeviceScreenshot } from '../adapters/deviceBackend'
import type { AgentAction, ScreenSize } from './actions'

export const MODEL_SCREENSHOT_MAX_SIDE = 2048

export function fitDimensionsToMaxSide(
  screen: ScreenSize,
  maxSide = MODEL_SCREENSHOT_MAX_SIDE,
): ScreenSize {
  if (screen.width <= 0 || screen.height <= 0) {
    throw new Error('Image dimensions must be positive.')
  }

  if (Math.max(screen.width, screen.height) <= maxSide) {
    return screen
  }

  const scale = maxSide / Math.max(screen.width, screen.height)
  return {
    width: Math.max(1, Math.round(screen.width * scale)),
    height: Math.max(1, Math.round(screen.height * scale)),
  }
}

export function chooseGridDivisions(screen: ScreenSize) {
  const longestSide = Math.max(screen.width, screen.height)
  let divisions = Math.round(longestSide / 220)
  divisions = Math.max(6, Math.min(12, divisions))

  if (divisions % 2 === 1) {
    divisions = divisions === 12 ? 10 : divisions + 1
  }

  return divisions
}

export function modelScreenshotView(screenshot: DeviceScreenshot): {
  dataUrl: string
  screen: ScreenSize
} {
  return {
    dataUrl: screenshot.modelDataUrl ?? screenshot.dataUrl,
    screen: screenshot.modelScreen ?? screenshot.screen,
  }
}

export function buildScreenshotContext({
  modelScreen,
  deviceScreen,
}: {
  modelScreen: ScreenSize
  deviceScreen?: ScreenSize
}) {
  const resized =
    deviceScreen !== undefined &&
    (deviceScreen.width !== modelScreen.width || deviceScreen.height !== modelScreen.height)

  return {
    model_screen_size: `${modelScreen.width}x${modelScreen.height}`,
    ...(deviceScreen
      ? { device_screen_size: `${deviceScreen.width}x${deviceScreen.height}` }
      : {}),
    coordinate_mode: 'screenshot_pixels',
    coordinate_origin: 'top_left',
    grid_divisions: chooseGridDivisions(modelScreen),
    grid_labels: 'major_lines_only',
    execution_mapping: 'model_coordinates_are_mapped_back_to_device_pixels',
    ...(resized ? { resized: true } : {}),
  }
}

export function mapActionCoordinates(
  action: AgentAction,
  fromScreen: ScreenSize,
  toScreen: ScreenSize,
): AgentAction {
  switch (action.action) {
    case 'tap': {
      const point = mapPoint(action.x, action.y, fromScreen, toScreen)
      return { ...action, ...point }
    }
    case 'long_press': {
      const point = mapPoint(action.x, action.y, fromScreen, toScreen)
      return { ...action, ...point }
    }
    case 'double_tap': {
      const point = mapPoint(action.x, action.y, fromScreen, toScreen)
      return { ...action, ...point }
    }
    case 'swipe': {
      const from = mapPoint(action.fromX, action.fromY, fromScreen, toScreen)
      const to = mapPoint(action.toX, action.toY, fromScreen, toScreen)
      return {
        ...action,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      }
    }
    default:
      return action
  }
}

function mapPoint(x: number, y: number, fromScreen: ScreenSize, toScreen: ScreenSize) {
  return {
    x: Math.round((x / fromScreen.width) * toScreen.width),
    y: Math.round((y / fromScreen.height) * toScreen.height),
  }
}
