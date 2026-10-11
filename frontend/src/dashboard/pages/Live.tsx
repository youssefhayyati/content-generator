import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, CalendarDays, Clapperboard, Expand, Image as ImageIcon, LoaderCircle, Mic, Music2, OctagonX, Play, Shrink, Smartphone, Type, Workflow } from 'lucide-react'
import { PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, type Asset, type FlowGraph, type FlowRunStatus } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useClock } from '../../lib/useClock'
import { fmtRelative, STATE, useInvalidate } from '../data'
import { hueOf } from '../flows/look'
import { RunStatus } from '../flows/Runs'
import { tone } from '../storm/StormGuard'
import { useToast } from '../toast'
import { Btn, CountUp, EmptyState, PageHeader, Panel, Skeleton, Stagger } from '../ui'
import { STATUS as PHONE_STATUS } from './Phones'

type BoardStatus = 'on_time' | 'boarding' | 'publishing' | 'live' | 'checking' | 'needs_you' | 'held' | 'waiting' | 'delayed' | 'by_hand' | 'due' | 'draft'

type Live = {
  now: string
  timezone: string
  paused: boolean
  departures: Array<{ id: number; at: string; title: string; account: { handle: string; platform: PlatformId } | null; platforms: PlatformId[]; format: string; status: BoardStatus; url: string | null }>
  phones: Array<{
    id: number
    name: string
    driver: string
    status: string
    screenshot_url: string | null
    accounts: Array<{ platform: PlatformId; handle: string }>
    run: { goal: string; started_at: string; steps: Array<{ action: string; ok: boolean; ms: number; note?: string }> } | null
    last: { status: string; goal: string; ended_at: string | null } | null
    seen_at: string | null
  }>
  flows: Array<{ id: number; flow_id: number; name: string; status: FlowRunStatus; cause: string | null; graph: FlowGraph; visited: string[]; here: string | null; step: string | null; resume_at: string | null }>
  making: Array<{ id: number; kind: string; prompt: string; since: string }>
  made: Array<{ id: number; kind: string; prompt: string; output: Asset | null; at: string }>
  weather: Array<{ account_id: number; handle: string; platform: PlatformId; share: number; pressure: number; tripped: boolean; enabled: boolean; total: number }>
  today: { published: number; runs: number; flows: number; made: number; comments: number }
}

/** Where a post on its way out stands, in the words and colours posts have everywhere else. */
const BOARD: Record<BoardStatus, { label: string; dot: string; text: string; ring: string }> = {
  on_time: STATE.scheduled,
  boarding: { ...STATE.scheduled, label: 'Up next', dot: 'bg-plan animate-pulse' },
  publishing: STATE.publishing,
  live: STATE.published,
  checking: STATE.submitted,
  needs_you: STATE.failed,
  held: { ...STATE.due, label: 'Held' },
  waiting: { label: 'Needs approval', dot: 'bg-[#ff8fa3]', text: 'text-[#ff8fa3]', ring: 'border-[#ff8fa3]/30' },
  delayed: { ...STATE.due, label: 'Delayed' },
  by_hand: { ...STATE.draft, label: 'By hand' },
  due: STATE.due,
  draft: STATE.draft,
}

const KIND_ICON: Record<string, typeof Mic> = { voice: Mic, music: Music2, reel: Clapperboard, video: Clapperboard, image: ImageIcon, text: Type }

/** How a phone's last run ended, as the Publishing page says it. */
const LAST_RUN: Record<string, string> = { confirmed: 'confirmed', failed: 'failed', uncertain: 'unconfirmed' }

/** How often the page asks what's going on. */
const POLL_MS = 4000

/** A list that runs edge to edge inside a flush Panel, and one of its rows. */
const ROWS = 'divide-y divide-line border-t border-line'
const ROW = 'flex items-center gap-3 px-4 py-3 md:px-5'

/**
 * /dashboard/live: everything the automation is doing right now, on one page that refreshes
 * itself. The posts going out, the phones, flows at work, Storm Guard on every account, and
 * what the studio is making. It goes fullscreen for a screen on the wall.
 */
