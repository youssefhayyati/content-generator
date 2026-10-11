import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, LayoutTemplate, MessageCircle, Plus, Volume2, VolumeX } from 'lucide-react'
import type { LabCatalog, LabTemplate } from '../../lib/api'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { cn } from '../../lib/cn'
import { ease } from '../../lib/motion'
import { coverOf, exampleFor, type LabExample, type LabMedia } from '../../showcase/lab'
import { monogram, PostText } from '../../showcase/pieces'
import { Btn, Label, Modal, Segmented } from '../ui'
import { hueOf, iconOf } from './look'
import { AiBadge } from './NodeCard'

/*
 * What each template makes, seen before it's used: every card shows an example made with it (the
 * picture, the clip playing, the before and after), and opening one shows it big, with what it takes,
 * the steps it runs and how the example was made. Used on Creative Lab's home (where New post goes),
 * on an empty canvas, in the canvas's templates and on the Showcase page.
 */

/* ------------------------------------------------------------------ the media */

/** Whether it's on screen: clips play and slides turn only then. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, seen] as const
}

function Pic({ m, big, className }: { m: LabMedia; big?: boolean; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={big ? m.src : (m.sm ?? m.src)}
      alt={m.alt}
      width={m.w}
      height={m.h}
      loading={big ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      ref={(el) => {
        if (el?.complete && el.naturalWidth) setLoaded(true)
      }}
      style={{ backgroundColor: m.tone }}
      className={cn('transition-opacity duration-700 ease-expo', loaded ? 'opacity-100' : 'opacity-0', className)}
    />
  )
}

/** A clip that plays muted while it can be seen (the sheet can turn the sound on). Reduced motion keeps its first frame. */
function Vid({ m, className, muted = true }: { m: LabMedia; className?: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    const v = ref.current
    if (!v || reduce) return
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.2 })
    io.observe(v)
    return () => {
      io.disconnect()
      v.pause()
    }
  }, [reduce, m.src])
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = muted
    // Sound turned on: from the start, so the voice is heard from its first word.
    if (!muted) {
      v.currentTime = 0
      v.play().catch(() => {})
    }
  }, [muted])
  return <video ref={ref} src={m.src} poster={m.poster} muted loop playsInline preload="metadata" aria-label={m.alt} style={{ backgroundColor: m.tone }} className={className} />
}

/** A recording: bars that breathe while it can be seen. */
function Wave({ className, bars = 36 }: { className?: string; bars?: number }) {
  return (
    <span aria-hidden className={cn('flex h-full items-center gap-[3px]', className)}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="w-[3px] flex-1 origin-center rounded-full bg-current animate-[lab-wave_1.6s_ease-in-out_infinite]"
          style={{ height: `${30 + 70 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))}%`, animationDelay: `${(i % 9) * -0.17}s` }}
        />
      ))}
    </span>
  )
}

function Media({ m, big, className, muted }: { m: LabMedia; big?: boolean; className?: string; muted?: boolean }) {
  if (m.kind === 'video') return <Vid m={m} className={className} muted={muted} />
  if (m.kind === 'audio') return <Wave className={cn('text-accent-soft', className)} />
  return <Pic m={m} big={big} className={className} />
}

const Tag = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn('rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-white/90 backdrop-blur', className)}>{children}</span>
)

/* ------------------------------------------------------------------ the result, small or big */

/**
 * An example's result: small (a card's preview, filling its box) or big (the sheet's stage, as large
 * as it fits). `muted` is the sheet's sound switch.
 */
