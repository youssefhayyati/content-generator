import { useState } from 'react'
import { motion } from 'framer-motion'
import { CircleAlert, Cloud, Cpu, Wallet } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import type { Billing, Spending as SpendingData } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { BarList, ColumnChart } from '../charts'
import { count, useApi } from '../data'
import { fmtMoney, fmtSeconds } from '../lab/look'
import { EmptyState, PageHeader, Panel, Segmented, Skeleton, Stagger } from '../ui'

const RANGES = [7, 30, 90] as const

/** How each cost is known, as a word beside it. */
const BILLING: Record<Billing, { label: string; className: string }> = {
  billed: { label: 'Paid', className: 'border-line-2 text-muted' },
  estimated: { label: 'Estimate', className: 'border-accent-soft/40 text-accent-soft' },
  free: { label: 'Free', className: 'border-ok/40 text-ok' },
  unpriced: { label: 'No price', className: 'border-warn/40 text-warn' },
}

const short = (date: string) => new Date(`${date}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const long = (date: string) => new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** /dashboard/spending: what the AI cost, what the providers billed and what the pod's jobs came to. */
export default function Spending() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const { data, loading } = useApi<SpendingData>('/spending', { days })

  return (
    <div>
      <PageHeader
        title={
          <>
            What the AI <Serif>cost.</Serif>
          </>
        }
        sub="Every model call, priced. Paid services show what they charge; your GPU pod shows its share of the hourly rate."
      />

      <Stagger i={0} className="mt-10 flex flex-wrap items-center gap-2">
        <Segmented id="spend-range" label="Date range" value={days} onChange={setDays} options={RANGES.map((r) => ({ value: r, label: `Last ${r} days` }))} />
      </Stagger>

      {!data ? (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-[112px] rounded-xl" />
          <Skeleton className="h-[220px] rounded-xl" />
        </div>
      ) : data.calls === 0 ? (
        <Stagger i={1} className="mt-4">
          <EmptyState icon={Wallet} title="Nothing spent yet" body={`No model has been used in the last ${days} days. Write, generate or run a node and its cost shows up here.`} />
        </Stagger>
      ) : (
        <div className={cn('mt-4 space-y-4 transition-opacity duration-300', loading && 'opacity-60')}>
          <Stagger i={1} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label="In all" value={fmtMoney(data.total)} sub={`${fmtMoney(data.previous)} the ${days} days before · ${count(data.calls, 'call')}`} icon={Wallet} />
            <Tile label="Paid services" value={fmtMoney(data.billed)} sub="Claude, Ollama Cloud, Higgsfield, Google and others" icon={Cloud} />
            <Tile
              label="Your GPU pod"
              value={`≈ ${fmtMoney(data.estimated)}`}
              sub={data.pod.seconds > 0 ? `${fmtSeconds(data.pod.seconds)} of jobs at ${fmtMoney(data.pod.hourly)}/hour` : `No jobs · ${fmtMoney(data.pod.hourly)}/hour while it's on`}
              icon={Cpu}
            />
          </Stagger>

          {data.unpriced > 0 && (
            <Stagger i={2}>
              <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3 text-[12.5px] text-muted">
                <CircleAlert className="mt-px size-4 shrink-0 text-warn" />
                <span>
                  {count(data.unpriced, 'call')} used models with no price set, so {data.unpriced === 1 ? 'it isn’t' : 'they aren’t'} in these totals. They’re marked{' '}
                  <span className="text-warn">No price</span> below; add their price in <code className="font-mono text-[11.5px] text-fg">backend/config/ai.php</code>.
                </span>
              </p>
            </Stagger>
          )}

          <Stagger i={3} className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="Per day" sub="Paid services and pod time together, in your local time">
              <ColumnChart
                caption={`Spending per day, last ${days} days`}
                format={fmtMoney}
                data={data.daily.map((d, i) => ({
                  // A label every few days, so 30 or 90 of them don't crowd.
                  label: i % (days <= 7 ? 1 : days <= 30 ? 6 : 18) === 0 ? short(d.date) : '',
                  full: long(d.date),
                  value: Math.round((d.billed + d.estimated) * 10000) / 10000,
                  current: i === data.daily.length - 1,
                }))}
              />
            </Panel>
            <Panel title="What it was for" sub="Where in the studio the money went">
              <BarList caption="Spending by use" format={fmtMoney} rows={data.uses.map((u) => ({ key: u.label, label: u.label, name: u.label, value: u.cost }))} />
            </Panel>
          </Stagger>

          <Stagger i={4}>
            <Panel title="By model" sub="Each model, how it's charged, and what it came to" flush>
              <ul className="divide-y divide-line border-t border-line">
                {data.models.map((m, i) => (
                  <motion.li
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease, delay: Math.min(i, 10) * 0.02 }}
                    className="flex items-center gap-4 px-4 py-3 md:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{m.label}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-dim">
                        {m.where} · {m.rate}
                      </span>
                    </span>
                    <span className={cn('hidden shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] sm:inline', BILLING[m.billing].className)}>
                      {BILLING[m.billing].label}
                    </span>
                    <span className="w-24 shrink-0 text-right">
                      <span className="block font-mono text-[13px] tabular-nums">{m.billing === 'unpriced' ? '—' : `${m.billing === 'estimated' ? '≈ ' : ''}${fmtMoney(m.cost)}`}</span>
                      <span className="mt-0.5 block font-mono text-[10.5px] text-dim">{count(m.calls, 'call')}</span>
                    </span>
                  </motion.li>
                ))}
              </ul>
            </Panel>
          </Stagger>

          <Stagger i={5}>
            <Panel title="How it's worked out">
              <ul className="grid gap-4 text-[12.5px] leading-relaxed text-muted md:grid-cols-3">
                <li>
                  <p className="mb-1 font-medium text-fg">Paid services</p>
                  Text is priced by the words in and out (tokens), pictures by the picture, video by the second, at each model's list price. On a plan like Ollama Cloud's, that's what each call uses of it.
                </li>
                <li>
                  <p className="mb-1 font-medium text-fg">Your GPU pod</p>
                  The pod is paid by the hour while it's on ({fmtMoney(data.pod.hourly)}/hour, {fmtMoney(data.pod.hourly * 24)} a day), used or not. Each job counts as the time it took, so this is what your work used. Idle time isn't in it: stop the pod when you're done.
                </li>
                <li>
                  <p className="mb-1 font-medium text-fg">Free</p>
                  Free-tier models, and work done on this server (text on pictures, slideshows, reels).
                </li>
              </ul>
            </Panel>
          </Stagger>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: typeof Wallet }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-4 md:px-5">
      <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
        <Icon className="size-3.5" strokeWidth={2} />
        {label}
      </p>
      <p className="mt-2.5 text-[28px] font-semibold leading-none tracking-[-0.03em]">{value}</p>
      <p className="mt-2 truncate text-[11.5px] text-dim" title={sub}>
        {sub}
      </p>
    </div>
  )
}
