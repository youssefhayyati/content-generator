import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Brush, Check, Eraser, ImagePlus, Plus, Undo2, X } from 'lucide-react'
import { api, ApiError, uploadFiles, type Asset, type LabCatalog, type LabField, type LabMoment, type LabNode } from '../../lib/api'
import { Link } from '../../lib/router'
import { cn } from '../../lib/cn'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { TextOverlay, type TextItem } from './TextOverlay'
import { LabVoicePicker } from './VoicePicker'
import { MediaPicker, MediaThumb } from '../media/Media'
import { useToast } from '../toast'
import { Btn, Label, Modal, Select, Toggle, inputClass, DateTimeInput, ColorInput } from '../ui'

/** What a field can know about the graph around its node. */
export type FieldContext = {
  catalog: LabCatalog
  node: LabNode
  assets: Record<number, Asset>
  /** The moments flowing into the node, when Find moments is connected. */
  moments: LabMoment[] | null
  /** The picture flowing into the node's image input, for painting on. */
  image: Asset | null
  /** The platform of the account picked on the node (a Post node). */
  platform: string | null
  /** Every picture or video flowing into its media input, in order (Text over it's slides). */
  media: Asset[]
  /** The brand's colours, from the brief connected (for text colours). */
  palette: string[]
  remember: (assets: Asset[]) => void
}

const PLACEMENTS: Record<string, Record<string, string>> = {
  instagram: { feed: 'Feed post', reel: 'Reel', story: 'Story' },
  x: { post: 'Post' },
  tiktok: { video: 'Video', photo: 'Photo post' },
  youtube: { short: 'Short', video: 'Video' },
  facebook: { feed: 'Feed post', reel: 'Reel', story: 'Story' },
  linkedin: { post: 'Post' },
  pinterest: { pin: 'Pin' },
}

