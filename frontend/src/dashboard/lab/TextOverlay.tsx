import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ImageOff, Move, Plus, Trash2, Type } from 'lucide-react'
import type { Asset } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { FontPicker, fontFamily, loadFont } from '../assistant/Fonts'
import { TextColours } from '../assistant/Palette'
import { useAssistant, type FontInfo, type TextBox } from '../assistant/store'
import { Btn, Label, Select, inputClass } from '../ui'
import type { FieldContext } from './fields'

/** One text on a Text over it node: what it says and how it looks, on which slide (1, 2…). */
export type TextItem = { slide?: number; text?: string; position?: string; size?: string; color?: string; style?: string; box_color?: string; font?: string }

const POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']
const SIZES = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
  { value: 'huge', label: 'XL' },
]
const STYLES = [
  { value: 'shadow', label: 'Shadow' },
  { value: 'outline', label: 'Outline' },
  { value: 'box', label: 'Box' },
  { value: 'plain', label: 'Plain' },
]
/* As the assistant draws them (studio.py draw_text): a size is a share of the picture's shorter side, the
   sides keep 6% clear, and the top and bottom keep clear what the platform's buttons cover. */
const SCALE: Record<string, number> = { small: 0.045, medium: 0.065, large: 0.09, huge: 0.13 }
const SAFE: Record<string, [number, number]> = { feed: [0.06, 0.06], post: [0.06, 0.06], story: [0.13, 0.2], reel: [0.13, 0.2] }
const SHAPE: Record<string, [number, number]> = { feed: [1080, 1350], post: [1600, 900], story: [1080, 1920], reel: [1080, 1920] }

const asBox = (t: TextItem, i: number): TextBox => ({
  id: i + 1,
  words: t.text ?? '',
  box: [0, 0, 0, 0],
  position: t.position ?? 'top',
  size: t.size ?? 'large',
  color: t.color || '#ffffff',
  style: t.style ?? 'shadow',
  box_color: t.box_color || '#000000',
  font: t.font ?? 'bold',
})

/**
 * The words on a Text over it node, edited the way the assistant edits a slide's texts: the picture or video
 * as it will look, each text drawn over it (click one to pick it, drag it to another spot), and every look a
 * text can have one click away: where, how big, the style, the font, the colours. Run draws it exactly.
 */
