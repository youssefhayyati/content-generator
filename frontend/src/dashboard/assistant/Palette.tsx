import { Plus } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Label } from '../ui'
import type { TextBox } from './store'

/*
 * Colours for the texts on a post: the picture's own (sent with each slide by the assistant), a
 * curated set, and any other. Each is checked against what is behind the text, the same way the
 * assistant checks it (studio.py, readability()), so the ones hard to read there are marked before
 * they're picked.
 */

export const CLASSIC = [
  { name: 'White', color: '#ffffff' },
  { name: 'Cream', color: '#f6efe4' },
  { name: 'Sand', color: '#e8d5b5' },
  { name: 'Ink', color: '#111111' },
  { name: 'Sun', color: '#ffd23f' },
  { name: 'Tangerine', color: '#ff8a3d' },
  { name: 'Coral', color: '#ff5a5f' },
  { name: 'Rose', color: '#ff8fc0' },
  { name: 'Sky', color: '#7cc4ff' },
  { name: 'Mint', color: '#5ee39a' },
  { name: 'Iris', color: '#a78bfa' },
  { name: 'Forest', color: '#0e3b2e' },
  { name: 'Navy', color: '#1d2b53' },
  { name: 'Wine', color: '#5b1a2b' },
]
const HARD = 2.2

let probe: CanvasRenderingContext2D | null = null

/** Any CSS colour ("white", "#ffd400", "gold") as #rrggbb. */
export function toHex(color: string): string {
  const c = color.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(c)) return c
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe) return '#ffffff'
  probe.fillStyle = '#000000'
  probe.fillStyle = c
  return String(probe.fillStyle)
}

