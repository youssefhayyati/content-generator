import { useEffect, useRef, useState } from 'react'
import { Btn, Modal } from './ui'

type Ask = {
  title: string
  /** What happens if they go ahead, in a sentence. */
  body?: string
  /** The word on the button that goes ahead. */
  action?: string
  danger?: boolean
}

let host: ((ask: Ask) => Promise<boolean>) | null = null

/**
 * Ask before doing something that can't be undone: the studio's own sheet, in place of the
 * browser's confirm(). Resolves true if they went ahead. `await confirm({ title, body, action })`.
 */
export const confirm = (ask: Ask): Promise<boolean> => (host ? host(ask) : Promise.resolve(window.confirm(ask.body ? `${ask.title}\n\n${ask.body}` : ask.title)))

/** Where confirm() shows its question. Mounted once, in the Shell. */
export function ConfirmHost() {
  const [open, setOpen] = useState(false)
  // Kept after closing, so the sheet still says what it asked while it fades out.
  const [ask, setAsk] = useState<Ask | null>(null)
  const done = useRef<((ok: boolean) => void) | null>(null)

  useEffect(() => {
    host = (a) =>
      new Promise<boolean>((resolve) => {
        done.current?.(false)
        done.current = resolve
        setAsk(a)
        setOpen(true)
      })
    return () => {
      host = null
      done.current?.(false)
    }
  }, [])

  const answer = (ok: boolean) => {
    done.current?.(ok)
    done.current = null
    setOpen(false)
  }

  return (
    <Modal open={open} onClose={() => answer(false)} title={ask?.title ?? ''}>
      {ask?.body && <p className="text-[13px] leading-relaxed text-muted">{ask.body}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="subtle" onClick={() => answer(false)}>
          Cancel
        </Btn>
        <Btn variant={ask?.danger ? 'danger' : 'primary'} autoFocus onClick={() => answer(true)}>
          {ask?.action ?? 'Continue'}
        </Btn>
      </div>
    </Modal>
  )
}
