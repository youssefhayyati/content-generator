import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, AudioLines, Check, CircleDashed, Clock, LoaderCircle, Pin, Play, Sparkles, Square, X } from 'lucide-react'
import type { Asset, LabNode, LabNodeKind, LabNodeState, LabPortType, LabValue } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { CARD_W, HEAD_H, NOTE_W, PORT_HUE, ROW_H, costLine, fits, hueOf, iconOf, portRows } from './look'

type Wire = { from: string; out: string; type: LabPortType }

const STATUS: Record<string, { label: string; cls: string; icon: typeof Check }> = {
  done: { label: 'Done', cls: 'text-ok', icon: Check },
  running: { label: 'Running', cls: 'text-accent-soft', icon: LoaderCircle },
  queued: { label: 'Queued', cls: 'text-muted', icon: Clock },
  stale: { label: 'Out of date', cls: 'text-warn', icon: AlertTriangle },
  ready: { label: 'Ready to run', cls: 'text-muted', icon: CircleDashed },
  missing: { label: 'Needs input', cls: 'text-dim', icon: CircleDashed },
  failed: { label: 'Failed', cls: 'text-fail', icon: AlertTriangle },
  empty: { label: 'Empty', cls: 'text-dim', icon: CircleDashed },
}

/**
 * A node on the canvas: its kind as a coloured glyph, its name and how it stands; its inputs (left)
 * and outputs (right) as typed ports; then a preview of what it made. Drag it by its header; the ×
 * on its corner (on hover, or selected) removes it; a right click opens its menu.
 */
