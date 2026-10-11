import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'
import { ease } from '../../lib/motion'

/*
 * The palettes in index.css, chosen in Settings → Appearance.
 * The choice is kept on this device and applies to the whole site, the landing page included.
 */

export type Swatch = { ink: string; card: string; fg: string; accent: string; soft: string }

export const PALETTES: Array<{ id: string; name: string; mood: string; swatch: Swatch }> = [
  { id: 'indigo', name: 'Indigo', mood: 'Classic AI-tool violet blue', swatch: { ink: '#050505', card: '#101010', fg: '#f5f4f0', accent: '#6062f1', soft: '#a5b4fc' } },
  { id: 'acid', name: 'Acid', mood: 'Electric lime on black, loud and editorial', swatch: { ink: '#070707', card: '#121211', fg: '#f2f1ea', accent: '#c6f432', soft: '#e1fb8f' } },
  { id: 'ember', name: 'Ember', mood: 'Warm black, signal orange, cream type', swatch: { ink: '#0b0908', card: '#161210', fg: '#f4ede3', accent: '#ff5b1f', soft: '#ffb38a' } },
  { id: 'cobalt', name: 'Cobalt', mood: 'Deep navy, electric blue, crisp and techy', swatch: { ink: '#04060c', card: '#0d111b', fg: '#eef2fb', accent: '#2f6bff', soft: '#8fb3ff' } },
  { id: 'mint', name: 'Mint', mood: 'Green-black with fresh mint, calm automation', swatch: { ink: '#050807', card: '#0f1513', fg: '#eef5f1', accent: '#2ee6a6', soft: '#94f5d0' } },
  { id: 'coral', name: 'Coral', mood: 'Social, friendly, creator energy', swatch: { ink: '#0a0708', card: '#171113', fg: '#f7eeec', accent: '#ff5f57', soft: '#ffb0a8' } },
  { id: 'gold', name: 'Gold', mood: 'Quiet luxury, premium agency feel', swatch: { ink: '#080706', card: '#15120e', fg: '#f3eee4', accent: '#e3b34c', soft: '#f2d9a0' } },
  { id: 'bloom', name: 'Bloom', mood: 'Plum black, petal pink, a violet second', swatch: { ink: '#0c080c', card: '#181117', fg: '#f8eef6', accent: '#f6a6f0', soft: '#fbd3f7' } },
  { id: 'glacier', name: 'Glacier', mood: 'Arctic night with pale ice blue, cool and clear', swatch: { ink: '#03090c', card: '#0b161b', fg: '#ecf6f7', accent: '#8fe0ec', soft: '#c3e8ee' } },
  { id: 'bone', name: 'Bone', mood: 'Warm charcoal and unbleached cream, print-shop calm', swatch: { ink: '#0e0d0b', card: '#1a1814', fg: '#f0eee9', accent: '#e3d6bd', soft: '#efe7d6' } },
  { id: 'mono', name: 'Mono', mood: 'Pure black and white, gallery minimal', swatch: { ink: '#000000', card: '#0e0e0e', fg: '#f5f5f5', accent: '#f5f5f5', soft: '#d4d4d4' } },
]

const KEY = 'flowai-palette'

/** Applies the saved palette; called before the first render so the page never flashes. */
export function applySavedPalette() {
  try {
    const id = localStorage.getItem(KEY)
    if (id && id !== 'indigo') document.documentElement.dataset.palette = id
  } catch {
    /* storage blocked: stay on the default */
  }
}

/** Puts a palette on the page and remembers it on this device. */
export function applyPalette(id: string) {
  const root = document.documentElement
  if (id === 'indigo') delete root.dataset.palette
  else root.dataset.palette = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* not remembered, still applied */
  }
}

/**
 * Puts a palette on the page as a circle of the new colours growing from `from` (a point on screen)
 * until it covers the window. `commit` is any state that should already show in the new colours,
 * like the picker's tick. Without view transitions, or with reduced motion, it simply switches.
 */
export function washPalette(id: string, from: { x: number; y: number }, commit?: () => void) {
  const apply = () => {
    if (commit) flushSync(commit)
    applyPalette(id)
  }
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return apply()
  const { x, y } = from
  const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  document
    .startViewTransition(apply)
    .ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
        { duration: 950, easing: `cubic-bezier(${ease.join(', ')})`, pseudoElement: '::view-transition-new(root)' },
      )
    })
    .catch(() => {})
}

/** A card per palette; picking one washes it over the page from that card. */
export function PalettePicker() {
  const [current, setCurrent] = useState(() => document.documentElement.dataset.palette ?? 'indigo')

  useEffect(() => applyPalette(current), [current])

  return (
    <div role="radiogroup" aria-label="Palette" className="grid gap-2 sm:grid-cols-2">
      {PALETTES.map((p) => {
        const on = p.id === current
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              washPalette(p.id, { x: r.left + 36, y: r.top + r.height / 2 }, () => setCurrent(p.id))
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors duration-300',
              on ? 'border-accent/70 bg-accent/10' : 'border-line hover:border-line-2 hover:bg-fg/[0.03]',
            )}
          >
            <Chip swatch={p.swatch} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">{p.name}</span>
              <span className="block truncate text-[11.5px] text-dim">{p.mood}</span>
            </span>
            {on && <Check className="mr-1 size-3.5 shrink-0 text-accent" strokeWidth={2.5} />}
          </button>
        )
      })}
    </div>
  )
}

/** A miniature of the page in that palette: background, a card, a line of type, a button. */
export function Chip({ swatch: s }: { swatch: Swatch }) {
  return (
    <span className="relative block h-12 w-[72px] shrink-0 overflow-hidden rounded-md border border-white/10" style={{ background: s.ink }}>
      <span className="absolute left-1.5 top-1.5 h-1 w-7 rounded-full" style={{ background: s.fg }} />
      <span className="absolute left-1.5 top-[13px] h-1 w-4 rounded-full opacity-60" style={{ background: s.soft }} />
      <span className="absolute bottom-1.5 left-1.5 h-3 w-6 rounded-full" style={{ background: s.accent }} />
      <span className="absolute bottom-1.5 right-1.5 top-1.5 w-6 rounded-md" style={{ background: s.card }}>
        <span className="absolute inset-x-1 bottom-1 h-3 rounded-sm opacity-80" style={{ background: `linear-gradient(to top, ${s.accent}, transparent)` }} />
      </span>
    </span>
  )
}
