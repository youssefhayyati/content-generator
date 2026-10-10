import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Brush, Eraser, LoaderCircle, Undo2, Wand2, X } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Btn, inputClass, Segmented } from '../ui'
import { useAssistant, type Draft } from './store'

/*
 * Changing part of a picture: paint over it on the slide, then say what to do with it, here or out
 * loud ("remove this"). Only the painted part goes to the editing model; the rest of the picture
 * stays exactly as it was (assistant/backend/retouch.py).
 */

const BRUSHES = [
  { value: 0.03, label: 'S' },
  { value: 0.06, label: 'M' },
  { value: 0.11, label: 'L' },
]
const MODES = [
  { value: 'remove', label: 'Remove' },
  { value: 'replace', label: 'Replace' },
  { value: 'change', label: 'Change' },
  { value: 'improve', label: 'Improve' },
] as const
type Mode = (typeof MODES)[number]['value']
const ASK: Record<Mode, string> = {
  remove: '',
  replace: 'What goes there? A vase of tulips…',
  change: 'What should change? Make it navy blue…',
  improve: 'Anything in particular? (optional)',
}
const INK = '#ff3d81'
/** The canvas is drawn at this width; the assistant scales the mask to the slide. */
const MASK_WIDTH = 540

type MaskState = {
  brush: number
  setBrush: (v: number) => void
  erase: boolean
  setErase: (v: boolean) => void
  empty: boolean
  canvas: RefObject<HTMLCanvasElement | null>
  /** Before each stroke, for undo. */
  history: RefObject<ImageData[]>
  /** The canvas changed: tell the assistant. */
  commit: () => void
  clear: () => void
  undo: () => void
}

const MaskContext = createContext<MaskState | null>(null)
const useMask = () => useContext(MaskContext)

export function MaskProvider({ children }: { children: ReactNode }) {
  const a = useAssistant()
  const [brush, setBrush] = useState(0.06)
  const [erase, setErase] = useState(false)
  const [empty, setEmpty] = useState(true)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const history = useRef<ImageData[]>([])
  const { painting, sendMask } = a

  const commit = useCallback(() => {
    const c = canvas.current
    if (!c || !painting) return
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let painted = false
    for (let k = 3; k < px.length; k += 16) {
      if (px[k] > 0) {
        painted = true
        break
      }
    }
    setEmpty(!painted)
    sendMask(painting, painted ? c.toDataURL('image/png') : null)
  }, [painting, sendMask])

  const clear = useCallback(() => {
    const c = canvas.current
    if (!c) return
    history.current.push(c.getContext('2d')!.getImageData(0, 0, c.width, c.height))
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    commit()
  }, [commit])

  const undo = useCallback(() => {
    const c = canvas.current
    const last = history.current.pop()
    if (!c || !last) return
    c.getContext('2d')!.putImageData(last, 0, 0)
    commit()
  }, [commit])

  // A new slide to paint on starts clean
  const target = painting ? `${painting.draft}-${painting.slide}` : ''
  useEffect(() => {
    history.current = []
    setEmpty(true)
    setErase(false)
  }, [target])

  const value = useMemo<MaskState>(
    () => ({
      brush,
      setBrush,
      erase,
      setErase,
      empty,
      canvas,
      history,
      commit,
      clear,
      undo,
    }),
    [brush, erase, empty, commit, clear, undo],
  )
  return <MaskContext.Provider value={value}>{children}</MaskContext.Provider>
}

/** The brush over a slide: what's painted shows in pink, and goes to the assistant after each stroke. */
export function MaskCanvas({ d }: { d: Draft }) {
  const m = useMask()
  const cursor = useRef<HTMLDivElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const height = Math.round((MASK_WIDTH * d.size[1]) / d.size[0])
  if (!m) return null

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * MASK_WIDTH,
      y: ((e.clientY - r.top) / r.height) * height,
    }
  }
  const line = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = m.canvas.current!.getContext('2d')!
    ctx.globalCompositeOperation = m.erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = INK
    ctx.lineWidth = m.brush * MASK_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x + 0.01, to.y)
    ctx.stroke()
  }
  const moveCursor = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = cursor.current
    if (!el) return
    const r = e.currentTarget.getBoundingClientRect()
    const size = m.brush * r.width
    el.style.width = el.style.height = `${size}px`
    el.style.transform = `translate(${e.clientX - r.left - size / 2}px, ${e.clientY - r.top - size / 2}px)`
    el.style.opacity = '1'
  }

  return (
    <div className="absolute inset-0 z-20" onClick={(e) => e.stopPropagation()}>
      <canvas
        ref={m.canvas}
        width={MASK_WIDTH}
        height={height}
        aria-label="Paint over the part to change"
        className="absolute inset-0 size-full cursor-none touch-none opacity-55"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const c = e.currentTarget
          m.history.current.push(c.getContext('2d')!.getImageData(0, 0, c.width, c.height))
          if (m.history.current.length > 30) m.history.current.shift()
          last.current = at(e)
          line(last.current, last.current)
        }}
        onPointerMove={(e) => {
          moveCursor(e)
          if (!last.current) return
          const p = at(e)
          line(last.current, p)
          last.current = p
        }}
        onPointerUp={() => {
          if (!last.current) return
          last.current = null
          m.commit()
        }}
        onPointerLeave={() => cursor.current && (cursor.current.style.opacity = '0')}
      />
      <div
        ref={cursor}
        className={cn('pointer-events-none absolute left-0 top-0 rounded-full border-2 opacity-0 shadow-[0_0_0_1px_rgb(0_0_0_/_0.5)]', m.erase ? 'border-white border-dashed' : 'border-white')}
      />
      {m.empty && (
        <span className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-black/65 px-3 py-1 text-[11px] text-white backdrop-blur">Paint over what you want to change</span>
      )}
    </div>
  )
}