export function NodeCard({
  node,
  kind,
  state,
  assets,
  zoom,
  selected,
  wire,
  hoverIn,
  onSelect,
  onOpen,
  onMove,
  onMoved,
  onWire,
  onRun,
  onStop,
  onRemove,
  onMenu,
}: {
  node: LabNode
  kind: LabNodeKind | undefined
  state: LabNodeState | undefined
  assets: Record<number, Asset>
  zoom: number
  selected: boolean
  wire: Wire | null
  hoverIn: string | null
  onSelect: () => void
  onOpen: () => void
  onMove: (x: number, y: number) => void
  onMoved: (x: number, y: number) => void
  onWire: (out: string, type: LabPortType, e: ReactPointerEvent) => void
  onRun: () => void
  onStop: () => void
  onRemove: () => void
  /** A right click: the node's menu, where the pointer is. */
  onMenu: (clientX: number, clientY: number) => void
}) {
  const drag = useRef<{ x: number; y: number; nx: number; ny: number; moved: boolean } | null>(null)
  const hue = hueOf(kind)
  const Icon = iconOf(node.type)
  const status = state?.status ?? 'empty'
  const s = STATUS[status] ?? STATUS.empty
  const running = status === 'running' || status === 'queued'
  const run = state?.active ?? null
  const rows = portRows(kind)
  const note = node.type === 'util.note'
  const runnable = state && state.policy !== 'none'
  // A run that costs money (or might: the price unknown) asks once more, saying what it costs.
  const paid = !!state?.estimate && state.estimate.cost !== 0
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const t = window.setTimeout(() => setConfirm(false), 4000)
    return () => window.clearTimeout(t)
  }, [confirm])

  const dragProps = {
    onPointerDown: (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return
      e.stopPropagation()
      onSelect()
      // Only the main button drags: a right click opens the menu, and its pointerup never comes back.
      if (e.button !== 0) return
      drag.current = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y, moved: false }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = (e.clientX - d.x) / zoom
      const dy = (e.clientY - d.y) / zoom
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      d.moved = true
      onMove(Math.round(d.nx + dx), Math.round(d.ny + dy))
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const d = drag.current
      drag.current = null
      if (d?.moved) onMoved(Math.round(d.nx + (e.clientX - d.x) / zoom), Math.round(d.ny + (e.clientY - d.y) / zoom))
    },
    onPointerCancel: () => {
      drag.current = null
    },
  }
  const menuProps = {
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onSelect()
      onMenu(e.clientX, e.clientY)
    },
  }
  const remove = (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onRemove}
      aria-label={`Remove ${node.label || kind?.label || 'this node'}`}
      title="Remove"
      className={cn(
        'absolute -right-2.5 -top-2.5 z-10 grid size-6 place-items-center rounded-full border border-line-2 bg-panel-3 text-muted shadow-lg transition-[opacity,color,border-color] duration-150 hover:border-fail/60 hover:text-fail focus-visible:opacity-100',
        selected ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
      )}
    >
      <X className="size-3.5" />
    </button>
  )

  if (note) {
    return (
      <motion.div
        {...dragProps}
        {...menuProps}
        onDoubleClick={onOpen}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease }}
        className={cn('group pointer-events-auto absolute cursor-grab select-none rounded-xl border bg-[#2a2716] p-4 shadow-[0_18px_40px_-24px_rgb(0_0_0_/_0.9)] active:cursor-grabbing', selected ? 'border-[#f5d76e]/70' : 'border-[#f5d76e]/20')}
        style={{ left: node.x, top: node.y, width: NOTE_W }}
      >
        {remove}
        <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-[#f3e9b5]">{String(node.params?.text || 'A note…')}</p>
      </motion.div>
    )
  }

  return (
    <motion.div
      data-node={node.id}
      initial={{ opacity: 0, scale: 0.95, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.35, ease }}
      onDoubleClick={onOpen}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, [data-port]')) return
        e.stopPropagation()
        onSelect()
      }}
      {...menuProps}
      className={cn(
        'group pointer-events-auto absolute select-none rounded-[14px] border bg-panel-2 shadow-[0_22px_50px_-26px_rgb(0_0_0_/_0.95)] transition-[border-color,box-shadow] duration-300',
        selected ? 'border-white/45 shadow-[0_0_0_3px_rgb(255_255_255_/_0.07),0_22px_50px_-26px_rgb(0_0_0_/_0.95)]' : 'border-line-2',
        status === 'failed' && !selected && 'border-fail/55',
        status === 'stale' && !selected && 'border-dashed border-warn/55',
        running && 'flow-thinking',
      )}
      style={{ left: node.x, top: node.y, width: CARD_W, ['--flow-hue' as string]: hue }}
    >
      {remove}
      {/* Header: the handle to drag it by. */}
      <div {...dragProps} className="relative flex cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing" style={{ height: HEAD_H }}>
        <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: hue }} />
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px]" style={{ background: `color-mix(in oklab, ${hue} 15%, transparent)`, color: hue, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 32%, transparent)` }}>
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium leading-tight tracking-[-0.01em]">{node.label || kind?.label || node.type}</span>
            {node.branch && <span className="shrink-0 rounded bg-white/10 px-1 font-mono text-[9px] text-muted">{node.branch}</span>}
            {node.pin && !node.soft && <Pin className="size-3 shrink-0 text-accent-soft" />}
            <AiBadge kind={kind} className="ml-auto" />
          </span>
          <span className={cn('mt-0.5 flex items-center gap-1 text-[10.5px] leading-none', s.cls)}>
            <s.icon className={cn('size-3', status === 'running' && 'animate-spin')} strokeWidth={2} />
            <span className="truncate">{status === 'running' && run?.stage ? run.stage : s.label}</span>
            {(state?.versions ?? 0) > 1 && <span className="ml-auto shrink-0 font-mono text-[9.5px] text-dim">v{state?.current?.version}</span>}
          </span>
        </span>
        {runnable && state.policy !== 'post' && (running ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.08] hover:text-fail">
            <Square className="size-3" fill="currentColor" />
          </button>
        ) : (status === 'ready' || status === 'stale' || status === 'failed' || (status === 'done' && state.policy === 'manual')) ? (
          confirm ? (
            <button type="button" onClick={() => {
              setConfirm(false)
              onRun()
            }} title={`${state.run_label} · ${costLine(state.estimate)}`} className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-white/[0.08] px-2 font-mono text-[10px] text-fg transition-colors hover:bg-white/[0.14]">
              <Play className="size-3" fill="currentColor" style={{ color: hue }} />
              {state.estimate?.cost == null ? 'cost ?' : `$${state.estimate.cost.toFixed(2)}`}
            </button>
          ) : (
            <button type="button" onClick={() => (paid ? setConfirm(true) : onRun())} aria-label={state.run_label} title={`${state.run_label}${state.estimate ? ` · ${costLine(state.estimate)}` : ''}`} className="grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-white/[0.08]" style={{ color: hue }}>
              <Play className="size-3.5" fill="currentColor" />
            </button>
          )
        ) : null)}
      </div>

      {/* Ports: inputs left, outputs right, one row each. */}
      {rows > 0 && (
        <div className="relative border-t border-line" style={{ height: rows * ROW_H }}>
          {kind?.inputs.map((p, i) => {
            const live = wire && wire.from !== node.id && fits(wire.type, p.accepts)
            const hot = hoverIn === `${node.id}:${p.name}`
            return (
              <div key={p.name} className="absolute left-0 flex items-center gap-1.5 pl-3" style={{ top: i * ROW_H, height: ROW_H }}>
                <span
                  data-port="in"
                  className={cn('absolute -left-[6px] size-3 rounded-full border-2 bg-panel-2 transition-transform', (live || hot) && 'scale-125')}
                  style={{ borderColor: live || hot ? PORT_HUE[p.accepts[0]] : 'var(--color-line-2)', boxShadow: hot ? `0 0 0 4px color-mix(in oklab, ${PORT_HUE[p.accepts[0]]} 30%, transparent)` : undefined }}
                />
                <span className={cn('text-[10.5px]', live ? 'text-fg' : 'text-dim')}>
                  {p.label}
                  {p.required && <span className="text-fail/80">*</span>}
                </span>
              </div>
            )
          })}
          {kind?.outputs.map((p, i) => {
            const value = state?.outputs?.[p.name]
            const has = filled(value)
            return (
              <div key={p.name} className="absolute right-0 flex items-center gap-1.5 pr-3" style={{ top: i * ROW_H, height: ROW_H }}>
                <span className={cn('text-[10.5px]', has ? 'text-muted' : 'text-dim')}>{p.label}</span>
                <span
                  data-port="out"
                  role="button"
                  aria-label={`Draw a line from ${p.label}`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onWire(p.name, p.type, e)
                  }}
                  className="absolute -right-[7px] grid size-3.5 cursor-crosshair place-items-center rounded-full border-2 bg-panel-2 transition-transform hover:scale-150"
                  style={{ borderColor: PORT_HUE[p.type], background: has ? PORT_HUE[p.type] : undefined }}
                />
              </div>
            )
          })}
        </div>
      )}

      <Preview node={node} state={state} assets={assets} />

      {running && (
        <div className="h-[3px] overflow-hidden rounded-b-[14px] bg-white/[0.05]">
          {run?.share != null ? (
            <div className="h-full transition-[width] duration-700" style={{ width: `${Math.max(4, run.share * 100)}%`, background: hue }} />
          ) : (
            <div className="h-full w-1/3 animate-[lab-indeterminate_1.4s_ease-in-out_infinite]" style={{ background: hue }} />
          )}
        </div>
      )}
    </motion.div>
  )
}