export default function LiveWall() {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [live, setLive] = useState<Live | null>(null)
  const [full, setFull] = useState(false)
  const [acting, setActing] = useState(false)
  const wall = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const tick = async () => {
      try {
        const data = await api<Live>('/live')
        if (!cancelled) setLive(data)
      } catch {
        /* the next tick will try again */
      }
      if (!cancelled) timer = window.setTimeout(tick, document.hidden ? POLL_MS * 4 : POLL_MS)
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : wall.current?.requestFullscreen?.())?.catch(() => {})

  const setPaused = async (paused: boolean) => {
    setActing(true)
    try {
      await api(`/publishing/${paused ? 'pause' : 'resume'}`, { method: 'POST' })
      setLive((l) => (l ? { ...l, paused } : l))
      invalidate()
      toast(paused ? 'Stopped. Nothing publishes until you resume.' : 'Publishing resumes.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t change it.', 'error')
    } finally {
      setActing(false)
    }
  }

  return (
    // Fullscreen shows this element alone, so there it brings its own wash, scroll and gutters.
    <div ref={wall} className={cn(full && 'isolate h-screen overflow-y-auto px-4 pb-16 pt-8 md:px-6 md:pt-10')} data-lenis-prevent={full || undefined}>
      {full && <div aria-hidden className="glass-ambient pointer-events-none fixed inset-0 -z-10" />}
      <div className={cn(full && 'mx-auto max-w-[1680px]')}>
        <PageHeader
          title={
            <>
              Happening <Serif>now.</Serif>
            </>
          }
          sub="Posts on their way out, the phones, flows at work, the mood in the comments and what the studio is making. It refreshes itself every few seconds."
          actions={
            <>
              <Btn icon={full ? Shrink : Expand} onClick={toggleFull}>
                {full ? 'Leave fullscreen' : 'Fullscreen'}
              </Btn>
              {live && (
                <Btn variant={live.paused ? 'primary' : 'danger'} icon={live.paused ? Play : OctagonX} loading={acting} onClick={() => setPaused(!live.paused)}>
                  {live.paused ? 'Resume publishing' : 'Stop everything'}
                </Btn>
              )}
            </>
          }
        />

        {!live ? (
          <div className="mt-10 space-y-4">
            <Skeleton className="h-[76px] rounded-xl" />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
              <Skeleton className="h-[420px] rounded-xl" />
              <Skeleton className="h-[420px] rounded-xl" />
            </div>
          </div>
        ) : (
          <>
            <Stagger i={0} className="mt-10">
              <Today today={live.today} timezone={live.timezone} />
            </Stagger>
            {/* Two columns that each stack on their own, so a short list leaves no hole beside a long one. */}
            <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4">
                <Stagger i={1}>
                  <GoingOut rows={live.departures} timezone={live.timezone} paused={live.paused} />
                </Stagger>
                <Stagger i={3}>
                  <Studio making={live.making} made={live.made} />
                </Stagger>
                <Stagger i={5}>
                  <Weather weather={live.weather} />
                </Stagger>
              </div>
              <div className="min-w-0 space-y-4">
                <Stagger i={2}>
                  <Phones phones={live.phones} />
                </Stagger>
                <Stagger i={4}>
                  <Flows flows={live.flows} onOpen={(f) => navigate(`/dashboard/flows?id=${f.flow_id}&run=${f.id}`)} />
                </Stagger>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Why a panel has nothing in it, in a line. */
function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-[12.5px] text-dim">{children}</p>
}

/** The clock, then today's numbers. */
function Today({ today, timezone }: { today: Live['today']; timezone: string }) {
  const items: Array<[string, number]> = [
    ['Published today', today.published],
    ['Phone runs', today.runs],
    ['Flow runs', today.flows],
    ['Made in the studio', today.made],
    ['Comments in', today.comments],
  ]
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
      <Clock timezone={timezone} />
      {items.map(([label, n]) => (
        <div key={label} className="bg-panel px-4 py-3.5">
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{label}</p>
          <CountUp value={n} className="mt-1 block text-[24px] font-medium tabular-nums tracking-[-0.03em]" />
        </div>
      ))}
    </div>
  )
}

/** On its own, so the second hand redraws this tile and nothing else. */
function Clock({ timezone }: { timezone: string }) {
  const now = useClock()
  return (
    <div className="bg-panel px-4 py-3.5">
      <p className="flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
        <span className="status-beat size-1.5 shrink-0 rounded-full bg-ok" />
        {now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone })}
      </p>
      <p className="mt-1 whitespace-nowrap text-[24px] font-medium tabular-nums tracking-[-0.03em]">
        {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: timezone })}
      </p>
    </div>
  )
}

