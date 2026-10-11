import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Clock3,
  CloudLightning,
  Film,
  ImageOff,
  Inbox as InboxIcon,
  PauseCircle,
  PenLine,
  Play,
  Plus,
  Sparkles,
  Type,
  Wand2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { PLATFORMS, PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import type { Asset, Page, Post } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { BarList, HEAT, StatTile } from '../charts'
import {
  addDays,
  firstName,
  fmtDay,
  fmtLongDay,
  fmtRelative,
  fmtTime,
  greeting,
  PLATFORM_ORDER,
  postState,
  sameDay,
  startOfWeek,
  STATE,
  titleOf,
  useApi,
  type Analytics,
  type Overview as OverviewData,
} from '../data'
import { AssetModal, fmtSeconds } from '../media/Media'
import { NEW_POST } from '../nav'
import { useOverview, useUser } from '../Shell'
import { Btn, CountUp, EmptyState, PageHeader, Panel, Platforms, Skeleton, Stagger } from '../ui'

export default function Overview() {
  const user = useUser()
  const { data } = useOverview()
  const { navigate } = useRouter()

  return (
    <div>
      <PageHeader
        title={
          <>
            {greeting()}, <Serif>{firstName(user.name)}.</Serif>
          </>
        }
        sub={data ? <Summary overview={data} /> : fmtLongDay(new Date())}
        actions={
          <>
            <Btn icon={CalendarDays} onClick={() => navigate('/dashboard/calendar')}>
              Calendar
            </Btn>
            <Btn variant="primary" icon={Plus} onClick={() => navigate(NEW_POST)}>
              New post
            </Btn>
          </>
        }
      />

      <div className="mt-10">
        {!data ? <Loading /> : data.counts.total === 0 ? <GettingStarted overview={data} /> : <Board overview={data} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

/** Re-render on a slow tick, for countdowns. */
function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), every)
    return () => window.clearInterval(t)
  }, [every])
  return now
}

