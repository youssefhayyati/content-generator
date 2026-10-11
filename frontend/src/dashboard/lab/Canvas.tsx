import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion } from 'framer-motion'
import { Copy, GitBranch, LayoutGrid, Maximize2, Minus, Play, Plus, Settings2, Square, Trash2, X } from 'lucide-react'
import type { LabCatalog, LabEdge, LabNode, LabNodeState, LabPayload, LabPortType, LabTemplate } from '../../lib/api'
import { cn } from '../../lib/cn'
import { CARD_W, HEAD_H, PORT_HUE, ROW_H, curve, fits, portPoint, portRows } from './look'
import { TemplateThumb } from './Gallery'
import { NodeCard } from './NodeCard'
import { useRemove } from './remove'
import { newNodeId, type Lab } from './useLab'

type View = { x: number; y: number; zoom: number }
type Wire = { from: string; out: string; type: LabPortType; x: number; y: number }
type Menu = { id: string; x: number; y: number }

/**
 * How many pieces a line out of this node can pick from: what it wrote in several (versions, lines),
 * or, for a Write node not run yet, how many it's asked for.
 */
function piecesOf(node: LabNode | undefined, state: LabNodeState | undefined, out: string) {
  const made = state?.outputs?.[out]?.items?.length ?? 0
  if (node?.type !== 'text.write') return made
  const task = String(node.params?.task ?? 'caption')
  const asked = task === 'lines' || task === 'thread' ? Number(node.params?.count ?? 4) : Number(node.params?.variants ?? 1)
  return Math.max(made, asked || 0)
}

const edgeKey = (e: LabEdge) => `${e.from}:${e.out}>${e.to}:${e.in}`
const viewKey = (id: number) => `lab-view-${id}`

/**
 * The Creative Lab canvas. Drag the background to pan, scroll to move, ⌘/Ctrl + scroll (or pinch) to
 * zoom. Drag a card by its header. Drag from an output (the dots on a card's right) to an input (on
 * another card's left) to join them: inputs that can take it light up. Drop a node from the library
 * anywhere. Delete or Backspace removes the selected card or line; a right click on a card opens its
 * menu. A line out of text written in several pieces says which it takes (#1, #2…): click it to change.
 */
