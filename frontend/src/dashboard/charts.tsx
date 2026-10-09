import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'

/*
 * Chart colours come from the palette tokens in index.css (--color-series, --color-heat-*),
 * validated with the dataviz checker against the panel surface:
 *   SERIES  — single-series slot: lightness band, chroma floor, ≥3:1 contrast all pass.
 *   HEAT    — one-hue sequential ramp (accent, dark → light): monotone, ΔL ≥ 0.06 per
 *             step, darkest step 2.49:1. Zero is not on the ramp; it's an empty cell.
 * Text never takes these colours — values and labels stay in text tokens.
 */
export const SERIES = 'var(--color-series)'
export const SURFACE = 'var(--color-panel)'
export const HEAT = [1, 2, 3, 4, 5].map((i) => `var(--color-heat-${i})`)

const GRID = 'rgb(255 255 255 / 0.06)'
const BASELINE = 'rgb(255 255 255 / 0.14)'

function useWidth<T extends HTMLElement>(initial = 600) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function niceStep(max: number, ticks = 4) {
  if (max <= ticks) return 1
  const raw = max / ticks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10
  return step * mag
}

/** Tooltip: the value leads, the label follows; a short stroke keys the series. */
function Tip({ left, value, label, keyed = true }: { left: number; value: ReactNode; label: ReactNode; keyed?: boolean }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-[150px] rounded-md border border-line-2 bg-panel-3 px-3 py-2 shadow-xl"
      style={{ left }}
    >
      <p className="text-[15px] font-semibold tracking-[-0.01em]">{value}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
        {keyed && <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: SERIES }} />}
        {label}
      </p>
    </div>
  )
}

