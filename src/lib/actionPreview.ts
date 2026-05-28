import type { AgentAction } from './actionTypes'

export function buildActionPreview(action: AgentAction): string {
  const suffix = action.reason ? ` - ${action.reason}` : ''

  switch (action.action) {
    case 'launch':
      return `launch ${action.app}${action.packageName ? ` (${action.packageName})` : ''}${suffix}`
    case 'tap':
      return `tap (${action.x}, ${action.y})${suffix}`
    case 'swipe':
      return `swipe (${action.fromX}, ${action.fromY}) -> (${action.toX}, ${action.toY}), ${
        action.durationMs ?? 400
      }ms${suffix}`
    case 'input_text':
      return `${action.clear ? 'replace text with' : 'input text'} "${truncate(
        action.text,
        48,
      )}"${suffix}`
    case 'type_secret':
      return `${action.clear ? 'replace text with' : 'input'} secret "${action.secretId}"${suffix}`
    case 'open_url':
      return `open url ${truncate(action.url, 80)}${suffix}`
    case 'set_clipboard':
      return `set clipboard "${truncate(action.text, 48)}"${suffix}`
    case 'paste':
      return `paste${suffix}`
    case 'key':
      return `press ${action.key}${suffix}`
    case 'back':
      return `back${suffix}`
    case 'home':
      return `home${suffix}`
    case 'long_press':
      return `long press (${action.x}, ${action.y}), ${action.durationMs}ms${suffix}`
    case 'double_tap':
      return `double tap (${action.x}, ${action.y})${suffix}`
    case 'wait':
      return `wait ${action.ms}ms${suffix}`
    case 'take_over':
      return `take over: ${action.message}${suffix}`
    case 'note':
      return `note: ${action.message}${suffix}`
    case 'interact':
      return `interact: ${action.message}${suffix}`
    case 'call_api':
      return `call api: ${action.instruction}${suffix}`
    case 'custom_tool':
      return `custom tool ${action.tool}${suffix}`
    case 'view_screenshot':
      return `view screenshot ${action.ref ?? `step #${action.step}`}${suffix}`
    case 'sequence': {
      const previews = action.actions.map((child) => buildActionPreview(child)).join('; ')
      return `sequence ${action.actions.length} action(s): ${truncate(previews, 120)}${suffix}`
    }
    case 'repeat':
      return `repeat ${action.count}x ${buildActionPreview(action.actionToRepeat)}${
        action.delayMs ? `, ${action.delayMs}ms delay` : ''
      }${suffix}`
    case 'done':
      return `done${action.summary ? `: ${action.summary}` : ''}${suffix}`
  }
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`
}
