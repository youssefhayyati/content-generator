import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import type { LabCatalog, LabEdge, LabNode, LabPayload, LabPortType } from '../../lib/api'
import { cn } from '../../lib/cn'
import { CARD_W, HEAD_H, PORT_HUE, ROW_H, curve, fits, portPoint, portRows } from './look'
import { NodeCard } from './NodeCard'
import type { Lab } from './useLab'

type View = { x: number; y: number; zoom: number }
type Wire = { from: string; out: string; type: LabPortType; x: number; y: number }

const edgeKey = (e: LabEdge) => `${e.from}:${e.out}>${e.to}:${e.in}`
const viewKey = (id: number) => `lab-view-${id}`

/**
 * The Creative Lab canvas. Drag the background to pan, scroll to move, ⌘/Ctrl + scroll (or pinch) to
 * zoom. Drag a card by its header. Drag from an output (the dots on a card's right) to an input (on
 * another card's left) to join them: inputs that can take it light up. Drop a node from the library
 * anywhere. Delete or Backspace removes the selected card or line.
 */
export function Canvas({
  lab,
  catalog,
  selected,
  onSelect,
  onAdd,
  onOpen,
  className,
}: {
  lab: Lab
  catalog: LabCatalog
  selected: string | null
  onSelect: (id: string | null) => void
  /** A node dropped from the library, where it landed. */
  onAdd: (type: string, x: number, y: number) => void
  /** Double-click: open a node's result big. */
  onOpen: (id: string) => void
  className?: string
}) {
  const data = lab.data as LabPayload
  const canvas = data.canvas
  const board = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(() => {
    try {
      const saved = localStorage.getItem(viewKey(data.project.id))
      if (saved) return JSON.parse(saved) as View
    } catch {
      /* private mode */
    }
    return { x: 60, y: 60, zoom: 0.9 }
  })
  const [edge, setEdge] = useState<string | null>(null)
  const [wire, setWire] = useState<Wire | null>(null)
  const [hoverIn, setHoverIn] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(viewKey(data.project.id), JSON.stringify(view))
      } catch {
        /* private mode */
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [view, data.project.id])

  /* ------------------------------------------------------------ view */

  const latest = useRef(canvas)
  latest.current = canvas
  const fit = useCallback(() => {
    const r = board.current?.getBoundingClientRect()
    const nodes = latest.current.nodes
    if (!r || !nodes.length) return
    const minX = Math.min(...nodes.map((n) => n.x)) - 60
    const minY = Math.min(...nodes.map((n) => n.y)) - 60
    const maxX = Math.max(...nodes.map((n) => n.x + CARD_W)) + 60
    const maxY = Math.max(...nodes.map((n) => n.y + 320)) + 40
    const zoom = Math.min(1.1, Math.max(0.25, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))))
    setView({ zoom, x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: Math.max(20, (r.height - (maxY - minY) * zoom) / 2) - minY * zoom })
  }, [])

  // A project opened for the first time (no saved view) is fitted into view.
  useLayoutEffect(() => {
    let saved = false
    try {
      saved = !!localStorage.getItem(viewKey(data.project.id))
    } catch {
      /* private mode */
    }
    if (!saved) fit()
  }, [fit, data.project.id])

  useEffect(() => {
    const el = board.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-scroll]')) return
      e.preventDefault()
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect()
          const zoom = Math.min(2, Math.max(0.2, v.zoom * Math.exp(-e.deltaY * 0.0018)))
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
      const zoom = Math.min(2, Math.max(0.2, v.zoom * f))
      return { zoom, x: cx - ((cx - v.x) * zoom) / v.zoom, y: cy - ((cy - v.y) * zoom) / v.zoom }
    })

  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const r = board.current!.getBoundingClientRect()
      return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom }
    },
    [view],
  )

  /** The middle of what's on screen, on the board: where a node added by a click goes. */
  useEffect(() => {
    const el = board.current
    if (!el) return
    ;(el as HTMLDivElement & { center?: () => { x: number; y: number } }).center = () => {
      const r = el.getBoundingClientRect()
      return { x: (r.width / 2 - view.x) / view.zoom - CARD_W / 2, y: (r.height / 2 - view.y) / view.zoom - 80 }
    }
  }, [view])

  /* ------------------------------------------------------------ pointer */

  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.board) return
    onSelect(null)
    setEdge(null)
    pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const inputsAt = useMemo(() => {
    // Every input port on the board, for snapping a wire.
    const out: Array<{ key: string; node: string; port: string; accepts: LabPortType[]; x: number; y: number }> = []
    for (const n of canvas.nodes) {
      const kind = catalog.nodes[n.type]
      for (const p of kind?.inputs ?? []) {
        const pt = portPoint(n, kind, 'in', p.name)
        out.push({ key: `${n.id}:${p.name}`, node: n.id, port: p.name, accepts: p.accepts, ...pt })
      }
    }
    return out
  }, [canvas.nodes, catalog])

  const nearestInput = (x: number, y: number, w: Wire) =>
    inputsAt
      .filter((p) => p.node !== w.from && fits(w.type, p.accepts))
      .map((p) => ({ p, d: Math.hypot(p.x - x, p.y - y) }))
      .filter(({ d }) => d < 36 / Math.min(1, view.zoom))
      .sort((a, b) => a.d - b.d)[0]?.p ?? null

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (wire) {
      const p = toBoard(e.clientX, e.clientY)
      setWire((w) => (w ? { ...w, x: p.x, y: p.y } : w))
      setHoverIn(nearestInput(p.x, p.y, wire)?.key ?? null)
      return
    }
    const p = pan.current
    if (p) setView((v) => ({ ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y }))
  }

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pan.current = null
    if (!wire) return
    const p = toBoard(e.clientX, e.clientY)
    const target = nearestInput(p.x, p.y, wire)
    if (target) {
      void lab.ops([{ op: 'connect', from: wire.from, out: wire.out, to: target.node, in: target.port }])
    } else {
      // Dropped on a card: let the API find the input that fits.
      const card = canvas.nodes.find((n) => n.id !== wire.from && p.x >= n.x && p.x <= n.x + CARD_W && p.y >= n.y && p.y <= n.y + HEAD_H + ROW_H * portRows(catalog.nodes[n.type]) + 160)
      if (card) void lab.ops([{ op: 'connect', from: wire.from, out: wire.out, to: card.id }])
    }
    setWire(null)
    setHoverIn(null)
  }

  // Delete or Backspace removes the selected line or card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') {
        onSelect(null)
        setEdge(null)
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (edge) {
        const ed = canvas.edges.find((x) => edgeKey(x) === edge)
        if (ed) void lab.ops([{ op: 'disconnect', ...ed }])
        setEdge(null)
      } else if (selected) {
        void lab.ops([{ op: 'remove', id: selected }])
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edge, selected, canvas.edges, lab, onSelect])

  /* ------------------------------------------------------------ render */

  const nodeById = useMemo(() => new Map(canvas.nodes.map((n) => [n.id, n])), [canvas.nodes])
  const wireFrom = wire ? nodeById.get(wire.from) : null

  return (
    <div
      ref={board}
      data-lenis-prevent
      data-board="1"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-lab-node')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData('application/x-lab-node')
        if (!type) return
        e.preventDefault()
        const p = toBoard(e.clientX, e.clientY)
        onAdd(type, Math.round(p.x - CARD_W / 2), Math.round(p.y - 24))
      }}
      className={cn('relative cursor-grab touch-none overflow-hidden bg-ink active:cursor-grabbing', wire && 'cursor-crosshair', className)}
      style={{
        backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)',
        backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
          <defs>
            <filter id="lab-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          {canvas.edges.map((e) => {
            const a = nodeById.get(e.from)
            const b = nodeById.get(e.to)
            if (!a || !b) return null
            const ka = catalog.nodes[a.type]
            const kb = catalog.nodes[b.type]
            const p1 = portPoint(a, ka, 'out', e.out)
            const p2 = portPoint(b, kb, 'in', e.in)
            const type = ka?.outputs.find((o) => o.name === e.out)?.type ?? 'text'
            const tone = PORT_HUE[type]
            const d = curve(p1.x, p1.y, p2.x, p2.y)
            const key = edgeKey(e)
            const target = data.nodes[e.to]
            const flowing = target && (target.status === 'running' || target.status === 'queued')
            const sel = edge === key
            return (
              <g key={key} className="pointer-events-auto">
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="cursor-pointer"
                  onPointerDown={(ev) => {
                    ev.stopPropagation()
                    onSelect(null)
                    setEdge(key)
                  }}
                />
                <path d={d} fill="none" stroke={sel ? 'var(--color-fg)' : tone} strokeOpacity={sel ? 1 : 0.55} strokeWidth={sel ? 2.4 : 1.7} className="pointer-events-none" />
                {flowing && (
                  <>
                    <path d={d} fill="none" stroke={tone} strokeWidth={6} strokeOpacity={0.3} filter="url(#lab-glow)" className="pointer-events-none" />
                    <path d={d} fill="none" stroke="var(--color-accent-glow)" strokeWidth={2} strokeDasharray="6 30" strokeLinecap="round" className="pointer-events-none [animation:flow-dash_1.1s_linear_infinite]" />
                  </>
                )}
              </g>
            )
          })}
          {wire && wireFrom && (() => {
            const p1 = portPoint(wireFrom, catalog.nodes[wireFrom.type], 'out', wire.out)
            return <path d={curve(p1.x, p1.y, wire.x, wire.y)} fill="none" stroke={PORT_HUE[wire.type]} strokeWidth={2} strokeDasharray="5 6" className="pointer-events-none" />
          })()}
        </svg>

        {/* The selected line's remove button. */}
        {edge && (() => {
          const e = canvas.edges.find((x) => edgeKey(x) === edge)
          const a = e && nodeById.get(e.from)
          const b = e && nodeById.get(e.to)
          if (!e || !a || !b) return null
          const p1 = portPoint(a, catalog.nodes[a.type], 'out', e.out)
          const p2 = portPoint(b, catalog.nodes[b.type], 'in', e.in)
          return (
            <button
              type="button"
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={() => {
                void lab.ops([{ op: 'disconnect', ...e }])
                setEdge(null)
              }}
              aria-label="Remove this line"
              className="pointer-events-auto absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line-2 bg-panel-3 text-muted shadow-lg transition-colors hover:border-fail/50 hover:text-fail"
              style={{ left: (p1.x + p2.x) / 2, top: (p1.y + p2.y) / 2 }}
            >
              <X className="size-3.5" />
            </button>
          )
        })()}

        {canvas.nodes.map((n: LabNode) => (
          <NodeCard
            key={n.id}
            node={n}
            kind={catalog.nodes[n.type]}
            state={data.nodes[n.id]}
            assets={data.assets}
            zoom={view.zoom}
            selected={selected === n.id}
            wire={wire}
            hoverIn={hoverIn}
            onSelect={() => {
              setEdge(null)
              onSelect(n.id)
            }}
            onOpen={() => onOpen(n.id)}
            onMove={(x, y) => lab.moveLocal(n.id, x, y)}
            onMoved={(x, y) => void lab.ops([{ op: 'move', id: n.id, x, y }])}
            onWire={(out, type, ev) => {
              const p = toBoard(ev.clientX, ev.clientY)
              setWire({ from: n.id, out, type, x: p.x, y: p.y })
              board.current?.setPointerCapture(ev.pointerId)
            }}
            onRun={() => void lab.run(n.id)}
            onStop={() => void lab.stop(n.id)}
          />
        ))}
      </div>

      {!canvas.nodes.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="max-w-sm text-center">
            <p className="text-[15px] font-medium">An empty canvas</p>
            <p className="mt-1.5 text-[13px] leading-snug text-muted">Drag a node in from the left, start from a template, or ask the assistant to build it for you.</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-panel/90 p-0.5 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
          <Minus className="size-3.5" />
        </button>
        <span className="w-10 text-center font-mono text-[10px] tabular-nums text-dim">{Math.round(view.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
          <Plus className="size-3.5" />
        </button>
        <button type="button" onClick={fit} aria-label="Fit everything" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Where a node added by a click goes: the middle of what the canvas shows. */
export function canvasCenter(): { x: number; y: number } {
  const el = document.querySelector('[data-board]') as (HTMLDivElement & { center?: () => { x: number; y: number } }) | null
  return el?.center?.() ?? { x: 120, y: 120 }
}
