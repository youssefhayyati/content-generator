import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type RefObject, type WheelEvent } from 'react'
import { ArrowLeft, Circle, CornerDownLeft, Delete, LoaderCircle, Power, RefreshCw, Send, Square, Unplug, Volume1, Volume2, type LucideIcon } from 'lucide-react'
import { api, apiBlob, type Device } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Skeleton } from '../ui'
import { usePhoneStream, type PhoneStream } from './usePhoneStream'

/** The screenshot fallback's control calls (DeviceController::control). */
type Control =
  | { action: 'tap'; x: number; y: number }
  | { action: 'swipe'; x: number; y: number; x2: number; y2: number; ms: number }
  | { action: 'key'; key: string }
  | { action: 'text'; text: string }

/** The side buttons: names for the screenshot fallback, Android key codes for the stream. */
const KEYS: { key: string; code: number; label: string; icon: LucideIcon }[] = [
  { key: 'back', code: 4, label: 'Back', icon: ArrowLeft },
  { key: 'home', code: 3, label: 'Home', icon: Circle },
  { key: 'recents', code: 187, label: 'Apps', icon: Square },
  { key: 'power', code: 26, label: 'Power', icon: Power },
  { key: 'volume_down', code: 25, label: 'Vol −', icon: Volume1 },
  { key: 'volume_up', code: 24, label: 'Vol +', icon: Volume2 },
  { key: 'enter', code: 66, label: 'Enter', icon: CornerDownLeft },
  { key: 'delete', code: 67, label: 'Delete', icon: Delete },
]

/** Your keyboard, typed into the phone while its screen has focus. */
const KEYBOARD: Record<string, number> = {
  Backspace: 67, Enter: 66, Tab: 61, Escape: 4, Delete: 112, Home: 122, End: 123, PageUp: 92, PageDown: 93,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
}

const SCREEN = 'block h-[min(68vh,640px)] w-auto touch-none select-none rounded-[14px]'

/**
 * A real phone's screen, live, driven by hand. The phone bridge streams it as video (scrcpy,
 * up to 60 fps) and takes touches as they happen; without the bridge it falls back to
 * screenshots, about one a second. Hands off while a publishing run is on the phone.
 */
export function PhoneLive({ device }: { device: Device }) {
  const toast = useToast()
  const canvas = useRef<HTMLCanvasElement>(null)
  const stream = usePhoneStream(device.id, canvas, true)
  const snapshots = stream.status === 'failed'
  const locked = device.booked_run_id !== null || (stream.status === 'live' && !stream.control)
  const offline = stream.status === 'offline'
  const idle = locked || (!snapshots && stream.status !== 'live')
  const [text, setText] = useState('')

  const post = async (body: Control) => {
    try {
      await api(`/devices/${device.id}/control`, { method: 'POST', body })
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The phone didn’t take it.', 'error')
      return false
    }
  }

  const press = (k: (typeof KEYS)[number]) => (snapshots ? void post({ action: 'key', key: k.key }) : stream.send({ t: 'key', code: k.code }))

  const type = async (e: FormEvent) => {
    e.preventDefault()
    if (!text) return press(KEYS.find((k) => k.key === 'enter')!)
    if (!snapshots) {
      stream.send({ t: 'text', text })
      setText('')
    } else if (await post({ action: 'text', text })) setText('')
  }

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <div className="flex shrink-0 items-start justify-center">
        {snapshots ? <SnapshotScreen device={device} locked={locked} post={post} /> : <StreamScreen canvas={canvas} stream={stream} locked={locked} />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
          <span
            className={cn(
              'size-1.5 rounded-full',
              stream.status === 'live' ? 'animate-pulse bg-ok' : stream.status === 'connecting' ? 'bg-draft' : offline ? 'bg-fail' : 'bg-warn',
            )}
          />
          {stream.status === 'live'
            ? `Live video · ${stream.fps} fps`
            : stream.status === 'connecting'
              ? 'Starting the video…'
              : offline
                ? 'Not connected · waiting for the phone'
                : 'Screenshots · about one a second'}
        </span>

        {offline && (
          <p className="rounded-lg border border-line-2 bg-white/[0.02] px-3 py-2.5 text-[12px] leading-snug">
            {stream.error} The screen comes back by itself as soon as it's connected.
          </p>
        )}

        {snapshots && (
          <div className="rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2.5 text-[12px] leading-snug">
            <p>{stream.error}</p>
            <Btn size="sm" icon={RefreshCw} onClick={stream.retry} className="mt-2">
              Try live video again
            </Btn>
          </div>
        )}
        {locked && (
          <p className="rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2.5 text-[12px] leading-snug">
            A publishing run is driving this phone. You can watch; the controls come back when it's done.
          </p>
        )}

        <div>
          <Label>Buttons</Label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {KEYS.map((k) => (
              <Btn key={k.key} size="sm" icon={k.icon} disabled={idle} onClick={() => press(k)} className="justify-start">
                {k.label}
              </Btn>
            ))}
          </div>
        </div>

        <form onSubmit={type}>
          <Label>Type into the phone</Label>
          <div className="mt-2 flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} disabled={idle} placeholder="Tap a field first" className={cn(inputClass, 'min-w-0 flex-1')} />
            <Btn type="submit" size="sm" icon={Send} disabled={idle} className="h-9">
              Send
            </Btn>
          </div>
          <p className="mt-1.5 text-[11px] text-dim">
            {snapshots ? 'Plain ASCII only. ' : 'Any text, emoji too. '}Send with an empty box presses Enter.
          </p>
        </form>

        <p className="mt-auto text-[11px] leading-snug text-dim">
          {snapshots
            ? 'Click to tap, drag to swipe, hold to long-press, scroll the wheel to scroll.'
            : 'Touch it like the phone: click, drag, hold, scroll. Right-click is Back. Click the screen, then type on your keyboard.'}
        </p>
      </div>
    </div>
  )
}

