import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clapperboard, Expand, Image as ImageIcon, LoaderCircle, Mic, Music2, OctagonPause, Play, Shrink, Smartphone, Type, Workflow } from 'lucide-react'
import { PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { api, type Asset, type FlowGraph, type FlowRunStatus } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useClock } from '../../lib/useClock'
import { fmtRelative, useInvalidate } from '../data'
import { hueOf } from '../flows/look'
import { RUN_STATUS } from '../flows/Runs'
import { Flap } from '../live/Flap'
import { useToast } from '../toast'
import { Btn, Skeleton } from '../ui'

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

const STATUS: Record<BoardStatus, { label: string; color: string; blink?: boolean }> = {
  on_time: { label: 'On time', color: '#f2efe6' },
  boarding: { label: 'Boarding', color: '#f5b04c', blink: true },
  publishing: { label: 'Publishing', color: 'var(--color-accent-soft)', blink: true },
  live: { label: 'Live', color: '#5ee39a' },
  checking: { label: 'Checking', color: '#f5b04c' },
  needs_you: { label: 'Needs you', color: '#ff6b6b', blink: true },
  held: { label: 'Held', color: '#6ee7f2' },
  waiting: { label: 'Awaits yes', color: '#ff8fa3' },
  delayed: { label: 'Delayed', color: '#f5b04c' },
  by_hand: { label: 'By hand', color: '#8a8a93' },
  due: { label: 'Due', color: '#f5b04c' },
  draft: { label: 'Draft', color: '#8a8a93' },
}

const KIND_ICON: Record<string, typeof Mic> = { voice: Mic, music: Music2, reel: Clapperboard, video: Clapperboard, image: ImageIcon, text: Type }

/** How often the wall asks what's going on. */
const POLL_MS = 4000

/**
 * /dashboard/live — Mission Control. A departures board for the posts going out, the phones
 * and what they're doing, flows at work, the weather on every account, and the studio making
 * sound and video. Put it on a screen in fullscreen and leave it.
 */