export function FieldEditor({ field, value, onChange, ctx }: { field: LabField; value: unknown; onChange: (v: unknown, now?: boolean) => void; ctx: FieldContext }) {
  const id = `f-${ctx.node.id}-${field.key}`
  const str = value === null || value === undefined ? '' : String(value)
  const wrap = (control: ReactNode, inline = false) => (
    <div className={cn(inline && 'flex items-center justify-between gap-3')}>
      <label htmlFor={id} className="mb-1.5 block text-[11.5px] text-muted">
        {field.label}
      </label>
      {control}
      {field.help && <p className="mt-1 text-[11px] leading-snug text-dim">{field.help}</p>}
    </div>
  )

  switch (field.kind) {
    case 'hidden':
      return null
    case 'text':
    case 'url':
      return wrap(<input id={id} className={inputClass} value={str} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(e.target.value, true)} />)
    case 'textarea':
      return wrap(
        <textarea
          id={id}
          className={cn(inputClass, 'h-auto min-h-[84px] resize-y py-2 leading-snug')}
          rows={field.key === 'text' || field.key === 'lines' || field.key === 'script' ? 5 : 3}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onChange(e.target.value, true)}
        />,
      )
    case 'number':
      return wrap(
        <input
          id={id}
          type="number"
          className={inputClass}
          value={str}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={(e) => onChange(e.target.value === '' ? null : Number(e.target.value), true)}
        />,
      )
    case 'range': {
      const n = value === null || value === undefined ? null : Number(value)
      return wrap(
        <div className="flex items-center gap-3">
          <input id={id} type="range" className="flex-1 accent-[var(--color-accent)]" min={field.min ?? 0} max={field.max ?? 1} step={field.step ?? 0.01} value={n ?? Number(field.default ?? field.min ?? 0)} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)} />
          <span className="w-12 text-right font-mono text-[11px] tabular-nums text-dim">{n === null ? 'auto' : n.toFixed(2)}</span>
        </div>,
      )
    }
    case 'toggle':
      return (
        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-muted">{field.label}</span>
            <Toggle on={!!value} onChange={(on) => onChange(on, true)} label={field.label} />
          </div>
          {field.help && <p className="mt-1 text-[11px] leading-snug text-dim">{field.help}</p>}
        </div>
      )
    case 'select':
      return wrap(
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value, true)}>
          {Object.entries(field.options ?? {}).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>,
      )
    case 'color':
      return wrap(
        <div className="flex items-center gap-2">
          <ColorInput id={id} className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-line-2" value={str || '#ffffff'} onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(e.target.value, true)} />
          <input className={cn(inputClass, 'font-mono')} value={str} onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(e.target.value, true)} />
        </div>,
      )
    case 'colors': {
      const list = Array.isArray(value) ? (value as string[]) : []
      return wrap(
        <div className="flex flex-wrap items-center gap-2">
          {list.map((c, i) => (
            <span key={i} className="group relative">
              <ColorInput value={c} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => onChange(list, true)} className="block size-8 cursor-pointer rounded-full border border-line-2" />
              <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i), true)} aria-label="Remove this colour" className="absolute -right-1 -top-1 hidden size-4 place-items-center rounded-full bg-panel-3 text-dim group-hover:grid hover:text-fail">
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          {list.length < 6 && (
            <button type="button" onClick={() => onChange([...list, '#a5b4fc'], true)} className="grid size-8 place-items-center rounded-full border border-dashed border-line-2 text-dim hover:text-fg" aria-label="Add a colour">
              <Plus className="size-3.5" />
            </button>
          )}
        </div>,
      )
    }
    case 'datetime':
      return wrap(<DateTimeInput id={id} className={inputClass} value={str} onChange={(e) => onChange(e.target.value, true)} />)
    case 'model':
      return wrap(<ModelSelect id={id} list={ctx.catalog.models[field.models ?? 'text'] ?? []} value={str} onChange={(v) => onChange(v || null, true)} />)
    case 'account':
      return wrap(
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, true)}>
          <option value="">{field.key === 'account_id' && (ctx.node.type === 'finish.post' || ctx.node.type === 'finish.channel') ? 'Pick the account' : 'None'}</option>
          {ctx.catalog.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.handle} · {a.platform}
            </option>
          ))}
        </Select>,
      )
    case 'device': {
      const account = ctx.catalog.accounts.find((a) => a.id === Number(ctx.node.params?.account_id))
      return wrap(
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, true)}>
          <option value="">{account?.device ? `The account’s phone (${account.device})` : 'The account’s phone'}</option>
          {ctx.catalog.devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.driver === 'simulator' ? 'simulator' : 'phone agent or automation'}
            </option>
          ))}
        </Select>,
      )
    }
    case 'campaign':
      return wrap(
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, true)}>
          <option value="">No campaign</option>
          {ctx.catalog.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || `Campaign ${c.id}`}
            </option>
          ))}
        </Select>,
      )
    case 'placement': {
      const options = PLACEMENTS[ctx.platform ?? ''] ?? {}
      return wrap(
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value || null, true)}>
          <option value="">Whatever suits the media</option>
          {Object.entries(options).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>,
      )
    }
    case 'font':
      return wrap(
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value || null, true)}>
          <option value="">Default</option>
          {ctx.catalog.engine.fonts.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label} · {f.style}
            </option>
          ))}
        </Select>,
      )
    case 'voice':
      return wrap(
        <LabVoicePicker
          id={id}
          value={str}
          onChange={(v) => onChange(v, true)}
          prefix={field.engine ? '' : 'vs:'}
          emptyLabel={ctx.node.type === 'people.dub' ? 'Their own voice, cloned from the video' : field.engine ? 'The assistant’s voice' : 'The account’s voice, or the default'}
        />,
      )
    case 'moment': {
      if (!ctx.moments?.length) return wrap(<input id={id} type="number" min={1} className={inputClass} value={str} onChange={(e) => onChange(Number(e.target.value) || 1, true)} />)
      return wrap(
        <Select id={id} value={str} onChange={(e) => onChange(Number(e.target.value), true)}>
          {ctx.moments.map((m) => (
            <option key={m.n} value={m.n}>
              {m.n}. {m.title} ({Math.round(m.duration)} s)
            </option>
          ))}
        </Select>,
      )
    }
    case 'assets':
      return wrap(<AssetsField value={Array.isArray(value) ? (value as number[]) : []} onChange={(v) => onChange(v, true)} ctx={ctx} />)
    case 'texts':
      return wrap(<TextOverlay value={Array.isArray(value) ? (value as TextItem[]) : []} onChange={onChange} ctx={ctx} />)
    case 'chips':
      return wrap(<Chips options={field.options ?? {}} top={field.top} value={str} onChange={(v) => onChange(v, true)} />)
    case 'preset':
      return wrap(<PresetPicker tool={field.presets ?? ''} value={str} onChange={(v) => onChange(v, true)} />)
    case 'mask':
      return wrap(<MaskField value={value ? Number(value) : null} onChange={(v) => onChange(v, true)} ctx={ctx} />)
    default:
      return wrap(<input id={id} className={inputClass} value={str} onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(e.target.value, true)} />)
  }
}

