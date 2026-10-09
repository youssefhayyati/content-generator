import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, CircleStop, Hourglass, LoaderCircle, UserCheck, X } from 'lucide-react'
import { PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { api, ApiError, type FlowCatalog, type FlowRun, type FlowRunStatus, type FlowRunSummary } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { fmtRelative, fmtTime, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, inputClass, Label } from '../ui'
import { hueOf, iconOf } from './look'

export const RUN_STATUS: Record<FlowRunStatus, { label: string; dot: string; text: string }> = {
  running: { label: 'Running', dot: 'bg-accent-soft animate-pulse', text: 'text-accent-soft' },
  waiting: { label: 'Waiting', dot: 'bg-warn', text: 'text-warn' },
  approval: { label: 'Waiting for you', dot: 'bg-[#ff8fa3] animate-pulse', text: 'text-[#ff8fa3]' },
  done: { label: 'Done', dot: 'bg-ok', text: 'text-ok' },
  failed: { label: 'Failed', dot: 'bg-fail', text: 'text-fail' },
  stopped: { label: 'Stopped', dot: 'bg-draft', text: 'text-dim' },
}

export function RunStatus({ status, className }: { status: FlowRunStatus; className?: string }) {
  const s = RUN_STATUS[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', s.text, className)}>
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

/** A flow's runs, newest first. */
export function RunList({ runs, selected, onSelect }: { runs: FlowRunSummary[]; selected: number | null; onSelect: (id: number) => void }) {
  if (!runs.length) return <p className="py-6 text-center text-[12px] text-dim">No runs yet. Press Run to try it.</p>
  return (
    <ul className="space-y-1">
      {runs.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className={cn('w-full rounded-lg border px-3 py-2 text-left transition-colors', selected === r.id ? 'border-line-2 bg-white/[0.05]' : 'border-transparent hover:bg-white/[0.03]')}
          >
            <span className="flex items-center justify-between gap-2">
              <RunStatus status={r.status} />
              <span className="font-mono text-[10px] text-dim">{fmtRelative(r.created_at)}</span>
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-muted">{r.cause}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** What an "Ask me first" is holding: the draft, editable, and the decision. */
export function Approval({
  runId,
  ask,
  draft,
  account,
  platform,
  media,
  onDecided,
  compact,
}: {
  runId: number
  ask: string
  draft: string | null | undefined
  account?: string | null
  platform?: PlatformId | null
  /** A reel the run made: watched before saying yes. */
  media?: { kind: 'video'; url: string; poster_url: string | null } | null
  onDecided?: (run: FlowRun) => void
  compact?: boolean
}) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [text, setText] = useState(draft ?? '')
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null)

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'yes' : 'no')
    try {
      const run = await api<FlowRun>(`/flow-runs/${runId}/decide`, {
        method: 'POST',
        body: { approve, draft: approve && draft != null && text.trim() !== draft.trim() ? text : null },
      })
      invalidate()
      toast(approve ? 'Approved. The flow carries on.' : 'Rejected. Nothing goes out.')
      onDecided?.(run)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t decide.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cn('rounded-xl border border-[#ff8fa3]/30 bg-[#ff8fa3]/[0.05]', compact ? 'p-3' : 'p-4')}>
      <p className="flex items-center gap-2 text-[13px] font-medium">
        <UserCheck className="size-4 text-[#ff8fa3]" strokeWidth={1.75} />
        {ask}
      </p>
      {account && (
        <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-dim">
          {platform && <PlatformIcon id={platform} className="size-3" />}@{account}
        </p>
      )}
      {media && (
        <video src={media.url} poster={media.poster_url ?? undefined} controls playsInline className={cn('mt-3 aspect-[9/16] rounded-lg bg-black object-cover', compact ? 'w-[160px]' : 'w-[200px]')} />
      )}
      {draft != null && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={compact ? 3 : 5}
          aria-label="The draft"
          className={cn(inputClass, 'mt-3 h-auto resize-y py-2 text-[13px] leading-relaxed')}
        />
      )}
      <div className="mt-3 flex items-center gap-2">
        <Btn variant="primary" size="sm" icon={Check} loading={busy === 'yes'} disabled={busy !== null || (draft != null && !text.trim())} onClick={() => decide(true)}>
          {draft != null && text.trim() !== (draft ?? '').trim() ? 'Approve with edits' : 'Approve'}
        </Btn>
        <Btn variant="subtle" size="sm" icon={X} loading={busy === 'no'} disabled={busy !== null} onClick={() => decide(false)}>
          Reject
        </Btn>
      </div>
    </div>
  )
}

/** One run in detail: the decision it waits for, then every step it took. */
export function RunDetail({ run, catalog, shown, onChange }: { run: FlowRun; catalog: FlowCatalog; shown: number; onChange: (run: FlowRun) => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [stopping, setStopping] = useState(false)
  const live = run.status === 'running' || run.status === 'waiting' || run.status === 'approval'

  const stop = async () => {
    setStopping(true)
    try {
      onChange(await api<FlowRun>(`/flow-runs/${run.id}/stop`, { method: 'POST' }))
      invalidate()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t stop it.', 'error')
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <RunStatus status={run.status} />
          <p className="mt-1 text-[12.5px] leading-snug text-muted">{run.cause}</p>
          <p className="mt-0.5 font-mono text-[10px] text-dim">
            #{run.id} · {fmtRelative(run.created_at)}
          </p>
        </div>
        {live && (
          <Btn size="sm" variant="subtle" icon={CircleStop} loading={stopping} onClick={stop}>
            Stop
          </Btn>
        )}
      </div>

      {run.status === 'approval' && run.approval && (
        <Approval key={run.id} runId={run.id} ask={run.approval.ask} draft={run.approval.draft} account={run.approval.account} platform={run.approval.platform} media={run.approval.media} onDecided={onChange} />
      )}
      {run.status === 'waiting' && run.resume_at && (
        <p className="flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12px] text-warn">
          <Hourglass className="size-3.5" /> Carries on by itself at {fmtTime(run.resume_at)} ({fmtRelative(run.resume_at)}).
        </p>
      )}
      {run.status === 'failed' && run.error && <p className="rounded-lg border border-fail/25 bg-fail/[0.06] px-3 py-2 text-[12px] leading-snug text-fail">{run.error}</p>}

      <div>
        <Label>Steps</Label>
        <ol className="relative mt-3 space-y-3 pl-6 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-line-2">
          {run.trail.slice(0, shown).map((t, i) => {
            const Icon = iconOf(t.type)
            const hue = hueOf(t.type)
            return (
              <motion.li key={`${t.node}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease }} className="relative">
                <span className="absolute -left-6 top-0 grid size-[19px] place-items-center rounded-full border bg-panel" style={{ borderColor: hue, color: hue }}>
                  <Icon className="size-2.5" strokeWidth={2} />
                </span>
                <p className="flex items-baseline justify-between gap-2 text-[12px] font-medium">
                  <span className="truncate">{catalog.nodes[t.type]?.label ?? t.type}</span>
                  {t.ms > 0 && <span className="shrink-0 font-mono text-[9.5px] font-normal text-dim">{t.ms < 1000 ? `${t.ms} ms` : `${(t.ms / 1000).toFixed(1)} s`}</span>}
                </p>
                <p className={cn('mt-0.5 text-[11.5px] leading-snug', t.status === 'failed' ? 'text-fail' : 'text-dim')}>{t.summary}</p>
              </motion.li>
            )
          })}
          {run.status === 'running' && shown >= run.trail.length && run.next && (
            <li className="relative flex items-center gap-2 text-[12px] text-accent-soft">
              <span className="absolute -left-6 top-0 grid size-[19px] place-items-center rounded-full border border-accent-soft/50 bg-panel">
                <LoaderCircle className="size-2.5 animate-spin" />
              </span>
              Working…
            </li>
          )}
        </ol>
      </div>
    </div>
  )
}
