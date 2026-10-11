import { useMemo, useState } from 'react'
import { LayoutTemplate, Plus, Search, Shapes } from 'lucide-react'
import type { LabCatalog, LabTemplate } from '../../lib/api'
import { cn } from '../../lib/cn'
import { inputClass } from '../ui'
import { TemplateThumb } from './Gallery'
import { GROUP_HUE, iconOf } from './look'
import { AiBadge } from './NodeCard'

const AI_FILTERS = [['all', 'All'], ['ai', 'Uses AI'], ['none', 'No AI needed']] as const

/**
 * The left panel: every kind of node, by group (drag one onto the canvas, or click to add it in
 * the middle), and the templates, each with a picture of what it makes (click to see its example,
 * + to add the whole graph at once).
 */
export function Library({ catalog, onAdd, onTemplate, onPreview, className }: { catalog: LabCatalog; onAdd: (type: string) => void; onTemplate: (t: LabTemplate) => void; onPreview: (t: LabTemplate | null) => void; className?: string }) {
  const [tab, setTab] = useState<'nodes' | 'templates'>('nodes')
  const [q, setQ] = useState('')
  // Nodes that use AI, or the ones that run without it (those that use it only for some settings are in both).
  const [ai, setAi] = useState<(typeof AI_FILTERS)[number][0]>('all')
  const groups = useMemo(() => {
    const words = q.toLowerCase().trim()
    const fits = (a: string | undefined) => ai === 'all' || (ai === 'ai' ? a !== 'no' : a !== 'yes')
    return Object.entries(catalog.groups)
      .map(([g, label]) => ({
        g,
        label,
        nodes: Object.entries(catalog.nodes).filter(([type, k]) => k.group === g && fits(k.ai) && (!words || `${k.label} ${k.detail} ${type}`.toLowerCase().includes(words))),
      }))
      .filter((x) => x.nodes.length)
  }, [catalog, q, ai])
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
      {tab === 'nodes' && (
        <div className="flex gap-1 px-2 pb-2" role="radiogroup" aria-label="Show nodes">
          {AI_FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={ai === k} onClick={() => setAi(k)} className={cn('flex-1 rounded-md border py-1 text-[10.5px] transition-colors', ai === k ? 'border-accent-soft/50 bg-accent/10 text-fg' : 'border-line text-dim hover:text-fg')}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div data-scroll data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tab === 'templates' && (
          <button type="button" onClick={() => onPreview(null)} className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 py-2 text-[11.5px] text-muted transition-colors hover:border-white/30 hover:text-fg">
            <LayoutTemplate className="size-3.5" /> See them all, with examples
          </button>
        )}
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
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-[12.5px] leading-tight">{k.label}</span>
                        <AiBadge kind={k} className="ml-auto" />
                      </span>
                      <span className="line-clamp-2 text-[10.5px] leading-snug text-dim">{k.detail}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        ) : (
          [...new Set(templates.map((t) => t.category))].map((category) => (
            <div key={category} className="mb-3 space-y-1.5">
              <p className="px-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted">{category}</p>
              {templates.filter((t) => t.category === category).map((t) => (
                <div key={t.key} className="group relative">
                  <button type="button" onClick={() => onPreview(t)} title="See what it makes" className="flex w-full gap-2.5 rounded-lg border border-line p-2 text-left transition-colors hover:border-white/25 hover:bg-white/[0.03]">
                    <TemplateThumb t={t} className="size-12 shrink-0 rounded-md" />
                    <span className="min-w-0 flex-1">
                      <span className="block pr-6 text-[12.5px] font-medium leading-tight">{t.name}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-snug text-dim">{t.tagline}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => onTemplate(t)} aria-label={`Add ${t.name} to the canvas`} title="Add to the canvas" className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-dim opacity-0 transition-[opacity,color,background-color] hover:bg-white/[0.08] hover:text-fg focus-visible:opacity-100 group-hover:opacity-100">
                    <Plus className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
