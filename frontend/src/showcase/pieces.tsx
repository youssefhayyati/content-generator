import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Clapperboard, GalleryHorizontal, ImageIcon, Type } from 'lucide-react'
import { PlatformIcon, PLATFORMS } from '../components/ui/PlatformIcon'
import { GROUP_HUE, groupOf, iconOf, PORT_TONE } from '../dashboard/flows/look'
import { cn } from '../lib/cn'
import { src as srcOf, type Case, type FlowLink, type FlowStep, type Plan, type Shot, type Version } from './cases'

/** A showcase picture: its average colour holds the space, then it fades in. */
export function Picture({ shot, size = 'full', className, eager }: { shot: Shot; size?: 'sm' | 'full'; className?: string; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={srcOf(shot, size)}
      alt={shot.alt}
      width={shot.w}
      height={shot.h}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      ref={(el) => {
        if (el?.complete && el.naturalWidth) setLoaded(true)
      }}
      style={{ backgroundColor: shot.tone }}
      className={cn('transition-opacity duration-700 ease-expo', loaded ? 'opacity-100' : 'opacity-0', className)}
    />
  )
}

/** A clip that plays, muted and looping, only while it can be seen. Reduced motion keeps the poster. */
export function Clip({ c, className, size = 'sm' }: { c: Case; className?: string; size?: 'sm' | 'full' }) {
  const ref = useRef<HTMLVideoElement>(null)
  const reduce = useReducedMotion()
  const poster = c.shots?.[0]
  useEffect(() => {
    const v = ref.current
    if (!v || reduce) return
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.2 })
    io.observe(v)
    return () => io.disconnect()
  }, [reduce])
  if (!c.video) return null
  return (
    <video
      ref={ref}
      src={c.video.src}
      poster={poster ? srcOf(poster, size) : undefined}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={poster?.alt}
      style={{ backgroundColor: poster?.tone }}
      className={className}
    />
  )
}

export const monogram = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

