import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Plus, Workflow } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Account, type FlowCatalog, type FlowDetail, type FlowList, type FlowSummary, type FlowTemplate } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { FlowEditor } from '../flows/Editor'
import { RunStatus } from '../flows/Runs'
import { SayIt } from '../flows/SayIt'
import { Sketch } from '../flows/Sketch'
import { useToast } from '../toast'
import { Btn, CountUp, Label, PageHeader, Skeleton, Stagger, Toggle } from '../ui'

/** /dashboard/flows: the automations, or one of them on its canvas (?id=). */
export default function Flows() {
  const { search } = useRouter()
  const params = new URLSearchParams(search)
  const id = params.get('id')
  return id ? <FlowEditor key={id} id={Number(id)} runParam={params.get('run') ? Number(params.get('run')) : null} born={params.has('born')} /> : <FlowsHome />
}

function FlowsHome() {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data, loading } = useApi<FlowList>('/flows')
  const { data: catalog } = useApi<FlowCatalog>('/flows/catalog')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [creating, setCreating] = useState<string | null>(null)

  const create = async (template: string | null) => {
    setCreating(template ?? 'blank')
    try {
      const flow = await api<FlowDetail>('/flows', { method: 'POST', body: template ? { template } : {} })
      invalidate()
      navigate(`/dashboard/flows?id=${flow.id}&born=1`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t create the flow.', 'error')
      setCreating(null)
    }
  }

  const flows = data?.flows ?? []

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Flows"
        title={
          <>
            Set it <Serif>once.</Serif>
          </>
        }
        sub="Automations that write, wait, watch and ask — drawn on a canvas, picked from a recipe, or described in your own words. Nothing goes on the calendar until you say yes."
        actions={
          <Btn icon={Plus} loading={creating === 'blank'} onClick={() => create(null)}>
            Blank canvas
          </Btn>
        }
      />

      <Stagger i={0} className="mt-8">
        {catalog ? <SayIt catalog={catalog} accounts={accounts} /> : <Skeleton className="h-[108px] rounded-2xl" />}
      </Stagger>

      {data && (data.stats.on > 0 || data.stats.runs_today > 0 || data.stats.waiting_on_you > 0) && (
        <Stagger i={1} className="mt-6">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
            <Stat label="Flows on" value={data.stats.on} />
            <Stat label="Runs today" value={data.stats.runs_today} />
            <Stat label="Waiting on you" value={data.stats.waiting_on_you} urgent={data.stats.waiting_on_you > 0} onClick={() => navigate('/dashboard/inbox')} />
          </div>
        </Stagger>
      )}

      <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-10">
          {/* Your flows */}
          {(loading && !data) || flows.length > 0 ? (
            <section>
              <div className="flex items-end justify-between">
                <Label>Your flows</Label>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {!data
                  ? [0, 1].map((i) => <Skeleton key={i} className="h-[180px] rounded-xl" />)
                  : flows.map((f, i) => <FlowCard key={f.id} flow={f} i={i} />)}
              </div>
            </section>
          ) : null}

          {/* Recipes */}
          <section>
            <Label>{flows.length ? 'More recipes' : 'Start from a recipe'}</Label>
            <p className="mt-1 text-[12.5px] text-dim">Whole automations, set up for your accounts. They start switched off: look, change anything, then turn them on.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {!catalog
                ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[210px] rounded-xl" />)
                : catalog.templates.map((t, i) => <Recipe key={t.key} template={t} i={i} busy={creating === t.key} onUse={() => create(t.key)} />)}
            </div>
          </section>
        </div>

        {/* Activity */}
        <aside className="min-w-0">
          <Label>Activity</Label>
          <div className="mt-3 rounded-xl border border-line bg-panel p-2">
            {!data ? (
              <Skeleton className="h-40" />
            ) : data.runs.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12px] leading-snug text-dim">Runs show up here as your flows work: what started them, and how they went.</p>
            ) : (
              <ul>
                {data.runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboard/flows?id=${r.flow_id}&run=${r.id}`)}
                      className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium">{r.flow}</span>
                        <span className="shrink-0 font-mono text-[10px] text-dim">{fmtRelative(r.created_at)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-dim">{r.cause}</span>
                      <RunStatus status={r.status} className="mt-1" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value, urgent, onClick }: { label: string; value: number; urgent?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="bg-panel px-4 py-3.5 text-left transition-colors enabled:hover:bg-panel-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{label}</p>
      <CountUp value={value} className={cn('mt-1 block text-[24px] font-medium tabular-nums tracking-[-0.03em]', urgent && 'text-[#ff8fa3]')} />
    </button>
  )
}

function FlowCard({ flow: f, i }: { flow: FlowSummary; i: number }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [on, setOn] = useState(f.enabled)

  const toggle = async (next: boolean) => {
    setOn(next)
    try {
      await api(`/flows/${f.id}`, { method: 'PATCH', body: { enabled: next } })
      invalidate()
      toast(next ? `“${f.name}” is on.` : `“${f.name}” is off.`)
    } catch (e) {
      setOn(!next)
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t switch it.', 'error')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: Math.min(i, 8) * 0.04 }}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/dashboard/flows?id=${f.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/dashboard/flows?id=${f.id}`)}
      className={cn(
        'group cursor-pointer overflow-hidden rounded-xl border bg-panel text-muted transition-colors hover:border-line-2 hover:bg-panel-2',
        on ? 'border-line' : 'border-line opacity-80',
      )}
    >
      <div className="border-b border-line bg-ink/40 px-4 py-3">
        <Sketch graph={f.graph} height={70} live={on && f.last_run?.status === 'running'} />
      </div>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium tracking-[-0.01em] text-fg">{f.name}</p>
          <p className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">{f.trigger_label}</p>
          <p className="mt-2 flex items-center gap-2 text-[11.5px] text-dim">
            {f.last_run ? (
              <>
                <RunStatus status={f.last_run.status} /> · {fmtRelative(f.last_run.created_at)} · {f.runs_count} {f.runs_count === 1 ? 'run' : 'runs'}
              </>
            ) : (
              'Never run'
            )}
          </p>
          {f.problem && <p className="mt-1 truncate text-[11px] text-warn">{f.problem}</p>}
        </div>
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center gap-2 pt-0.5">
          <Toggle on={on} onChange={toggle} label={`${f.name} on`} />
        </span>
      </div>
    </motion.div>
  )
}

function Recipe({ template: t, i, busy, onUse }: { template: FlowTemplate; i: number; busy: boolean; onUse: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onUse}
      disabled={busy}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: 0.1 + i * 0.05 }}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel text-left transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-line-2 hover:bg-panel-2"
    >
      <div className="relative border-b border-line bg-[radial-gradient(120%_120%_at_0%_0%,color-mix(in_oklab,var(--color-accent)_10%,transparent),transparent_60%)] px-4 py-4">
        <Sketch graph={t.graph} height={64} />
      </div>
      <div className="flex flex-1 flex-col px-4 py-3.5">
        <p className="flex items-center justify-between gap-2 text-[14px] font-medium tracking-[-0.01em]">
          {t.name}
          {busy ? <Workflow className="size-3.5 animate-spin text-dim" /> : <ArrowUpRight className="size-3.5 text-dim transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" />}
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{t.tagline}</p>
        <p className="mt-2 line-clamp-3 text-[11.5px] leading-snug text-dim">{t.detail}</p>
      </div>
    </motion.button>
  )
}