/** Visually hidden table so every chart has a non-visual twin. */
function SrTable({ caption, rows }: { caption: string; rows: Array<[string, number | string]> }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ------------------------------------------------------------------ */
/* Columns — one series, a handful of days                              */
/* ------------------------------------------------------------------ */

export function ColumnChart({
  data,
  height = 150,
  caption,
  unit = 'posts',
}: {
  data: Array<{ label: string; full: string; value: number; current?: boolean }>
  height?: number
  caption: string
  unit?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>(300)
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const yMax = Math.ceil(max / niceStep(max)) * niceStep(max)
  const axis = 22
  const plotH = height - axis
  const slot = width / data.length
  const barW = Math.min(24, slot * 0.5)
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0)

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={caption}>
        <line x1={0} x2={width} y1={plotH + 0.5} y2={plotH + 0.5} stroke={BASELINE} />
        {data.map((d, i) => {
          // Never shorter than its own rounded cap, so a 1 next to a 40 still reads as a bar.
          const h = Math.max(6, (d.value / yMax) * (plotH - 18))
          const x = i * slot + (slot - barW) / 2
          return (
            <g
              key={d.label + i}
              tabIndex={0}
              role="img"
              aria-label={`${d.full}: ${d.value} ${unit}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="cursor-default outline-none"
            >
              {/* The whole slot is the hit target, not just the painted bar. */}
              <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
              {hover === i && <rect x={i * slot + 2} y={0} width={slot - 4} height={plotH} rx={6} fill="rgb(255 255 255 / 0.03)" />}
              {d.value > 0 && (
                <motion.path
                  d={`M${x},${plotH} v${-(h - 4)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${h - 4} z`}
                  style={{ fill: SERIES, transformOrigin: `${x + barW / 2}px ${plotH}px` }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1, opacity: hover === null || hover === i ? 1 : 0.55 }}
                  transition={{ duration: 0.9, ease, delay: 0.15 + i * 0.05 }}
                />
              )}
              {i === peak && d.value > 0 && (
                <text x={x + barW / 2} y={plotH - h - 7} textAnchor="middle" className="fill-fg font-mono text-[10.5px]">
                  {d.value}
                </text>
              )}
              <text
                x={i * slot + slot / 2}
                y={height - 5}
                textAnchor="middle"
                className={cn('font-mono text-[10px]', d.current ? 'fill-fg' : 'fill-dim')}
              >
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <Tip
          left={Math.min(width - 150, Math.max(0, hover * slot + slot / 2 - 75))}
          value={`${data[hover].value} ${data[hover].value === 1 ? unit.replace(/s$/, '') : unit}`}
          label={data[hover].full}
        />
      )}
      <SrTable caption={caption} rows={data.map((d) => [d.full, d.value])} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Line — one series over time, crosshair + table view                  */
/* ------------------------------------------------------------------ */

const PAD = { top: 16, right: 40, bottom: 28, left: 36 }

export function LineChart({
  points,
  height = 260,
  caption,
  unit,
  mode,
}: {
  points: Array<{ label: string; full: string; value: number }>
  height?: number
  caption: string
  unit: string
  mode: 'chart' | 'table'
}) {
  const [ref, width] = useWidth<HTMLDivElement>(640)
  const [hover, setHover] = useState<number | null>(null)

  const values = points.map((p) => p.value)
  const max = Math.max(1, ...values)
  const step = niceStep(max)
  const yMax = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)
  const innerW = Math.max(10, width - PAD.left - PAD.right)
  const innerH = height - PAD.top - PAD.bottom
  const n = Math.max(1, points.length - 1)
  const x = (i: number) => PAD.left + (i / n) * innerW
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = `${line}L${x(values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  const xTicks = Array.from({ length: 5 }, (_, k) => Math.round((k / 4) * (points.length - 1)))
  const last = values.length - 1

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - PAD.left) / innerW) * n)
    setHover(Math.min(last, Math.max(0, i)))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setHover((h) => Math.min(last, Math.max(0, (h ?? last) + (e.key === 'ArrowRight' ? 1 : -1))))
  }
  const tipLeft = hover === null ? 0 : Math.min(width - 150, Math.max(0, x(hover) - 75))
  const shape = `${points.length}-${values.join(',')}`

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {mode === 'chart' ? (
        <>
          <svg
            width={width}
            height={height}
            tabIndex={0}
            role="img"
            aria-label={`${caption}. Use the left and right arrow keys to read values.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(last)}
            onBlur={() => setHover(null)}
            onKeyDown={onKey}
            className="block touch-pan-y outline-none"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASELINE : GRID} />
                <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-dim font-mono text-[10px] tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {xTicks.map((i) => (
              <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-dim font-mono text-[10px]">
                {points[i]?.label}
              </text>
            ))}

            <motion.path
              key={`a-${shape}`}
              d={area}
              style={{ fill: SERIES }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.1 }}
              transition={{ duration: 0.8, delay: 0.5 }}
            />
            <motion.path
              key={`l-${shape}`}
              d={line}
              fill="none"
              style={{ stroke: SERIES }}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.3, ease }}
            />
            <circle cx={x(last)} cy={y(values[last] ?? 0)} r={4} style={{ fill: SERIES, stroke: SURFACE }} strokeWidth={2} />
            <text x={x(last) + 9} y={y(values[last] ?? 0)} dy="0.32em" className="fill-fg font-mono text-[11px]">
              {values[last]}
            </text>

            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="rgb(255 255 255 / 0.3)" />
                <circle cx={x(hover)} cy={y(values[hover])} r={4.5} style={{ fill: SERIES, stroke: SURFACE }} strokeWidth={2} />
              </g>
            )}
          </svg>
          {hover !== null && <Tip left={tipLeft} value={values[hover]} label={`${unit} · ${points[hover].full}`} />}
        </>
      ) : (
        <div data-lenis-prevent className="h-full overflow-auto rounded-md border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-panel-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              <tr>
                <th className="px-3 py-2 font-normal">Date</th>
                <th className="px-3 py-2 text-right font-normal">{unit}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...points].reverse().map((p) => (
                <tr key={p.full} className="border-t border-line">
                  <td className="px-3 py-1.5 text-muted">{p.full}</td>
                  <td className="px-3 py-1.5 text-right">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Horizontal bars — one series across nominal categories               */
/* ------------------------------------------------------------------ */

export function BarList({
  rows,
  caption,
  unit = 'posts',
}: {
  rows: Array<{ key: string; label: ReactNode; name: string; value: number }>
  caption: string
  unit?: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((s, r) => s + r.value, 0) || 1

  return (
    <ul className="space-y-3" aria-label={caption}>
      {rows.map((r, i) => {
        const dim = hover !== null && hover !== r.key
        return (
          <li
            key={r.key}
            tabIndex={0}
            aria-label={`${r.name}: ${r.value} ${unit}, ${Math.round((r.value / total) * 100)}%`}
            onPointerEnter={() => setHover(r.key)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(r.key)}
            onBlur={() => setHover(null)}
            className="grid grid-cols-[96px_1fr] items-center gap-3 rounded-md text-[12.5px] outline-none transition-opacity duration-300"
            style={{ opacity: dim ? 0.5 : 1 }}
          >
            <span className="flex min-w-0 items-center gap-2 text-muted">{r.label}</span>
            <span className="flex items-center gap-2.5">
              <span className="relative h-2.5 flex-1">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-r-[4px]"
                  style={{ background: SERIES }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.value / max) * 100}%` }}
                  transition={{ duration: 1, ease, delay: 0.1 + i * 0.06 }}
                />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-fg">
                {hover === r.key ? `${Math.round((r.value / total) * 100)}%` : r.value}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* Heatmap — weekday × hour, one-hue sequential                         */
/* ------------------------------------------------------------------ */

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

export function Heatmap({ grid, mode }: { grid: number[][]; mode: 'chart' | 'table' }) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  const max = Math.max(0, ...grid.flat())
  const bucket = (v: number) => (v <= 0 || max === 0 ? -1 : Math.min(HEAT.length - 1, Math.ceil((v / max) * HEAT.length) - 1))

  if (mode === 'table') {
    const rows = grid.flatMap((hours, d) => hours.map((v, h) => ({ d, h, v }))).filter((c) => c.v > 0)
    return (
      <div data-lenis-prevent className="max-h-[260px] overflow-auto rounded-md border border-line">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-panel-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
            <tr>
              <th className="px-3 py-2 font-normal">Day</th>
              <th className="px-3 py-2 font-normal">Hour</th>
              <th className="px-3 py-2 text-right font-normal">Posts</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-dim">
                  Nothing scheduled yet.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={`${c.d}-${c.h}`} className="border-t border-line">
                <td className="px-3 py-1.5 text-muted">{DAYS_LONG[c.d]}</td>
                <td className="px-3 py-1.5 text-muted">{hourLabel(c.h)}</td>
                <td className="px-3 py-1.5 text-right">{c.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[560px] grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-[2px]">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="pb-1 text-center font-mono text-[9.5px] text-dim">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </span>
          ))}
          {grid.map((hours, d) => (
            <div key={d} className="contents">
              <span className="flex items-center font-mono text-[10px] text-dim">{DAYS_SHORT[d]}</span>
              {hours.map((v, h) => {
                const b = bucket(v)
                const on = hover?.[0] === d && hover?.[1] === h
                return (
                  <motion.span
                    key={h}
                    tabIndex={v > 0 ? 0 : -1}
                    aria-label={`${DAYS_LONG[d]} ${hourLabel(h)}: ${v} posts`}
                    onPointerEnter={() => setHover([d, h])}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover([d, h])}
                    onBlur={() => setHover(null)}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, ease, delay: 0.1 + (d * 24 + h) * 0.002 }}
                    className={cn(
                      'aspect-square rounded-[3px] outline-none transition-shadow duration-200',
                      on && 'shadow-[0_0_0_1.5px_rgb(255_255_255_/_0.8)]',
                    )}
                    style={{ background: b < 0 ? 'rgb(255 255 255 / 0.035)' : HEAT[b] }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="min-h-[18px] text-[12px] text-muted">
          {hover ? (
            <>
              <span className="font-semibold text-fg">{grid[hover[0]][hover[1]]}</span> posts ·{' '}
              {DAYS_LONG[hover[0]]}s, {hourLabel(hover[1])}–{hourLabel((hover[1] + 1) % 24)}
            </>
          ) : (
            'Hover a cell for the count.'
          )}
        </p>
        <div className="flex items-center gap-2 font-mono text-[10px] text-dim" aria-hidden>
          Fewer
          <span className="flex gap-[2px]">
            {HEAT.map((c) => (
              <span key={c} className="size-3 rounded-[2px]" style={{ background: c }} />
            ))}
          </span>
          More
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stat tile — label · value · delta · sparkline                        */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  delta,
  trend,
  period,
}: {
  label: string
  value: ReactNode
  /** Change against the previous period, as a count; omitted for tiles without one. */
  delta?: number
  trend?: number[]
  period?: string
}) {
  const w = 96
  const h = 28
  const pts =
    trend && trend.length > 1
      ? (() => {
          const min = Math.min(...trend)
          const max = Math.max(...trend)
          return trend.map((v, i) => [(i / (trend.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)] as const)
        })()
      : null
  const end = pts?.[pts.length - 1]

  return (
    <div className="bg-panel p-4 md:p-5">
      <p className="text-[12.5px] text-muted">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-[28px] font-semibold leading-none tracking-[-0.03em] md:text-[32px]">{value}</p>
        {pts && end && (
          <svg width={w} height={h} className="hidden shrink-0 overflow-visible sm:block" aria-hidden>
            <polyline
              points={pts.map((p) => p.join(',')).join(' ')}
              fill="none"
              stroke="rgb(255 255 255 / 0.28)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx={end[0]} cy={end[1]} r={3} style={{ fill: SERIES, stroke: SURFACE }} strokeWidth={2} />
          </svg>
        )}
      </div>
      {delta !== undefined && (
        <p className={cn('mt-3 flex items-center gap-1 text-[11.5px]', delta > 0 ? 'text-ok' : delta < 0 ? 'text-fail' : 'text-dim')}>
          {delta > 0 ? <ArrowUpRight className="size-3.5" /> : delta < 0 ? <ArrowDownRight className="size-3.5" /> : <Minus className="size-3.5" />}
          {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
          {Math.abs(delta)}
          <span className="ml-1 text-dim">vs {period}</span>
        </p>
      )}
    </div>
  )
}
