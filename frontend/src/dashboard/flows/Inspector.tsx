import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { Account, FlowCatalog, FlowField, FlowGraph, FlowNode, SoundCatalog } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useApi } from '../data'
import { Btn, inputClass, Label } from '../ui'
import { hueOf, iconOf, variablesFor } from './look'

/** A node's settings with every default in place, for a node that's just been made or changed kind. */
export function defaults(catalog: FlowCatalog, type: string): FlowNode['config'] {
  return Object.fromEntries((catalog.nodes[type]?.fields ?? []).map((f) => [f.key, f.default ?? (f.kind === 'account' ? null : '')]))
}

/** The selected step: what it does, and its settings. Text settings take {{variables}}. */
export function Inspector({
  node,
  graph,
  catalog,
  accounts,
  onChange,
  onRemove,
}: {
  node: FlowNode
  graph: FlowGraph
  catalog: FlowCatalog
  accounts: Account[]
  onChange: (patch: Partial<FlowNode>) => void
  onRemove: () => void
}) {
  const kind = catalog.nodes[node.type]
  const Icon = iconOf(node.type)
  const hue = hueOf(node.type)
  const vars = variablesFor(graph, node.id, catalog)
  const isTrigger = node.type.startsWith('trigger.')
  const triggers = Object.entries(catalog.nodes).filter(([t]) => t.startsWith('trigger.'))
  const set = (key: string, value: string | number | null) => onChange({ config: { ...node.config, [key]: value } })
  const visible = (f: FlowField) => !f.when || Object.entries(f.when).every(([k, v]) => String(node.config[k]) === v)

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ background: `color-mix(in oklab, ${hue} 16%, transparent)`, color: hue, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 35%, transparent)` }}
        >
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: hue }}>
            {catalog.groups[kind.group]}
          </p>
          <p className="text-[15px] font-medium tracking-[-0.01em]">{kind.label}</p>
          <p className="mt-1 text-[12px] leading-snug text-dim">{kind.detail}</p>
        </div>
      </div>

      {isTrigger && (
        <label className="block">
          <Label>Starts when</Label>
          <select value={node.type} onChange={(e) => onChange({ type: e.target.value, config: defaults(catalog, e.target.value) })} className={cn(inputClass, 'mt-2')}>
            {triggers.map(([t, k]) => (
              <option key={t} value={t}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {kind.fields.filter(visible).map((f) => (
        <Field key={f.key} field={f} value={node.config[f.key] ?? null} accounts={accounts} vars={vars} onChange={(v) => set(f.key, v)} />
      ))}

      {kind.produces.length > 0 && (
        <div>
          <Label>Leaves for the next steps</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kind.produces.map((v) => (
              <code key={v} className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{`{{${v}}}`}</code>
            ))}
          </div>
        </div>
      )}

      {!isTrigger && (
        <div className="border-t border-line pt-4">
          <Btn variant="danger" size="sm" icon={Trash2} onClick={onRemove}>
            Remove this step
          </Btn>
        </div>
      )}
    </div>
  )
}

function Field({
  field: f,
  value,
  accounts,
  vars,
  onChange,
}: {
  field: FlowField
  value: string | number | null
  accounts: Account[]
  vars: string[]
  onChange: (v: string | number | null) => void
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  // Put {{variable}} where the cursor is, or at the end.
  const insert = (v: string) => {
    const el = ref.current
    const text = String(value ?? '')
    const token = `{{${v}}}`
    if (!el) return onChange(text + token)
    const at = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? at
    onChange(text.slice(0, at) + token + text.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(at + token.length, at + token.length)
    })
  }

  return (
    <label className="block">
      <Label>{f.label}</Label>
      {f.kind === 'voice' ? (
        <VoiceSelect value={String(value ?? '')} onChange={onChange} hint={f.hint} />
      ) : f.kind === 'account' ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={cn(inputClass, 'mt-2')}>
          <option value="">{f.hint ?? 'Any account'}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      ) : f.kind === 'select' ? (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, 'mt-2')}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.kind === 'time' ? (
        <input type="time" value={String(value ?? '09:00')} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, 'mt-2')} />
      ) : f.kind === 'number' ? (
        <input type="number" min={0} step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={cn(inputClass, 'mt-2')} />
      ) : f.kind === 'textarea' ? (
        <textarea ref={ref} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={f.placeholder} className={cn(inputClass, 'mt-2 h-auto resize-y py-2 leading-snug')} />
      ) : (
        <input ref={ref} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} className={cn(inputClass, 'mt-2')} />
      )}
      {(f.kind === 'text' || f.kind === 'textarea') && vars.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {vars.map((v) => (
            <button
              key={v}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                insert(v)
              }}
              className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-dim transition-colors hover:border-accent-soft/40 hover:text-accent-soft"
            >
              +{v}
            </button>
          ))}
        </span>
      )}
    </label>
  )
}

/** A voice from FlowAI Sound, or the account's own. */
function VoiceSelect({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
  const { data } = useApi<SoundCatalog>('/sound')
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, 'mt-2')}>
      <option value="">{hint ?? 'The account’s voice'}</option>
      {(data?.voices ?? []).map((v) => (
        <option key={v.id} value={v.id}>
          {v.name} · {v.language} · {v.style}
        </option>
      ))}
    </select>
  )
}