function luminance(color: string): number {
  const hex = toHex(color)
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** How readable a look is over a picture whose darker and lighter parts are bg (1–21). */
export function readability(look: { color: string; style: string; box_color: string }, bg: [number, number]): number {
  const [lo, hi] = bg
  const ink = luminance(look.color)
  if (look.style === 'box') {
    const panel = luminance(look.box_color)
    return Math.min(ratio(ink, 0.82 * panel + 0.18 * lo), ratio(ink, 0.82 * panel + 0.18 * hi))
  }
  const worst = Math.min(ratio(ink, lo), ratio(ink, hi))
  if (look.style === 'outline') return Math.max(worst, 0.8 * ratio(ink, luminance(look.box_color)))
  return look.style === 'shadow' ? worst * 1.3 : worst
}

function verdict(r: number) {
  if (r >= 4.5) return { label: 'Easy to read', tone: 'text-ok', dot: 'bg-ok' }
  if (r >= 3) return { label: 'Readable', tone: 'text-muted', dot: 'bg-white/60' }
  if (r >= HARD) return { label: 'A bit faint', tone: 'text-warn', dot: 'bg-warn' }
  return { label: 'Hard to read here', tone: 'text-fail', dot: 'bg-fail' }
}

type Look = { color: string; style: string; box_color: string }

/** Ready-made looks that read well on this spot, from the picture's colours and the classics. */
function suggestions(t: TextBox, palette: string[]): Array<Look & { score: number }> {
  const bg = t.bg ?? [0.2, 0.6]
  const tint = palette[0] ?? '#f6efe4'
  const deep = palette[palette.length - 1] ?? '#111111'
  const accent = palette.length > 2 ? palette[1] : '#ffd23f'
  const looks: Look[] = [
    { color: '#ffffff', style: 'shadow', box_color: 'black' },
    { color: '#111111', style: 'plain', box_color: 'black' },
    { color: tint, style: 'box', box_color: deep },
    { color: '#111111', style: 'box', box_color: tint },
    { color: accent, style: 'outline', box_color: '#111111' },
    { color: accent, style: 'box', box_color: deep },
    { color: '#ffffff', style: 'box', box_color: accent },
  ]
  const seen = new Set<string>()
  return looks
    .map((l) => ({ ...l, score: readability(l, bg) }))
    .filter((l) => {
      const key = `${toHex(l.color)}${l.style}${l.style === 'box' || l.style === 'outline' ? toHex(l.box_color) : ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return l.score >= 3
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 4)
}

function Swatch({ color, name, on, hard, onPick }: { color: string; name: string; on: boolean; hard: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`${name}${hard ? ', hard to read here' : ''}`}
      aria-pressed={on}
      title={`${name}${hard ? ' · hard to read here' : ''}`}
      className={cn(
        'relative size-6 rounded-full border transition-transform hover:scale-110',
        on ? 'border-accent-soft ring-2 ring-accent-soft/50 ring-offset-2 ring-offset-panel' : 'border-white/20',
      )}
      style={{ background: color }}
    >
      {hard && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-panel bg-warn" />}
    </button>
  )
}

/** A row of colours: the picture's, then the classics, then any other. */
function Swatches({ value, palette, hardFor, onPick }: { value: string; palette: string[]; hardFor: (c: string) => boolean; onPick: (c: string) => void }) {
  const current = toHex(value)
  const known = [...palette, ...CLASSIC.map((c) => c.color)].some((c) => toHex(c) === current)
  return (
    <div className="space-y-2">
      {palette.length > 0 && (
        <div className="flex gap-2">
          <span className="w-14 shrink-0 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-dim">Picture</span>
          <div className="flex flex-wrap gap-1.5">
            {palette.map((c, i) => (
              <Swatch key={c} color={c} name={`From the picture, ${i + 1}`} on={toHex(c) === current} hard={hardFor(c)} onPick={() => onPick(c)} />
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <span className="w-14 shrink-0 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-dim">Classic</span>
        <div className="flex flex-wrap gap-1.5">
          {CLASSIC.map((c) => (
            <Swatch key={c.color} color={c.color} name={c.name} on={toHex(c.color) === current} hard={hardFor(c.color)} onPick={() => onPick(c.color)} />
          ))}
          <label
            className={cn(
              'relative grid size-6 cursor-pointer place-items-center rounded-full border border-dashed text-dim hover:text-fg',
              known ? 'border-white/30' : 'border-accent-soft ring-2 ring-accent-soft/50 ring-offset-2 ring-offset-panel',
            )}
            title="Any colour"
            style={known ? undefined : { background: current }}
          >
            {known && <Plus className="size-3" />}
            <input type="color" aria-label="Any colour" value={current} className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => onPick(e.target.value)} />
          </label>
        </div>
      </div>
    </div>
  )
}

/** The colour part of the text editor: text colour, panel or outline colour, looks that read well. */
export function TextColours({ t, palette, onChange }: { t: TextBox; palette: string[]; onChange: (fields: Record<string, string>) => void }) {
  const bg = t.bg
  const score = bg ? readability(t, bg) : null
  const v = score === null ? null : verdict(score)
  const looks = bg ? suggestions(t, palette) : []
  const second = t.style === 'box' ? 'Panel' : t.style === 'outline' ? 'Outline' : null

  return (
    <div className="space-y-3.5">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <Label>Colour</Label>
          {v && score !== null && (
            <span className={cn('flex items-center gap-1.5 font-mono text-[10px]', v.tone)} title="Contrast with what is behind it">
              <span className={cn('size-1.5 rounded-full', v.dot)} />
              {v.label} · {score.toFixed(1)}:1
            </span>
          )}
        </div>
        <Swatches value={t.color} palette={palette} hardFor={(c) => !!bg && readability({ ...t, color: c }, bg) < HARD} onPick={(color) => onChange({ color })} />
      </div>

      {second && (
        <div>
          <Label className="mb-1.5">{second} colour</Label>
          <Swatches value={t.box_color} palette={palette} hardFor={(c) => !!bg && readability({ ...t, box_color: c }, bg) < HARD} onPick={(box_color) => onChange({ box_color })} />
        </div>
      )}

      {looks.length > 0 && (
        <div>
          <Label className="mb-1.5">Looks that read well here</Label>
          <div className="flex flex-wrap gap-1.5">
            {looks.map((l) => {
              const on = toHex(l.color) === toHex(t.color) && l.style === t.style && (l.style === 'shadow' || l.style === 'plain' || toHex(l.box_color) === toHex(t.box_color))
              const back = l.style === 'box' ? l.box_color : `linear-gradient(135deg, ${grey(bg![0])}, ${grey(bg![1])})`
              return (
                <button
                  key={`${l.color}${l.style}${l.box_color}`}
                  type="button"
                  onClick={() =>
                    onChange({
                      color: l.color,
                      style: l.style,
                      box_color: l.box_color,
                    })
                  }
                  title={`${l.style === 'box' ? 'On a panel' : l.style === 'outline' ? 'Outlined' : l.style === 'shadow' ? 'With a shadow' : 'Plain'} · ${l.score.toFixed(1)}:1`}
                  aria-label={`Use this look: ${l.style}, ${l.score.toFixed(1)} to 1`}
                  className={cn(
                    'grid h-9 w-14 place-items-center rounded-md border text-[15px] font-extrabold transition-transform hover:scale-105',
                    on ? 'border-accent-soft ring-2 ring-accent-soft/40' : 'border-white/15',
                  )}
                  style={{
                    background: back,
                    color: l.color,
                    textShadow: l.style === 'shadow' ? '0 1px 3px rgb(0 0 0 / 0.7)' : undefined,
                    WebkitTextStroke: l.style === 'outline' ? `1px ${l.box_color}` : undefined,
                  }}
                >
                  Aa
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** A luminance as the grey that has it, to show roughly what is behind a text. */
function grey(lum: number) {
  const v = lum <= 0.0031308 ? lum * 12.92 : 1.055 * lum ** (1 / 2.4) - 0.055
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255)
  return `rgb(${c} ${c} ${c})`
}