/** Hashtags and [placeholders] set apart from the words around them. */
export function PostText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|\[[^\]]+\])/u)
  return (
    <p className={cn('whitespace-pre-line', className)}>
      {parts.map((p, i) =>
        p.startsWith('#') ? (
          <span key={i} className="text-[color:var(--tag)]">
            {p}
          </span>
        ) : p.startsWith('[') ? (
          <span key={i} className="rounded-[4px] bg-[color:var(--tag)]/15 px-1 font-mono text-[0.86em] text-[color:var(--tag)]">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </p>
  )
}

/**
 * A post as it would go out: on paper, so the words read as the thing that was made rather than
 * as part of the page. The network's mark sits in the corner; Instagram versions carry the picture.
 */
export function PostCard({ c, version, clamp, className, withShot = true }: { c: Case; version: Version; clamp?: boolean; className?: string; withShot?: boolean }) {
  const shot = withShot && version.platform === 'instagram' ? c.shots?.[0] : undefined
  return (
    <article
      className={cn('overflow-hidden rounded-[18px] bg-bone text-ink shadow-[0_30px_80px_-40px_rgb(0_0_0_/_0.9)]', className)}
      style={{ ['--tag' as string]: 'color-mix(in oklab, var(--color-accent) 72%, #000)' }}
    >
      <header className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[10.5px] font-semibold tracking-wide text-bone">{monogram(c.brand.name)}</span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[13.5px] font-semibold">{c.brand.name}</span>
          <span className="block truncate text-[12px] text-ink/50">@{c.brand.handle}</span>
        </span>
        <PlatformIcon id={version.platform} className="ml-auto size-4 shrink-0 text-ink/70" />
      </header>
      {shot && <Picture shot={shot} size="sm" className="aspect-square w-full object-cover" />}
      {/* The padding sits outside the clamp: inside it, the next line would show through the padding. */}
      <div className={cn('px-4 pb-4', shot && 'pt-3')}>
        <PostText text={version.text} className={cn('text-[14px] leading-[1.5] tracking-[-0.005em]', clamp && 'line-clamp-[9]')} />
      </div>
    </article>
  )
}

export const platformName = (v: Version) => PLATFORMS[v.platform].name

/* ------------------------------------------------------------------ */
/* The flow, drawn                                                     */
/* ------------------------------------------------------------------ */

const LANE_X = [17, 50, 83]

/**
 * The composed flow on a dotted board: the steps in their lanes, lines in the colour of the port
 * they leave by, and a point of light running down each line in turn.
 */
export function FlowMap({ flow, compact, fit, className }: { flow: NonNullable<Case['flow']>; compact?: boolean; fit?: boolean; className?: string }) {
  const reduce = useReducedMotion()
  // SMIL chains its pulses by element id, and one page can draw the same flow more than once.
  const uid = 'p' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const rows = Math.max(...flow.steps.map((s) => s.row)) + 1
  const ROW = 72
  const H = rows * ROW
  const at = (id: string) => flow.steps.find((s) => s.id === id)!
  const point = (s: FlowStep) => ({ x: LANE_X[s.lane] * 3, y: s.row * ROW + ROW / 2 })
  const path = (l: FlowLink) => {
    const a = point(at(l.from))
    const b = point(at(l.to))
    const dy = (b.y - a.y) * 0.5
    return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`
  }

  // fit: as tall as the box on wide screens, where the box has a height; full width otherwise.
  return (
    <div
      className={cn('relative w-full', fit && 'lg:h-full lg:w-auto', className)}
      style={{ aspectRatio: `300 / ${H}`, backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)', backgroundSize: compact ? '14px 14px' : '20px 20px' }}
    >
      <svg viewBox={`0 0 300 ${H}`} className="absolute inset-0 size-full overflow-visible" preserveAspectRatio="none" aria-hidden>
        {flow.links.map((l, i) => (
          <g key={i}>
            <path d={path(l)} fill="none" stroke={PORT_TONE[l.port]} strokeOpacity={0.45} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
            {!reduce && (
              <circle r={compact ? 2.2 : 3} fill={PORT_TONE[l.port]} opacity={0}>
                <animateMotion dur="1.1s" begin={`${i * 0.55}s;${uid}x${i}.end+${flow.links.length * 0.55 - 1.1}s`} id={`${uid}x${i}`} path={path(l)} fill="freeze" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.2 1" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="1.1s" begin={`${uid}x${i}.begin`} fill="freeze" />
              </circle>
            )}
          </g>
        ))}
      </svg>
      {flow.steps.map((s) => {
        const Icon = iconOf(s.type)
        const hue = GROUP_HUE[groupOf(s.type)]
        return (
          <div
            key={s.id}
            className={cn(
              'absolute flex -translate-x-1/2 -translate-y-1/2 items-center border border-line-2 bg-panel-2 shadow-[0_10px_30px_-12px_rgb(0_0_0_/_0.8)]',
              compact ? 'w-[32%] gap-1 rounded-md px-1.5 py-1' : 'w-[31%] gap-2 rounded-lg px-2 py-1.5',
            )}
            style={{ left: `${LANE_X[s.lane]}%`, top: `${((s.row * ROW + ROW / 2) / H) * 100}%` }}
          >
            {compact ? (
              <Icon className="size-3 shrink-0" strokeWidth={2} style={{ color: hue }} />
            ) : (
              <span className="grid size-6 shrink-0 place-items-center rounded" style={{ background: `color-mix(in oklab, ${hue} 18%, transparent)`, color: hue }}>
                <Icon className="size-3.5" strokeWidth={2} />
              </span>
            )}
            <span className="min-w-0 leading-tight">
              <span className={cn('block truncate font-medium text-fg', compact ? 'text-[9.5px]' : 'text-[12px]')}>{s.label}</span>
              {!compact && <span className="block truncate text-[10.5px] text-dim">{s.detail}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The campaign plan                                                   */
/* ------------------------------------------------------------------ */

export const FORMAT_ICON = { image: ImageIcon, carousel: GalleryHorizontal, video: Clapperboard, text: Type } as const

export function PlanBoard({ plan, className }: { plan: Plan; className?: string }) {
  return (
    <div className={cn('rounded-[20px] border border-line bg-panel p-5 md:p-7', className)}>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">Big idea</p>
      <p className="mt-2 font-serif text-[clamp(1.6rem,2.6vw,2.4rem)] italic leading-[1.05] tracking-[-0.01em]">{plan.idea}</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        {plan.pillars.map((p, i) => (
          <div key={p.name} className="rounded-xl border border-line bg-white/[0.02] p-3">
            <p className="font-mono text-[10px] text-dim">P{i + 1}</p>
            <p className="mt-1 text-[13px] font-medium leading-snug">{p.name}</p>
            <p className="mt-1 text-[12px] leading-snug text-muted">{p.why}</p>
          </div>
        ))}
      </div>
      <p className="mt-7 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">{plan.posts.length} posts</p>
      <ol className="mt-2 divide-y divide-line border-y border-line">
        {plan.posts.map((p, i) => {
          const Icon = FORMAT_ICON[p.format]
          return (
            <li key={p.title} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-3 sm:grid-cols-[22px_minmax(0,1fr)_auto]">
              <span className="pt-0.5 font-mono text-[11px] text-dim">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium leading-snug">{p.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">“{p.hook}” {p.message}</span>
              </span>
              <span className="col-start-2 mt-2 flex items-center gap-1.5 self-start text-[11.5px] capitalize text-dim sm:col-start-auto sm:mt-0">
                <Icon className="size-3.5" strokeWidth={1.75} />
                {p.format}
                <span className="text-line-2">·</span>
                <span className="normal-case">{p.pillar}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** A small label that sits over a picture: dark glass, mono caps. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/90 backdrop-blur-md', className)}>
      {children}
    </span>
  )
}