/** "in 42 min", "in 3 h 10 min", then "in 2 days". */
function countdown(iso: string, now: number) {
  const mins = Math.round((Date.parse(iso) - now) / 60_000)
  if (mins < 1) return 'any moment now'
  if (mins < 60) return `in ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m ? `in ${h} h ${m} min` : `in ${h} h`
  return fmtRelative(iso, now)
}

/** A post's picture: its first image, or a video's poster frame. */
const coverOf = (p: Post) => p.assets.find((a) => a.kind !== 'audio' && a.poster_url)?.poster_url ?? null

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** An image that steps aside for `fallback` if its file can't be loaded. */
function Img({ src, className, fallback }: { src: string; className?: string; fallback: ReactNode }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  return broken ? <>{fallback}</> : <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={className} />
}

/** The composer, opened with a time already picked. */
const composeAt = (d: Date) => `/dashboard/create?at=${encodeURIComponent(d.toISOString())}`

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-fg">
      {children}
      <ArrowRight className="size-3 transition-transform duration-300 group-hover:translate-x-0.5" />
    </button>
  )
}

/** One line under the greeting that says where things stand. */
function Summary({ overview }: { overview: OverviewData }) {
  const now = useNow()
  const next = overview.upcoming[0]
  const bits: ReactNode[] = [fmtLongDay(new Date(now))]
  if (overview.counts.draft > 0) bits.push(`${plural(overview.counts.draft, 'draft')} waiting`)
  bits.push(next?.scheduled_at ? <span className="text-fg">Next post {countdown(next.scheduled_at, now)}</span> : 'Nothing scheduled yet')
  return (
    <>
      {bits.map((b, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2 text-dim">·</span>}
          {b}
        </span>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The board                                                            */
/* ------------------------------------------------------------------ */

function Board({ overview }: { overview: OverviewData }) {
  // One 90-day fetch feeds the trend tiles (last 30 vs the 30 before) and the activity grid.
  const { data: analytics } = useApi<Analytics>('/analytics', { range: 90 })
  const recent = useApi<Page<Post>>('/posts', { status: 'published', per_page: 4 }).data?.data ?? null

  return (
    <div className="space-y-4">
      <Attention overview={overview} />

      <Stagger i={0}>
        <Trends overview={overview} analytics={analytics} />
      </Stagger>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Stagger i={1} className="min-w-0">
          <Spotlight overview={overview} recent={recent} />
        </Stagger>
        <Stagger i={2} className="min-w-0">
          <WeekBoard />
        </Stagger>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Stagger i={3} className="min-w-0">
          <StudioWall />
        </Stagger>
        <Stagger i={4} className="min-w-0">
          <Activity analytics={analytics} />
        </Stagger>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Stagger i={5} className="min-w-0">
          <Drafts overview={overview} />
        </Stagger>
        <Stagger i={6} className="min-w-0">
          <RecentlyPublished posts={recent} />
        </Stagger>
        <Stagger i={7} className="min-w-0 lg:col-span-2 xl:col-span-1">
          <WherePanel overview={overview} />
        </Stagger>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Needs you: only what's blocking posts, most serious first            */
/* ------------------------------------------------------------------ */

const TONE = {
  fail: { chip: 'bg-fail/10 text-fail', action: 'text-fail' },
  warn: { chip: 'bg-warn/10 text-warn', action: 'text-warn' },
  accent: { chip: 'bg-accent/15 text-accent-soft', action: 'text-accent-soft' },
}

function Attention({ overview }: { overview: OverviewData }) {
  const { navigate } = useRouter()
  const a = overview.automation
  const failed = overview.counts.failed
  const due = overview.due
  const waiting = a?.waiting_on_you ?? 0

  const rows: Array<{ key: string; tone: keyof typeof TONE; icon: LucideIcon; text: ReactNode; action: string; to: string }> = []
  if (failed > 0)
    rows.push({
      key: 'failed',
      tone: 'fail',
      icon: CircleX,
      text: (
        <>
          <span className="text-fg">{plural(failed, 'post')} didn’t go out.</span> Open {failed === 1 ? 'it' : 'them'} to see why and try again.
        </>
      ),
      action: 'Review',
      to: '/dashboard/library?status=failed',
    })
  if (overview.publishing_paused)
    rows.push({
      key: 'paused',
      tone: 'warn',
      icon: PauseCircle,
      text: (
        <>
          <span className="text-fg">Publishing is paused.</span> Scheduled posts wait until you resume.
        </>
      ),
      action: 'Resume',
      to: '/dashboard/publishing',
    })
  if (a?.frozen.length > 0)
    rows.push({
      key: 'storm',
      tone: 'fail',
      icon: CloudLightning,
      text: (
        <>
          <span className="text-fg">Storm Guard froze {a.frozen.map((f) => `@${f.handle}`).join(', ')}.</span> Comments turned negative fast, so nothing approved
          before the storm goes out until you give the all clear.
        </>
      ),
      action: 'Look',
      to: '/dashboard/comments',
    })
  if (due > 0)
    rows.push({
      key: 'due',
      tone: 'warn',
      icon: AlertTriangle,
      text: (
        <>
          <span className="text-fg">
            {due} {due === 1 ? 'post is' : 'posts are'} past {due === 1 ? 'its' : 'their'} time.
          </span>{' '}
          Publishing to the networks isn’t connected yet, so post {due === 1 ? 'it' : 'them'} yourself and mark {due === 1 ? 'it' : 'them'} published.
        </>
      ),
      action: 'Review',
      to: '/dashboard/library?status=scheduled',
    })
  if (waiting > 0)
    rows.push({
      key: 'waiting',
      tone: 'accent',
      icon: InboxIcon,
      text: (
        <>
          <span className="text-fg">
            {waiting} {waiting === 1 ? 'draft wants' : 'drafts want'} your yes.
          </span>{' '}
          Nothing goes out until you approve it.
        </>
      ),
      action: 'Open inbox',
      to: '/dashboard/inbox',
    })

  if (!rows.length) return null
  return (
    <Stagger>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
        {rows.map((r) => {
          const Icon = r.icon
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => navigate(r.to)}
              className="group flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-white/[0.02]"
            >
              <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', TONE[r.tone].chip)}>
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
              <p className="min-w-0 flex-1 leading-snug text-muted">{r.text}</p>
              <span className={cn('flex shrink-0 items-center gap-1 font-medium', TONE[r.tone].action)}>
                {r.action}
                <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
              </span>
            </button>
          )
        })}
      </div>
    </Stagger>
  )
}

/* ------------------------------------------------------------------ */
/* Trends: the last 30 days against the 30 before                       */
/* ------------------------------------------------------------------ */

type Measure = 'created' | 'scheduled' | 'published'

function Trends({ overview, analytics }: { overview: OverviewData; analytics: Analytics | null }) {
  if (!analytics) {
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-panel p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-8 w-14" />
            <Skeleton className="mt-4 h-3 w-32" />
          </div>
        ))}
      </div>
    )
  }

  const days = analytics.days
  const n = days.length
  const sum = (from: number, to: number, k: Measure) => days.slice(Math.max(0, from), to).reduce((s, d) => s + d[k], 0)
  // Twelve weekly totals for the sparkline, oldest first; the last point is this week.
  const weekly = (k: Measure) => Array.from({ length: 12 }, (_, w) => sum(n - 84 + w * 7, n - 84 + (w + 1) * 7, k))
  const tile = (label: string, k: Measure) => {
    const now = sum(n - 30, n, k)
    return <StatTile label={label} value={<CountUp value={now} />} delta={now - sum(n - 60, n - 30, k)} trend={weekly(k)} period="previous 30 days" />
  }

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
      {tile('Published, last 30 days', 'published')}
      {tile('Planned, last 30 days', 'scheduled')}
      {tile('Created, last 30 days', 'created')}
      <StatTile label="Drafts waiting" value={<CountUp value={overview.counts.draft} />} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Spotlight: the next post out, big                                    */
/* ------------------------------------------------------------------ */

/** The picture for a post: its cover, or its words set large when it has none. */
function Cover({ post, className }: { post: Post; className?: string }) {
  const cover = coverOf(post)
  const words = (
    <span className="flex size-full flex-col justify-between p-5">
      <Type className="size-4 text-dim" strokeWidth={1.75} />
      <span className="line-clamp-4 font-serif text-[22px] italic leading-[1.15] text-fg/90">{post.body}</span>
    </span>
  )
  return cover ? <Img src={cover} fallback={words} className={className} /> : words
}

function Spotlight({ overview, recent }: { overview: OverviewData; recent: Post[] | null }) {
  const { navigate } = useRouter()
  const now = useNow()
  const next = overview.upcoming.find((p) => p.scheduled_at)
  const a = overview.automation
  const flows = a && (a.flows_on > 0 || a.runs_today > 0) && (
    <footer className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[11.5px] text-dim md:px-5">
      <Workflow className="size-3.5 text-accent-soft" strokeWidth={1.75} />
      {plural(a.flows_on, 'flow')} working
      <span className="text-line-2">·</span>
      {plural(a.runs_today, 'run')} today
    </footer>
  )

  if (!next?.scheduled_at) {
    const slot = overview.next_slot
    // With nothing queued, the last post out holds the picture, so the card still shows your work.
    const last = recent?.[0]
    return (
      <section className="flex h-full min-h-[340px] flex-col overflow-hidden rounded-xl border border-line bg-panel">
        {last ? (
          <button
            type="button"
            onClick={() => navigate(`/dashboard/create?post=${last.id}`)}
            className="group relative block aspect-[16/10] w-full overflow-hidden border-b border-line bg-panel-2 text-left"
          >
            <Cover post={last} className="size-full object-cover transition-transform duration-700 ease-expo group-hover:scale-[1.02]" />
            <span className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
              <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
                <span className="size-1.5 rounded-full bg-ok" />
                Last out · {fmtRelative(last.published_at ?? last.updated_at)}
              </span>
              <span className="rounded-full bg-black/60 px-2 py-1 backdrop-blur">
                <Platforms ids={last.platforms} className="text-white" />
              </span>
            </span>
          </button>
        ) : null}
        <div className="flex flex-1 flex-col p-5">
          {!last && (
            <span className="mb-5 grid size-10 place-items-center rounded-lg border border-line-2 bg-white/[0.03] text-muted">
              <Clock3 className="size-4" strokeWidth={1.75} />
            </span>
          )}
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-dim">Up next</p>
          <p className="mt-1.5 text-[18px] font-medium tracking-[-0.02em]">Nothing scheduled</p>
          <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-snug text-dim">
            {slot
              ? `Your next open posting time is ${fmtDay(slot)} at ${fmtTime(slot)}.`
              : 'Give a draft a time, or pick posting times and let the queue fill them.'}
          </p>
          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            <Btn size="sm" variant="primary" icon={PenLine} onClick={() => navigate(slot ? composeAt(new Date(slot)) : NEW_POST)}>
              {slot ? 'Fill that slot' : 'Write a post'}
            </Btn>
            <Btn size="sm" icon={Workflow} onClick={() => navigate('/dashboard/automations')}>
              Posting times
            </Btn>
          </div>
        </div>
        {flows}
      </section>
    )
  }

  const at = new Date(next.scheduled_at)
  const cover = coverOf(next)
  const more = overview.counts.scheduled - 1

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => navigate(`/dashboard/create?post=${next.id}`)}
        className="group relative block aspect-[16/10] w-full overflow-hidden bg-panel-2 text-left"
      >
        <Cover post={next} className="size-full object-cover transition-transform duration-700 ease-expo group-hover:scale-[1.02]" />
        <span className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            <span className="size-1.5 rounded-full bg-plan" />
            Up next
          </span>
          <span className="rounded-full bg-black/60 px-2 py-1 backdrop-blur">
            <Platforms ids={next.platforms} className="text-white" />
          </span>
        </span>
      </button>

      <div className="flex flex-1 flex-col p-4 md:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[28px] font-semibold leading-none tracking-[-0.035em]">{fmtTime(at)}</p>
          <p className="text-[12px] text-muted">{sameDay(at, new Date(now)) ? 'Today' : fmtDay(at)}</p>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-plan">
          <Clock3 className="size-3.5" strokeWidth={1.75} />
          Goes out {countdown(next.scheduled_at, now)}
        </p>
        <p className="mt-4 line-clamp-1 text-[14px] font-medium">{titleOf(next)}</p>
        {cover && <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-dim">{next.body}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
          <Btn size="sm" variant="primary" icon={PenLine} onClick={() => navigate(`/dashboard/create?post=${next.id}`)}>
            Open post
          </Btn>
          <Btn size="sm" icon={CalendarDays} onClick={() => navigate('/dashboard/calendar')}>
            Calendar
          </Btn>
          {more > 0 && <span className="ml-auto text-[11.5px] text-dim">+{more} more queued</span>}
        </div>
      </div>
      {flows}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* This week: every post on its day, with its picture                   */
/* ------------------------------------------------------------------ */

const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const shortTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

function WeekBoard() {
  const { navigate } = useRouter()
  const [offset, setOffset] = useState(0)
  const start = useMemo(() => addDays(startOfWeek(new Date()), offset * 7), [offset])
  const { data } = useApi<Page<Post>>('/posts', {
    from: start.toISOString(),
    to: addDays(start, 7).toISOString(),
    sort: 'scheduled',
    per_page: 200,
  })
  const today = new Date()
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const posts = data?.data ?? []
  const byDay = days.map((d) => posts.filter((p) => p.scheduled_at && sameDay(new Date(p.scheduled_at), d)))

  // A sensible time to start a post on an empty day: the next whole hour today, 10:00 later on.
  const startTime = (d: Date) => {
    if (sameDay(d, today)) {
      const t = new Date()
      t.setHours(t.getHours() + 1, 0, 0, 0)
      return t
    }
    const t = new Date(d)
    t.setHours(10, 0, 0, 0)
    return t
  }

  return (
    <Panel
      className="h-full"
      title={offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : 'Week'}
      sub={`${shortDate.format(start)} – ${shortDate.format(addDays(start, 6))} · ${data ? plural(posts.length, 'post') : '…'}`}
      actions={
        <>
          <div className="flex items-center rounded-md border border-line">
            <button type="button" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)} className="grid size-7 place-items-center text-dim transition-colors hover:text-fg">
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setOffset(0)}
              disabled={offset === 0}
              className="h-7 border-x border-line px-2 text-[11.5px] text-muted transition-colors enabled:hover:text-fg disabled:text-dim"
            >
              Today
            </button>
            <button type="button" aria-label="Next week" onClick={() => setOffset((o) => o + 1)} className="grid size-7 place-items-center text-dim transition-colors hover:text-fg">
              <ChevronRight className="size-3.5" />
            </button>
          </div>
          <LinkButton onClick={() => navigate('/dashboard/calendar')}>Calendar</LinkButton>
        </>
      }
      bodyClassName="p-2 md:p-3"
    >
      <div className="no-scrollbar overflow-x-auto" data-lenis-prevent>
        <div className="grid min-w-[720px] grid-cols-7 gap-1.5 xl:min-w-0">
          {days.map((d, i) => {
            const isToday = sameDay(d, today)
            const past = !isToday && d < today
            const list = byDay[i]
            return (
              <div key={d.toISOString()} className={cn('flex min-h-[220px] flex-col rounded-lg p-1.5', isToday ? 'bg-white/[0.035] ring-1 ring-inset ring-line-2' : '')}>
                <div className="flex flex-col items-center gap-1 pb-2.5 pt-1">
                  <span className={cn('text-[10.5px] font-medium uppercase tracking-[0.1em]', isToday ? 'text-fg' : 'text-dim')}>{weekdayShort.format(d)}</span>
                  <span
                    className={cn(
                      'grid size-7 place-items-center rounded-full text-[13px] font-medium tabular-nums',
                      isToday ? 'bg-accent text-on-accent' : past ? 'text-dim' : 'text-fg',
                    )}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  {!data ? (
                    i % 3 === 0 && <Skeleton className="aspect-[4/3] w-full" />
                  ) : (
                    <>
                      {list.slice(0, 3).map((p) => (
                        <WeekCard key={p.id} post={p} />
                      ))}
                      {list.length > 3 && (
                        <button type="button" onClick={() => navigate('/dashboard/calendar')} className="py-1 text-[11px] text-dim transition-colors hover:text-fg">
                          +{list.length - 3} more
                        </button>
                      )}
                      {list.length === 0 && !past && (
                        <button
                          type="button"
                          onClick={() => navigate(composeAt(startTime(d)))}
                          aria-label={`Add a post on ${fmtDay(d)}`}
                          className="grid h-16 place-items-center rounded-md border border-dashed border-line text-dim opacity-70 transition-[opacity,border-color,color] hover:border-line-2 hover:text-fg hover:opacity-100"
                        >
                          <Plus className="size-4" strokeWidth={1.75} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}

function WeekCard({ post }: { post: Post }) {
  const { navigate } = useRouter()
  const state = postState(post)
  const cover = coverOf(post)
  const words = <span className="line-clamp-3 px-2 pt-2 text-[11px] leading-snug text-muted">{titleOf(post)}</span>
  return (
    <motion.button
      type="button"
      onClick={() => navigate(`/dashboard/create?post=${post.id}`)}
      title={`${STATE[state].label} · ${titleOf(post)}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className="group block w-full overflow-hidden rounded-md border border-line bg-panel-2 text-left transition-colors hover:border-line-2"
    >
      <span className="block">{cover ? <Img src={cover} fallback={words} className="aspect-[4/3] w-full object-cover" /> : words}</span>
      {/* The platform mark, in its state's colour, leads the time: the title above keeps the card's full width. */}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {post.platforms[0] ? (
          <PlatformIcon id={post.platforms[0]} className={cn('size-2.5', STATE[state].text)} />
        ) : (
          <span className={cn('size-1.5 shrink-0 rounded-full', STATE[state].dot)} />
        )}
        <span className="truncate whitespace-nowrap text-[10.5px] tabular-nums text-fg">{shortTime.format(new Date(post.scheduled_at!))}</span>
      </span>
    </motion.button>
  )
}

