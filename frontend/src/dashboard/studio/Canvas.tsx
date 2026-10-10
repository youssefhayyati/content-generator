import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Clapperboard, GripHorizontal, Image as ImageIcon, ImagePlus, LoaderCircle, Maximize2, Minus, Plus, StickyNote, Type, X } from 'lucide-react'
import { api, type Asset, type Canvas, type CanvasNode, type ModelInfo, type Page, type Project, type Registry } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useApi, useInvalidate } from '../data'
import { MediaPicker } from '../media/Media'
import { useToast } from '../toast'
import { Btn, inputClass } from '../ui'
import { GenerationCard, ModelPicker, useGenerations } from './parts'
import { messageFor, retryGeneration, runMedia, runText } from './run'

const WIDTH: Record<CanvasNode['type'], number> = { note: 220, text: 300, asset: 260, generation: 300 }
const uid = () => Math.random().toString(36).slice(2, 10)
type Kind = 'text' | 'image' | 'video'

/**
 * A project's canvas: drag the background to pan, ⌘/Ctrl + scroll to zoom, drag a card by its
 * handle. Make text, photos and video right on it; anything made from another card is joined
 * to it with a line. Saves itself a moment after every change.
 */
export function CanvasView({ id }: { id: number }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data: registry } = useApi<Registry>('/models')
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [selected, setSelected] = useState<string | null>(null)
  const [making, setMaking] = useState<Kind | null>(null)
  const [picking, setPicking] = useState(false)
  const { data: generations, setData: setGenerations } = useGenerations({ project_id: id })
  const assetIds = canvas?.nodes.filter((n) => n.type === 'asset' && n.ref).map((n) => n.ref).join(',') ?? ''
  const { data: assets } = useApi<Page<Asset>>(assetIds ? '/assets' : null, { ids: assetIds })
  const board = useRef<HTMLDivElement>(null)
  const sizes = useRef(new Map<string, { w: number; h: number }>())
  const [, setMeasured] = useState(0)
  const loaded = useRef(false)

  useEffect(() => {
    api<Project>(`/projects/${id}`)
      .then((p) => {
        setCanvas(p.canvas ?? { nodes: [], edges: [], view: { x: 0, y: 0, zoom: 1 } })
        setName(p.name)
      })
      .catch(() => {
        toast('That project doesn’t exist any more.', 'error')
        navigate('/dashboard/studio?tab=projects', { replace: true })
      })
  }, [id, toast, navigate])

  // Save a moment after the last change.
  useEffect(() => {
    if (!canvas) return
    if (!loaded.current) {
      loaded.current = true
      return
    }
    setSaved('unsaved')
    const t = window.setTimeout(() => {
      setSaved('saving')
      api(`/projects/${id}`, { method: 'PATCH', body: { canvas, name } })
        .then(() => setSaved('saved'))
        .catch(() => setSaved('unsaved'))
    }, 700)
    return () => window.clearTimeout(t)
  }, [canvas, name, id])

  const update = useCallback((fn: (c: Canvas) => Canvas) => setCanvas((c) => (c ? fn(c) : c)), [])
  const view = canvas?.view ?? { x: 0, y: 0, zoom: 1 }

  /**
   * Where a new card goes: right of the card it was made from, or else the first free spot from
   * the top left of what's in view. Never on top of another card.
   */
  const spot = (type: CanvasNode['type'], from?: string | null, nodes: CanvasNode[] = canvas?.nodes ?? []) => {
    const rect = (n: CanvasNode) => ({ x: n.x, y: n.y, w: sizes.current.get(n.id)?.w ?? WIDTH[n.type], h: sizes.current.get(n.id)?.h ?? 240 })
    const w = WIDTH[type]
    const free = (x: number, y: number) => nodes.every((n) => {
      const r = rect(n)
      return x + w + 24 <= r.x || x >= r.x + r.w + 24 || y + 240 <= r.y || y >= r.y + r.h + 24
    })
    const source = nodes.find((n) => n.id === from)
    const base = source
      ? { x: source.x + rect(source).w + 80, y: source.y }
      : { x: Math.round((60 - view.x) / view.zoom), y: Math.round((60 - view.y) / view.zoom) }
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 6; col++) {
        const x = base.x + col * (w + 40)
        const y = base.y + row * 140
        if (free(x, y)) return { x, y }
      }
    }
    return base
  }

  const add = (node: Omit<CanvasNode, 'id' | 'x' | 'y'> & Partial<Pick<CanvasNode, 'x' | 'y'>>, from?: string | null) => {
    const next: CanvasNode = { id: uid(), ...spot(node.type, from), ...node }
    update((c) => ({ ...c, nodes: [...c.nodes, next], edges: from ? [...c.edges, { from, to: next.id }] : c.edges }))
    setSelected(next.id)
    return next.id
  }

  const remove = (nodeId: string) =>
    update((c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== nodeId), edges: c.edges.filter((e) => e.from !== nodeId && e.to !== nodeId) }))

  // Delete or Backspace removes the selected card (unless you're typing in it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        remove(selected)
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Wheel: scroll pans, ⌘/Ctrl + scroll zooms around the cursor. Non-passive, to keep the page still.
  useEffect(() => {
    const el = board.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      update((c) => {
        const v = c.view
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect()
          const zoom = Math.min(2, Math.max(0.3, v.zoom * Math.exp(-e.deltaY * 0.0015)))
          const px = e.clientX - r.left
          const py = e.clientY - r.top
          return { ...c, view: { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom } }
        }
        return { ...c, view: { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY } }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [update, canvas !== null])

  const zoomBy = (factor: number) =>
    update((c) => {
      const r = board.current?.getBoundingClientRect()
      const cx = (r?.width ?? 800) / 2
      const cy = (r?.height ?? 600) / 2
      const zoom = Math.min(2, Math.max(0.3, c.view.zoom * factor))
      return { ...c, view: { zoom, x: cx - ((cx - c.view.x) * zoom) / c.view.zoom, y: cy - ((cy - c.view.y) * zoom) / c.view.zoom } }
    })

  const fit = () =>
    update((c) => {
      if (!c.nodes.length) return { ...c, view: { x: 0, y: 0, zoom: 1 } }
      const r = board.current?.getBoundingClientRect()
      const xs = c.nodes.map((n) => n.x)
      const ys = c.nodes.map((n) => n.y)
      const right = Math.max(...c.nodes.map((n) => n.x + (sizes.current.get(n.id)?.w ?? WIDTH[n.type])))
      const bottom = Math.max(...c.nodes.map((n) => n.y + (sizes.current.get(n.id)?.h ?? 200)))
      const w = right - Math.min(...xs) + 120
      const h = bottom - Math.min(...ys) + 120
      const zoom = Math.min(1.2, Math.max(0.3, Math.min((r?.width ?? 800) / w, (r?.height ?? 600) / h)))
      return { ...c, view: { zoom, x: -Math.min(...xs) * zoom + 60 * zoom, y: -Math.min(...ys) * zoom + 60 * zoom } }
    })

  // Pan by dragging the empty board.
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const onBoardDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    setSelected(null)
    pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onBoardMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pan.current
    if (!p) return
    update((c) => ({ ...c, view: { ...c.view, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y } }))
  }

  const genById = new Map(generations?.map((g) => [g.id, g]))
  const assetById = new Map(assets?.data.map((a) => [a.id, a]))
  const selectedNode = canvas?.nodes.find((n) => n.id === selected) ?? null
  // The image a new video would start from: the selected card's.
  const selectedImage =
    selectedNode?.type === 'asset'
      ? assetById.get(selectedNode.ref ?? -1)
      : selectedNode?.type === 'generation'
        ? genById.get(selectedNode.ref ?? -1)?.outputs.find((a) => a.kind === 'image')
        : undefined

  const make = async (kind: Kind, prompt: string, model: string | null) => {
    const from = selected
    try {
      if (kind === 'text') {
        const node = add({ type: 'text', text: '' }, from)
        const genId = await runText({ prompt, model, project_id: id }, (t) => update((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === node ? { ...n, text: t } : n)) })))
        update((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === node ? { ...n, ref: genId } : n)) }))
      } else {
        const g = await runMedia({ kind, model, prompt, project_id: id, input_asset_ids: kind === 'video' && selectedImage ? [selectedImage.id] : undefined, params: kind === 'image' ? { aspect_ratio: '4:5' } : { duration: 5 } })
        setGenerations((list) => [g, ...(list ?? [])])
        add({ type: 'generation', ref: g.id }, from)
      }
      setMaking(null)
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  if (!canvas || !registry) return <div className="skeleton h-[70dvh] rounded-xl" />

  return (
    <div className="-mx-4 -mt-8 md:-mx-6 md:-mt-10">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel/80 px-4 py-2.5 backdrop-blur md:px-6">
        <Btn variant="subtle" size="sm" icon={ArrowLeft} onClick={() => navigate('/dashboard/studio?tab=projects')} aria-label="All projects" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          className="min-w-0 max-w-[260px] rounded bg-transparent px-1 text-[14px] font-medium outline-none focus:bg-white/[0.04]"
        />
        <span className="font-mono text-[10px] text-dim">{{ saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved' }[saved]}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Tool icon={StickyNote} onClick={() => add({ type: 'note', text: '' })}>
            Note
          </Tool>
          <Tool icon={Type} onClick={() => setMaking('text')}>
            Write
          </Tool>
          <Tool icon={ImageIcon} onClick={() => setMaking('image')}>
            Photo
          </Tool>
          <Tool icon={Clapperboard} onClick={() => setMaking('video')}>
            Video
          </Tool>
          <Tool icon={ImagePlus} onClick={() => setPicking(true)}>
            Library
          </Tool>
          <span className="mx-1 h-5 w-px bg-line-2" />
          <Btn variant="subtle" size="sm" icon={Minus} onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" />
          <span className="w-10 text-center font-mono text-[10.5px] tabular-nums text-dim">{Math.round(view.zoom * 100)}%</span>
          <Btn variant="subtle" size="sm" icon={Plus} onClick={() => zoomBy(1.2)} aria-label="Zoom in" />
          <Btn variant="subtle" size="sm" icon={Maximize2} onClick={fit} aria-label="Fit everything" />
        </div>
      </div>

      {/* Board */}
      <div
        ref={board}
        data-lenis-prevent
        onPointerDown={onBoardDown}
        onPointerMove={onBoardMove}
        onPointerUp={() => (pan.current = null)}
        className="relative h-[calc(100dvh-7.5rem)] cursor-grab touch-none overflow-hidden bg-ink active:cursor-grabbing"
        style={{
          backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)',
          backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <Edges canvas={canvas} sizes={sizes.current} />
          {canvas.nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              zoom={view.zoom}
              selected={selected === n.id}
              onSelect={() => setSelected(n.id)}
              onMove={(x, y) => update((c) => ({ ...c, nodes: c.nodes.map((m) => (m.id === n.id ? { ...m, x, y } : m)) }))}
              onRemove={() => remove(n.id)}
              onSize={(w, h) => {
                const s = sizes.current.get(n.id)
                if (!s || s.w !== w || s.h !== h) {
                  sizes.current.set(n.id, { w, h })
                  setMeasured((k) => k + 1)
                }
              }}
            >
              {n.type === 'note' || n.type === 'text' ? (
                <NoteText node={n} onChange={(text) => update((c) => ({ ...c, nodes: c.nodes.map((m) => (m.id === n.id ? { ...m, text } : m)) }))} />
              ) : n.type === 'asset' ? (
                <AssetView asset={assetById.get(n.ref ?? -1)} />
              ) : genById.get(n.ref ?? -1) ? (
                <GenerationCard
                  generation={genById.get(n.ref ?? -1)!}
                  models={registry.models}
                  compact
                  onRetry={async (g, change) => {
                    await retryGeneration(g, change)
                    invalidate()
                  }}
                />
              ) : (
                <div className="flex items-center gap-2 p-4 text-[12px] text-dim">
                  <LoaderCircle className="size-3.5 animate-spin" /> Loading…
                </div>
              )}
            </NodeCard>
          ))}
        </div>

        {canvas.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="max-w-[44ch] text-center text-[13px] leading-snug text-dim">
              An empty canvas. Add a note, write something, make a photo or a video, or bring media in from the library.
              Select a card first and what you make is joined to it.
            </p>
          </div>
        )}

        <AnimatePresence>
          {making && (
            <MakePanel
              key={making}
              kind={making}
              models={registry.models}
              defaultText={registry.default_text}
              from={selectedNode ? (selectedImage ? 'the selected image' : 'the selected card') : null}
              needsImage={making === 'video' && !selectedImage}
              onRun={(prompt, model) => make(making, prompt, model)}
              onClose={() => setMaking(null)}
            />
          )}
        </AnimatePresence>
      </div>

      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        max={12}
        onPick={(picked) => {
          // One after another, each finding a free spot among the ones placed before it.
          const added = picked.reduce<CanvasNode[]>(
            (list, a) => [...list, { id: uid(), type: 'asset', ref: a.id, ...spot('asset', null, [...canvas.nodes, ...list]) }],
            [],
          )
          update((c) => ({ ...c, nodes: [...c.nodes, ...added] }))
        }}
      />
    </div>
  )
}