export default function LiveWall() {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [live, setLive] = useState<Live | null>(null)
  const [full, setFull] = useState(false)
  const wall = useRef<HTMLDivElement>(null)
  const clock = useClock()

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
    try {
      await api(`/publishing/${paused ? 'pause' : 'resume'}`, { method: 'POST' })
      setLive((l) => (l ? { ...l, paused } : l))
      invalidate()
      toast(paused ? 'Stopped. Nothing publishes until you resume.' : 'Publishing resumes.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t change it.', 'error')
    }
  }

  const time = clock.toLocaleTimeString('en-GB', { hour12: false, timeZone: live?.timezone })
  const date = clock.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: live?.timezone })

  return (
    <div ref={wall} className={cn('-mx-4 -mt-8 bg-[#060607] md:-mx-8 md:-mt-10', full && 'h-screen overflow-y-auto')} data-lenis-prevent>
      {/* The top bar: the clock, the state of publishing, today's numbers. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-white/[0.06] px-4 py-4 md:px-8">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#5ee39a]">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#5ee39a]/60" />
            <span className="relative size-2 rounded-full bg-[#5ee39a]" />
          </span>
          Live
        </span>
        <h1 className="text-[15px] font-medium tracking-[-0.01em] text-fg">Mission control</h1>
        <span className="font-mono text-[28px] font-medium tabular-nums tracking-[-0.02em] text-fg md:text-[34px]">{time}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-dim">{date}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {live && (
            <button
              type="button"
              onClick={() => setPaused(!live.paused)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors',
                live.paused ? 'border-fail/50 bg-fail/10 text-fail hover:bg-fail/15' : 'border-[#5ee39a]/30 text-[#5ee39a] hover:bg-[#5ee39a]/10',
              )}
              title={live.paused ? 'Resume automated publishing' : 'Stop all automated publishing'}
            >
              {live.paused ? <Play className="size-3" fill="currentColor" /> : <OctagonPause className="size-3.5" />}
              {live.paused ? 'Publishing stopped · resume' : 'Publishing on · stop'}
            </button>
          )}
          <Btn size="sm" variant="subtle" icon={full ? Shrink : Expand} onClick={toggleFull}>
            {full ? 'Leave fullscreen' : 'Fullscreen'}
          </Btn>
        </div>
      </div>

      {!live ? (
        <div className="grid gap-4 p-4 md:p-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Skeleton className="h-[520px] rounded-xl bg-white/[0.03]" />
          <Skeleton className="h-[520px] rounded-xl bg-white/[0.03]" />
        </div>
      ) : (
        <div className="space-y-4 p-4 md:p-8">
          <Today today={live.today} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
            <Departures rows={live.departures} timezone={live.timezone} paused={live.paused} onOpen={(id) => navigate(`/dashboard/create?post=${id}`)} />
            <div className="min-w-0 space-y-4">
              <Phones phones={live.phones} />
              <Flows flows={live.flows} onOpen={(f) => navigate(`/dashboard/flows?id=${f.flow_id}&run=${f.id}`)} />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Weather weather={live.weather} />
            <Studio making={live.making} made={live.made} />
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-white/[0.06] bg-[#0b0b0d] p-4 md:p-5', className)}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-dim">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

function Today({ today }: { today: Live['today'] }) {
  const items: Array<[string, number]> = [
    ['Published today', today.published],
    ['Phone runs', today.runs],
    ['Flow runs', today.flows],
    ['Made in the studio', today.made],
    ['Comments in', today.comments],
  ]
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-5">
      {items.map(([label, n], i) => (
        <div key={label} className={cn('bg-[#0b0b0d] px-4 py-3', i === items.length - 1 && 'col-span-2 sm:col-span-1')}>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-dim">{label}</p>
          <p className="mt-1">
            <Flap text={String(n)} width={4} className="text-[17px]" />
          </p>
        </div>
      ))}
    </div>
  )
}

/** The departures board: time, account, destination, the post, and its status, in flaps. */
function Departures({ rows, timezone, paused, onOpen }: { rows: Live['departures']; timezone: string; paused: boolean; onOpen: (id: number) => void }) {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: timezone })
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', timeZone: timezone })
  return (
    <Section
      title="Departures"
      aside={paused ? <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fail">All departures held</span> : <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">Next 48 hours</span>}
    >
      {rows.length === 0 ? (
        <div className="grid min-h-[260px] place-items-center text-center">
          <div>
            <Flap text="NO DEPARTURES" width={13} className="text-[18px]" />
            <p className="mt-4 text-[12.5px] text-dim">Nothing scheduled in the next two days. Approve some posts and they’ll board here.</p>
          </div>
        </div>
      ) : (
        <div className="no-scrollbar overflow-x-auto" data-lenis-prevent>
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[64px_150px_34px_minmax(0,1fr)_118px] gap-3 px-2 pb-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-dim">
              <span>Time</span>
              <span>Account</span>
              <span>To</span>
              <span>Post</span>
              <span className="text-right">Status</span>
            </div>
            <ul>
              {rows.map((r, i) => {
                const s = STATUS[r.status]
                return (
                  <motion.li key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 12) * 0.03 }}>
                    <button
                      type="button"
                      onClick={() => onOpen(r.id)}
                      className="grid w-full grid-cols-[64px_150px_34px_minmax(0,1fr)_118px] items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-white/[0.03]"
                    >
                      <span className="flex flex-col">
                        <Flap text={fmt(r.at)} width={5} stagger={i * 30} />
                        {day(r.at) !== today && <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-dim">{day(r.at)}</span>}
                      </span>
                      <span className="min-w-0 overflow-hidden">
                        <Flap text={r.account ? `@${r.account.handle}` : 'Any'} width={11} stagger={i * 30 + 60} className="max-w-full" />
                      </span>
                      <span className="grid size-[26px] place-items-center rounded-[4px] bg-[#16161a] text-[#f2efe6]">
                        <PlatformIcon id={r.account?.platform ?? r.platforms[0] ?? 'instagram'} className="size-3.5" />
                      </span>
                      <span className="min-w-0 truncate text-[13px] text-[#d9d6cc]">{r.title}</span>
                      <span className="flex justify-end" style={{ ['--flap-ink' as string]: s.color }}>
                        <span className={cn(s.blink && 'animate-[blink_1.4s_steps(1)_infinite]')}>
                          <Flap text={s.label} width={10} stagger={i * 30 + 120} />
                        </span>
                      </span>
                    </button>
                  </motion.li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </Section>
  )
}

/** The phones: their screens as they last were, and what each is doing. */
function Phones({ phones }: { phones: Live['phones'] }) {
  return (
    <Section title={`Phones · ${phones.length}`}>
      {phones.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-dim">No phones yet. Add one under Phones.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {phones.slice(0, 6).map((p) => {
            const busy = !!p.run
            const light = p.status === 'paused' ? '#f5b04c' : busy ? 'var(--color-accent-soft)' : p.status === 'error' || p.status === 'offline' ? '#ff6b6b' : '#5ee39a'
            const last = p.run?.steps[p.run.steps.length - 1]
            return (
              <div key={p.id} className="min-w-0">
                <div className={cn('relative aspect-[9/16] overflow-hidden rounded-[14px] border-[3px] border-[#1a1a1e] bg-black', busy && 'ring-2 ring-accent-soft/50')}>
                  {p.screenshot_url ? (
                    <img src={p.screenshot_url} alt="" className="size-full object-cover object-top opacity-90" />
                  ) : (
                    <span className="grid size-full place-items-center text-white/20">
                      <Smartphone className="size-6" strokeWidth={1.25} />
                    </span>
                  )}
                  {busy && <span aria-hidden className="absolute inset-x-0 top-0 h-1/3 animate-[scan_2.2s_linear_infinite] bg-gradient-to-b from-accent-soft/0 via-accent-soft/15 to-accent-soft/0" />}
                </div>
                <p className="mt-2 flex items-center gap-1.5 truncate text-[12px] font-medium text-fg">
                  <span className={cn('size-1.5 shrink-0 rounded-full', busy && 'animate-pulse')} style={{ background: light }} />
                  {p.name}
                </p>
                <p className="truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
                  {busy ? (last ? `${last.action} · ${last.ok ? 'ok' : 'failed'}` : 'Starting…') : p.status === 'paused' ? 'Paused' : p.last ? `Last: ${p.last.status}` : 'Idle'}
                </p>
                {busy && <p className="mt-0.5 truncate text-[11px] text-muted">{p.run!.goal}</p>}
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

/** Flows at work: each live run as beads, the ones it has passed lit, the one it's at pulsing. */
function Flows({ flows, onOpen }: { flows: Live['flows']; onOpen: (f: Live['flows'][number]) => void }) {
  return (
    <Section title={`Flows at work · ${flows.length}`}>
      {flows.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-dim">No flow is running right now.</p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {flows.map((f) => {
              const s = RUN_STATUS[f.status]
              const order = f.graph.nodes.slice().sort((a, b) => a.y - b.y || a.x - b.x)
              return (
                <motion.li key={f.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <button type="button" onClick={() => onOpen(f)} className="w-full rounded-lg border border-white/[0.06] px-3 py-2.5 text-left transition-colors hover:border-white/[0.12]">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 truncate text-[12.5px] font-medium">
                        <Workflow className="size-3.5 shrink-0 text-accent-soft" /> {f.name}
                      </span>
                      <span className={cn('shrink-0 font-mono text-[10px]', s.text)}>{s.label}</span>
                    </span>
                    <span className="mt-2 flex items-center gap-1">
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
                    <span className="mt-1.5 block truncate text-[11px] text-dim">
                      {f.status === 'waiting' && f.resume_at ? `Waiting · carries on ${fmtRelative(f.resume_at)}` : f.step ? `At: ${f.step}` : f.cause}
                    </span>
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </Section>
  )
}

/** Storm Guard on every account: a bar that fills as comments turn. */
function Weather({ weather }: { weather: Live['weather'] }) {
  return (
    <Section title="Weather · Storm Guard">
      <ul className="space-y-2.5">
        {weather.map((w) => {
          const color = w.tripped ? '#ff6b6b' : w.pressure >= 85 ? '#ff6b6b' : w.pressure >= 45 ? '#f5b04c' : '#5ee39a'
          return (
            <li key={w.account_id} className="flex items-center gap-3">
              <PlatformIcon id={w.platform} className="size-3.5 shrink-0 text-muted" />
              <span className="w-[130px] shrink-0 truncate text-[12.5px]">@{w.handle}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.span className="block h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, w.tripped ? 100 : w.pressure)}%` }} transition={{ duration: 1, ease }} />
              </span>
              <span className="w-[86px] shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color }}>
                {!w.enabled ? 'Off' : w.tripped ? 'Frozen' : w.pressure >= 85 ? 'Stormy' : w.pressure >= 45 ? 'Choppy' : 'Calm'}
              </span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** The studio: what's being made right now, and the last few things it made. */
function Studio({ making, made }: { making: Live['making']; made: Live['made'] }) {
  return (
    <Section title="In the studio">
      {making.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {making.map((g) => {
            const Icon = KIND_ICON[g.kind] ?? LoaderCircle
            return (
              <li key={g.id} className="flex items-center gap-2.5 text-[12.5px]">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent-soft" />
                <Icon className="size-3.5 shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate">{g.prompt}</span>
                <span className="font-mono text-[10px] text-dim">{fmtRelative(g.since)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {made.length === 0 && making.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-dim">Nothing made yet today.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {made.map((g) => {
            const Icon = KIND_ICON[g.kind] ?? ImageIcon
            return (
              <div key={g.id} className="min-w-0">
                <div className="relative aspect-square overflow-hidden rounded-lg bg-white/[0.04]">
                  {g.output?.poster_url ? <img src={g.output.poster_url} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-dim"><Icon className="size-5" strokeWidth={1.5} /></span>}
                  <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded bg-black/60 text-white">
                    <Icon className="size-3" />
                  </span>
                </div>
                <p className="mt-1 truncate text-[10.5px] text-dim">{g.prompt}</p>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