/** The posts going out: when, where to, what, and where each one stands. */
function GoingOut({ rows, timezone, paused }: { rows: Live['departures']; timezone: string; paused: boolean }) {
  const { navigate } = useRouter()
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone })
  const day = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', timeZone: timezone })
  const today = day(new Date())
  return (
    <Panel
      title="Going out"
      sub={paused ? <span className="text-fail">Publishing is stopped. Nothing leaves until you resume.</span> : `Scheduled for the next 48 hours. Times in ${timezone.replace(/_/g, ' ')}.`}
      actions={
        <Btn size="sm" icon={CalendarDays} onClick={() => navigate('/dashboard/calendar')}>
          Calendar
        </Btn>
      }
      flush={rows.length > 0}
      className="overflow-hidden"
    >
      {rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing going out" body="No post is scheduled in the next two days. Approve some and they line up here." className="py-10" />
      ) : (
        <ul className={ROWS}>
          {rows.map((r, i) => {
            const s = BOARD[r.status]
            const on = day(new Date(r.at))
            const platform = r.account?.platform ?? r.platforms[0] ?? 'instagram'
            return (
              <motion.li key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 12) * 0.03 }}>
                <button type="button" onClick={() => navigate(`/dashboard/create?post=${r.id}`)} className={cn(ROW, 'w-full text-left transition-colors hover:bg-white/[0.04]')}>
                  <span className="w-[66px] shrink-0 sm:w-[72px]">
                    <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{on === today ? 'Today' : on}</span>
                    <span className="block whitespace-nowrap text-[13.5px] font-medium tabular-nums">{time(r.at)}</span>
                  </span>
                  {/* On a phone the tile gives its room to the title, and the platform moves down a line. */}
                  <span className="hidden size-8 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03] text-muted sm:grid">
                    <PlatformIcon id={platform} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{r.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-dim">
                      <PlatformIcon id={platform} className="size-3 shrink-0 sm:hidden" />
                      <span className="truncate">
                        {r.account ? `@${r.account.handle}` : 'Any account'} · {r.format}
                      </span>
                    </span>
                  </span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', s.ring, s.text)}>
                    <span className={cn('size-1.5 rounded-full', s.dot)} />
                    {s.label}
                  </span>
                </button>
              </motion.li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** The phones: each one's last screen, what it's doing, and its light. */
function Phones({ phones }: { phones: Live['phones'] }) {
  const { navigate } = useRouter()
  const working = phones.filter((p) => p.run).length
  return (
    <Panel
      title="Phones"
      sub={phones.length === 0 ? 'The phones that post for you' : `${working} working · ${phones.length} in all`}
      actions={
        <Btn size="sm" icon={Smartphone} onClick={() => navigate('/dashboard/phones')}>
          Manage
        </Btn>
      }
      flush={phones.length > 0}
    >
      {phones.length === 0 ? (
        <Quiet>No phones yet. Add one under Phones.</Quiet>
      ) : (
        <ul className={ROWS}>
          {phones.map((p) => {
            const status = PHONE_STATUS[p.run ? 'busy' : p.status] ?? PHONE_STATUS.offline
            const step = p.run?.steps[p.run.steps.length - 1]
            const handles = p.accounts.map((a) => `@${a.handle}`).join(', ')
            return (
              <li key={p.id} className={ROW}>
                <Screen url={p.screenshot_url} name={p.name} busy={!!p.run} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-dim">
                    {p.run ? p.run.goal : p.last ? `Last run ${LAST_RUN[p.last.status] ?? p.last.status}${p.last.ended_at ? ` · ${fmtRelative(p.last.ended_at)}` : ''}` : handles || 'No accounts'}
                  </span>
                  {p.run && (
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-accent-soft">{step ? `${step.action} · ${step.ok ? 'ok' : 'failed'}` : 'Starting…'}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-dim">
                  <span className={cn('size-1.5 rounded-full', status.dot)} />
                  {status.label}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** A phone's latest screen, small, opening the whole picture. The outline of a phone when there isn't one. */
function Screen({ url, name, busy }: { url: string | null; name: string; busy: boolean }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  const frame = cn('grid aspect-[9/16] w-8 shrink-0 place-items-center overflow-hidden rounded-md border bg-white/[0.03] text-dim', busy ? 'border-accent/50' : 'border-line-2')
  return url && !broken ? (
    <a href={url} target="_blank" rel="noreferrer" className={frame} title="The phone's latest screen">
      <img src={url} alt={`${name}'s latest screen`} className="size-full object-cover object-top" onError={() => setBroken(true)} />
    </a>
  ) : (
    <span className={frame}>
      <Smartphone className="size-3.5" strokeWidth={1.5} />
    </span>
  )
}

/** Flows at work: each live run as beads, the ones it has passed lit, the one it's at pulsing. */
function Flows({ flows, onOpen }: { flows: Live['flows']; onOpen: (f: Live['flows'][number]) => void }) {
  return (
    <Panel title="Flows at work" sub="Runs in progress, and where each one is" flush={flows.length > 0} className="overflow-hidden">
      {flows.length === 0 ? (
        <Quiet>No flow is running right now.</Quiet>
      ) : (
        <ul className={ROWS}>
          <AnimatePresence initial={false}>
            {flows.map((f) => {
              const order = f.graph.nodes.slice().sort((a, b) => a.y - b.y || a.x - b.x)
              return (
                <motion.li key={f.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <button type="button" onClick={() => onOpen(f)} className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.04] md:px-5">
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium">
                        <Workflow className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} />
                        <span className="truncate">{f.name}</span>
                      </span>
                      <RunStatus status={f.status} className="shrink-0" />
                    </span>
                    <span className="mt-2.5 flex items-center gap-1">
                      {order.map((n) => {
                        const visited = f.visited.includes(n.id)
                        const here = f.here === n.id
                        return (
                          <span
                            key={n.id}
                            className={cn('h-1.5 flex-1 rounded-full transition-colors', here && 'animate-pulse')}
                            style={{ background: here ? hueOf(n.type) : visited ? `color-mix(in oklab, ${hueOf(n.type)} 55%, transparent)` : 'rgb(255 255 255 / 0.08)' }}
                          />
                        )
                      })}
                    </span>
                    <span className="mt-2 block truncate text-[11.5px] text-dim">
                      {f.status === 'waiting' && f.resume_at ? `Waiting · carries on ${fmtRelative(f.resume_at)}` : f.step ? `At: ${f.step}` : f.cause}
                    </span>
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  )
}

/** Storm Guard on every account: a bar that fills as comments turn. */
function Weather({ weather }: { weather: Live['weather'] }) {
  return (
    <Panel title="Storm Guard" sub="How close each account’s comments are to a freeze" flush={weather.length > 0}>
      {weather.length === 0 ? (
        <Quiet>No accounts yet. Connect one and its comments are watched from here.</Quiet>
      ) : (
        <ul className={ROWS}>
          {weather.map((w) => {
            const t = tone(w)
            return (
              <li key={w.account_id} className={ROW}>
                <PlatformIcon id={w.platform} className="size-3.5 shrink-0 text-muted" />
                <span className="w-[120px] shrink-0 truncate text-[13px] font-medium sm:w-[150px]">@{w.handle}</span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <motion.span
                    className="block h-full rounded-full"
                    style={{ background: t.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(3, w.tripped ? 100 : w.pressure)}%` }}
                    transition={{ duration: 1, ease }}
                  />
                </span>
                <span className="flex w-[74px] shrink-0 justify-end">
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium" style={{ color: t.color, borderColor: `color-mix(in oklab, ${t.color} 35%, transparent)` }}>
                    <span className="size-1.5 rounded-full" style={{ background: t.color }} />
                    {t.name}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** The studio: what's being made right now, and the last few things it made. */
function Studio({ making, made }: { making: Live['making']; made: Live['made'] }) {
  return (
    <Panel title="In the studio" sub="Being made now, and the latest finished">
      {making.length > 0 && (
        <ul className={cn('space-y-2', made.length > 0 && 'mb-4')}>
          {making.map((g) => {
            const Icon = KIND_ICON[g.kind] ?? LoaderCircle
            return (
              <li key={g.id} className="flex items-center gap-2.5 text-[12.5px]">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent-soft" />
                <Icon className="size-3.5 shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate">{g.prompt}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-dim">{fmtRelative(g.since)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {made.length === 0 && making.length === 0 ? (
        <Quiet>Nothing made yet today.</Quiet>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {made.map((g) => {
            const Icon = KIND_ICON[g.kind] ?? ImageIcon
            return (
              <div key={g.id} className="min-w-0">
                <div className="relative aspect-square overflow-hidden rounded-lg border border-line bg-white/[0.03]">
                  {g.output?.poster_url ? (
                    <img src={g.output.poster_url} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-dim">
                      <Icon className="size-5" strokeWidth={1.5} />
                    </span>
                  )}
                  <span className="absolute bottom-1.5 left-1.5 grid size-5 place-items-center rounded bg-black/60 text-white">
                    <Icon className="size-3" />
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[11.5px] text-dim">{g.prompt}</p>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