function Tool({ icon: Icon, onClick, children }: { icon: typeof Type; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-md border border-line-2 px-2.5 text-[12px] text-muted transition-colors hover:border-white/25 hover:text-fg"
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {children}
    </button>
  )
}

/** A card on the canvas: dragged by its handle, measured so lines can find its edges. */
function NodeCard({
  node,
  zoom,
  selected,
  onSelect,
  onMove,
  onRemove,
  onSize,
  children,
}: {
  node: CanvasNode
  zoom: number
  selected: boolean
  onSelect: () => void
  onMove: (x: number, y: number) => void
  onRemove: () => void
  onSize: (w: number, h: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; nx: number; ny: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => onSize(el.offsetWidth, el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [onSize])

  const paper = node.type === 'note'

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease }}
      onPointerDown={onSelect}
      className={cn(
        'pointer-events-auto absolute rounded-xl shadow-[0_24px_60px_-28px_rgb(0_0_0_/_0.9)] transition-[box-shadow] duration-200',
        paper ? 'bg-bone text-ink' : 'border border-line-2 bg-panel-2',
        selected && 'ring-2 ring-accent-soft/70',
      )}
      style={{ left: node.x, top: node.y, width: WIDTH[node.type] }}
    >
      <div
        className={cn('group flex h-6 cursor-grab touch-none items-center justify-between rounded-t-xl px-2 active:cursor-grabbing', paper ? 'text-ink/40' : 'text-dim')}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) onMove(Math.round(d.nx + (e.clientX - d.x) / zoom), Math.round(d.ny + (e.clientY - d.y) / zoom))
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <GripHorizontal className="size-3.5" />
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} aria-label="Remove from canvas" className="opacity-0 transition-opacity hover:text-fail group-hover:opacity-100">
          <X className="size-3.5" />
        </button>
      </div>
      {children}
    </motion.div>
  )
}

