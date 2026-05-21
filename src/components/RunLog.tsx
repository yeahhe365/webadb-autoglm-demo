import { RotateCcw, Trash2 } from 'lucide-react'
import { ScreenshotLightbox, type ScreenshotSource } from './ScreenshotLightbox'

export type LogScreenshot = ScreenshotSource

export type LogEntry = {
  id: number
  time: string
  tone: 'info' | 'ok' | 'warn' | 'error'
  title: string
  detail?: string
  screenshot?: LogScreenshot
}

export function RunLog({
  logs,
  onClear,
}: {
  logs: LogEntry[]
  onClear: () => void
}) {
  return (
    <section className="log-section">
      <div className="panel-title log-title">
        <span>
          <RotateCcw size={18} />
          <h2>Run Log</h2>
        </span>
        <button type="button" onClick={onClear} disabled={logs.length === 0}>
          <Trash2 size={16} />
          Clear
        </button>
      </div>
      <div className="log-list">
        {logs.length === 0 ? <p className="muted">No events yet</p> : null}
        {logs.map((entry) => (
          <article className={`log-entry ${entry.tone}`} key={entry.id}>
            <time>{entry.time}</time>
            <strong>{entry.title}</strong>
            {entry.detail ? <pre>{entry.detail}</pre> : null}
            {entry.screenshot ? (
              <ScreenshotLightbox
                screenshot={entry.screenshot}
                title={entry.title}
                thumbnailAlt={`Screenshot for ${entry.title}`}
                expandedAlt={`Expanded screenshot for ${entry.title}`}
                thumbnailClassName="log-screenshot-button"
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
