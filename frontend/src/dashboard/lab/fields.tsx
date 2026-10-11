import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Brush, Check, Eraser, ImagePlus, Plus, Trash2, Undo2, X } from 'lucide-react'
import { uploadFiles, type Asset, type LabCatalog, type LabField, type LabMoment, type LabNode } from '../../lib/api'
import { cn } from '../../lib/cn'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { LabVoicePicker } from './VoicePicker'
import { MediaPicker, MediaThumb } from '../media/Media'
import { useToast } from '../toast'
import { Btn, Label, Modal, Select, Toggle, inputClass } from '../ui'

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
          <input id={id} type="color" className="h-9 w-12 cursor-pointer rounded border border-line-2 bg-transparent" value={str || '#ffffff'} onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(e.target.value, true)} />
          <input className={cn(inputClass, 'font-mono')} value={str} onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(e.target.value, true)} />
        </div>,
      )
    case 'colors': {
      const list = Array.isArray(value) ? (value as string[]) : []
      return wrap(
        <div className="flex flex-wrap items-center gap-2">
          {list.map((c, i) => (
            <span key={i} className="group relative">
              <input type="color" value={c} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => onChange(list, true)} className="size-8 cursor-pointer rounded-full border border-line-2 bg-transparent" />
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
      return wrap(<input id={id} type="datetime-local" className={inputClass} value={str} onChange={(e) => onChange(e.target.value, true)} />)
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
      return wrap(<TextsField value={Array.isArray(value) ? (value as TextItem[]) : []} onChange={onChange} ctx={ctx} />)
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

type TextItem = { slide?: number; text?: string; position?: string; size?: string; color?: string; style?: string; box_color?: string; font?: string }

const POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']
const SIZES = ['small', 'medium', 'large', 'huge']
const STYLES = { shadow: 'Shadow', box: 'On a panel', outline: 'Outlined', plain: 'Plain' }

/** The words on a Design node's slides: what, where, how big, in which colour and font. */
function TextsField({ value, onChange, ctx }: { value: TextItem[]; onChange: (v: unknown, now?: boolean) => void; ctx: FieldContext }) {
  const set = (i: number, patch: Partial<TextItem>, now = false) => onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)), now)
  return (
    <div className="space-y-2">
      {value.map((t, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line bg-white/[0.02] p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-dim">Slide</span>
            <input type="number" min={1} max={20} className={cn(inputClass, 'h-7 w-14 px-2 text-[12px]')} value={t.slide ?? 1} onChange={(e) => set(i, { slide: Number(e.target.value) || 1 }, true)} />
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i), true)} className="ml-auto text-dim hover:text-fail" aria-label="Remove these words">
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <textarea className={cn(inputClass, 'h-auto min-h-[52px] py-1.5 text-[12.5px]')} rows={2} value={t.text ?? ''} placeholder="The words ({offer} works)" onChange={(e) => set(i, { text: e.target.value })} onBlur={() => onChange(value, true)} />
          <div className="grid grid-cols-2 gap-1.5">
            <Select value={t.position ?? 'top'} onChange={(e) => set(i, { position: e.target.value }, true)} className="h-8 text-[12px]">
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <Select value={t.size ?? 'large'} onChange={(e) => set(i, { size: e.target.value }, true)} className="h-8 text-[12px]">
              {SIZES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <Select value={t.style ?? 'shadow'} onChange={(e) => set(i, { style: e.target.value }, true)} className="h-8 text-[12px]">
              {Object.entries(STYLES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Select value={t.font ?? ''} onChange={(e) => set(i, { font: e.target.value || undefined }, true)} className="h-8 text-[12px]">
              <option value="">Brand font / default</option>
              {ctx.catalog.engine.fonts.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-dim">Colour</span>
            <input type="color" value={t.color?.startsWith('#') ? t.color : '#ffffff'} onChange={(e) => set(i, { color: e.target.value })} onBlur={() => onChange(value, true)} className="h-7 w-10 cursor-pointer rounded border border-line-2 bg-transparent" />
            {t.style === 'box' && (
              <>
                <span className="text-[11px] text-dim">Panel</span>
                <input type="color" value={t.box_color?.startsWith('#') ? t.box_color : '#000000'} onChange={(e) => set(i, { box_color: e.target.value })} onBlur={() => onChange(value, true)} className="h-7 w-10 cursor-pointer rounded border border-line-2 bg-transparent" />
              </>
            )}
          </div>
        </div>
      ))}
      <Btn size="sm" icon={Plus} onClick={() => onChange([...value, { slide: 1, text: '', position: value.length ? 'bottom' : 'top', size: value.length ? 'medium' : 'large', style: 'shadow' }], true)}>
        Add words
      </Btn>
      <p className="text-[11px] leading-snug text-dim">A headline connected to the node goes on slide 1 when there are no words here.</p>
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