export function TextOverlay({ value, onChange, ctx }: { value: TextItem[]; onChange: (v: TextItem[], now?: boolean) => void; ctx: FieldContext }) {
  const media = ctx.media
  const slides = Math.max(1, media.length, ...value.map((t) => Number(t.slide) || 1))
  const [slide, setSlide] = useState(1)
  const [picked, setPicked] = useState<number | null>(value.length ? 0 : null)
  const [adding, setAdding] = useState('')
  const words = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (slide > slides) setSlide(1)
  }, [slide, slides])
  useEffect(() => {
    if (picked !== null && picked >= value.length) setPicked(value.length ? value.length - 1 : null)
  }, [picked, value.length])

  const on = (t: TextItem) => (Number(t.slide) || 1) === slide
  const set = (i: number, patch: Partial<TextItem>, now = true) => onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)), now)
  const add = () => {
    const text = adding.trim()
    if (!text) return
    const first = !value.some(on)
    onChange([...value, { slide, text, position: first ? 'top' : 'bottom', size: first ? 'large' : 'medium', style: 'shadow', color: '#ffffff' }], true)
    setPicked(value.length)
    setAdding('')
  }
  const current = picked !== null ? value[picked] : undefined

  return (
    <div className="space-y-3">
      <Frame
        asset={media[slide - 1] ?? null}
        texts={value.map((t, i) => ({ t, i })).filter(({ t }) => on(t))}
        picked={picked}
        placement={String(ctx.node.params?.placement ?? 'feed')}
        background={String(ctx.node.params?.background ?? '#1c1c1c')}
        onPick={(i) => setPicked(i)}
        onEdit={(i) => {
          setPicked(i)
          window.setTimeout(() => words.current?.focus(), 30)
        }}
        onMove={(i, position) => set(i, { position })}
      />

      {slides > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {Array.from({ length: slides }, (_, k) => {
            const a = media[k]
            const n = value.filter((t) => (Number(t.slide) || 1) === k + 1).length
            return (
              <button key={k} type="button" onClick={() => setSlide(k + 1)} aria-label={`Slide ${k + 1}`} className={cn('relative size-12 shrink-0 overflow-hidden rounded-md border transition-colors', slide === k + 1 ? 'border-accent-soft' : 'border-line hover:border-line-2')}>
                {a ? a.kind === 'video' ? <video src={a.url} muted className="size-full object-cover" /> : <img src={a.url} alt="" className="size-full object-cover" draggable={false} /> : <span className="block size-full" style={{ background: String(ctx.node.params?.background ?? '#1c1c1c') }} />}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 font-mono text-[9px] text-white">{k + 1}</span>
                {n > 0 && <span className="absolute right-0.5 top-0.5 grid size-3.5 place-items-center rounded-full bg-accent font-mono text-[8.5px] text-on-accent">{n}</span>}
              </button>
            )
          })}
        </div>
      )}

      {value.some(on) && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t, i) =>
            on(t) ? (
              <button key={i} type="button" onClick={() => setPicked(picked === i ? null : i)} className={cn('max-w-full truncate rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors', picked === i ? 'border-accent-soft/60 bg-accent/10 text-fg' : 'border-line text-muted hover:border-line-2 hover:text-fg')}>
                {t.text || <span className="text-dim">(empty)</span>}
              </button>
            ) : null,
          )}
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={media[slide - 1]?.kind === 'video' ? 'Add a text over the video ({offer} works)' : `Add a text${slides > 1 ? ` to slide ${slide}` : ''} ({offer} works)`} className={cn(inputClass, 'h-8 text-[12.5px]')} />
        <Btn size="sm" type="submit" icon={Plus} disabled={!adding.trim()} className="h-8">
          Add
        </Btn>
      </form>

      <AnimatePresence mode="wait">
        {current && picked !== null && on(current) && (
          <motion.div key={picked} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
            <TextEditor t={current} i={picked} ctx={ctx} slides={slides} words={words} onSet={(patch, now) => set(picked, patch, now)} onRemove={() => {
              onChange(value.filter((_, j) => j !== picked), true)
              setPicked(null)
            }} />
          </motion.div>
        )}
      </AnimatePresence>

      {!value.length && <p className="text-[11px] leading-snug text-dim">A headline connected to the node goes at the top of slide 1 while there are no texts here.</p>}
    </div>
  )
}

