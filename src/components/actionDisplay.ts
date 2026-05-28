import {
  ArrowLeft,
  AppWindow,
  CheckCircle2,
  Clipboard,
  ClipboardPaste,
  Code2,
  Clock,
  Hand,
  Home,
  Image,
  Keyboard,
  KeyRound,
  Link,
  MousePointerClick,
  Move,
  PenLine,
  Repeat2,
  TextCursorInput,
  Touchpad,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentAction } from '../lib/actionTypes'
import type { AppCopy } from '../lib/appCopy'

const ACTION_ICONS = {
  back: ArrowLeft,
  call_api: Code2,
  custom_tool: Code2,
  done: CheckCircle2,
  double_tap: Touchpad,
  home: Home,
  input_text: TextCursorInput,
  interact: Hand,
  key: Keyboard,
  launch: AppWindow,
  long_press: Hand,
  note: PenLine,
  open_url: Link,
  paste: ClipboardPaste,
  repeat: Repeat2,
  sequence: Code2,
  set_clipboard: Clipboard,
  swipe: Move,
  take_over: Hand,
  tap: MousePointerClick,
  type_secret: KeyRound,
  view_screenshot: Image,
  wait: Clock,
} satisfies Record<AgentAction['action'], LucideIcon>

export function getActionDisplay(action: AgentAction, copy: AppCopy) {
  return {
    icon: ACTION_ICONS[action.action],
    label: copy.actionNames[action.action],
  }
}