export function ExamplePreview({ ex, big = false, muted = true }: { ex: LabExample; big?: boolean; muted?: boolean }) {
  const fill = 'absolute inset-0 size-full object-cover'
  switch (ex.look) {
    case 'carousel':
      return <Carousel list={ex.made} big={big} />
    case 'compare':
      return big ? <CompareSlider ex={ex} /> : <CompareWipe ex={ex} />
    case 'panes':
      return big ? (
        <div className="grid size-full items-center gap-4" style={{ gridTemplateColumns: `repeat(${ex.panes!.length}, minmax(0, 1fr))` }}>
          {ex.panes!.map((p) => (
            <figure key={p.label} className="flex min-h-0 flex-col items-center gap-2.5">
              <Media m={p.m} big muted={muted} className="h-auto max-h-[64svh] w-auto max-w-full rounded-[18px] object-contain shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)]" />
              <figcaption className="text-center text-[12px] text-muted">{p.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <span className="absolute inset-0 flex gap-px bg-black">
          {ex.panes!.map((p) => (
            <span key={p.label} className="relative min-w-0 flex-1 overflow-hidden">
              <Media m={p.m} className={fill} />
              <Tag className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate">{p.label}</Tag>
            </span>
          ))}
        </span>
      )
    case 'grid':
      return big ? (
        // Two rows of 4:5 pictures, as wide as the stage's height lets both rows show.
        <div className="grid max-h-full w-full max-w-[min(100%,54svh)] grid-cols-2 gap-2.5">
          {(ex.panes ?? ex.made.map((m) => ({ m, label: '' }))).map((p, i) => (
            <figure key={i} className="relative overflow-hidden rounded-xl">
              <Media m={p.m} big className="aspect-[4/5] w-full object-cover" />
              {p.label && <Tag className="absolute bottom-2 left-2">{p.label}</Tag>}
            </figure>
          ))}
        </div>
      ) : (
        <span className="absolute inset-0 grid grid-cols-2 gap-px bg-black">
          {(ex.panes?.map((p) => p.m) ?? ex.made).slice(0, 4).map((m, i) => (
            <span key={i} className="relative overflow-hidden">
              <Media m={m} className={fill} />
            </span>
          ))}
        </span>
      )
    case 'reel':
      return big ? <Phone ex={ex} m={ex.made[0]} muted={muted} /> : (
        <>
          <Media m={ex.made[0]} className={fill} />
          {ex.from && <From m={ex.from} />}
        </>
      )
    case 'post':
      return big ? <PostBig ex={ex} /> : (
        <span className="absolute inset-0 flex flex-col bg-bone p-4 text-ink">
          <PostHead ex={ex} light />
          <PostText text={ex.words[0]?.text ?? ''} className="mt-2.5 line-clamp-4 text-[12px] leading-snug" />
          {ex.made[0] && <Pic m={ex.made[0]} className="mt-auto h-[38%] w-full rounded-md object-cover" />}
        </span>
      )
    case 'recording':
      return big ? <RecordingBig ex={ex} /> : (
        <span className="absolute inset-0 flex flex-col justify-between bg-[radial-gradient(120%_80%_at_20%_0%,color-mix(in_oklab,var(--color-accent)_22%,transparent),transparent)] p-4">
          <span className="flex h-16 text-accent-soft">
            <Wave />
          </span>
          <span className="rounded-lg bg-bone p-3 text-ink">
            <PostHead ex={ex} light />
            <PostText text={ex.words.find((w) => w.label === 'The post')?.text ?? ''} className="mt-2 line-clamp-3 text-[11.5px] leading-snug" />
          </span>
        </span>
      )
    case 'pack':
      return big ? <PackBig ex={ex} muted={muted} /> : (
        <span className="absolute inset-0 grid grid-cols-[1.15fr_1fr] gap-px bg-black">
          <span className="relative overflow-hidden">
            <Media m={ex.made[0]} className={fill} />
          </span>
          <span className="grid grid-rows-2 gap-px">
            <span className="relative overflow-hidden">
              <Media m={ex.made[1]} className={fill} />
            </span>
            <span className="overflow-hidden bg-bone p-2.5 text-ink">
              <PostText text={ex.words.find((w) => w.label === 'The short post')?.text ?? ''} className="line-clamp-4 text-[10.5px] leading-snug" />
            </span>
          </span>
        </span>
      )
    default:
      return big ? (
        <Media m={ex.made[0]} big muted={muted} className="h-auto max-h-full w-auto max-w-full rounded-[18px] object-contain shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)]" />
      ) : (
        <Media m={ex.made[0]} className={fill} />
      )
  }
}

/** What it was made from, small in the corner: "From this". */
function From({ m, big }: { m: LabMedia; big?: boolean }) {
  return (
    <span className={cn('absolute overflow-hidden rounded-lg border border-white/40 shadow-lg', big ? 'left-3 top-8 w-20' : 'bottom-2 left-2 w-12')}>
      <Pic m={m} className="aspect-[4/5] w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-center font-mono text-[8px] uppercase tracking-[0.08em] text-white">From</span>
    </span>
  )
}

/** A clip as a phone plays it: full bleed, a progress line, the handle and the caption over the bottom. */
function Phone({ ex, m, muted, className }: { ex: LabExample; m: LabMedia; muted: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const caption = ex.words.find((w) => /caption|post/i.test(w.label))?.text
  useEffect(() => {
    const v = box.current?.querySelector('video')
    if (!v) return
    let raf = 0
    const tick = () => {
      if (v.duration && bar.current) bar.current.style.transform = `scaleX(${v.currentTime / v.duration})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [m.src])
  return (
    <div ref={box} className={cn('relative aspect-[9/16] h-[70svh] max-h-full max-w-full overflow-hidden rounded-[26px] border border-white/10 bg-black shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)] lg:h-full', className)}>
      <Media m={m} big muted={muted} className="size-full object-cover" />
      <span className="absolute inset-x-3 top-3 h-[3px] overflow-hidden rounded-full bg-white/25">
        <span ref={bar} className="block h-full origin-left scale-x-0 rounded-full bg-white" />
      </span>
      {ex.from && <From m={ex.from} big />}
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/30 to-transparent p-4 pt-16 text-white">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <span className="grid size-7 place-items-center rounded-full bg-white text-[9px] text-black">{monogram(ex.brand.name)}</span>@{ex.brand.handle}
          <PlatformIcon id={ex.platform} className="ml-auto size-4 text-white/80" />
        </p>
        {caption && <p className="mt-2 line-clamp-2 whitespace-pre-line text-[12px] leading-snug text-white/90">{caption.replace(/\n{2,}/g, '\n')}</p>}
      </div>
    </div>
  )
}

function Carousel({ list, big }: { list: LabMedia[]; big: boolean }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const reduce = useReducedMotion()
  const [at, setAt] = useState(0)
  // Small, the slides turn by themselves; big, they wait for the arrows (or a swipe).
  useEffect(() => {
    if (big || !seen || reduce || list.length < 2) return
    const t = window.setInterval(() => setAt((n) => (n + 1) % list.length), 2400)
    return () => window.clearInterval(t)
  }, [big, seen, reduce, list.length])
  const go = (by: number) => setAt((n) => (n + by + list.length) % list.length)
  const m = list[at]
  return (
    <div ref={ref} className={cn(big ? 'relative flex aspect-[4/5] h-[70svh] max-h-full max-w-full items-center justify-center lg:h-full' : 'absolute inset-0')}>
      <div className={cn('relative size-full overflow-hidden', big && 'rounded-[20px] shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)]')}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={at} className="absolute inset-0" initial={{ opacity: 0, x: big ? 40 : 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: big ? -40 : 0 }} transition={{ duration: big ? 0.5 : 0.8, ease }}>
            <Media m={m} big={big} className="size-full object-cover" />
          </motion.div>
        </AnimatePresence>
        <span className="absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-md">
          {at + 1} / {list.length}
        </span>
      </div>
      {big && (
        <>
          <button type="button" aria-label="Previous slide" onClick={() => go(-1)} className="absolute left-2 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/75 md:-left-5">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" aria-label="Next slide" onClick={() => go(1)} className="absolute right-2 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/75 md:-right-5">
            <ChevronRight className="size-5" />
          </button>
        </>
      )}
    </div>
  )
}

/** Before and after, small: the after wipes across the before and back. */
function CompareWipe({ ex }: { ex: LabExample }) {
  const [before, after] = ex.panes!
  return (
    <span className="absolute inset-0">
      <Media m={before.m} className="absolute inset-0 size-full object-cover" />
      <span className="absolute inset-0 animate-[lab-wipe_6s_ease-in-out_infinite]">
        <Media m={after.m} className="absolute inset-0 size-full object-cover" />
      </span>
      <span aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_12px_rgb(0_0_0_/_0.6)] animate-[lab-wipe-line_6s_ease-in-out_infinite]" />
      <Tag className="absolute bottom-2 left-2">{before.label}</Tag>
      <Tag className="absolute bottom-2 right-2">{after.label}</Tag>
    </span>
  )
}

/** Before and after, big: drag the line. */
function CompareSlider({ ex }: { ex: LabExample }) {
  const [before, after] = ex.panes!
  const [at, setAt] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const drag = (e: ReactPointerEvent) => {
    const r = box.current?.getBoundingClientRect()
    if (r) setAt(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)))
  }
  return (
    <div
      ref={box}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && drag(e)}
      className="relative h-[70svh] max-h-full max-w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-[20px] shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)] lg:h-full"
      style={{ aspectRatio: `${after.m.w} / ${after.m.h}` }}
    >
      <Media m={before.m} big className="absolute inset-0 size-full object-cover" />
      <span className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }}>
        <Media m={after.m} big className="absolute inset-0 size-full object-cover" />
      </span>
      <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_12px_rgb(0_0_0_/_0.6)]" style={{ left: `${at}%` }}>
        <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-lg">
          <ChevronLeft className="-mr-1 size-3.5" />
          <ChevronRight className="-ml-1 size-3.5" />
        </span>
      </span>
      <Tag className="absolute left-3 top-3">{after.label}</Tag>
      <Tag className="absolute right-3 top-3">{before.label}</Tag>
    </div>
  )
}

function PostHead({ ex, light }: { ex: LabExample; light?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[9px] font-semibold', light ? 'bg-ink text-bone' : 'bg-fg text-ink')}>{monogram(ex.brand.name)}</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12px] font-semibold">{ex.brand.name}</span>
        <span className={cn('block truncate text-[10.5px]', light ? 'text-ink/50' : 'text-dim')}>@{ex.brand.handle}</span>
      </span>
      <PlatformIcon id={ex.platform} className={cn('ml-auto size-3.5 shrink-0', light ? 'text-ink/70' : 'text-muted')} />
    </span>
  )
}

/** Words first: a post as it goes out, on paper, its picture under it. */
function PostBig({ ex, text }: { ex: LabExample; text?: string }) {
  return (
    <article className="no-scrollbar max-h-full w-full max-w-[520px] overflow-y-auto rounded-[18px] bg-bone text-ink shadow-[0_30px_80px_-40px_rgb(0_0_0_/_0.9)]" data-lenis-prevent style={{ ['--tag' as string]: 'color-mix(in oklab, var(--color-accent) 72%, #000)' }}>
      <header className="px-4 pb-3 pt-4">
        <PostHead ex={ex} light />
      </header>
      <PostText text={text ?? ex.words[0]?.text ?? ''} className="px-4 pb-4 text-[14px] leading-[1.5]" />
      {ex.made[0]?.kind === 'image' && <Pic m={ex.made[0]} big className="w-full object-cover" />}
    </article>
  )
}

function RecordingBig({ ex }: { ex: LabExample }) {
  const audio = ex.made.find((m) => m.kind === 'audio')
  const quote = ex.words.find((w) => w.label === 'The moment it found')?.text
  return (
    <div className="no-scrollbar grid max-h-full w-full max-w-[900px] items-center gap-5 overflow-y-auto md:grid-cols-2" data-lenis-prevent>
      <div className="space-y-4 rounded-[18px] border border-white/10 bg-white/[0.03] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">The recording</p>
        <div className="flex h-20 text-accent-soft">
          <Wave bars={48} />
        </div>
        {audio && <audio src={audio.src} controls preload="none" className="w-full" />}
        {quote && (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">The moment it found</p>
            <p className="border-l-2 border-accent/60 pl-3 text-[13.5px] italic leading-relaxed text-fg/90">“{quote}”</p>
          </>
        )}
      </div>
      <PostBig ex={ex} text={ex.words.find((w) => w.label === 'The post')?.text} />
    </div>
  )
}

function PackBig({ ex, muted }: { ex: LabExample; muted: boolean }) {
  const [picture, clip] = ex.made
  return (
    <div className="no-scrollbar flex max-h-full w-full items-center justify-center gap-4 overflow-x-auto" data-lenis-prevent>
      <Media m={picture} big className="h-auto max-h-[62svh] w-auto max-w-[34%] shrink-0 rounded-[18px] object-contain shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)]" />
      <Phone ex={ex} m={clip} muted={muted} className="h-[62svh] w-auto shrink-0 lg:h-[62svh]" />
      <div className="w-[260px] shrink-0">
        <PostBig ex={{ ...ex, platform: 'x', made: [] }} text={ex.words.find((w) => w.label === 'The short post')?.text} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ a template: card and sheet */

/** What a template takes in (its sources) and the steps it runs (the nodes between them and the post). */
function anatomy(t: LabTemplate, catalog: LabCatalog | null) {
  const nodes = [...t.graph.nodes].sort((a, b) => a.x - b.x || a.y - b.y)
  const label = (n: (typeof nodes)[number]) => n.label || catalog?.nodes[n.type]?.label || n.type
  return {
    given: nodes.filter((n) => n.type.startsWith('source.')).map((n) => (n.type === 'source.brief' ? 'Your brief (or a campaign’s)' : n.type === 'source.youtube' ? 'A YouTube link' : label(n))),
    steps: nodes.filter((n) => !n.type.startsWith('source.') && !['finish.channel', 'finish.post', 'util.note'].includes(n.type)),
    label,
  }
}

/** A template as a card: its example playing, what it is, what it makes. */
export function TemplateCard({ t, onOpen, className }: { t: LabTemplate; onOpen: () => void; className?: string }) {
  const ex = exampleFor(t.key)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-panel text-left transition-[border-color,box-shadow] duration-300 hover:border-line-2 hover:shadow-[0_20px_60px_-30px_rgb(0_0_0_/_0.9)]', className)}
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-panel-3">
        {ex ? <ExamplePreview ex={ex} /> : <NoExample t={t} />}
        <Tag className="absolute left-2.5 top-2.5">{t.category}</Tag>
      </span>
      <span className="flex flex-1 flex-col p-3.5">
        <span className="text-[13.5px] font-medium leading-snug">{t.name}</span>
        <span className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">{t.tagline}</span>
        {ex && (
          <span className="mt-auto flex items-center gap-1.5 pt-3 text-[11px] text-dim">
            <span className="grid size-4 place-items-center rounded-full bg-fg text-[7px] font-semibold text-ink">{monogram(ex.brand.name)}</span>
            <span className="truncate">Example for {ex.brand.name}</span>
            <ArrowRight className="ml-auto size-3.5 shrink-0 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-fg" />
          </span>
        )}
      </span>
    </button>
  )
}

/** A template with no example yet (one of yours): its nodes, in a row. */
function NoExample({ t }: { t: LabTemplate }) {
  const types = [...new Set([...t.graph.nodes].sort((a, b) => a.x - b.x).map((n) => n.type))].filter((x) => !['finish.channel', 'finish.post'].includes(x)).slice(0, 5)
  return (
    <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-[radial-gradient(100%_80%_at_50%_0%,rgb(255_255_255_/_0.06),transparent)] px-4">
      {types.map((type, i) => {
        const Icon = iconOf(type)
        return (
          <span key={type} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-3 bg-line-2" />}
            <span className="grid size-9 place-items-center rounded-lg border border-line-2 bg-panel-2 text-muted">
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** A template in full: its example big, what it takes, its steps, and how the example was made. */
export function TemplateDetail({ t, catalog, onUse, useLabel, onAsk, header }: { t: LabTemplate; catalog: LabCatalog | null; onUse: () => void; useLabel: string; onAsk?: () => void; header?: ReactNode }) {
  const ex = exampleFor(t.key)
  const [muted, setMuted] = useState(true)
  const { given, steps, label } = anatomy(t, catalog)
  // Clips with a voice or music get the sound switch (a recording has its own player).
  const sound = !!ex && [...ex.made, ...(ex.panes?.map((p) => p.m) ?? [])].some((m) => m.kind === 'video' && m.sound)
  useEffect(() => setMuted(true), [t.key])

  return (
    <div className="grid gap-5 lg:h-full lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)]">
      <div className="relative flex min-h-[50vh] items-center justify-center overflow-hidden rounded-lg bg-black p-4 lg:min-h-0 lg:p-8">
        {ex ? <ExamplePreview key={t.key} ex={ex} big muted={muted} /> : <div className="relative aspect-[4/3] w-full max-w-lg overflow-hidden rounded-xl"><NoExample t={t} /></div>}
        {sound && (
          <button type="button" onClick={() => setMuted((m) => !m)} className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white backdrop-blur-md transition-colors hover:bg-white/20">
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            {muted ? 'Sound on' : 'Sound off'}
          </button>
        )}
      </div>

      <div className="flex flex-col lg:min-h-0">
        <div key={t.key} className="flex flex-1 flex-col gap-5 pb-5 lg:min-h-0 lg:overflow-y-auto lg:pr-1" data-lenis-prevent>
          {header}
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <span className="rounded border border-line px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{t.category}</span>
              {ex && (
                <>
                  <span>Example for {ex.brand.name} · {ex.brand.trade}</span>
                  <span className="rounded border border-line px-1.5 py-px text-[10.5px] text-dim">Demo brand</span>
                </>
              )}
            </p>
            <h2 className="mt-3 text-[20px] font-medium leading-tight tracking-[-0.02em]">{t.name}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.tagline}</p>
          </div>

          {ex && (
            <section>
              <Label>What it was given</Label>
              <p className="mt-2 border-l-2 border-accent/50 pl-3 text-[13px] leading-relaxed text-fg">{ex.given}</p>
            </section>
          )}

          <section>
            <Label>You bring</Label>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {given.map((g, i) => (
                <li key={i} className="rounded-md border border-line bg-white/[0.02] px-2 py-1 text-[12px] text-muted">{g}</li>
              ))}
              {!given.length && <li className="text-[12px] text-dim">Nothing: it starts from words you type in its nodes.</li>}
            </ul>
          </section>

          <section>
            <Label>The steps</Label>
            <ol className="mt-2 space-y-1.5">
              {steps.map((n, i) => {
                const kind = catalog?.nodes[n.type]
                const Icon = iconOf(n.type)
                const hue = hueOf(kind)
                return (
                  <li key={n.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-dim">{i + 1}</span>
                    <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklab, ${hue} 15%, transparent)`, color: hue }}>
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{label(n)}</span>
                    {kind && <AiBadge kind={kind} />}
                  </li>
                )
              })}
            </ol>
            <p className="mt-2 text-[11.5px] leading-snug text-dim">Then where it goes and the post: you pick the account, and nothing goes out until you say.</p>
          </section>

          {ex && ex.words.length > 0 && (
            <section>
              <Label>What it wrote</Label>
              <div className="mt-2 space-y-2">
                {ex.words.map((w) => (
                  <div key={w.label} className="rounded-md border border-line bg-white/[0.02] p-3" style={{ ['--tag' as string]: 'var(--color-accent-soft)' }}>
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{w.label}</p>
                    <PostText text={w.text} className="text-[12.5px] leading-relaxed text-fg/90" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {ex && (
            <section>
              <Label>How this example was made</Label>
              <ol className="mt-2 space-y-2">
                {ex.steps.map((m, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-[12.5px] leading-snug">
                    <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[9px] text-dim">{j + 1}</span>
                    <span className="min-w-0 flex-1">{m.did}</span>
                    <span className="shrink-0 rounded border border-line px-1.5 py-px font-mono text-[10px] text-dim">{m.model}</span>
                  </li>
                ))}
              </ol>
              {ex.note && <p className="mt-3 rounded-md border border-dashed border-line-2 p-2.5 text-[11.5px] leading-snug text-muted">{ex.note}</p>}
            </section>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-line pt-4">
          <div className="flex gap-2">
            <Btn variant="primary" icon={Plus} onClick={onUse} className="flex-1">
              {useLabel}
            </Btn>
            {onAsk && (
              <Btn icon={MessageCircle} onClick={onAsk}>
                Ask the assistant
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The templates to browse: by category, each a card with its example. */
export function TemplateGrid({ templates, onOpen, limit, dense, className }: { templates: LabTemplate[]; onOpen: (t: LabTemplate) => void; limit?: number; /** More to a row: a sheet the width of the page. */ dense?: boolean; className?: string }) {
  const [category, setCategory] = useState('all')
  const [more, setMore] = useState(false)
  const categories = useMemo(() => [...new Set(templates.map((t) => t.category))], [templates])
  const list = category === 'all' ? templates : templates.filter((t) => t.category === category)
  const shown = limit && !more && category === 'all' ? list.slice(0, limit) : list
  return (
    <div className={className}>
      <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
        <Segmented
          id="lab-gallery-category"
          label="Show"
          options={[{ value: 'all', label: `All ${templates.length}` }, ...categories.map((c) => ({ value: c, label: c }))]}
          value={category}
          onChange={setCategory}
          className="w-fit"
        />
      </div>
      <ul className={cn('mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2', dense ? 'md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5' : 'xl:grid-cols-3 2xl:grid-cols-4')}>
        {shown.map((t, i) => (
          <motion.li key={t.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease, delay: Math.min(i, 8) * 0.035 }}>
            <TemplateCard t={t} onOpen={() => onOpen(t)} />
          </motion.li>
        ))}
      </ul>
      {shown.length < list.length && (
        <div className="mt-4 flex justify-center">
          <Btn variant="subtle" icon={LayoutTemplate} onClick={() => setMore(true)}>
            See all {list.length}
          </Btn>
        </div>
      )}
    </div>
  )
}

/**
 * The templates in one row that scrolls sideways, at the top of a page: seen at once, without taking
 * the page. "See all" opens them as a grid.
 */
export function TemplateStrip({ templates, onOpen, onAll, title, sub }: { templates: LabTemplate[]; onOpen: (t: LabTemplate) => void; onAll: () => void; title: ReactNode; sub?: ReactNode }) {
  const row = useRef<HTMLUListElement>(null)
  const by = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="group/strip">
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          {title}
          {sub && <p className="mt-1 text-[12.5px] leading-snug text-muted">{sub}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => by(-1)} aria-label="Scroll back" className="grid size-8 place-items-center rounded-md border border-line text-dim transition-colors hover:border-line-2 hover:text-fg">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => by(1)} aria-label="Scroll on" className="grid size-8 place-items-center rounded-md border border-line text-dim transition-colors hover:border-line-2 hover:text-fg">
            <ChevronRight className="size-4" />
          </button>
          <Btn size="sm" variant="subtle" icon={LayoutTemplate} onClick={onAll} className="ml-1">
            See all {templates.length}
          </Btn>
        </div>
      </div>
      <ul ref={row} className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1" data-lenis-prevent>
        {templates.map((t) => (
          <li key={t.key} className="w-[248px] shrink-0 snap-start">
            <TemplateCard t={t} onOpen={() => onOpen(t)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One template's sheet, with the ones beside it a step away. */
export function TemplateSheet({ t, list, catalog, open, onClose, onStep, onUse, useLabel, onAsk }: { t: LabTemplate | null; list: LabTemplate[]; catalog: LabCatalog | null; open: boolean; onClose: () => void; onStep: (t: LabTemplate) => void; onUse: (t: LabTemplate) => void; useLabel: string; onAsk?: (t: LabTemplate) => void }) {
  const i = t ? list.findIndex((x) => x.key === t.key) : -1
  const step = (by: number) => list.length && onStep(list[(i + by + list.length) % list.length])
  return (
    <Modal open={open && !!t} onClose={onClose} title={t ? `${String(i + 1).padStart(2, '0')} · ${t.name}` : ''} full>
      {t && (
        <TemplateDetail
          t={t}
          catalog={catalog}
          onUse={() => onUse(t)}
          useLabel={useLabel}
          onAsk={onAsk && (() => onAsk(t))}
          header={
            list.length > 1 && (
              <div className="flex items-center justify-between text-[12px] text-dim">
                <button type="button" onClick={() => step(-1)} className="flex items-center gap-1 transition-colors hover:text-fg">
                  <ArrowLeft className="size-3.5" /> Previous
                </button>
                <span className="font-mono text-[10.5px]">
                  {i + 1} / {list.length}
                </span>
                <button type="button" onClick={() => step(1)} className="flex items-center gap-1 transition-colors hover:text-fg">
                  Next <ArrowRight className="size-3.5" />
                </button>
              </div>
            )
          }
        />
      )}
    </Modal>
  )
}

/**
 * Every template, with examples, in one sheet (from the canvas): the grid, and a template opened in
 * the same sheet, Back returning to the grid.
 */
export function TemplateBrowser({ open, onClose, templates, catalog, onUse, useLabel, start, onAsk }: { open: boolean; onClose: () => void; templates: LabTemplate[]; catalog: LabCatalog | null; onUse: (t: LabTemplate) => void; useLabel: string; start?: LabTemplate | null; onAsk?: (t: LabTemplate) => void }) {
  const [current, setCurrent] = useState<LabTemplate | null>(start ?? null)
  useEffect(() => {
    if (open) setCurrent(start ?? null)
  }, [open, start])
  const i = current ? templates.findIndex((x) => x.key === current.key) : -1
  return (
    <Modal open={open} onClose={onClose} title={current ? current.name : 'What you can make'} full>
      {current ? (
        <TemplateDetail
          t={current}
          catalog={catalog}
          onUse={() => onUse(current)}
          useLabel={useLabel}
          onAsk={onAsk && (() => onAsk(current))}
          header={
            <div className="flex items-center justify-between text-[12px] text-dim">
              <button type="button" onClick={() => setCurrent(null)} className="flex items-center gap-1 transition-colors hover:text-fg">
                <ArrowLeft className="size-3.5" /> Every template
              </button>
              <button type="button" onClick={() => setCurrent(templates[(i + 1) % templates.length])} className="flex items-center gap-1 transition-colors hover:text-fg">
                Next <ArrowRight className="size-3.5" />
              </button>
            </div>
          }
        />
      ) : (
        <div className="h-full overflow-y-auto pr-1" data-lenis-prevent>
          <p className="mb-4 max-w-[70ch] text-[13px] leading-relaxed text-muted">Each template with an example made with it, for a demo brand. Open one to see it big, what it takes and the steps it runs, then use it.</p>
          <TemplateGrid templates={templates} onOpen={setCurrent} dense />
        </div>
      )}
    </Modal>
  )
}

/** The cover a small template button shows (the canvas's template list): its example's first picture or frame. */
export function TemplateThumb({ t, className }: { t: LabTemplate; className?: string }) {
  const ex = exampleFor(t.key)
  const m = ex && coverOf(ex)
  if (!m) {
    const Icon = iconOf(t.graph.nodes.find((n) => !n.type.startsWith('source.'))?.type ?? '')
    return (
      <span className={cn('grid place-items-center bg-white/[0.04] text-dim', className)}>
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
    )
  }
  return <Pic m={m.kind === 'video' && m.poster ? { ...m, kind: 'image', src: m.poster, sm: m.poster } : m} className={cn('object-cover', className)} />
}