/** Every look a text can have, one click each: the assistant's text editor. */
function TextEditor({ t, i, ctx, slides, words, onSet, onRemove }: { t: TextItem; i: number; ctx: FieldContext; slides: number; words: React.RefObject<HTMLTextAreaElement | null>; onSet: (patch: Partial<TextItem>, now?: boolean) => void; onRemove: () => void }) {
  const a = useAssistant()
  const box = asBox(t, i)
  // The font picker and the colours send the fields they change: font, color, style, box_color.
  const fields = (f: Record<string, string>) => onSet(f as Partial<TextItem>)
  return (
    <div className="space-y-3.5 rounded-lg border border-line-2 bg-white/[0.02] p-3.5">
      <div className="flex gap-2">
        <textarea ref={words} rows={2} value={t.text ?? ''} onChange={(e) => onSet({ text: e.target.value }, false)} onBlur={(e) => onSet({ text: e.target.value })} className={cn(inputClass, 'h-auto min-h-[52px] resize-y py-1.5 text-[12.5px]')} aria-label="The words" />
        <Btn size="sm" variant="danger" icon={Trash2} className="h-8 shrink-0" onClick={onRemove} aria-label="Remove this text" />
      </div>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3.5">
        <div>
          <Label className="mb-1.5">Position</Label>
          <div className="grid w-[78px] grid-cols-3 gap-1">
            {POSITIONS.map((p) => (
              <button key={p} type="button" title={p} onClick={() => onSet({ position: p })} className={cn('grid aspect-square place-items-center rounded-[4px] border transition-colors', box.position === p ? 'border-accent-soft bg-accent/30' : 'border-line hover:border-line-2')}>
                <span className={cn('size-1 rounded-full', box.position === p ? 'bg-fg' : 'bg-white/30')} />
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5">Size</Label>
            <Choice value={box.size} options={SIZES} onChange={(size) => onSet({ size })} />
          </div>
          <div>
            <Label className="mb-1.5">Style</Label>
            <Choice value={box.style} options={STYLES} onChange={(style) => onSet({ style })} />
          </div>
        </div>
      </div>
      {slides > 1 && (
        <label className="flex items-center gap-2 text-[11.5px] text-muted">
          On slide
          <Select value={String(Number(t.slide) || 1)} onChange={(e) => onSet({ slide: Number(e.target.value) })} className="h-7 w-20 text-[12px]">
            {Array.from({ length: slides }, (_, k) => (
              <option key={k} value={k + 1}>
                {k + 1}
              </option>
            ))}
          </Select>
        </label>
      )}
      {a.fonts ? (
        <FontPicker t={box} onChange={fields} />
      ) : (
        <div>
          <Label className="mb-1.5">Font</Label>
          <Select value={t.font ?? ''} onChange={(e) => onSet({ font: e.target.value || undefined })}>
            <option value="">The brand’s font, or the default</option>
            {ctx.catalog.engine.fonts.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label} · {f.style}
              </option>
            ))}
          </Select>
        </div>
      )}
      <TextColours t={box} palette={ctx.palette} onChange={fields} />
    </div>
  )
}

function Choice({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value} className={cn('rounded-[5px] px-2.5 py-1 text-[11.5px] transition-colors', value === o.value ? 'bg-white/[0.1] text-fg' : 'text-dim hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The slide as it will look: the picture or video, and each of its texts drawn where the assistant draws
 * it. Click a text to pick it, double-click to rewrite it, drag it to another of the nine spots.
 */
function Frame({ asset, texts, picked, placement, background, onPick, onEdit, onMove }: {
  asset: Asset | null
  texts: Array<{ t: TextItem; i: number }>
  picked: number | null
  placement: string
  background: string
  onPick: (i: number) => void
  onEdit: (i: number) => void
  onMove: (i: number, position: string) => void
}) {
  const a = useAssistant()
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 320, h: 400 })
  const [drag, setDrag] = useState<{ i: number; spot: string } | null>(null)
  const [w0, h0] = asset?.width && asset?.height ? [asset.width, asset.height] : SHAPE[placement] ?? SHAPE.feed
  const [safeTop, safeBottom] = SAFE[placement] ?? SAFE.feed

  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The fonts the texts use, from the very files the assistant draws with.
  useEffect(() => {
    for (const { t } of texts) {
      const f = a.fonts?.fonts.find((x) => x.name === (t.font || 'bold'))
      if (f) void loadFont(f)
    }
  }, [a.fonts, texts.map(({ t }) => t.font).join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const spotAt = (e: ReactPointerEvent) => {
    const r = frame.current!.getBoundingClientRect()
    const col = Math.min(2, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 3)))
    const row = Math.min(2, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * 3)))
    return POSITIONS[row * 3 + col]
  }
  const short = Math.min(size.w, size.h)
  const zones = POSITIONS.map((p) => ({ p, items: texts.filter(({ t, i }) => (drag?.i === i ? drag.spot : t.position ?? 'top') === p) }))

  return (
    <div className="space-y-1.5">
      <div ref={frame} className="relative w-full select-none overflow-hidden rounded-lg border border-line bg-black" style={{ aspectRatio: `${w0} / ${h0}`, background: asset ? undefined : background }}>
        {asset?.kind === 'video' ? (
          <video src={asset.url} poster={asset.poster_url ?? undefined} muted autoPlay loop playsInline className="size-full object-cover" />
        ) : asset ? (
          <img src={asset.url} alt="" className="size-full object-cover" draggable={false} />
        ) : null}
        {drag && (
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {POSITIONS.map((p) => (
              <span key={p} className={cn('border border-dashed border-white/15', drag.spot === p && 'bg-accent/15')} />
            ))}
          </div>
        )}
        {zones.map(({ p, items }) =>
          items.length ? (
            <div
              key={p}
              className={cn('pointer-events-none absolute flex flex-col gap-[0.35em]', p.startsWith('top') ? 'justify-start' : p.startsWith('bottom') ? 'justify-end' : 'justify-center', p.endsWith('left') ? 'items-start' : p.endsWith('right') ? 'items-end' : 'items-center')}
              style={{ left: '6%', right: '6%', top: `${safeTop * 100}%`, bottom: `${safeBottom * 100}%` }}
            >
              {items.map(({ t, i }) => (
                <Drawn
                  key={i}
                  t={t}
                  px={(SCALE[t.size ?? 'large'] ?? 0.09) * short}
                  family={a.fonts?.fonts.find((f) => f.name === (t.font || 'bold'))}
                  picked={picked === i}
                  align={p.endsWith('left') ? 'left' : p.endsWith('right') ? 'right' : 'center'}
                  onDown={(e) => {
                    e.stopPropagation()
                    onPick(i)
                    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                    setDrag({ i, spot: t.position ?? 'top' })
                  }}
                  onDrag={(e) => drag?.i === i && setDrag({ i, spot: spotAt(e) })}
                  onUp={() => {
                    if (drag && drag.i === i && drag.spot !== (t.position ?? 'top')) onMove(i, drag.spot)
                    setDrag(null)
                  }}
                  onEdit={() => onEdit(i)}
                />
              ))}
            </div>
          ) : null,
        )}
        {!asset && !texts.length && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <span className="text-[11.5px] text-dim">
              <ImageOff className="mx-auto mb-1.5 size-4" strokeWidth={1.5} />
              Connect a picture or a video, or add a text for a plain slide.
            </span>
          </div>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-[10.5px] text-dim">
        <Move className="size-3" /> Drag a text to move it; double-click to rewrite it. Run draws it exactly{asset?.kind === 'video' ? ', over the whole video' : ''}.
      </p>
    </div>
  )
}