/* ------------------------------------------------------------------ */
/* From the studio: the newest pictures and video                       */
/* ------------------------------------------------------------------ */

function StudioWall() {
  const { navigate } = useRouter()
  const { data } = useApi<Page<Asset>>('/assets')
  const [open, setOpen] = useState<Asset | null>(null)
  const visual = (data?.data ?? []).filter((a) => a.kind !== 'audio')
  const shown = visual.slice(0, 8)
  const rest = (data?.meta.total ?? 0) - shown.length

  return (
    <Panel
      className="h-full"
      title="From the studio"
      sub="Your newest images and video"
      actions={
        <>
          <LinkButton onClick={() => navigate('/dashboard/studio')}>Creative Lab</LinkButton>
          <LinkButton onClick={() => navigate('/dashboard/library?view=media')}>All media</LinkButton>
        </>
      }
    >
      {!data ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Skeleton className="col-span-2 row-span-2 aspect-square" />
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Wand2}
          title="No media yet"
          body="Generate images and video in the Creative Lab, or upload your own. They’ll show up here."
          action={
            <Btn variant="primary" icon={Wand2} onClick={() => navigate('/dashboard/studio')}>
              Open the Creative Lab
            </Btn>
          }
          className="py-10"
        />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {shown.map((a, i) => (
            <WallTile key={a.id} asset={a} big={i === 0} i={i} onOpen={() => setOpen(a)} />
          ))}
          <button
            type="button"
            onClick={() => navigate(rest > 0 ? '/dashboard/library?view=media' : '/dashboard/studio')}
            className="group flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 text-muted transition-colors hover:border-white/30 hover:text-fg"
          >
            {rest > 0 ? (
              <>
                <span className="text-[18px] font-semibold tracking-[-0.02em] text-fg">+{rest}</span>
                <span className="text-[11px]">View all</span>
              </>
            ) : (
              <>
                <Sparkles className="size-4" strokeWidth={1.75} />
                <span className="text-[11px]">Generate</span>
              </>
            )}
          </button>
        </div>
      )}
      <AssetModal asset={open} onClose={() => setOpen(null)} />
    </Panel>
  )
}

