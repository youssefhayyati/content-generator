import { useMemo, useState } from 'react'
import { LayoutTemplate, Search, Shapes } from 'lucide-react'
import type { LabCatalog, LabTemplate } from '../../lib/api'
import { cn } from '../../lib/cn'
import { inputClass } from '../ui'
import { GROUP_HUE, iconOf } from './look'

/**
 * The left panel: every kind of node, by group (drag one onto the canvas, or click to add it in
 * the middle), and the templates (click to add the whole graph).
 */
export function Library({ catalog, onAdd, onTemplate, className }: { catalog: LabCatalog; onAdd: (type: string) => void; onTemplate: (t: LabTemplate) => void; className?: string }) {
  const [tab, setTab] = useState<'nodes' | 'templates'>('nodes')
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const words = q.toLowerCase().trim()
    return Object.entries(catalog.groups)
      .map(([g, label]) => ({
        g,
        label,
        nodes: Object.entries(catalog.nodes).filter(([type, k]) => k.group === g && (!words || `${k.label} ${k.detail} ${type}`.toLowerCase().includes(words))),
      }))
      .filter((x) => x.nodes.length)
  }, [catalog, q])
  const templates = useMemo(() => {
    const words = q.toLowerCase().trim()
    return catalog.templates.filter((t) => !words || `${t.name} ${t.tagline} ${t.category}`.toLowerCase().includes(words))
  }, [catalog, q])

  return (
    <aside className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex gap-1 p-2">
        {([['nodes', 'Nodes', Shapes], ['templates', 'Templates', LayoutTemplate]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] transition-colors', tab === k ? 'bg-white/[0.08] text-fg' : 'text-dim hover:text-fg')}>
            <Icon className="size-3.5" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>
      <div className="relative px-2 pb-2">
        <Search className="pointer-events-none absolute left-4.5 top-[11px] size-3.5 text-dim" />
        <input className={cn(inputClass, 'h-8 pl-8 text-[12px]')} placeholder={tab === 'nodes' ? 'Find a node…' : 'Find a template…'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div data-scroll data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tab === 'nodes' ? (
          groups.map(({ g, label, nodes }) => (
            <div key={g} className="mb-3">
              <p className="mb-1 px-1 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: GROUP_HUE[g] }}>
                {label}
              </p>
              {nodes.map(([type, k]) => {
                const Icon = iconOf(type)
                return (
                  <button
                    key={type}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-lab-node', type)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => onAdd(type)}
                    title={k.detail}
                    className="group flex w-full cursor-grab items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.05] active:cursor-grabbing"
                  >
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklab, ${GROUP_HUE[g]} 14%, transparent)`, color: GROUP_HUE[g] }}>
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] leading-tight">{k.label}</span>
                      <span className="line-clamp-2 text-[10.5px] leading-snug text-dim">{k.detail}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => (
              <button key={t.key} type="button" onClick={() => onTemplate(t)} className="w-full rounded-lg border border-line p-2.5 text-left transition-colors hover:border-white/25 hover:bg-white/[0.03]">
                <span className="flex items-center gap-2">
                  <span className="text-[12.5px] font-medium">{t.name}</span>
                  <span className="ml-auto font-mono text-[9.5px] text-dim">{t.nodes} nodes</span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-dim">{t.tagline}</span>
                <span className="mt-1.5 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">{t.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