export function Canvas({
  lab,
  catalog,
  selected,
  onSelect,
  onAdd,
  onOpen,
  onTemplate,
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
  /** A template picked on the empty canvas: opened with its example (null: all of them). */
  onTemplate?: (t: LabTemplate | null) => void
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
  const [menu, setMenu] = useState<Menu | null>(null)
  const remove = useRemove(lab, catalog)

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
      if ((e.target as HTMLElement).closest('[data-scroll], [data-menu]')) return
      e.preventDefault()
      setMenu(null)
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
    if (!(e.target as HTMLElement).closest('[data-menu]')) setMenu(null)
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.board) return
    onSelect(null)
    setEdge(null)
    // The main button pans (the middle one too); a right click's pointerup never comes back.
    if (e.button !== 0 && e.button !== 1) return
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
      // Only keys meant for the canvas: never one pressed in the panel beside it (a button focused there).
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]')) return
      if (target !== document.body && !board.current?.contains(target)) return
      if (e.key === 'Escape') {
        if (menu) return setMenu(null)
        onSelect(null)
        setEdge(null)
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (edge) {
        const ed = canvas.edges.find((x) => edgeKey(x) === edge)
        if (ed) void lab.ops([{ op: 'disconnect', ...ed }])
        setEdge(null)
      } else if (selected) {
        remove([selected])
        setMenu(null)
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edge, selected, menu, canvas.edges, lab, onSelect, remove])

  /* ------------------------------------------------------------ the node's menu */

  const openMenu = (id: string, clientX: number, clientY: number) => {
    const r = board.current!.getBoundingClientRect()
    // Kept inside the canvas: it opens left or up when there's no room.
    setMenu({ id, x: Math.min(clientX - r.left, r.width - 212), y: Math.min(clientY - r.top, r.height - 236) })
    setEdge(null)
  }

  const duplicate = (id: string) => {
    const n = canvas.nodes.find((x) => x.id === id)
    if (!n) return
    const kind = catalog.nodes[n.type]
    const copy = newNodeId(canvas, kind)
    // The same settings, fed the same way, just below: ready to try something else.
    void lab
      .ops([
        { op: 'add', node: { id: copy, type: n.type, x: n.x, y: n.y + 60, params: n.params ?? {}, label: `${n.label || kind?.label || 'Node'} copy`.slice(0, 60) } },
        ...canvas.edges.filter((e) => e.to === id).map((e) => ({ op: 'connect', ...e, to: copy })),
      ])
      .then((r) => r && onSelect(copy))
  }

  const tidy = () => void lab.ops([{ op: 'tidy' }]).then((r) => r && window.requestAnimationFrame(fit))

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
      onPointerCancel={() => {
        pan.current = null
        setWire(null)
        setHoverIn(null)
      }}
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest('[data-menu]')) e.preventDefault()
      }}
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

        {/* Which piece a line takes, on the line itself. */}
        {canvas.edges.map((e) => {
          if (e.pick == null || edgeKey(e) === edge) return null
          const a = nodeById.get(e.from)
          const b = nodeById.get(e.to)
          if (!a || !b) return null
          const p1 = portPoint(a, catalog.nodes[a.type], 'out', e.out)
          const p2 = portPoint(b, catalog.nodes[b.type], 'in', e.in)
          return (
            <button
              key={`pick-${edgeKey(e)}`}
              type="button"
              onPointerDown={(ev) => {
                ev.stopPropagation()
                onSelect(null)
                setEdge(edgeKey(e))
              }}
              title={e.pick ? `Takes version ${e.pick}: click to change` : 'Takes all of it: click to change'}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-2 bg-panel-3 px-1.5 py-px font-mono text-[10px] text-muted shadow-md transition-colors hover:border-white/30 hover:text-fg"
              style={{ left: (p1.x + p2.x) / 2, top: (p1.y + p2.y) / 2 }}
            >
              {e.pick ? `#${e.pick}` : 'all'}
            </button>
          )
        })}

        {/* The selected line: which piece it takes (text in several), and removing it. */}
        {edge && (() => {
          const e = canvas.edges.find((x) => edgeKey(x) === edge)
          const a = e && nodeById.get(e.from)
          const b = e && nodeById.get(e.to)
          if (!e || !a || !b) return null
          const p1 = portPoint(a, catalog.nodes[a.type], 'out', e.out)
          const p2 = portPoint(b, catalog.nodes[b.type], 'in', e.in)
          const text = catalog.nodes[a.type]?.outputs.find((o) => o.name === e.out)?.type === 'text'
          const pieces = text ? Math.min(10, piecesOf(a, data.nodes[a.id], e.out)) : 0
          return (
            <div
              className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full border border-line-2 bg-panel-3 p-0.5 shadow-lg"
              style={{ left: (p1.x + p2.x) / 2, top: (p1.y + p2.y) / 2 }}
              onPointerDown={(ev) => ev.stopPropagation()}
            >
              {pieces > 1 && (
                <>
                  {[0, ...Array.from({ length: pieces }, (_, i) => i + 1)].map((k) => {
                    const on = (e.pick ?? 0) === k
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => void lab.ops([{ op: 'pick', from: e.from, out: e.out, to: e.to, in: e.in, pick: k }])}
                        title={k ? `Take version ${k} only` : 'Take all of it'}
                        className={cn('h-6 min-w-6 rounded-full px-1.5 font-mono text-[10.5px] transition-colors', on ? 'bg-white/[0.14] text-fg' : 'text-dim hover:text-fg')}
                      >
                        {k ? `#${k}` : 'all'}
                      </button>
                    )
                  })}
                  <span className="mx-0.5 h-4 w-px bg-line-2" />
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  void lab.ops([{ op: 'disconnect', ...e }])
                  setEdge(null)
                }}
                aria-label="Remove this line"
                className="grid size-6 place-items-center rounded-full text-muted transition-colors hover:text-fail"
              >
                <X className="size-3.5" />
              </button>
            </div>
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
              // Any press on a card closes the menu; a right click opens it again just after.
              setMenu(null)
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
            onRemove={() => {
              remove([n.id])
              if (selected === n.id) onSelect(null)
            }}
            onMenu={(x, y) => openMenu(n.id, x, y)}
          />
        ))}
      </div>

      {menu && (() => {
        const n = nodeById.get(menu.id)
        if (!n) return null
        const kind = catalog.nodes[n.type]
        const state = data.nodes[n.id]
        const running = state?.status === 'running' || state?.status === 'queued'
        const runnable = !!state && state.policy !== 'none' && state.policy !== 'post'
        const close = (fn: () => void) => () => {
          setMenu(null)
          fn()
        }
        const items: Array<{ label: string; icon: typeof Play; on: () => void; danger?: boolean; hint?: string }> = [
          ...(runnable ? [running ? { label: 'Stop', icon: Square, on: () => void lab.stop(n.id) } : { label: state.status === 'done' ? 'Run again' : (state.run_label ?? 'Run'), icon: Play, on: () => void lab.run(n.id) }] : []),
          { label: 'Settings', icon: Settings2, on: () => onOpen(n.id) },
          { label: 'Duplicate', icon: Copy, on: () => duplicate(n.id) },
          ...(kind && kind.run !== 'none' && kind.run !== 'post' ? [{ label: 'Branch', icon: GitBranch, hint: 'a copy and all after it', on: () => void lab.ops([{ op: 'branch', id: n.id }]) }] : []),
          { label: 'Remove', icon: Trash2, danger: true, hint: 'Del', on: () => {
            remove([n.id])
            onSelect(null)
          } },
        ]
        return (
          <motion.div
            key={`${menu.id}-${menu.x}-${menu.y}`}
            data-menu
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 w-[200px] origin-top-left overflow-hidden rounded-lg border border-line-2 bg-panel-3/95 p-1 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)] backdrop-blur"
            style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}
          >
            <p className="truncate px-2.5 pb-1 pt-1.5 text-[11px] text-dim">{n.label || kind?.label || n.type}</p>
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={close(it.on)}
                className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors', it.danger ? 'text-fail/90 hover:bg-fail/10' : 'text-fg hover:bg-white/[0.07]')}
              >
                <it.icon className="size-3.5 shrink-0" />
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[10.5px] text-dim">{it.hint}</span>}
              </button>
            ))}
          </motion.div>
        )
      })()}

      {!canvas.nodes.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-y-auto p-6">
          <div className="w-full max-w-xl text-center">
            <p className="text-[15px] font-medium">An empty canvas</p>
            <p className="mt-1.5 text-[13px] leading-snug text-muted">Start from one of these (each shows what it makes), drag a node in from the left, or ask the assistant to build it for you.</p>
            {onTemplate && (
              <div className="pointer-events-auto mt-5" onPointerDown={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-2 gap-2 text-left sm:grid-cols-3">
                  {STARTERS.map((key) => catalog.templates.find((t) => t.key === key)).filter((t): t is LabTemplate => !!t).map((t) => (
                    <button key={t.key} type="button" onClick={() => onTemplate(t)} className="group overflow-hidden rounded-lg border border-line bg-panel/90 text-left transition-colors hover:border-white/25 hover:bg-panel-2">
                      <TemplateThumb t={t} className="aspect-[4/3] w-full transition-transform duration-700 ease-expo group-hover:scale-[1.03]" />
                      <span className="block p-2.5">
                        <span className="block text-[12px] font-medium leading-tight">{t.name}</span>
                        <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-dim">{t.category}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => onTemplate(null)} className="mt-3 text-[12px] text-accent-soft hover:underline">
                  See all {catalog.templates.length} templates, each with an example
                </button>
              </div>
            )}
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
        <button type="button" onClick={fit} aria-label="Fit everything" title="Fit everything" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
          <Maximize2 className="size-3.5" />
        </button>
        {canvas.nodes.length > 1 && (
          <button type="button" onClick={tidy} aria-label="Tidy up" title="Tidy up: in columns, by how far along each node is" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
            <LayoutGrid className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** The templates an empty canvas offers first: one of each kind of content. */
const STARTERS = ['product-picture', 'words-over-picture', 'moving-pictures', 'youtube-clips', 'hf-cinematic-shot', 'hf-ads']

/** Where a node added by a click goes: the middle of what the canvas shows. */
export function canvasCenter(): { x: number; y: number } {
  const el = document.querySelector('[data-board]') as (HTMLDivElement & { center?: () => { x: number; y: number } }) | null
  return el?.center?.() ?? { x: 120, y: 120 }
}