/** The video: every pointer move goes to the phone as it happens, like a finger. */
function StreamScreen({ canvas, stream, locked }: { canvas: RefObject<HTMLCanvasElement | null>; stream: PhoneStream; locked: boolean }) {
  const touching = useRef(false)

  /** The pointer in the video's pixels, the space the phone maps touches from. */
  const at = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    return {
      x: Math.min(Math.max(Math.round(((e.clientX - r.left) / r.width) * c.width), 0), c.width - 1),
      y: Math.min(Math.max(Math.round(((e.clientY - r.top) / r.height) * c.height), 0), c.height - 1),
      w: c.width,
      h: c.height,
    }
  }

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.focus()
    if (locked || stream.status !== 'live') return
    if (e.button === 2) return stream.send({ t: 'key', code: 4 })
    if (e.button === 1) return stream.send({ t: 'key', code: 3 })
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    touching.current = true
    stream.send({ t: 'touch', action: 0, ...at(e) })
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (touching.current) stream.send({ t: 'touch', action: 2, ...at(e) })
  }

  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!touching.current) return
    touching.current = false
    stream.send({ t: 'touch', action: 1, ...at(e) })
  }

  const wheel = (e: WheelEvent<HTMLCanvasElement>) => {
    if (locked || stream.status !== 'live') return
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100
    stream.send({ t: 'scroll', ...at(e), v: Math.max(-16, Math.min(16, -notches)) })
  }

  const key = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (locked || stream.status !== 'live' || e.ctrlKey || e.metaKey || e.altKey) return
    const code = KEYBOARD[e.key]
    if (code !== undefined) stream.send({ t: 'key', code })
    else if (e.key.length === 1) stream.send({ t: 'text', text: e.key })
    else return
    e.preventDefault()
  }

  return (
    <div className="relative rounded-[22px] border border-line-2 bg-black p-2">
      <canvas
        ref={canvas}
        width={360}
        height={720}
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
        onKeyDown={key}
        onPaste={(e) => {
          if (locked) return
          e.preventDefault()
          stream.send({ t: 'text', text: e.clipboardData.getData('text') })
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(SCREEN, 'outline-none focus-visible:ring-2 focus-visible:ring-accent/40', locked ? 'cursor-not-allowed' : 'cursor-pointer')}
      />
      {stream.status === 'connecting' && (
        <div className="absolute inset-2 grid place-items-center rounded-[14px] text-[12px] text-dim">
          <span className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" />
            Starting the phone's screen…
          </span>
        </div>
      )}
      {stream.status === 'offline' && (
        <div className="absolute inset-2 flex flex-col items-center justify-center gap-3 rounded-[14px] bg-black px-6 text-center">
          <Unplug className="size-6 text-dim" strokeWidth={1.5} />
          <p className="text-[13px] font-medium">Not connected</p>
          <p className="text-[11.5px] leading-snug text-dim">Plug the phone in. Its screen shows up here by itself.</p>
          <LoaderCircle className="size-3.5 animate-spin text-dim" />
        </div>
      )}
    </div>
  )
}

