import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, CalendarCheck, CalendarClock, CalendarPlus, Check, CircleAlert, TriangleAlert } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { api, ApiError, type Account, type Campaign, type CampaignItem, type Conflict, type Post } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtDay, fmtTime } from '../data'
import { useToast } from '../toast'
import { Btn, FieldError, inputClass, Label, Panel, Skeleton } from '../ui'
import { FORMAT_ICON, Pill } from './shared'

type Proposed = { variant_id: number; item_id: number; account_id: number; at: string }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const plus = (days: number) => iso(new Date(Date.now() + days * 86_400_000))

const say = (e: unknown, fallback: string) => (e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : fallback)

/**
 * The last step: approved content onto the calendar. The times are proposed from your queue
 * slots, the accounts' minimum gaps and what's already booked — you see them all before
 * anything is booked, and change the period or the running order until they look right.
 */
export function ScheduleTab({
  campaign,
  items,
  accounts,
  reload,
  onCampaign,
}: {
  campaign: Campaign
  items: CampaignItem[] | null
  accounts: Account[]
  reload: () => Promise<void>
  onCampaign: (c: Campaign) => void
}) {
  const toast = useToast()
  const { navigate } = useRouter()
  const [from, setFrom] = useState(campaign.period_start ?? plus(1))
  const [to, setTo] = useState(campaign.period_end ?? plus(14))
  const [order, setOrder] = useState<number[] | null>(null)
  const [proposal, setProposal] = useState<Proposed[] | null>(null)
  const [booked, setBooked] = useState<{ posts: Post[]; conflicts: Conflict[] } | null>(null)
  const [busy, setBusy] = useState<'preview' | 'book' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const approvedItems = (items ?? []).filter((i) => i.variants.some((v) => v.status === 'approved'))
  const ids = order ?? approvedItems.map((i) => i.id)
  const ordered = ids.map((id) => approvedItems.find((i) => i.id === id)).filter((i): i is CampaignItem => !!i)
  const approvedCount = approvedItems.reduce((n, i) => n + i.variants.filter((v) => v.status === 'approved').length, 0)

  const move = (index: number, by: number) => {
    const next = [...ids]
    const to2 = index + by
    if (to2 < 0 || to2 >= next.length) return
    ;[next[index], next[to2]] = [next[to2], next[index]]
    setOrder(next)
    setProposal(null)
  }

  const send = async (preview: boolean) => {
    setBusy(preview ? 'preview' : 'book')
    setError(null)
    try {
      const body = { from, to, order: ids, preview }
      if (preview) {
        const { proposal: p } = await api<{ proposal: Proposed[] }>(`/campaigns/${campaign.id}/schedule`, { method: 'POST', body })
        setProposal(p)
      } else {
        const result = await api<{ posts: Post[]; conflicts: Conflict[] }>(`/campaigns/${campaign.id}/schedule`, { method: 'POST', body })
        setBooked(result)
        setProposal(null)
        onCampaign(await api<Campaign>(`/campaigns/${campaign.id}`))
        await reload()
        toast(`${result.posts.length} ${result.posts.length === 1 ? 'post' : 'posts'} on the calendar.`)
      }
    } catch (e) {
      setError(say(e, 'Couldn’t work out the times.'))
    } finally {
      setBusy(null)
    }
  }

  if (!items) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[320px] rounded-xl" />
        <Skeleton className="h-[260px] rounded-xl" />
      </div>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {booked ? (
          <Booked booked={booked} campaign={campaign} items={items} reload={reload} />
        ) : proposal ? (
          <Proposal proposal={proposal} items={items} accounts={accounts} />
        ) : (
          <Panel title="The running order" sub="The scheduler spreads them over the period in this order. Move anything that should go out sooner.">
            {ordered.length === 0 ? (
              <p className="text-[12.5px] text-dim">Nothing is approved yet. Approve content at gate 6B first.</p>
            ) : (
              <ol className="space-y-2">
                {ordered.map((item, i) => {
                  const Icon = FORMAT_ICON[item.format]
                  const approved = item.variants.filter((v) => v.status === 'approved')
                  return (
                    <motion.li
                      key={item.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.03 }}
                      className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-dim">{String(i + 1).padStart(2, '0')}</span>
                      <Icon className="size-3.5 shrink-0 text-muted" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{item.title}</span>
                      <span className="hidden shrink-0 gap-1 sm:flex">
                        {approved.map((v) => (
                          <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-line-2 px-2 py-0.5 text-[10.5px] text-muted">
                            <PlatformIcon id={v.account.platform} className="size-3" />@{v.account.handle}
                          </span>
                        ))}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <Btn size="sm" variant="subtle" icon={ArrowUp} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Earlier" />
                        <Btn size="sm" variant="subtle" icon={ArrowDown} onClick={() => move(i, 1)} disabled={i === ordered.length - 1} aria-label="Later" />
                      </span>
                    </motion.li>
                  )
                })}
              </ol>
            )}
          </Panel>
        )}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20">
        <Panel title="When it runs" sub="Posting times come from your queue slots, inside this period.">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <Label>From</Label>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setProposal(null)
                }}
                className={cn(inputClass, 'mt-2')}
              />
            </label>
            <label className="block">
              <Label>To</Label>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setProposal(null)
                }}
                className={cn(inputClass, 'mt-2')}
              />
            </label>
          </div>

          <p className="mt-4 text-[12px] leading-snug text-dim">
            {approvedCount} approved {approvedCount === 1 ? 'version' : 'versions'} across {approvedItems.length} {approvedItems.length === 1 ? 'post' : 'posts'}.
          </p>

          <div className="mt-4 space-y-2">
            {!booked && (
              <>
                <Btn icon={CalendarClock} onClick={() => send(true)} loading={busy === 'preview'} disabled={!approvedCount} className="w-full">
                  {proposal ? 'Work the times out again' : 'Show me the times'}
                </Btn>
                <Btn variant="primary" icon={CalendarCheck} onClick={() => send(false)} loading={busy === 'book'} disabled={!approvedCount} className="w-full">
                  {proposal ? 'Approve these times' : 'Put it on the calendar'}
                </Btn>
              </>
            )}
            {booked && (
              <Btn variant="primary" icon={CalendarCheck} onClick={() => navigate('/dashboard/calendar')} className="w-full">
                Open the calendar
              </Btn>
            )}
          </div>
          <FieldError message={error} />
          {!booked && <p className="mt-3 text-[11.5px] leading-snug text-dim">Booking again replaces this campaign’s own times. Anything already scheduled elsewhere is worked around, not moved.</p>}
        </Panel>

        <Panel title="Queue slots">
          <p className="text-[12px] leading-snug text-muted">
            The times of day it picks from.{' '}
            <button type="button" className="text-accent-soft hover:underline" onClick={() => navigate('/dashboard/automations')}>
              Set your queue slots
            </button>{' '}
            to control them; without any, it uses 09:00, 12:30 and 18:30.
          </p>
        </Panel>
      </div>
    </div>
  )
}

