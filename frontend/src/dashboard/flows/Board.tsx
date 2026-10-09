import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CircleDashed, Hourglass, LoaderCircle, Maximize2, Minus, Plus, X } from 'lucide-react'
import type { Account, FlowCatalog, FlowGraph, FlowNode, FlowPort, FlowRun, TrailEntry } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { curve, edgePath, hueOf, iconOf, NODE_H, NODE_W, PORT_TONE, portAt, portX, summaryOf } from './look'

type View = { x: number; y: number; zoom: number }
export type Replay = { run: FlowRun; shown: number }

const edgeKey = (e: { from: string; to: string; port: string }) => `${e.from}>${e.port}>${e.to}`

/**
 * The flow canvas. Drag the background to pan, scroll to move, ⌘/Ctrl + scroll to zoom. In
 * edit mode cards drag, and a line is drawn from a port (the dots on a card's right edge) to
 * another card. With a run attached it becomes a replay: the steps the run took light up in
 * order, current travels along the lines it took, and the step working right now glows.
 */
export function Board({
  graph,
  catalog,
  accounts,
  editable,
  selected,
  onSelect,
  onChange,
  replay,
  fitKey,
  born,
  className,
}: {
  graph: FlowGraph
  catalog: FlowCatalog
  accounts: Account[] | null
  editable: boolean
  selected: string | null
  onSelect: (id: string | null) => void
  onChange?: (fn: (g: FlowGraph) => FlowGraph) => void
  replay?: Replay | null
  /** Changing it fits the flow into view again. */
  fitKey?: string | number
  /** Play the flow drawing itself in, step after step. */
  born?: boolean
  className?: string
}) {
  const board = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 })
  const [edge, setEdge] = useState<string | null>(null)
  const [wire, setWire] = useState<{ from: string; port: FlowPort; x: number; y: number } | null>(null)
  const ports = useCallback((type: string): FlowPort[] => catalog.nodes[type]?.ports ?? ['next'], [catalog])

  /* -------------------------------------------------------------- */
  /* View: fit, zoom, pan                                            */
  /* -------------------------------------------------------------- */

  // The latest graph, for fitting without refitting on every edit.
  const latest = useRef(graph)
  latest.current = graph
  // A replay writes beside the cards: leave room on the right for it.
  const aside = useRef(false)
  aside.current = !!replay

  const fit = useCallback(() => {
    const r = board.current?.getBoundingClientRect()
    const nodes = latest.current.nodes
    if (!r || !nodes.length) return
    const minX = Math.min(...nodes.map((n) => n.x)) - 40
    const minY = Math.min(...nodes.map((n) => n.y)) - 40
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W)) + (aside.current ? 270 : 40)
    // Room under the last row for the port labels.
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_H)) + 56
    const zoom = Math.min(1, Math.max(0.35, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))))
    setView({ zoom, x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: Math.max(16, (r.height - (maxY - minY) * zoom) / 2) - minY * zoom })
  }, [])

  // Fit when first shown, when asked to (fitKey), and when the board changes size.
  useLayoutEffect(() => {
    fit()
  }, [fit, fitKey])

  useEffect(() => {
    const el = board.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  useEffect(() => {
    const el = board.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect()
          const zoom = Math.min(1.8, Math.max(0.3, v.zoom * Math.exp(-e.deltaY * 0.0015)))
          const px = e.clientX - r.left
          const py = e.clientY - r.top
          return { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom }
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (f: number) =>
    setView((v) => {
      const r = board.current?.getBoundingClientRect()
      const cx = (r?.width ?? 800) / 2
      const cy = (r?.height ?? 500) / 2
      const zoom = Math.min(1.8, Math.max(0.3, v.zoom * f))
      return { zoom, x: cx - ((cx - v.x) * zoom) / v.zoom, y: cy - ((cy - v.y) * zoom) / v.zoom }
    })

  const toBoard = (clientX: number, clientY: number) => {
    const r = board.current!.getBoundingClientRect()
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom }
  }

  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const onBoardDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    onSelect(null)
    setEdge(null)
    pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onBoardMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (wire) {
      const p = toBoard(e.clientX, e.clientY)
      setWire((w) => (w ? { ...w, x: p.x, y: p.y } : w))
      return
    }
    const p = pan.current
    if (p) setView((v) => ({ ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y }))
  }
  const onBoardUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pan.current = null
    if (!wire) return
    const p = toBoard(e.clientX, e.clientY)
    const target = graph.nodes.find((n) => p.x >= n.x - 12 && p.x <= n.x + NODE_W + 12 && p.y >= n.y - 12 && p.y <= n.y + NODE_H + 12)
    if (target && target.id !== wire.from && !target.type.startsWith('trigger.')) {
      const next = { from: wire.from, to: target.id, port: wire.port }
      onChange?.((g) => ({ ...g, edges: [...g.edges.filter((x) => edgeKey(x) !== edgeKey(next)), next] }))
    }
    setWire(null)
  }

  // Delete or Backspace removes the selected line or card (never the trigger).
  useEffect(() => {
    if (!editable) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (edge) {
        onChange?.((g) => ({ ...g, edges: g.edges.filter((x) => edgeKey(x) !== edge) }))
        setEdge(null)
      } else if (selected && !graph.nodes.find((n) => n.id === selected)?.type.startsWith('trigger.')) {
        onChange?.((g) => ({ nodes: g.nodes.filter((n) => n.id !== selected), edges: g.edges.filter((x) => x.from !== selected && x.to !== selected) }))
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, edge, selected, graph.nodes, onChange, onSelect])

  /* -------------------------------------------------------------- */
  /* Replay: what the run has done so far                            */
  /* -------------------------------------------------------------- */

  const trace = useMemo(() => {
    if (!replay) return null
    const entries = replay.run.trail.slice(0, replay.shown)
    const last = new Map<string, TrailEntry>()
    entries.forEach((t) => last.set(t.node, t))
    // A line is lit once the step before it has left through its port and the step after it ran.
    const lit = new Map<string, number>()
    entries.forEach((t, i) => {
      if (!t.port) return
      for (const e of graph.edges) {
        if (e.from !== t.node || e.port !== t.port) continue
        const reached = entries.findIndex((u, j) => j > i && u.node === e.to)
        if (reached >= 0 && !lit.has(edgeKey(e))) lit.set(edgeKey(e), reached)
      }
    })
    const caughtUp = replay.shown >= replay.run.trail.length
    const working = caughtUp && replay.run.status === 'running' ? replay.run.next : null
    // The line into the step that's working carries current until it answers.
    const feeding = working ? graph.edges.filter((e) => e.to === working && last.get(e.from)?.port === e.port).map(edgeKey) : []
    return { last, lit, working, feeding, newest: replay.shown - 1, caughtUp }
  }, [replay, graph.edges])

  /* -------------------------------------------------------------- */

  const depth = useMemo(() => {
    // For the birth animation: how many steps from the trigger.
    const d = new Map<string, number>()
    const trigger = graph.nodes.find((n) => n.type.startsWith('trigger.'))
    if (!trigger) return d
    const queue = [trigger.id]
    d.set(trigger.id, 0)
    while (queue.length) {
      const id = queue.shift()!
      for (const e of graph.edges.filter((x) => x.from === id)) {
        if (!d.has(e.to)) {
          d.set(e.to, d.get(id)! + 1)
          queue.push(e.to)
        }
      }
    }
    return d
  }, [graph])

  const wireFrom = wire ? graph.nodes.find((n) => n.id === wire.from) : null

  return (
    <div
      ref={board}
      data-lenis-prevent
      onPointerDown={onBoardDown}
      onPointerMove={onBoardMove}
      onPointerUp={onBoardUp}
      className={cn('relative cursor-grab touch-none overflow-hidden bg-ink active:cursor-grabbing', wire && 'cursor-crosshair', className)}
      style={{
        backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.065) 1px, transparent 1px)',
        backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {/* Lines */}
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
          <defs>
            <filter id="flow-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" />
            </filter>
          </defs>
          {graph.edges.map((e, i) => {
            const d = edgePath(graph, e, ports)
            if (!d) return null
            const key = edgeKey(e)
            const isLit = trace?.lit.has(key) ?? false
            const dim = !!trace && !isLit
            const tone = PORT_TONE[e.port]
            const fresh = isLit && trace?.lit.get(key) === trace?.newest
            const feeding = trace?.feeding.includes(key)
            const from = graph.nodes.find((n) => n.id === e.from)!
            const out = portAt(from, ports(from.type), e.port)
            const label = e.port !== 'next' ? { x: out.x + 9, y: out.y + 17 } : null
            return (
              <g key={key} className="pointer-events-auto">
                {/* A wide, invisible stroke makes the line easy to click. */}
                {editable && (
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    className="cursor-pointer"
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      onSelect(null)
                      setEdge(key)
                    }}
                  />
                )}
                <motion.path
                  d={d}
                  fill="none"
                  stroke={edge === key ? 'var(--color-fg)' : tone}
                  strokeOpacity={dim ? 0.14 : isLit ? 0.95 : 0.5}
                  strokeWidth={isLit ? 2.2 : 1.5}
                  initial={born ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease, delay: born ? 0.25 + (depth.get(e.from) ?? i) * 0.32 : 0 }}
                  className="pointer-events-none"
                />
                {(isLit || feeding) && (
                  <>
                    <path d={d} fill="none" stroke={tone} strokeWidth={6} strokeOpacity={0.35} filter="url(#flow-glow)" className="pointer-events-none" />
                    <path d={d} fill="none" stroke="var(--color-accent-glow)" strokeWidth={2} strokeDasharray="6 38" strokeLinecap="round" className="pointer-events-none [animation:flow-dash_1.1s_linear_infinite]" />
                  </>
                )}
                {(fresh || feeding) && (
                  <circle r={5} fill="var(--color-accent-glow)" filter="url(#flow-glow)" className="pointer-events-none">
                    <animateMotion dur={feeding ? '1.2s' : '0.8s'} repeatCount={feeding ? 'indefinite' : '1'} path={d} fill="freeze" />
                  </circle>
                )}
                {label && (
                  <text x={label.x} y={label.y} fill={tone} fillOpacity={dim ? 0.3 : 0.9} className="pointer-events-none select-none font-mono text-[10px] uppercase tracking-[0.12em]">
                    {e.port}
                  </text>
                )}
              </g>
            )
          })}
          {wire && wireFrom && (
            <path
              d={curve(portAt(wireFrom, ports(wireFrom.type), wire.port).x, wireFrom.y + NODE_H, wire.x, wire.y)}
              fill="none"
              stroke={PORT_TONE[wire.port]}
              strokeWidth={2}
              strokeDasharray="5 6"
              className="pointer-events-none"
            />
          )}
        </svg>

        {/* The selected line's remove button, halfway along. */}
        {editable && edge && (() => {
          const e = graph.edges.find((x) => edgeKey(x) === edge)
          const a = e && graph.nodes.find((n) => n.id === e.from)
          const b = e && graph.nodes.find((n) => n.id === e.to)
          if (!e || !a || !b) return null
          const out = portAt(a, ports(a.type), e.port)
          const x = (out.x + b.x + NODE_W / 2) / 2
          const y = (out.y + b.y) / 2
          return (
            <button
              type="button"
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={() => {
                onChange?.((g) => ({ ...g, edges: g.edges.filter((x) => edgeKey(x) !== edge) }))
                setEdge(null)
              }}
              aria-label="Remove this line"
              className="pointer-events-auto absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line-2 bg-panel-3 text-muted shadow-lg transition-colors hover:border-fail/50 hover:text-fail"
              style={{ left: x, top: y }}
            >
              <X className="size-3.5" />
            </button>
          )
        })()}

        {graph.nodes.map((n) => (
          <Card
            key={n.id}
            node={n}
            catalog={catalog}
            accounts={accounts}
            zoom={view.zoom}
            editable={editable}
            selected={selected === n.id}
            onSelect={() => {
              setEdge(null)
              onSelect(n.id)
            }}
            onMove={(x, y) => onChange?.((g) => ({ ...g, nodes: g.nodes.map((m) => (m.id === n.id ? { ...m, x, y } : m)) }))}
            onWire={(port, ev) => {
              const p = toBoard(ev.clientX, ev.clientY)
              setWire({ from: n.id, port, x: p.x, y: p.y })
              board.current?.setPointerCapture(ev.pointerId)
            }}
            entry={trace?.last.get(n.id) ?? null}
            newest={!!trace && replay?.run.trail[trace.newest]?.node === n.id}
            traced={!!trace}
            working={trace?.working === n.id}
            delay={born ? 0.1 + (depth.get(n.id) ?? 0) * 0.32 : 0}
          />
        ))}
      </div>

      {/* Zoom */}
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-panel/90 p-0.5 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
          <Minus className="size-3.5" />
        </button>
        <span className="w-9 text-center font-mono text-[10px] tabular-nums text-dim">{Math.round(view.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
          <Plus className="size-3.5" />
        </button>
        <button type="button" onClick={fit} aria-label="Fit the flow" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* A step                                                              */
/* ------------------------------------------------------------------ */

const BADGE: Record<TrailEntry['status'], { icon: typeof Check; cls: string; label: string }> = {
  ok: { icon: Check, cls: 'bg-ok text-ink', label: 'Done' },
  ended: { icon: CircleDashed, cls: 'bg-white/15 text-muted', label: 'Nothing to do' },
  waiting: { icon: Hourglass, cls: 'bg-warn text-ink', label: 'Waiting' },
  approval: { icon: Hourglass, cls: 'bg-[#ff8fa3] text-ink', label: 'Waiting for you' },
  failed: { icon: X, cls: 'bg-fail text-ink', label: 'Failed' },
}

function Card({
  node,
  catalog,
  accounts,
  zoom,
  editable,
  selected,
  onSelect,
  onMove,
  onWire,
  entry,
  newest,
  traced,
  working,
  delay,
}: {
  node: FlowNode
  catalog: FlowCatalog
  accounts: Account[] | null
  zoom: number
  editable: boolean
  selected: boolean
  onSelect: () => void
  onMove: (x: number, y: number) => void
  onWire: (port: FlowPort, e: ReactPointerEvent) => void
  entry: TrailEntry | null
  /** The step the replay reached last: it says what it did, beside the card. */
  newest: boolean
  traced: boolean
  working: boolean
  delay: number
}) {
  const kind = catalog.nodes[node.type]
  const Icon = iconOf(node.type)
  const hue = hueOf(node.type)
  const drag = useRef<{ x: number; y: number; nx: number; ny: number; moved: boolean } | null>(null)
  const ports = kind?.ports ?? ['next']
  const isTrigger = node.type.startsWith('trigger.')
  const badge = entry ? BADGE[entry.status] : null
  const dim = traced && !entry && !working

  return (
    <motion.div
      data-node={node.id}
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: dim ? 0.38 : 1, scale: 1, y: 0 }}
      transition={{ duration: 0.45, ease, delay }}
      onPointerDown={(e) => {
        e.stopPropagation()
        onSelect()
        if (!editable) return
        drag.current = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = (e.clientX - d.x) / zoom
        const dy = (e.clientY - d.y) / zoom
        if (!d.moved && Math.hypot(dx, dy) < 3) return
        d.moved = true
        onMove(Math.round(d.nx + dx), Math.round(d.ny + dy))
      }}
      onPointerUp={() => (drag.current = null)}
      className={cn(
        'pointer-events-auto absolute select-none rounded-[14px] border bg-panel-2 shadow-[0_22px_50px_-26px_rgb(0_0_0_/_0.95)] transition-[border-color,box-shadow] duration-300',
        editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        selected ? 'border-white/40 shadow-[0_0_0_3px_rgb(255_255_255_/_0.08),0_22px_50px_-26px_rgb(0_0_0_/_0.95)]' : 'border-line-2',
        entry?.status === 'failed' && 'border-fail/60',
        entry?.status === 'approval' && 'border-[#ff8fa3]/60',
        entry?.status === 'waiting' && 'border-dashed border-warn/60',
        working && 'flow-thinking',
      )}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, ['--flow-hue' as string]: hue }}
    >
      {/* The kind of step, as a coloured edge and a glyph. */}
      <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: hue }} />
      <div className="flex h-full items-center gap-3 pl-4 pr-5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-[10px]"
          style={{ background: `color-mix(in oklab, ${hue} 16%, transparent)`, color: hue, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 35%, transparent)` }}
        >
          <Icon className="size-[17px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: hue }}>
              {catalog.groups[kind?.group ?? 'action']}
            </span>
          </span>
          <span className="block truncate text-[13px] font-medium leading-tight tracking-[-0.01em]">{kind?.label ?? node.type}</span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-dim">{summaryOf(node, accounts)}</span>
        </span>
      </div>

      {/* In: every step but the trigger takes a line on its top edge. */}
      {!isTrigger && <span aria-hidden className="absolute -top-[5px] left-1/2 size-2.5 -translate-x-1/2 rounded-full border border-line-2 bg-panel-3" />}

      {/* Out: one dot per way the step can go, along the bottom. Drag from it to join another step. */}
      {ports.map((port) => (
        <span
          key={port}
          role={editable ? 'button' : undefined}
          aria-label={editable ? `Draw a line from ${port}` : undefined}
          onPointerDown={(e) => {
            if (!editable) return
            e.stopPropagation()
            onWire(port, e)
          }}
          className={cn('absolute -bottom-[7px] grid size-3.5 -translate-x-1/2 place-items-center rounded-full border-2 bg-panel-2 transition-transform', editable && 'cursor-crosshair hover:scale-150')}
          style={{ left: portX(ports, port), borderColor: PORT_TONE[port] }}
        />
      ))}

      {/* Replay: how the step went, and what it said. */}
      <AnimatePresence>
        {(badge || working) && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            title={working ? 'Working…' : badge!.label}
            className={cn('absolute -right-2 -top-2 grid size-5 place-items-center rounded-full shadow-lg', working ? 'bg-panel-3 text-fg ring-1 ring-line-2' : badge!.cls)}
          >
            {working ? <LoaderCircle className="size-3 animate-spin" /> : (() => {
              const B = badge!.icon
              return <B className="size-3" strokeWidth={2.5} />
            })()}
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {entry && (newest || entry.status === 'approval') && (
          <motion.div
            key={entry.at + entry.status}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.35, ease }}
            className="pointer-events-none absolute left-[calc(100%+16px)] top-1/2 z-10 w-[232px] -translate-y-1/2"
          >
            <span aria-hidden className="absolute -left-[9px] top-1/2 h-px w-[9px] bg-line-2" />
            <p
              className={cn(
                'line-clamp-4 rounded-lg border px-3 py-2 text-[11.5px] leading-snug shadow-[0_18px_40px_-20px_rgb(0_0_0_/_0.9)]',
                entry.status === 'failed' ? 'border-fail/30 bg-[color-mix(in_oklab,var(--color-fail)_10%,var(--color-panel-2))] text-fail' : 'border-line-2 bg-panel-3 text-muted',
                isTrigger && 'font-mono text-[10.5px] uppercase tracking-[0.06em]',
              )}
            >
              {entry.summary}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