/** The fallback: one screenshot after another, taps and swipes sent when the pointer lifts. */
function SnapshotScreen({ device, locked, post }: { device: Device; locked: boolean; post: (c: Control) => Promise<boolean> }) {
  const [frame, setFrame] = useState<{ url: string; width: number; height: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marks, setMarks] = useState<{ id: number; x: number; y: number }[]>([])
  const start = useRef<{ x: number; y: number; px: number; py: number; t: number } | null>(null)
  const lastWheel = useRef(0)
  const shown = useRef<string | null>(null)

  // One frame at a time, so a slow phone never piles requests onto the API.
  useEffect(() => {
    const abort = new AbortController()
    ;(async () => {
      while (!abort.signal.aborted) {
        try {
          const { blob, headers } = await apiBlob(`/devices/${device.id}/live`, abort.signal)
          if (shown.current) URL.revokeObjectURL(shown.current)
          shown.current = URL.createObjectURL(blob)
          setFrame({ url: shown.current, width: Number(headers.get('X-Screen-Width')), height: Number(headers.get('X-Screen-Height')) })
          setError(null)
          await wait(150)
        } catch (e) {
          if (abort.signal.aborted) return
          setError(e instanceof Error ? e.message : 'Lost the phone.')
          await wait(2000)
        }
      }
    })()
    return () => abort.abort()
  }, [device.id])

  useEffect(() => () => void (shown.current && URL.revokeObjectURL(shown.current)), [])

  /** Where the pointer is, in the phone's own pixels (the frame on screen is scaled). */
  const point = (e: PointerEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const f = frame!
    return { px, py, x: clamp(Math.round((px / r.width) * f.width), f.width), y: clamp(Math.round((py / r.height) * f.height), f.height) }
  }

  const down = (e: PointerEvent<HTMLImageElement>) => {
    if (locked || !frame) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { ...point(e), t: performance.now() }
  }

  const up = (e: PointerEvent<HTMLImageElement>) => {
    const s = start.current
    start.current = null
    if (!s || !frame) return
    const p = point(e)
    const held = Math.round(performance.now() - s.t)
    const moved = Math.hypot(p.x - s.x, p.y - s.y) > frame.width * 0.02

    const id = Date.now()
    setMarks((m) => [...m, { id, x: s.px, y: s.py }])
    window.setTimeout(() => setMarks((m) => m.filter((k) => k.id !== id)), 600)

    if (moved) void post({ action: 'swipe', x: s.x, y: s.y, x2: p.x, y2: p.y, ms: Math.min(Math.max(held, 80), 2000) })
    else if (held > 500) void post({ action: 'swipe', x: s.x, y: s.y, x2: s.x, y2: s.y, ms: Math.min(held, 3000) })
    else void post({ action: 'tap', x: s.x, y: s.y })
  }

  const wheel = (e: WheelEvent<HTMLImageElement>) => {
    if (locked || !frame || Math.abs(e.deltaY) < 4 || performance.now() - lastWheel.current < 400) return
    lastWheel.current = performance.now()
    const x = Math.round(frame.width / 2)
    const [from, to] = e.deltaY > 0 ? [0.65, 0.35] : [0.35, 0.65]
    void post({ action: 'swipe', x, y: Math.round(frame.height * from), x2: x, y2: Math.round(frame.height * to), ms: 200 })
  }

  return (
    <div>
      <div className="relative rounded-[22px] border border-line-2 bg-black p-2">
        {frame ? (
          <img
            src={frame.url}
            alt={`${device.name}'s screen`}
            draggable={false}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={() => (start.current = null)}
            onWheel={wheel}
            style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
            className={cn(SCREEN, locked ? 'cursor-not-allowed' : 'cursor-pointer')}
          />
        ) : (
          <Skeleton className="h-[min(68vh,640px)] w-[min(34vh,320px)] rounded-[14px]" />
        )}
        {marks.map((m) => (
          <span key={m.id} className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-accent/60" style={{ left: m.x + 8, top: m.y + 8 }} />
        ))}
      </div>
      {error && <p className="mt-2 max-w-[320px] text-[11.5px] leading-snug text-fail">{error}</p>}
    </div>
  )
}

const clamp = (v: number, size: number) => Math.min(Math.max(v, 0), size - 1)
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))