/** Under the slide: start painting, and once painted, what to do with it. */
export function MaskBar({ d, index }: { d: Draft; index: number }) {
  const a = useAssistant()
  const m = useMask()
  const [mode, setMode] = useState<Mode>('remove')
  const [prompt, setPrompt] = useState('')
  const slide = d.slides[index]
  const on = a.painting?.draft === d.id && a.painting.slide === index + 1
  const editing = Object.values(a.jobs).some((j) => j.status === 'running' && /painted/i.test(j.label))
  if (!m || slide?.kind !== 'image' || !a.generation) return null

  const needs = mode === 'replace' || mode === 'change'
  const apply = () => {
    if (m.empty || (needs && !prompt.trim())) return
    a.action('edit_area', {
      draft: d.id,
      slide: index + 1,
      mode,
      prompt: prompt.trim(),
    })
    setPrompt('')
  }

  return (
    <div className="mx-auto w-full max-w-[400px]">
      <AnimatePresence mode="wait" initial={false}>
        {!on ? (
          <motion.div key="off" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Btn size="sm" variant="subtle" icon={Brush} onClick={() => a.paint({ draft: d.id, slide: index + 1 })} disabled={a.conn !== 'online'}>
              Paint to change part of it
            </Btn>
          </motion.div>
        ) : (
          <motion.div
            key="on"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease }}
            className="space-y-2.5 rounded-xl border border-line-2 bg-panel p-3"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Segmented id={`brush-${d.id}`} label="Brush size" value={m.brush} onChange={m.setBrush} options={BRUSHES} className="text-[11px]" />
              <button
                type="button"
                aria-pressed={m.erase}
                title="Erase"
                aria-label="Erase"
                onClick={() => m.setErase(!m.erase)}
                className={cn('grid size-7 place-items-center rounded-md border transition-colors', m.erase ? 'border-accent-soft/60 bg-accent/15 text-fg' : 'border-line text-dim hover:text-fg')}
              >
                <Eraser className="size-3.5" />
              </button>
              <button
                type="button"
                title="Undo the last stroke"
                aria-label="Undo the last stroke"
                onClick={m.undo}
                className="grid size-7 place-items-center rounded-md border border-line text-dim transition-colors hover:text-fg"
              >
                <Undo2 className="size-3.5" />
              </button>
              <Btn size="sm" variant="subtle" onClick={m.clear} disabled={m.empty}>
                Clear
              </Btn>
              <button
                type="button"
                onClick={() => a.paint(null)}
                aria-label="Stop painting"
                title="Stop painting"
                className="ml-auto grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.05] hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>
            <Segmented id={`mode-${d.id}`} label="What to do with it" value={mode} onChange={setMode} options={[...MODES]} className="w-full [&>button]:flex-1 [&>button]:justify-center" />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                apply()
              }}
            >
              {mode !== 'remove' && <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={ASK[mode]} aria-label={ASK[mode]} className={cn(inputClass, 'h-8 text-[12.5px]')} />}
              <Btn
                type="submit"
                size="sm"
                variant="primary"
                icon={editing ? undefined : Wand2}
                loading={editing}
                disabled={m.empty || (needs && !prompt.trim()) || a.conn !== 'online'}
                className={cn('h-8', mode === 'remove' && 'w-full')}
              >
                {mode === 'remove' ? 'Remove it' : 'Apply'}
              </Btn>
            </form>
            <p className="flex items-center gap-1.5 text-[11px] leading-snug text-dim">
              {editing ? (
                <>
                  <LoaderCircle className="size-3 animate-spin" /> Editing the painted part. The rest stays as it is.
                </>
              ) : m.empty ? (
                'Paint over it on the picture. Only that part changes.'
              ) : (
                'Or just say it: “remove this”, “make it gold”.'
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