function WallTile({ asset, big, i, onOpen }: { asset: Asset; big: boolean; i: number; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  const label = asset.name ?? (asset.kind === 'video' ? 'Video' : 'Image')
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-label={`Open ${label}`}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease, delay: 0.25 + i * 0.04 }}
      className={cn('group relative aspect-square overflow-hidden rounded-lg bg-white/[0.04]', big && 'col-span-2 row-span-2')}
    >
      {asset.poster_url ? (
        <Img
          src={asset.poster_url}
          fallback={
            <span className="grid size-full place-items-center text-dim">
              <ImageOff className="size-5" strokeWidth={1.5} />
            </span>
          }
          className="size-full object-cover transition-transform duration-700 ease-expo group-hover:scale-[1.04]"
        />
      ) : (
        <span className="grid size-full place-items-center text-dim">
          <Film className="size-5" strokeWidth={1.5} />
        </span>
      )}
      {asset.kind === 'video' && hover && <video src={asset.url} muted loop playsInline autoPlay className="absolute inset-0 size-full object-cover" />}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-8 text-left opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <span className="block truncate text-[11px] font-medium text-white">{label}</span>
      </span>
      {asset.kind === 'video' && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9.5px] text-white backdrop-blur">
          <Play className="size-2.5" fill="currentColor" />
          {asset.duration ? fmtSeconds(asset.duration) : 'Video'}
        </span>
      )}
      {asset.source === 'generated' && (
        <span className="absolute right-2 top-2 grid size-5 place-items-center rounded bg-black/60 text-accent-soft backdrop-blur" title="Generated with AI">
          <Sparkles className="size-3" strokeWidth={2} />
        </span>
      )}
    </motion.button>
  )
}