function NoteText({ node, onChange }: { node: CanvasNode; onChange: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [node.text])
  const paper = node.type === 'note'
  return (
    <textarea
      ref={ref}
      value={node.text ?? ''}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      placeholder={paper ? 'A note…' : 'Writing…'}
      rows={2}
      className={cn(
        'block w-full resize-none bg-transparent px-3.5 pb-3.5 outline-none',
        paper ? 'font-serif text-[17px] leading-snug placeholder:text-ink/30' : 'text-[13px] leading-relaxed placeholder:text-dim',
      )}
    />
  )
}

function AssetView({ asset }: { asset: Asset | undefined }) {
  if (!asset) return <div className="skeleton m-2 aspect-square rounded-lg" />
  return (
    <div className="p-2 pt-0">
      {asset.kind === 'video' ? (
        <video src={asset.url} poster={asset.poster_url ?? undefined} controls playsInline className="w-full rounded-lg bg-black" onPointerDown={(e) => e.stopPropagation()} />
      ) : (
        <img src={asset.url} alt={asset.name ?? ''} draggable={false} className="w-full rounded-lg" />
      )}
      <p className="truncate px-1 pt-1.5 text-[11px] text-dim">{asset.name}</p>
    </div>
  )
}

/** Lines from each card to what was made from it: right edge to left edge, gently curved. */
function Edges({ canvas, sizes }: { canvas: Canvas; sizes: Map<string, { w: number; h: number }> }) {
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]))
  return (
    <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
      {canvas.edges.map((e) => {
        const a = byId.get(e.from)
        const b = byId.get(e.to)
        if (!a || !b) return null
        const sa = sizes.get(a.id) ?? { w: WIDTH[a.type], h: 120 }
        const sb = sizes.get(b.id) ?? { w: WIDTH[b.type], h: 120 }
        const [x1, y1] = [a.x + sa.w, a.y + Math.min(sa.h / 2, 80)]
        const [x2, y2] = [b.x, b.y + Math.min(sb.h / 2, 80)]
        const dx = Math.max(60, Math.abs(x2 - x1) / 2)
        return (
          <g key={`${e.from}-${e.to}`}>
            <path d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} fill="none" stroke="var(--color-accent-soft)" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4 5" />
            <circle cx={x2} cy={y2} r={3.5} fill="var(--color-accent-soft)" />
          </g>
        )
      })}
    </svg>
  )
}