/** Visible when its `show` rule holds (and its `connected` input is connected). */
export function shown(field: LabField, params: Record<string, unknown>, connected: (port: string) => boolean) {
  if (field.connected && !connected(field.connected)) return false
  if (field.unconnected && connected(field.unconnected)) return false
  if (!field.show) return true
  return Object.entries(field.show).every(([k, allowed]) => allowed.includes(String(params[k] ?? '')))
}

/* ------------------------------------------------------------------ */

function ModelSelect({ id, list, value, onChange }: { id: string; list: LabCatalog['models'][string]; value: string; onChange: (v: string) => void }) {
  const picked = list.find((m) => m.id === value) ?? list.find((m) => m.available) ?? list[0]
  return (
    <div>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Best available{picked ? ` (${picked.label})` : ''}</option>
        {list.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.available}>
            {m.label} · {m.price === 0 ? (m.provider === 'pod' ? 'free on your pod' : 'free') : m.price ? `$${m.price.toFixed(2)}` : m.reach}
            {!m.available ? ' (unavailable)' : ''}
          </option>
        ))}
      </Select>
      {picked && (
        <p className={cn('mt-1 text-[11px] leading-snug', picked.available ? 'text-dim' : 'text-warn')}>
          {picked.available ? (picked.purpose ?? picked.reach) : picked.reason}
        </p>
      )}
    </div>
  )
}

function AssetsField({ value, onChange, ctx }: { value: number[]; onChange: (v: number[]) => void; ctx: FieldContext }) {
  const [open, setOpen] = useState(false)
  const items = value.map((id) => ctx.assets[id]).filter(Boolean)
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {items.map((a) => (
          <div key={a.id} className="group relative">
            <MediaThumb asset={a} />
            <button type="button" onClick={() => onChange(value.filter((x) => x !== a.id))} aria-label="Remove" className="absolute right-1 top-1 hidden size-5 place-items-center rounded bg-black/70 text-white group-hover:grid">
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setOpen(true)} className="grid aspect-square place-items-center rounded-md border border-dashed border-line-2 text-dim transition-colors hover:border-white/30 hover:text-fg" aria-label="Add files">
          <ImagePlus className="size-4" />
        </button>
      </div>
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        kinds={['image', 'video', 'audio']}
        max={20}
        initial={items}
        title="Files for this node"
        onPick={(picked) => {
          ctx.remember(picked)
          onChange(picked.map((a) => a.id))
        }}
      />
    </div>
  )
}

/** A choice as a row of chips, the first few shown and the rest a click away. */
function Chips({ options, top, value, onChange }: { options: Record<string, string>; top?: number; value: string; onChange: (v: string) => void }) {
  const entries = Object.entries(options)
  const [all, setAll] = useState(false)
  const pickedLate = top !== undefined && entries.findIndex(([k]) => k === value) > top
  const shown = all || top === undefined || pickedLate ? entries : entries.slice(0, top + 1)
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k} className={cn('rounded-full border px-2.5 py-1 text-[11.5px] transition-colors', value === k ? 'border-accent-soft/70 bg-accent/15 text-fg' : 'border-line text-muted hover:border-line-2 hover:text-fg', k === '' && 'border-dashed')}>
          {label}
        </button>
      ))}
      {shown.length < entries.length && (
        <button type="button" onClick={() => setAll(true)} className="rounded-full px-2 py-1 text-[11.5px] text-accent-soft hover:underline">
          +{entries.length - shown.length} more
        </button>
      )}
    </div>
  )
}