/* ------------------------------------------------------------------ */
/* Activity: 13 weeks of publishing, one cell a day                     */
/* ------------------------------------------------------------------ */

const WEEKDAY_ROWS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

function Activity({ analytics }: { analytics: Analytics | null }) {
  const [tip, setTip] = useState<{ x: number; y: number; value: number; date: string } | null>(null)

  if (!analytics) return <Skeleton className="h-[248px] rounded-xl" />

  const days = analytics.days
  // Columns are weeks that start on Monday, so pad the first column up to the first day.
  const lead = (new Date(`${days[0].date}T00:00`).getDay() + 6) % 7
  const cells: Array<(typeof days)[number] | null> = [...Array.from({ length: lead }, () => null), ...days]
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  const max = Math.max(1, ...days.map((d) => d.published))
  const total = days.reduce((s, d) => s + d.published, 0)
  const active = days.filter((d) => d.published > 0).length

  // Days in a row with something published, counting back from today (or yesterday, if today is still open).
  let i = days.length - 1
  if (days[i].published === 0) i--
  let streak = 0
  while (i >= 0 && days[i].published > 0) {
    streak++
    i--
  }

  const show = (e: ReactPointerEvent<HTMLElement>, d: (typeof days)[number]) => {
    const box = e.currentTarget.offsetParent as HTMLElement | null
    const r = e.currentTarget.getBoundingClientRect()
    const b = box?.getBoundingClientRect()
    if (!b) return
    setTip({ x: r.left - b.left + r.width / 2, y: r.top - b.top, value: d.published, date: d.date })
  }

  return (
    <Panel className="h-full" title="Activity" sub="Posts published per day, last 13 weeks">
      <div className="relative flex gap-2" onPointerLeave={() => setTip(null)}>
        <div className="grid shrink-0 grid-rows-7 gap-[3px] pt-px text-[9.5px] leading-none text-dim" aria-hidden>
          {WEEKDAY_ROWS.map((l, r) => (
            <span key={r} className="flex items-center">
              {l}
            </span>
          ))}
        </div>
        <div className="grid flex-1 grid-flow-col grid-rows-7 gap-[3px]" style={{ gridAutoColumns: 'minmax(0, 1fr)' }} role="img" aria-label={`${total} posts published on ${active} of the last ${days.length} days`}>
          {weeks.flatMap((week, w) =>
            Array.from({ length: 7 }, (_, r) => {
              const d = week[r]
              if (!d) return <span key={`${w}-${r}`} className="aspect-square" />
              const level = d.published ? Math.min(5, Math.ceil((d.published / max) * 5)) : 0
              return (
                <span
                  key={d.date}
                  onPointerEnter={(e) => show(e, d)}
                  className="aspect-square rounded-[3px] transition-[outline-color] outline outline-1 outline-transparent hover:outline-white/50"
                  style={{ background: level ? HEAT[level - 1] : 'rgb(255 255 255 / 0.05)' }}
                />
              )
            }),
          )}
        </div>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line-2 bg-panel-3 px-2.5 py-1.5 shadow-xl"
            style={{ left: tip.x, top: tip.y - 6 }}
          >
            <p className="text-[13px] font-semibold">{plural(tip.value, 'post')}</p>
            <p className="text-[10.5px] text-muted">{longDate.format(new Date(`${tip.date}T00:00`))}</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-dim" aria-hidden>
        Less
        <span className="size-2.5 rounded-[2px] bg-white/[0.05]" />
        {HEAT.map((c) => (
          <span key={c} className="size-2.5 rounded-[2px]" style={{ background: c }} />
        ))}
        More
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
        {[
          ['Published', total],
          ['Active days', active],
          ['Day streak', streak],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] text-dim">{k}</dt>
            <dd className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="sr-only">
        <caption>Posts published per day</caption>
        <tbody>
          {days
            .filter((d) => d.published > 0)
            .map((d) => (
              <tr key={d.date}>
                <th scope="row">{d.date}</th>
                <td>{d.published}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </Panel>
  )
}

function WherePanel({ overview }: { overview: OverviewData }) {
  const rows = PLATFORM_ORDER.filter((id) => overview.platforms[id])
    .map((id) => ({
      key: id,
      name: PLATFORMS[id].name,
      label: (
        <>
          <PlatformIcon id={id} className="size-3.5 shrink-0 text-fg" />
          <span className="truncate">{PLATFORMS[id].name}</span>
        </>
      ),
      value: overview.platforms[id] ?? 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  return (
    <Panel className="h-full" title="Where you post" sub="Posts per platform, all time">
      {rows.length ? <BarList caption="Posts per platform" rows={rows} /> : <p className="py-6 text-center text-[13px] text-dim">No posts yet.</p>}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Drafts and what just went out                                        */
/* ------------------------------------------------------------------ */

function Thumb({ post }: { post: Post }) {
  const cover = coverOf(post)
  const blank = (
    <span className="grid size-11 shrink-0 place-items-center rounded-md border border-line bg-white/[0.03] text-dim">
      <Type className="size-4" strokeWidth={1.75} />
    </span>
  )
  return cover ? <Img src={cover} fallback={blank} className="size-11 shrink-0 rounded-md object-cover" /> : blank
}

function PostRow({ post, meta, trailing }: { post: Post; meta: ReactNode; trailing?: ReactNode }) {
  const { navigate } = useRouter()
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
      <button type="button" onClick={() => navigate(`/dashboard/create?post=${post.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Thumb post={post} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-fg">{titleOf(post)}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-dim">{meta}</span>
        </span>
        <Platforms ids={post.platforms} className="hidden shrink-0 sm:flex" />
      </button>
      {trailing}
    </li>
  )
}

function Drafts({ overview }: { overview: OverviewData }) {
  const { navigate } = useRouter()
  return (
    <Panel
      className="h-full"
      title="Drafts"
      sub="Pick up where you left off"
      actions={<LinkButton onClick={() => navigate('/dashboard/library?status=draft')}>All drafts</LinkButton>}
      bodyClassName="p-2 md:p-3"
    >
      {overview.drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Check className="size-4 text-ok" strokeWidth={2} />
          <p className="text-[13px] text-dim">No drafts. Everything you’ve written has a time.</p>
        </div>
      ) : (
        <ul>
          {overview.drafts.map((p) => (
            <PostRow key={p.id} post={p} meta={`Edited ${fmtRelative(p.updated_at)}`} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RecentlyPublished({ posts }: { posts: Post[] | null }) {
  const { navigate } = useRouter()
  return (
    <Panel
      className="h-full"
      title="Recently published"
      sub="What went out last"
      actions={<LinkButton onClick={() => navigate('/dashboard/library?status=published')}>All published</LinkButton>}
      bodyClassName="p-2 md:p-3"
    >
      {!posts ? (
        <div className="space-y-2 p-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-dim">Nothing published yet.</p>
      ) : (
        <ul>
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              meta={`Published ${fmtRelative(p.published_at ?? p.updated_at)}`}
              trailing={
                p.post_url && (
                  <a
                    href={p.post_url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the live post"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
                  >
                    <ArrowUpRight className="size-3.5" />
                  </a>
                )
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* First run                                                            */
/* ------------------------------------------------------------------ */

function GettingStarted({ overview }: { overview: OverviewData }) {
  const { navigate } = useRouter()
  const steps = [
    {
      icon: PenLine,
      title: 'Write your first post',
      body: 'One idea, shaped for every platform you pick.',
      action: 'Open the composer',
      to: NEW_POST,
      done: overview.counts.total > 0,
    },
    {
      icon: Workflow,
      title: 'Set your posting times',
      body: 'Choose the slots you like. The queue fills them for you.',
      action: 'Set up the queue',
      to: '/dashboard/automations',
      done: overview.next_slot !== null,
    },
    {
      icon: CalendarDays,
      title: 'Plan the week',
      body: 'See every post on one calendar and move things around.',
      action: 'Open the calendar',
      to: '/dashboard/calendar',
      done: overview.counts.scheduled > 0,
    },
  ]

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel p-6 md:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/15 blur-[100px]" />
      <div className="relative grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Getting started</p>
          <h2 className="mt-4 overflow-hidden text-[clamp(2rem,3.6vw,3rem)] font-medium leading-[0.95] tracking-[-0.045em]">
            <motion.span className="block" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.9, ease, delay: 0.15 }}>
              Your studio is ready.
            </motion.span>
          </h2>
          <h2 className="overflow-hidden pb-[0.1em] text-[clamp(2rem,3.6vw,3rem)] font-medium leading-[0.95] tracking-[-0.045em]">
            <motion.span className="block" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.9, ease, delay: 0.24 }}>
              <Serif>Let’s fill it.</Serif>
            </motion.span>
          </h2>
          <p className="mt-5 max-w-sm text-[14px] leading-snug text-muted">
            Three steps from an empty workspace to a week of posts that are ready to go.
          </p>
          <div className="mt-7">
            <Btn variant="primary" icon={Plus} onClick={() => navigate(NEW_POST)}>
              Write the first post
            </Btn>
          </div>
        </div>

        <ol className="relative">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <li key={s.title}>
                {i > 0 && (
                  <div className="relative ml-[27px] h-5 w-px bg-line-2">
                    <motion.div
                      className="absolute inset-0 origin-top bg-accent-soft"
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: steps[i - 1].done ? 1 : 0 }}
                      transition={{ duration: 0.6, ease, delay: 0.6 + i * 0.15 }}
                    />
                  </div>
                )}
                <motion.button
                  type="button"
                  onClick={() => navigate(s.to)}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.7, ease, delay: 0.3 + i * 0.12 }}
                  className={cn(
                    'group flex w-full items-center gap-4 rounded-lg border px-4 py-3.5 text-left transition-colors duration-300',
                    i === steps.findIndex((x) => !x.done) ? 'border-accent/50 bg-accent/[0.08]' : 'border-line bg-ink-2 hover:border-line-2',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white/[0.06] text-fg">
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Step 0{i + 1}</span>
                    <span className="mt-0.5 block text-[14px] font-medium">{s.title}</span>
                    <span className="mt-0.5 block text-[12px] text-dim">{s.body}</span>
                  </span>
                  {s.done ? (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ok text-ink">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted transition-colors group-hover:text-fg">
                      <span className="hidden sm:inline">{s.action}</span>
                      <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </span>
                  )}
                </motion.button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-panel p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-8 w-14" />
            <Skeleton className="mt-4 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  )
}