/** Whether a node needs AI to run, at a glance: AI, AI for some settings, or no AI. */
export function AiBadge({ kind, long = false, className }: { kind: LabNodeKind | undefined; long?: boolean; className?: string }) {
  const ai = kind?.ai ?? 'no'
  const label = ai === 'yes' ? 'AI' : ai === 'some' ? (long ? 'AI for some settings' : 'AI · some') : 'No AI'
  return (
    <span
      title={kind?.ai_detail ?? undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px font-mono text-[9px] uppercase leading-[14px] tracking-[0.06em]',
        ai === 'yes' ? 'bg-accent/15 text-accent-soft' : ai === 'some' ? 'border border-dashed border-accent-soft/40 text-accent-soft/80' : 'bg-white/[0.05] text-dim',
        className,
      )}
    >
      {ai !== 'no' && <Sparkles className="size-2.5" strokeWidth={2} />}
      {label}
    </span>
  )
}

export function filled(v: LabValue | undefined) {
  if (!v) return false
  switch (v.type) {
    case 'text':
      return !!v.text?.trim()
    case 'brief':
      return !!v.brief
    case 'moments':
      return !!v.moments?.length
    case 'transcript':
      return !!(v.asset_id || v.source_id || v.text)
    case 'source':
      return !!v.source_id
    case 'post':
      return !!v.post_id
    case 'channel':
      return !!v.account_id
    default:
      return !!v.assets?.length
  }
}

/** Every asset id a node holds or made, by kind. */
export function nodeAssets(node: LabNode, state: LabNodeState | undefined, assets: Record<number, Asset>) {
  const ids = node.type === 'source.media' ? ((node.params?.assets as number[]) ?? []) : Object.values(state?.outputs ?? {}).flatMap((v) => v.assets ?? [])
  // An asset on two ports (a Character's look) shows once.
  return [...new Set(ids)].map((id) => assets[id]).filter(Boolean)
}