type Preset = { id: string; name: string; preview_url: string | null }

/** A Higgsfield tool's looks, each with its preview: one click picks it. */
function PresetPicker({ tool, value, onChange }: { tool: string; value: string; onChange: (v: string) => void }) {
  const [presets, setPresets] = useState<Preset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    // Another tool: not its looks, or its error, while the new ones come.
    setPresets(null)
    setError(null)
    api<{ presets: Preset[] }>(`/lab/higgsfield/presets/${tool}`)
      .then((r) => live && setPresets(r.presets))
      .catch((e) => {
        if (!live) return
        setPresets([])
        setError(e instanceof ApiError ? e.message : 'The looks couldn’t be loaded.')
      })
    return () => {
      live = false
    }
  }, [tool])
  if (!presets) return <div className="grid grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <div key={i} className="aspect-square animate-pulse rounded-md bg-white/[0.05]" />)}</div>
  if (!presets.length) {
    return (
      <p className="text-[11.5px] leading-snug text-warn">
        {error ?? 'No looks are available.'} <Link to="/dashboard/models" className="text-accent-soft hover:underline">Models</Link>
      </p>
    )
  }
  const words = q.trim().toLowerCase()
  const shown = presets.filter((p) => !words || p.name.toLowerCase().includes(words))
  const picked = presets.find((p) => p.id === value)
  return (
    <div className="space-y-2">
      {presets.length > 9 && <input className={cn(inputClass, 'h-8 text-[12px]')} placeholder="Find a look: anime, clay, comic…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div data-scroll className="grid max-h-[300px] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
        {shown.map((p) => (
          <button key={p.id} type="button" onClick={() => onChange(p.id)} aria-pressed={p.id === value} title={p.name} className={cn('group relative overflow-hidden rounded-md border text-left transition-colors', p.id === value ? 'border-accent-soft ring-2 ring-accent-soft/40' : 'border-line hover:border-line-2')}>
            {p.preview_url ? <img src={p.preview_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" /> : <span className="block aspect-square w-full bg-white/[0.05]" />}
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-3 text-[10px] text-white">{p.name}</span>
          </button>
        ))}
      </div>
      {picked ? <p className="text-[11px] text-dim">Picked: {picked.name}</p> : value ? <p className="text-[11px] text-warn">The look picked isn’t offered any more: pick another.</p> : null}
    </div>
  )
}

/** Paint over the part of the picture to change; the strokes are saved as a mask. */
function MaskField({ value, onChange, ctx }: { value: number | null; onChange: (v: number | null) => void; ctx: FieldContext }) {
  const [open, setOpen] = useState(false)
  const mask = value ? ctx.assets[value] : null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Btn size="sm" icon={Brush} disabled={!ctx.image} onClick={() => setOpen(true)}>
          {value ? 'Paint again' : 'Paint the area'}
        </Btn>
        {value && (
          <Btn size="sm" variant="subtle" icon={Eraser} onClick={() => onChange(null)}>
            Clear
          </Btn>
        )}
      </div>
      {!ctx.image && <p className="text-[11px] text-dim">Connect a picture (and let it finish) to paint on it.</p>}
      {mask && ctx.image && (
        <div className="relative overflow-hidden rounded-md">
          <img src={ctx.image.url} alt="" className="w-full" />
          <img src={mask.url} alt="The painted area" className="absolute inset-0 size-full opacity-60 mix-blend-screen" />
        </div>
      )}
      {open && ctx.image && <PaintModal image={ctx.image} onClose={() => setOpen(false)} onSave={(id, asset) => {
        ctx.remember([asset])
        onChange(id)
        setOpen(false)
      }} />}
    </div>
  )
}

function PaintModal({ image, onClose, onSave }: { image: Asset; onClose: () => void; onSave: (id: number, asset: Asset) => void }) {
  const toast = useToast()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [brush, setBrush] = useState(0.06)
  const [strokes, setStrokes] = useState<Array<{ points: Array<[number, number]>; size: number }>>([])
  const [saving, setSaving] = useState(false)
  const drawing = useRef<{ points: Array<[number, number]>; size: number } | null>(null)
  const W = image.width ?? 1080
  const H = image.height ?? 1350

  const redraw = (all = strokes, extra: typeof drawing.current = null) => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    g.strokeStyle = 'rgba(255, 0, 200, 1)'
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const s of extra ? [...all, extra] : all) {
      g.lineWidth = s.size * Math.min(c.width, c.height)
      g.beginPath()
      s.points.forEach(([x, y], i) => (i ? g.lineTo(x * c.width, y * c.height) : g.moveTo(x * c.width, y * c.height)))
      if (s.points.length === 1) g.lineTo(s.points[0][0] * c.width + 0.1, s.points[0][1] * c.height)
      g.stroke()
    }
  }
  useEffect(() => redraw(), [strokes])

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  const save = async () => {
    setSaving(true)
    try {
      const out = document.createElement('canvas')
      out.width = W
      out.height = H
      const g = out.getContext('2d')!
      g.strokeStyle = '#ffffff'
      g.lineCap = 'round'
      g.lineJoin = 'round'
      for (const s of strokes) {
        g.lineWidth = s.size * Math.min(W, H)
        g.beginPath()
        s.points.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H)))
        if (s.points.length === 1) g.lineTo(s.points[0][0] * W + 0.1, s.points[0][1] * H)
        g.stroke()
      }
      const blob = await new Promise<Blob>((res) => out.toBlob((b) => res(b!), 'image/png'))
      const [asset] = await uploadFiles<Asset[]>('/assets', [new File([blob], 'painted-area-mask.png', { type: 'image/png' })])
      onSave(asset.id, asset)
    } catch {
      toast('The painted area couldn’t be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Paint over what to change" wide>
      <div className="space-y-3">
        <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-black">
          <img src={image.url} alt="" className="block max-h-[60vh] max-w-full" draggable={false} />
          <canvas
            ref={canvas}
            width={Math.min(W, 1400)}
            height={Math.round((Math.min(W, 1400) / W) * H)}
            className="absolute inset-0 size-full cursor-crosshair touch-none opacity-55"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = { points: [at(e)], size: brush }
              redraw(strokes, drawing.current)
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              drawing.current.points.push(at(e))
              redraw(strokes, drawing.current)
            }}
            onPointerUp={() => {
              const s = drawing.current
              drawing.current = null
              if (s) setStrokes((all) => [...all, s])
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label>Brush</Label>
          <input type="range" min={0.015} max={0.2} step={0.005} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="w-40 accent-[var(--color-accent)]" />
          <Btn size="sm" variant="subtle" icon={Undo2} disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}>
            Undo
          </Btn>
          <Btn size="sm" variant="subtle" icon={Eraser} disabled={!strokes.length} onClick={() => setStrokes([])}>
            Clear
          </Btn>
          <div className="ml-auto flex gap-2">
            <Btn variant="subtle" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="primary" icon={Check} loading={saving} disabled={!strokes.length} onClick={() => void save()}>
              Use this area
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function AccountChip({ platform, handle }: { platform: string; handle: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <PlatformIcon id={platform as never} className="size-3.5" />@{handle}
    </span>
  )
}