function Drawn({ t, px, family, picked, align, onDown, onDrag, onUp, onEdit }: {
  t: TextItem
  px: number
  family: FontInfo | undefined
  picked: boolean
  align: 'left' | 'center' | 'right'
  onDown: (e: ReactPointerEvent) => void
  onDrag: (e: ReactPointerEvent) => void
  onUp: () => void
  onEdit: () => void
}) {
  const style = t.style ?? 'shadow'
  const color = t.color || '#ffffff'
  const second = t.box_color || '#000000'
  return (
    <span
      role="button"
      title="Drag to move, double-click to rewrite"
      onPointerDown={onDown}
      onPointerMove={onDrag}
      onPointerUp={onUp}
      onDoubleClick={onEdit}
      className={cn('pointer-events-auto max-w-full cursor-grab whitespace-pre-wrap break-words rounded-[0.25em] leading-[1.15] outline-offset-2 active:cursor-grabbing', picked ? 'outline outline-2 outline-accent-soft' : 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-white/70')}
      style={{
        fontSize: px,
        fontFamily: family ? `"${fontFamily(family)}", system-ui, sans-serif` : 'system-ui, sans-serif',
        fontWeight: family ? undefined : 700,
        textAlign: align,
        color,
        padding: style === 'box' ? '0.4em' : undefined,
        background: style === 'box' ? `color-mix(in srgb, ${second} 82%, transparent)` : undefined,
        textShadow: style === 'shadow' ? `0 ${Math.max(1, px * 0.05)}px ${Math.max(2, px * 0.08)}px rgb(0 0 0 / 0.67)` : undefined,
        WebkitTextStroke: style === 'outline' ? `${Math.max(1.5, px * 0.12)}px ${second}` : undefined,
        paintOrder: style === 'outline' ? 'stroke fill' : undefined,
      }}
    >
      {t.text || <Type className="inline size-[0.8em] opacity-60" />}
    </span>
  )
}