/** The proposal, grouped by day: what goes out when, before anything is booked. */
function Proposal({ proposal, items, accounts }: { proposal: Proposed[]; items: CampaignItem[]; accounts: Account[] }) {
  const days = new Map<string, Proposed[]>()
  for (const p of [...proposal].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = fmtDay(p.at)
    days.set(key, [...(days.get(key) ?? []), p])
  }

  return (
    <Panel title="Proposed times" sub="Nothing is booked yet. Approve them, or change the period and work them out again.">
      <div className="space-y-5">
        {[...days].map(([day, slots]) => (
          <div key={day}>
            <Label>{day}</Label>
            <ul className="mt-2 space-y-1.5">
              {slots.map((p) => {
                const item = items.find((i) => i.id === p.item_id)
                const account = accounts.find((a) => a.id === p.account_id)
                return (
                  <li key={`${p.variant_id}-${p.at}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[12.5px]">
                    <span className="font-mono text-[11px] tabular-nums text-accent-soft">{fmtTime(p.at)}</span>
                    <span className="min-w-0 flex-1 truncate">{item?.title ?? 'A post'}</span>
                    {account && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
                        <PlatformIcon id={account.platform} className="size-3" />@{account.handle}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** Booked: the real posts, anything that clashes, and a way to add a second time. */
function Booked({
  booked,
  campaign,
  items,
  reload,
}: {
  booked: { posts: Post[]; conflicts: Conflict[] }
  campaign: Campaign
  items: CampaignItem[]
  reload: () => Promise<void>
}) {
  const toast = useToast()
  const [adding, setAdding] = useState<number | null>(null)
  const [at, setAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const approved = items.flatMap((i) => i.variants.filter((v) => v.status === 'approved').map((v) => ({ item: i, variant: v })))

  const addTime = async (variantId: number) => {
    setSaving(true)
    setError(null)
    try {
      await api(`/campaigns/${campaign.id}/variants/${variantId}/times`, { method: 'POST', body: { at: new Date(at).toISOString() } })
      await reload()
      setAdding(null)
      setAt('')
      toast('Another time booked.')
    } catch (e) {
      setError(say(e, 'Couldn’t book that time.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="On the calendar" sub={`${booked.posts.length} ${booked.posts.length === 1 ? 'post is' : 'posts are'} scheduled.`}>
        <ul className="space-y-1.5">
          {booked.posts.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[12.5px]">
              <Check className="size-3.5 shrink-0 text-ok" strokeWidth={2.5} />
              <span className="font-mono text-[11px] tabular-nums text-muted">{p.scheduled_at ? `${fmtDay(p.scheduled_at)}, ${fmtTime(p.scheduled_at)}` : '—'}</span>
              <span className="min-w-0 flex-1 truncate">{p.title ?? p.body.slice(0, 60)}</span>
              {p.account && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
                  <PlatformIcon id={p.account.platform} className="size-3" />@{p.account.handle}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {booked.conflicts.length > 0 && (
        <Panel title="Worth a look" sub="Nothing is blocked, but these are worth knowing about.">
          <ul className="space-y-2">
            {booked.conflicts.map((c, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-snug text-warn">
                {c.kind === 'phone' ? <CircleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} /> : <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} />}
                <span>{c.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Post something twice" sub="An approved version can go out at more than one time.">
        <ul className="space-y-1.5">
          {approved.map(({ item, variant }) => (
            <li key={variant.id} className="rounded-lg border border-line px-3 py-2">
              <div className="flex items-center gap-3 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
                  <PlatformIcon id={variant.account.platform} className="size-3" />@{variant.account.handle}
                </span>
                {variant.posts.length > 1 && <Pill tone="dim">{variant.posts.length} times</Pill>}
                <Btn
                  size="sm"
                  variant="subtle"
                  icon={CalendarPlus}
                  onClick={() => {
                    setAdding(adding === variant.id ? null : variant.id)
                    setError(null)
                  }}
                  aria-label={`Add a time for ${item.title} on @${variant.account.handle}`}
                />
              </div>
              {adding === variant.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1">
                    <Label>Also post at</Label>
                    <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={cn(inputClass, 'mt-2')} />
                  </label>
                  <Btn variant="primary" icon={Check} loading={saving} disabled={!at} onClick={() => addTime(variant.id)}>
                    Book it
                  </Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
        <FieldError message={error} />
      </Panel>
    </div>
  )
}
