import { useState } from 'react'
import { motion } from 'framer-motion'
import { CircleAlert, Play, SearchCheck, Smartphone, Trash2, UsersRound } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, type Account, type Device, type Investigation, type PublishingUsage } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { count, fmtRelative, useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, EmptyState, Label, Modal, PageHeader, Skeleton, Stagger } from '../ui'
import { KitMarkdown } from '../intake/KitMarkdown'

const SEVERITY: Record<string, string> = {
  high: 'border-fail/30 text-fail',
  medium: 'border-warn/30 text-warn',
  low: 'border-white/10 text-muted',
}

/** /dashboard/investigations: the investigator side, and the three role dashboards. */
export default function Investigations() {
  const { data: investigations, loading } = useApi<Investigation[]>('/investigations')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [starting, setStarting] = useState(false)
  const [open, setOpen] = useState<Investigation | null>(null)
  const invalidate = useInvalidate()
  const toast = useToast()

  const start = async (accountId: number | null) => {
    setStarting(true)
    try {
      const inv = await api<Investigation>('/investigations', { method: 'POST', body: { account_id: accountId } })
      invalidate()
      toast(inv.status === 'done' ? (inv.open_issues ? `${inv.open_issues} ${inv.open_issues === 1 ? 'issue' : 'issues'} found.` : 'Clean. The records and the evidence agree.') : 'Running. Open it in a moment.')
      if (inv.status === 'done') setOpen(inv)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t start it.', 'error')
    } finally {
      setStarting(false)
    }
  }

  const openDetail = async (id: number) => {
    try {
      setOpen(await api<Investigation>(`/investigations/${id}`))
    } catch {
      toast('Couldn’t open it.', 'error')
    }
  }

  return (
    <div>
      <PageHeader
        title={
          <>
            Did it really <Serif>happen?</Serif>
          </>
        }
        sub="The investigator collects the records, compares them with the evidence, validates each finding, and reports what needs a person."
        actions={<StartButton accounts={accounts ?? []} busy={starting} onStart={start} />}
      />

      <Dashboards />

      <Stagger i={1} className="mt-10">
        <Label>Investigations</Label>
        <div className="mt-3">
          {!investigations && loading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-[72px] rounded-xl" />
              ))}
            </div>
          ) : investigations && investigations.length === 0 ? (
            <EmptyState icon={SearchCheck} title="Nothing investigated yet" body="Run one over the whole studio, or one account. It takes seconds on the records you already have." />
          ) : (
            <ul className="space-y-2">
              {investigations?.map((inv, i) => (
                <motion.li key={inv.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.02 }}>
                  <button
                    type="button"
                    onClick={() => openDetail(inv.id)}
                    className="group flex w-full items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-line-2 hover:bg-panel-2"
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', inv.status === 'done' ? (inv.open_issues ? 'bg-warn' : 'bg-ok') : inv.status === 'failed' ? 'bg-fail' : 'bg-accent-soft animate-pulse')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{inv.title}</span>
                      <span className="mt-0.5 block text-[11.5px] text-dim">
                        {inv.status === 'running'
                          ? `Running · ${inv.stage}…`
                          : inv.status === 'failed'
                            ? `Failed: ${inv.error ?? 'unknown'}`
                            : inv.counts
                              ? `${count(inv.counts.posts, 'post')} · ${count(inv.counts.runs, 'run')} · ${count(inv.open_issues, 'issue')}`
                              : '—'}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-dim">{fmtRelative(inv.created_at)}</span>
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </Stagger>

      {open && <Detail investigation={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function StartButton({ accounts, busy, onStart }: { accounts: Account[]; busy: boolean; onStart: (accountId: number | null) => void }) {
  const [picking, setPicking] = useState(false)
  return (
    <>
      <Btn variant="primary" icon={Play} loading={busy} onClick={() => (accounts.length ? setPicking(true) : onStart(null))}>
        Investigate
      </Btn>
      <Modal open={picking} onClose={() => setPicking(false)} title="Investigate what?">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => { setPicking(false); onStart(null) }}
            className="w-full rounded-lg border border-line px-4 py-3 text-left text-[13px] transition-colors hover:border-line-2 hover:bg-panel-2"
          >
            <b className="font-medium">The whole studio</b>
            <span className="block text-[11.5px] text-dim">Every account, post, run and phone.</span>
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setPicking(false); onStart(a.id) }}
              className="w-full rounded-lg border border-line px-4 py-3 text-left text-[13px] transition-colors hover:border-line-2 hover:bg-panel-2"
            >
              <b className="font-medium">@{a.handle}</b>
              <span className="block text-[11.5px] text-dim">{a.platform} only</span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}

/** Dashboards for the three roles: operator (phones and runs), investigator (open issues), studio (accounts). */
function Dashboards() {
  const { data: devices } = useApi<Device[]>('/devices')
  const { data: usage } = useApi<PublishingUsage>('/publishing/usage')
  const { data: investigations } = useApi<Investigation[]>('/investigations')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const { navigate } = useRouter()

  const openIssues = (investigations ?? []).reduce((n, i) => n + i.open_issues, 0)

  const cards = [
    {
      role: 'Operator',
      icon: Smartphone,
      lines: devices
        ? [`${devices.filter((d) => d.status === 'busy').length} phones working · ${devices.filter((d) => d.paused).length} paused`, usage ? `${usage.runs} runs · ${usage.outcomes.uncertain ?? 0} unconfirmed` : '—']
        : ['—'],
      to: '/dashboard/publishing',
    },
    {
      role: 'Investigator',
      icon: SearchCheck,
      lines: [`${openIssues} open ${openIssues === 1 ? 'issue' : 'issues'} across all investigations`, investigations?.[0] ? `Latest ${fmtRelative(investigations[0].created_at)}` : 'None run yet'],
      to: null,
    },
    {
      role: 'Studio',
      icon: UsersRound,
      lines: accounts
        ? [`${accounts.length} accounts · ${accounts.filter((a) => a.automation).length} automated`, `${accounts.filter((a) => a.autonomy === 'rules').length} in mode B`]
        : ['—'],
      to: '/dashboard/accounts',
    },
  ]

  return (
    <Stagger i={0} className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-3">
      {cards.map((c) => (
        <button
          key={c.role}
          type="button"
          disabled={!c.to}
          onClick={() => c.to && navigate(c.to)}
          className={cn('rounded-xl border border-line bg-panel px-4 py-3.5 text-left transition-colors', c.to && 'hover:border-line-2')}
        >
          <p className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
            <c.icon className="size-3" strokeWidth={2} />
            {c.role}
          </p>
          {c.lines.map((l, i) => (
            <p key={i} className={cn('truncate text-[12.5px]', i === 0 ? 'mt-1.5 font-medium' : 'mt-0.5 text-dim')}>
              {l}
            </p>
          ))}
        </button>
      ))}
    </Stagger>
  )
}

function Detail({ investigation: inv, onClose }: { investigation: Investigation; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()

  const remove = async () => {
    try {
      await api(`/investigations/${inv.id}`, { method: 'DELETE' })
      invalidate()
      onClose()
      toast('Investigation deleted.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete it.', 'error')
    }
  }

  return (
    <Modal open onClose={onClose} title={inv.title} className="max-w-2xl">
      <div className="space-y-5">
        {/* The pipeline, as it happened. */}
        <ol className="flex flex-wrap items-center gap-1.5">
          {(inv.stages ?? []).map((s, i) => (
            <li key={i} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-muted">
              <span className="text-accent-soft">{s.name}</span>
              <span className="text-dim">·</span>
              {s.summary}
            </li>
          ))}
        </ol>

        {inv.findings && inv.findings.length > 0 && (
          <section>
            <Label>Findings</Label>
            <ul className="mt-2 space-y-1.5">
              {inv.findings.map((f, i) => (
                <li key={i} className="rounded-lg border border-line px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-full border px-2 py-px font-mono text-[9.5px] uppercase', SEVERITY[f.severity] ?? SEVERITY.low)}>{f.severity}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{f.subject}</span>
                    {f.verdict === 'explained' ? (
                      <span className="shrink-0 text-[10.5px] text-ok">explained</span>
                    ) : (
                      <CircleAlert className="size-3.5 shrink-0 text-warn" strokeWidth={1.75} />
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-dim">{f.detail}</p>
                  {f.note && <p className="mt-1 text-[11.5px] italic leading-snug text-muted">{f.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {inv.report && (
          <section>
            <Label>Report</Label>
            <div className="mt-2 rounded-lg border border-line bg-white/[0.02] px-4 py-3">
              <KitMarkdown text={inv.report} />
            </div>
          </section>
        )}

        <div className="flex justify-between border-t border-line pt-4">
          <Btn variant="danger" icon={Trash2} onClick={remove}>
            Delete
          </Btn>
          <Btn variant="subtle" onClick={onClose}>
            Close
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
