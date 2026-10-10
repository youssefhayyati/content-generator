import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, OctagonX, Play, Send, Smartphone } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, type Device, type PublishingRun, type PublishingUsage } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { count, fmtRelative, fmtTime, useApi, useInvalidate } from '../data'
import { useUser } from '../Shell'
import { useToast } from '../toast'
import { Btn, EmptyState, Modal, PageHeader, Skeleton, Stagger } from '../ui'

const OUTCOME: Record<PublishingRun['outcome'], { dot: string; text: string; label: string }> = {
  running: { dot: 'bg-accent-soft animate-pulse', text: 'text-accent-soft', label: 'Running' },
  confirmed: { dot: 'bg-ok', text: 'text-ok', label: 'Confirmed' },
  failed: { dot: 'bg-fail', text: 'text-fail', label: 'Failed' },
  uncertain: { dot: 'bg-warn', text: 'text-warn', label: 'Unconfirmed' },
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

/** /dashboard/publishing: the stop button, the run records, and what a typical run costs. */
export default function Publishing() {
  const { data: runs, loading } = useApi<PublishingRun[]>('/publishing/runs')
  const { data: usage } = useApi<PublishingUsage>('/publishing/usage')
  const { data: devices } = useApi<Device[]>('/devices')
  const [open, setOpen] = useState<PublishingRun | null>(null)
  const invalidate = useInvalidate()

  // Runs are short; while any are going, keep the page live.
  const running = runs?.filter((r) => r.outcome === 'running') ?? []
  useEffect(() => {
    if (running.length === 0) return
    const t = window.setInterval(invalidate, 4000)
    return () => window.clearInterval(t)
  }, [running.length, invalidate])

  const busyPhones = devices?.filter((d) => d.status === 'busy').length ?? 0

  return (
    <div>
      <PageHeader
        title={
          <>
            What the phones <Serif>did.</Serif>
          </>
        }
        sub="Every attempt leaves a record: the steps, the proof, and how it ended. Export any of them as the hand-in JSON."
        actions={<StopButton />}
      />

      {/* The operations strip: jobs and phones at a glance. */}
      <Stagger i={0} className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Running now" value={String(running.length)} sub={running[0] ? running[0].goal : undefined} />
        <Stat
          label="Phones"
          value={devices ? `${busyPhones} busy · ${devices.length} total` : '—'}
          sub={devices?.some((d) => d.paused) ? `${devices.filter((d) => d.paused).length} paused` : undefined}
          icon={Smartphone}
        />
        <Stat
          label="A typical run"
          value={usage && usage.runs > 0 ? `${usage.typical.steps} steps · ${fmtMs(usage.typical.wall_clock_ms)}` : '—'}
          sub={
            usage && usage.runs > 0
              ? `${count(usage.runs, 'finished run')}${usage.typical.spend > 0 ? ` · $${usage.typical.spend.toFixed(4)} each` : ''}`
              : 'no finished runs yet'
          }
        />
        <Stat
          label="Outcomes"
          value={usage ? `${usage.outcomes.confirmed ?? 0} confirmed` : '—'}
          sub={usage ? `${usage.outcomes.uncertain ?? 0} unconfirmed · ${usage.outcomes.failed ?? 0} failed` : undefined}
        />
      </Stagger>

      <Stagger i={1} className="mt-8">
        {!runs && loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[64px] rounded-xl" />
            ))}
          </div>
        ) : runs && runs.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No runs yet"
            body="When an approved post's time comes on an automated account, its phone picks it up and the run lands here."
          />
        ) : (
          <ul className="space-y-2">
            {runs?.map((run, i) => (
              <motion.li key={run.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.02 }}>
                <button
                  type="button"
                  onClick={() => setOpen(run)}
                  className="group flex w-full items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-line-2 hover:bg-panel-2"
                >
                  <span className={cn('size-2 shrink-0 rounded-full', OUTCOME[run.outcome].dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{run.goal}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-dim">
                      {run.account ? `@${run.account}` : 'No account'} · {run.device?.name ?? 'No phone'}
                      {run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right sm:block">
                    <span className={cn('block font-mono text-[10.5px] uppercase tracking-[0.12em]', OUTCOME[run.outcome].text)}>{OUTCOME[run.outcome].label}</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-dim">
                      {run.outcome === 'running' ? `${count(run.totals.steps, 'step')} so far` : `${count(run.totals.steps, 'step')} · ${fmtMs(run.totals.wall_clock_ms)}`}
                    </span>
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono text-[10.5px] text-dim">{run.started_at ? fmtRelative(run.started_at) : '—'}</span>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </Stagger>

      <RunDetail run={open} onClose={() => setOpen(null)} />
    </div>
  )
}

/** The big red one: while it's pressed, no automated run starts anywhere. */
function StopButton() {
  const user = useUser()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [paused, setPaused] = useState(user.publishing_paused)
  const [acting, setActing] = useState(false)

  const toggle = async () => {
    setActing(true)
    try {
      const r = await api<{ paused: boolean }>(`/publishing/${paused ? 'resume' : 'pause'}`, { method: 'POST' })
      setPaused(r.paused)
      invalidate()
      toast(r.paused ? 'Stopped. Runs already on phones finish; nothing new starts.' : 'Publishing is running again.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t reach the API.', 'error')
    } finally {
      setActing(false)
    }
  }

  return (
    <Btn variant={paused ? 'primary' : 'danger'} icon={paused ? Play : OctagonX} onClick={toggle} loading={acting}>
      {paused ? 'Resume publishing' : 'Stop everything'}
    </Btn>
  )
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon?: typeof Smartphone }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3.5">
      <p className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
        {Icon && <Icon className="size-3" strokeWidth={2} />}
        {label}
      </p>
      <p className="mt-1.5 truncate text-[15px] font-medium tracking-[-0.01em]">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-dim">{sub}</p>}
    </div>
  )
}

/** One run, whole: the steps, the evidence, and the hand-in JSON. */
function RunDetail({ run, onClose }: { run: PublishingRun | null; onClose: () => void }) {
  const toast = useToast()
  if (!run) return null

  const record = {
    run_id: run.run_id,
    goal: run.goal,
    account: run.account,
    started_at: run.started_at,
    ended_at: run.ended_at,
    outcome: run.outcome,
    evidence: run.evidence,
    steps: run.steps,
    totals: run.totals,
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `run-${run.run_id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Run record downloaded.')
  }

  return (
    <Modal open onClose={onClose} title={`Run · ${OUTCOME[run.outcome].label}`} className="max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] font-medium leading-snug">{run.goal}</p>
            <p className="mt-1 text-[12px] text-dim">
              {run.account ? `@${run.account}` : 'No account'} · {run.device?.name ?? 'No phone'} · attempt {run.attempt}
              {run.started_at ? ` · ${fmtTime(run.started_at)}` : ''}
              {run.ended_at ? ` → ${fmtTime(run.ended_at)}` : ' · still running'}
            </p>
          </div>
          <Btn size="sm" icon={Download} onClick={exportJson}>
            JSON
          </Btn>
        </div>

        {run.error && <p className="rounded-lg border border-fail/25 bg-fail/[0.06] px-3 py-2 text-[12px] text-fail">{run.error}</p>}

        {run.evidence && (
          <div className="rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 text-[12px]">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Evidence · {run.evidence.kind === 'post_url' ? 'post URL' : 'screenshot'}</p>
            {run.evidence.ref && (
              <a href={run.evidence.ref} target="_blank" rel="noreferrer" className="mt-1 block truncate text-accent-soft hover:underline">
                {run.evidence.ref}
              </a>
            )}
            {run.evidence.note && <p className="mt-1 text-dim">{run.evidence.note}</p>}
          </div>
        )}

        {run.screenshot_url && (
          <a href={run.screenshot_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line">
            <img src={run.screenshot_url} alt="The screen at the end of the run" className="max-h-72 w-full object-cover object-top" loading="lazy" />
          </a>
        )}

        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
            Steps · {run.totals.steps} · {fmtMs(run.totals.wall_clock_ms)}
            {run.totals.spend > 0 ? ` · $${run.totals.spend.toFixed(4)}` : ''}
          </p>
          <ol className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
            {run.steps.map((s) => (
              <li key={s.n} className="flex items-baseline gap-2.5 rounded-md border border-line/60 bg-white/[0.015] px-2.5 py-1.5 font-mono text-[11.5px]">
                <span className="w-5 shrink-0 text-right text-dim">{s.n}</span>
                <span className={cn('size-1.5 shrink-0 self-center rounded-full', s.ok ? 'bg-ok' : 'bg-fail')} />
                <span className="min-w-0 flex-1 truncate">{s.action}</span>
                {s.note && <span className="max-w-40 truncate text-dim" title={s.note}>{s.note}</span>}
                <span className="shrink-0 text-dim">{s.ms}ms</span>
              </li>
            ))}
            {run.steps.length === 0 && <li className="text-[12px] text-dim">No steps reported yet.</li>}
          </ol>
        </div>
      </div>
    </Modal>
  )
}
