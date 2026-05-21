import { Maximize2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

export type ScreenshotSource = {
  dataUrl: string
  screen: {
    width: number
    height: number
  }
}

export function ScreenshotLightbox({
  screenshot,
  title,
  thumbnailAlt,
  expandedAlt,
  thumbnailClassName,
  overlayClassName = 'log-screenshot-overlay',
  modalClassName = 'screenshot-modal',
  panelClassName = 'screenshot-modal-panel',
  headerClassName = 'screenshot-modal-header',
  closeClassName = 'screenshot-modal-close',
  children,
}: {
  screenshot: ScreenshotSource
  title: string
  thumbnailAlt: string
  expandedAlt: string
  thumbnailClassName: string
  overlayClassName?: string
  modalClassName?: string
  panelClassName?: string
  headerClassName?: string
  closeClassName?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        className={thumbnailClassName}
        aria-label={`Open screenshot for ${title}`}
        onClick={() => setOpen(true)}
      >
        <img src={screenshot.dataUrl} alt={thumbnailAlt} />
        {children}
        <span className={overlayClassName}>
          <Maximize2 size={14} />
        </span>
      </button>

      {open ? (
        <div
          className={modalClassName}
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot for ${title}`}
          onClick={() => setOpen(false)}
        >
          <div className={panelClassName} onClick={(event) => event.stopPropagation()}>
            <div className={headerClassName}>
              <div>
                <strong>{title}</strong>
                <small>
                  {screenshot.screen.width}x{screenshot.screen.height}
                </small>
              </div>
              <button
                type="button"
                className={closeClassName}
                onClick={() => setOpen(false)}
                aria-label="Close screenshot preview"
              >
                <X size={16} />
              </button>
            </div>
            <img src={screenshot.dataUrl} alt={expandedAlt} />
          </div>
        </div>
      ) : null}
    </>
  )
}