/** What the node made (or holds), small. */
function Preview({ node, state, assets }: { node: LabNode; state: LabNodeState | undefined; assets: Record<number, Asset> }) {
  const outs = state?.outputs ?? {}
  const media = nodeAssets(node, state, assets)
  const images = media.filter((a) => a.kind === 'image')
  const videos = media.filter((a) => a.kind === 'video')
  const sounds = media.filter((a) => a.kind === 'audio')
  const written = Object.values(outs).find((v) => v.type === 'text' && v.text)
  const text = written?.text
  const moments = Object.values(outs).find((v) => v.type === 'moments')?.moments
  const brief = Object.values(outs).find((v) => v.type === 'brief')?.brief
  const error = state?.status === 'failed' ? state.failed?.error : null
  const parts: ReactNode[] = []

  if (state?.source) {
    const src = state.source
    parts.push(
      <div key="src" className="flex gap-2.5">
        {src.thumbnail && <img src={src.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded object-cover" referrerPolicy="no-referrer" />}
        <div className="min-w-0">
          <p className="line-clamp-2 text-[11.5px] leading-snug">{src.title}</p>
          <p className={cn('mt-0.5 text-[10px]', src.permission === 'allowed' ? 'text-ok' : src.permission === 'denied' ? 'text-fail' : 'text-warn')}>
            {src.permission === 'allowed' ? `Permission: ${src.basis === 'own' ? 'yours' : src.basis === 'creative_commons' ? 'Creative Commons' : 'given'}` : src.permission === 'denied' ? 'Not ours to use' : 'Permission needed'}
          </p>
        </div>
      </div>,
    )
  } else if (node.type === 'source.youtube' && node.params?.url) {
    parts.push(<p key="url" className="truncate text-[11px] text-dim">{String(node.params.url)}</p>)
  }

  if (state?.post) {
    const p = state.post
    parts.push(
      <div key="post" className="space-y-2">
        <div className="flex items-center gap-2">
          {p.account && <PlatformIcon id={p.account.platform} className="size-3.5" />}
          <span className="truncate text-[11.5px]">{p.account ? `@${p.account.handle}` : 'No account'}</span>
          <span className={cn('ml-auto rounded px-1.5 py-0.5 text-[10px] capitalize', p.status === 'published' ? 'bg-ok/15 text-ok' : p.status === 'failed' ? 'bg-fail/15 text-fail' : p.status === 'scheduled' ? 'bg-accent/15 text-accent-soft' : 'bg-white/10 text-muted')}>{p.status}</span>
        </div>
        {p.scheduled_at && p.status === 'scheduled' && <p className="text-[10.5px] text-dim">{new Date(p.scheduled_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
        {p.run?.screenshot_url && <img src={p.run.screenshot_url} alt="What the phone showed" className="max-h-40 w-full rounded object-cover object-top" />}
        {p.metrics && (
          <p className="font-mono text-[10px] text-muted">
            {[p.metrics.views != null && `${p.metrics.views} views`, p.metrics.likes != null && `${p.metrics.likes} likes`, p.metrics.comments != null && `${p.metrics.comments} comments`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>,
    )
  }

  const channel = Object.values(outs).find((v) => v.type === 'channel' && v.account_id)
  if (channel) {
    parts.push(
      <div key="where" className="flex items-center gap-2 text-[11.5px]">
        <PlatformIcon id={channel.platform as never} className="size-3.5" />
        <span className="truncate">@{channel.handle}</span>
        <span className="ml-auto shrink-0 text-dim">{channel.label}</span>
      </div>,
    )
  }
  if (images.length) {
    parts.push(
      <div key="img" className={cn('grid gap-1', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {images.slice(0, 4).map((a) => (
          <img key={a.id} src={a.url} alt={a.name ?? ''} loading="lazy" className={cn('w-full rounded-md bg-black/30', images.length > 1 ? 'aspect-square object-cover' : 'max-h-64 object-contain')} />
        ))}
      </div>,
    )
  }
  if (videos.length) {
    const v = videos[0]
    parts.push(
      <video
        key={`vid-${v.id}`}
        src={v.url}
        poster={v.poster_url ?? undefined}
        muted
        loop
        playsInline
        preload="none"
        onPointerEnter={(e) => void e.currentTarget.play().catch(() => {})}
        onPointerLeave={(e) => e.currentTarget.pause()}
        className="max-h-60 w-full rounded-md bg-black object-contain"
      />,
    )
  }
  if (sounds.length) {
    parts.push(
      <div key="snd" className="space-y-1">
        {sounds.slice(0, 3).map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1.5">
            <AudioLines className="size-3.5 shrink-0 text-ok" />
            <span className="min-w-0 flex-1 truncate text-[11px]">{a.sound?.voice_name ?? a.sound?.label ?? a.name}</span>
            {a.duration && <span className="font-mono text-[10px] text-dim">{Math.round(a.duration)}s</span>}
          </div>
        ))}
      </div>,
    )
  }
  if (moments?.length) {
    parts.push(
      <ol key="mom" className="space-y-1">
        {moments.slice(0, 4).map((m) => (
          <li key={m.n} className="flex gap-1.5 text-[11px] leading-snug">
            <span className="font-mono text-[10px] text-dim">{m.n}</span>
            <span className="min-w-0 flex-1 truncate">{m.title}</span>
            <span className="font-mono text-[10px] text-dim">{Math.round(m.duration)}s</span>
          </li>
        ))}
        {moments.length > 4 && <li className="text-[10.5px] text-dim">+{moments.length - 4} more</li>}
      </ol>,
    )
  }
  if (brief) {
    const chips = [brief.campaign?.name, brief.product, brief.offer, brief.tone].filter(Boolean).map(String)
    parts.push(
      <div key="brief" className="space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {chips.slice(0, 4).map((c) => (
            <span key={c} className="max-w-full truncate rounded bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] text-muted">{c}</span>
          ))}
          {!chips.length && <span className="text-[11px] text-dim">Fill it in, or pick a campaign.</span>}
        </div>
        {!!brief.palette?.length && (
          <div className="flex gap-1">
            {brief.palette.map((c) => (
              <span key={c} className="size-3.5 rounded-full ring-1 ring-white/20" style={{ background: c }} />
            ))}
          </div>
        )}
      </div>,
    )
  }
  if (written?.items && written.items.length > 1 && !moments?.length) {
    // Several pieces: numbered, the way the lines out of it pick them.
    parts.push(
      <ol key="items" className="space-y-1.5">
        {written.items.slice(0, 4).map((t, i) => (
          <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-muted">
            <span className="shrink-0 font-mono text-[10px] text-dim">#{i + 1}</span>
            <span className="line-clamp-2 min-w-0 flex-1">{t}</span>
          </li>
        ))}
        {written.items.length > 4 && <li className="text-[10.5px] text-dim">+{written.items.length - 4} more</li>}
      </ol>,
    )
  } else if (text && !moments?.length) {
    parts.push(
      <p key="txt" className="line-clamp-5 whitespace-pre-wrap text-[11.5px] leading-snug text-muted">
        {text}
      </p>,
    )
  }
  const transcript = Object.values(outs).find((v) => v.type === 'transcript')
  if (transcript?.words && !text) parts.push(<p key="tr" className="text-[11px] text-dim">{transcript.words} words{transcript.language ? ` · ${transcript.language}` : ''}</p>)
  if (error) parts.push(<p key="err" className="line-clamp-3 text-[11px] leading-snug text-fail">{error}</p>)
  if (state?.status === 'missing' && state.missing?.length && !error) parts.push(<p key="miss" className="line-clamp-2 text-[10.5px] leading-snug text-dim">{state.missing[0]}</p>)
  if (state?.estimate?.unavailable && state.status !== 'done' && !error) parts.push(<p key="off" className="line-clamp-2 text-[10.5px] leading-snug text-warn">Can’t run yet: {state.estimate.unavailable}</p>)
  const character = Object.values(outs).find((v) => v.type === 'character' && v.reference_id)
  if (character) parts.push(<p key="char" className="text-[10.5px] text-muted">Trained: {character.name ?? 'the character'}, ready for Character pictures</p>)
  const warnings = Object.values(outs).flatMap((v) => v.warnings ?? [])
  if (warnings.length) parts.push(<p key="warn" className="line-clamp-2 text-[10.5px] text-warn">{warnings[0]}</p>)

  if (!parts.length) return null
  return (
    <div data-scroll className="max-h-[360px] space-y-2.5 overflow-hidden border-t border-line p-3">
      {parts}
    </div>
  )
}