function MakePanel({
  kind,
  models,
  defaultText,
  from,
  needsImage,
  onRun,
  onClose,
}: {
  kind: Kind
  models: ModelInfo[]
  defaultText: string
  from: string | null
  needsImage: boolean
  onRun: (prompt: string, model: string | null) => Promise<void>
  onClose: () => void
}) {
  const usable = models.filter((m) => m.kind === kind)
  const [model, setModel] = useState<string | null>(kind === 'text' ? defaultText : (usable.find((m) => m.available)?.id ?? usable[0]?.id ?? null))
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const current = usable.find((m) => m.id === model)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-1/2 top-4 z-20 w-[min(460px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-line-2 bg-panel-3 p-4 shadow-[0_30px_80px_-30px_rgb(0_0_0_/_0.95)]"
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium">{{ text: 'Write', image: 'Make a photo', video: 'Make a video' }[kind]}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="text-dim hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
      <ModelPicker models={models} kind={kind} value={model} onChange={setModel} className="mt-3" />
      <textarea
        autoFocus
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder={kind === 'video' ? 'The motion: slow push in, the flame flickers…' : 'Describe it…'}
        className={cn(inputClass, 'mt-2 h-auto resize-none py-2')}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className={cn('text-[11.5px]', needsImage ? 'text-warn' : 'text-dim')}>
          {needsImage ? 'Select an image on the canvas first: the video starts from it.' : from ? `Joined to ${from}.` : current && !current.available ? current.reason : ' '}
        </span>
        <Btn
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!prompt.trim() || needsImage || !current?.available}
          onClick={async () => {
            setBusy(true)
            await onRun(prompt, model)
            setBusy(false)
          }}
        >
          Make it
        </Btn>
      </div>
    </motion.div>
  )
}
