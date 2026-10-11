import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Copy, Layers, MousePointerClick, PenLine, Plus, Smartphone, Trash2, Undo2 } from 'lucide-react'
import { PLATFORMS, PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, type Page, type Post, type PostRun } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Link, useRouter } from '../../lib/router'
import {
  addDays,
  fmtDateTime,
  fmtDay,
  fmtTime,
  postState,
  sameDay,
  setPostStatus,
  startOfWeek,
  STATE,
  titleOf,
  useApi,
  useInvalidate,
  type PostState,
} from '../data'
import { NEW_POST } from '../nav'
import { useToast } from '../toast'
import { Btn, Label, Modal, PageHeader, Platforms, Segmented, StateBadge, Stagger } from '../ui'

const HOUR = 52
/** How much of an hour a post's block covers, in minutes. Posts are moments, not meetings. */
const BLOCK_MIN = 50
const SNAP_MIN = 15
/** Beyond this many side by side, posts are too thin to read: the whole group becomes one stack. */
const MAX_LANES = 2

/** In the month view, a day shows this many posts; with more, one row becomes "+N more". */
const MONTH_CHIPS = 3
const POST_DRAG = 'application/x-calendar-post'
const VIEW_KEY = 'calendar-view'

export const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const range = (a: Date, b: Date) =>
  `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

export type CalendarMode = 'week' | 'month'

export const VIEWS: Array<{ value: CalendarMode; label: ReactNode }> = [
  { value: 'week', label: <><Clock3 className="size-3.5" />Week</> },
  { value: 'month', label: <><CalendarDays className="size-3.5" />Month</> },
]

/** A day picked without a time lands at 9:00, or, today, at the next full hour. */
function timeFor(day: Date, now: Date) {
  const at = new Date(day)
  at.setHours(9, 0, 0, 0)
  if (sameDay(day, now) && at <= now) at.setHours(now.getHours() + 1, 0, 0, 0)
  return at
}

/**
 * What the calendar shows: a week by the hour, or a month by the day (whole weeks, so it
 * starts and ends on the neighbouring months' days). The choice is remembered.
 */
export function useCalendarRange() {
  const [mode, setModeState] = useState<CalendarMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'week'
    } catch {
      return 'week'
    }
  })
  const [cursor, setCursor] = useState(() => new Date())
  const [dir, setDir] = useState(0)

  const { start, days } = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(cursor)
      return { start, days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) }
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const start = startOfWeek(first)
    const weeks = Math.ceil((Math.round((last.getTime() - start.getTime()) / 86_400_000) + 1) / 7)
    return { start, days: Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)) }
  }, [mode, cursor])

  const setMode = (next: CalendarMode) => {
    setDir(0)
    setModeState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* Remembering the view is a nicety. */
    }
  }

  /** One week or month back or forward; 0 goes back to today. */
  const shift = (n: number) => {
    setDir(n)
    setCursor((c) => {
      const today = new Date()
      if (n === 0) return today
      if (mode === 'week') return addDays(c, n * 7)
      const month = new Date(c.getFullYear(), c.getMonth() + n, 1)
      return month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth() ? today : month
    })
  }

  /** From the month: that day's week, by the hour. */
  const openDay = (d: Date) => {
    setCursor(d)
    setMode('week')
  }

  const now = new Date()
  const current =
    mode === 'week'
      ? sameDay(start, startOfWeek(now))
      : cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()

  return { mode, setMode, cursor, start, end: addDays(start, days.length), days, dir, shift, openDay, current }
}

/** Side-by-side columns for posts whose blocks would overlap, or one stack when there are too many. */
function lanes(posts: Post[]) {
  const sorted = [...posts].sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!))
  const out = new Map<number, { lane: number; lanes: number }>()
  const stacks: Post[][] = []
  let cluster: Post[] = []
  let clusterEnd = -1

  const flush = () => {
    const ends: number[] = []
    const assigned: Array<[Post, number]> = []
    for (const p of cluster) {
      const start = minutesOf(new Date(p.scheduled_at!))
      let lane = ends.findIndex((end) => end <= start)
      if (lane === -1) lane = ends.length
      ends[lane] = start + BLOCK_MIN
      assigned.push([p, lane])
    }
    if (ends.length > MAX_LANES) stacks.push(cluster)
    else for (const [p, lane] of assigned) out.set(p.id, { lane, lanes: ends.length })
    cluster = []
  }

  for (const p of sorted) {
    const start = minutesOf(new Date(p.scheduled_at!))
    if (cluster.length && start >= clusterEnd) flush()
    cluster.push(p)
    clusterEnd = Math.max(clusterEnd, start + BLOCK_MIN)
  }
  if (cluster.length) flush()
  return { lanes: out, stacks }
}

export default function Calendar() {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const view = useCalendarRange()
  const { mode, days, start } = view
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<Post | null>(null)
  const [now, setNow] = useState(() => new Date())

  const { data, loading, setData } = useApi<Page<Post>>('/posts', {
    from: start.toISOString(),
    to: view.end.toISOString(),
    sort: 'scheduled',
    per_page: 500,
  })
  const posts = data?.data ?? []
  const selected = posts.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const counts = (['draft', 'scheduled', 'due', 'published'] as PostState[]).map((s) => ({
    s,
    n: posts.filter((p) => postState(p, now.getTime()) === s).length,
  }))

  const shift = (n: number) => {
    setSelectedId(null)
    view.shift(n)
  }

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      invalidate()
      toast(message)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That didn’t work.', 'error')
    }
  }

  /** Dropping a block somewhere else on the grid moves the post there. */
  const reschedule = async (post: Post, at: Date) => {
    if (at.getTime() <= Date.now()) {
      toast('That time has already passed. Drop it somewhere in the future.', 'error')
      return
    }
    const iso = at.toISOString()
    setData((d) => d && { ...d, data: d.data.map((p) => (p.id === post.id ? { ...p, scheduled_at: iso } : p)) })
    try {
      await api(`/posts/${post.id}`, {
        method: 'PUT',
        body: { title: post.title, body: post.body, format: post.format, platforms: post.platforms, status: post.status, scheduled_at: iso },
      })
      invalidate()
      toast(`Moved to ${fmtDateTime(iso)}.`)
    } catch (e) {
      invalidate()
      toast(e instanceof Error ? e.message : 'Couldn’t move the post.', 'error')
    }
  }

  const onCreate = (at: Date) => navigate(`/dashboard/create?at=${encodeURIComponent(at.toISOString())}`)

  return (
    <div>
      <PageHeader
        title={
          <>
            See everything. <Serif>Plan ahead.</Serif>
          </>
        }
        sub="Drag a post to move it. Click an empty slot to write one for that time."
        actions={
          <Btn variant="primary" icon={Plus} onClick={() => navigate(NEW_POST)}>
            New post
          </Btn>
        }
      />

      <Stagger i={0} className="mt-10">
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={monthYear(mode === 'week' ? start : view.cursor)}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.3, ease }}
                className="text-[15px] font-medium tracking-[-0.01em]"
              >
                {monthYear(mode === 'week' ? start : view.cursor)}
              </motion.p>
            </AnimatePresence>
            {mode === 'week' && <span className="font-mono text-[11px] text-dim">{range(start, addDays(start, 6))}</span>}
            <div className="flex items-center gap-1">
              <button type="button" aria-label={`Previous ${mode}`} onClick={() => shift(-1)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" aria-label={`Next ${mode}`} onClick={() => shift(1)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg">
                <ChevronRight className="size-4" />
              </button>
            </div>
            {!view.current && (
              <Btn size="sm" onClick={() => shift(0)}>
                Today
              </Btn>
            )}
            <div className={cn('ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted transition-opacity', loading && 'opacity-60')}>
              {counts.map(({ s, n }) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={cn('size-1.5 rounded-full', STATE[s].dot)} />
                  {STATE[s].label}
                  <span className="font-mono text-dim">{n}</span>
                </span>
              ))}
            </div>
            <Segmented id="calendar-view" label="Calendar view" options={VIEWS} value={mode} onChange={view.setMode} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
            <AnimatePresence mode="wait" initial={false} custom={view.dir}>
              <motion.div
                key={`${mode}-${start.toISOString()}`}
                custom={view.dir}
                initial={{ opacity: 0, x: view.dir * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: view.dir * -40 }}
                transition={{ duration: 0.35, ease }}
                className="min-w-0"
              >
                {mode === 'week' ? (
                  <WeekGrid
                    days={days}
                    posts={posts}
                    ready={!loading && !!data}
                    now={now}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onCreate={onCreate}
                    onMove={reschedule}
                  />
                ) : (
                  <MonthGrid
                    days={days}
                    month={view.cursor}
                    posts={posts}
                    now={now}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onCreate={onCreate}
                    onMove={reschedule}
                    onOpenDay={view.openDay}
                  />
                )}
                <Agenda days={days} month={mode === 'month' ? view.cursor : undefined} posts={posts} now={now} onSelect={setSelectedId} />
              </motion.div>
            </AnimatePresence>

            <aside className="border-t border-line p-5 lg:border-l lg:border-t-0">
              <AnimatePresence mode="wait" initial={false}>
                {selected ? (
                  <motion.div
                    key={selected.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.3, ease }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
                        <Platforms ids={selected.platforms} className="text-fg" />
                        <span className="truncate">{selected.platforms.map((p) => PLATFORMS[p].name).join(', ')}</span>
                      </span>
                      <StateBadge state={postState(selected, now.getTime())} />
                    </div>
                    <p className="mt-5 text-xl font-medium leading-tight tracking-[-0.02em]">{titleOf(selected)}</p>
                    <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-dim">
                      <Clock3 className="size-3" />
                      {fmtDateTime(selected.scheduled_at!)}
                    </p>
                    <Label className="mt-6">Copy</Label>
                    <p className="mt-2 line-clamp-[10] whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg/85">{selected.body}</p>
                    {postState(selected, now.getTime()) === 'due' && (
                      <p className="mt-5 rounded-md border border-warn/25 bg-warn/[0.06] px-3 py-2.5 text-[12.5px] leading-snug text-warn">
                        {selected.account?.automation
                          ? 'Its time has passed: its phone picks it up within a minute.'
                          : 'Its time has passed, and no phone publishes for this account. Post it yourself and mark it published, or turn on automation for the account.'}
                      </p>
                    )}
                    <PublishProof post={selected} className="mt-5" />
                    {selected.lab && (
                      <Link to={`/dashboard/studio?project=${selected.lab.project_id}${selected.lab.node_id ? `&node=${encodeURIComponent(selected.lab.node_id)}` : ''}`} className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-accent-soft hover:underline">
                        Open its node in Creative Lab
                      </Link>
                    )}
                    <div className="mt-6 grid grid-cols-2 gap-2">
                      <Btn icon={PenLine} onClick={() => navigate(`/dashboard/create?post=${selected.id}`)}>
                        Edit
                      </Btn>
                      {selected.status === 'scheduled' ? (
                        <Btn variant="primary" icon={Check} onClick={() => act(() => setPostStatus(selected, 'published'), 'Marked as published.')}>
                          Published
                        </Btn>
                      ) : (
                        <Btn icon={Copy} onClick={() => act(() => api(`/posts/${selected.id}/duplicate`, { method: 'POST' }), 'Duplicated as a new draft.')}>
                          Duplicate
                        </Btn>
                      )}
                      {selected.status !== 'draft' && (
                        <Btn variant="subtle" icon={Undo2} onClick={() => act(() => setPostStatus(selected, 'draft'), 'Moved back to drafts.')}>
                          To drafts
                        </Btn>
                      )}
                      <Btn variant="subtle" icon={Trash2} className="text-fail hover:text-fail" onClick={() => setDeleting(selected)}>
                        Delete
                      </Btn>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
                    <MousePointerClick className="size-5 text-dim" strokeWidth={1.5} />
                    <p className="mt-3 text-[13px] text-muted">Select a post to see it here.</p>
                    <p className="mt-1 max-w-[24ch] text-[12px] text-dim">Or click an empty slot to write one for that time.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </aside>
          </div>
        </section>
      </Stagger>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this post?">
        <p className="text-[13px] leading-snug text-muted">
          “{deleting ? titleOf(deleting) : ''}” comes off your calendar and out of your library. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setDeleting(null)}>Keep it</Btn>
          <Btn
            variant="danger"
            icon={Trash2}
            onClick={() => {
              const post = deleting
              setDeleting(null)
              setSelectedId(null)
              if (post) act(() => api(`/posts/${post.id}`, { method: 'DELETE' }), 'Post deleted.')
            }}
          >
            Delete post
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const PROOF: Record<PostRun['outcome'], { label: string; tone: string }> = {
  confirmed: { label: 'Published from the phone', tone: 'text-ok' },
  uncertain: { label: 'Not confirmed: check the account', tone: 'text-warn' },
  failed: { label: 'The phone couldn’t post it', tone: 'text-fail' },
  running: { label: 'The phone is posting it', tone: 'text-accent-soft' },
}

/** How the phone's last run on a post went, with the screenshot it ended on as the proof. */
export function PublishProof({ post, className }: { post: Post; className?: string }) {
  const run = post.run
  if (!run) return null
  const look = PROOF[run.outcome]
  return (
    <div className={cn('rounded-lg border border-line bg-white/[0.02] p-3', className)}>
      <p className={cn('flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]', look.tone)}>
        <Smartphone className="size-3" />
        {look.label}
      </p>
      <p className="mt-1 font-mono text-[10.5px] text-dim">
        {run.ended_at ? fmtDateTime(run.ended_at) : 'Still going'}
        {run.attempt > 1 && ` · attempt ${run.attempt}`}
        {run.steps > 0 && ` · ${run.steps} steps`}
      </p>
      {run.screenshot_url && (
        <a href={run.screenshot_url} target="_blank" rel="noreferrer" title="Open the screenshot" className="mt-2.5 block overflow-hidden rounded-md border border-line">
          <img src={run.screenshot_url} alt="The phone’s screen when it finished" loading="lazy" className="max-h-72 w-full object-cover object-top" />
        </a>
      )}
      {run.note && <p className="mt-2 line-clamp-4 text-[11.5px] leading-snug text-muted">{run.note}</p>}
    </div>
  )
}

export function WeekGrid({
  days,
  posts,
  ready,
  now,
  selectedId,
  onSelect,
  onCreate,
  onMove,
  drop,
}: {
  days: Date[]
  posts: Post[]
  /** This week's posts have arrived (not the previous week's, still on screen). */
  ready: boolean
  now: Date
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (at: Date) => void
  onMove: (post: Post, at: Date) => void
  /** Something else that can be dragged onto a slot (the assistant's drafts): its drag type, and what to do with it. */
  drop?: { type: string; onDrop: (at: Date, value: string) => void }
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // The grid below scrolls, and its scrollbar takes width the header doesn't lose: the header gives up
  // the same amount, so each day's line in the header meets its line in the grid.
  const [gutter, setGutter] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setGutter(el.offsetWidth - el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const firstColumn = useRef<HTMLDivElement>(null)
  const [colWidth, setColWidth] = useState(120)
  const [ghost, setGhost] = useState<{ day: number; minutes: number } | null>(null)
  const [openStack, setOpenStack] = useState<number | null>(null)
  const dragged = useRef(false)

  // An open stack closes on a click anywhere outside it, or on Escape.
  useEffect(() => {
    if (openStack === null) return
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-stack="${openStack}"]`)) setOpenStack(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpenStack(null)
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [openStack])

  // Once this week's posts are in, open on the earliest of them; with none, on a little
  // before now (this week) or the start of the working day. Only the first time.
  const placed = useRef(false)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !ready || placed.current) return
    placed.current = true
    const hours = posts.filter((p) => p.scheduled_at).map((p) => new Date(p.scheduled_at!).getHours())
    const hour = hours.length
      ? Math.max(0, Math.min(...hours) - 1)
      : days.some((d) => sameDay(d, now))
        ? Math.max(0, now.getHours() - 2)
        : 8
    el.scrollTo({ top: hour * HOUR, behavior: 'smooth' })
  }, [ready, posts, days, now])

  useLayoutEffect(() => {
    const el = firstColumn.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setColWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const byDay = days.map((d) => posts.filter((p) => p.scheduled_at && sameDay(new Date(p.scheduled_at), d)))
  const layouts = byDay.map(lanes)

  const slotAt = (day: number, e: { clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    const minutes = Math.floor(((e.clientY - r.top) / HOUR) * 60 / 30) * 30
    return { day, minutes: Math.max(0, Math.min(23 * 60 + 30, minutes)) }
  }

  return (
    <div className="hidden md:block">
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line" style={{ paddingRight: gutter }}>
        <span />
        {days.map((d) => {
          const today = sameDay(d, now)
          return (
            <div key={d.toISOString()} className="border-l border-line px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{d.toLocaleDateString(undefined, { weekday: 'short' })}</p>
              <p className={cn('mt-0.5 text-[18px] font-medium tracking-[-0.02em]', today ? 'text-fg' : 'text-muted')}>
                {d.getDate()}
                {today && <span className="ml-2 align-middle font-mono text-[10px] text-accent-soft">today</span>}
              </p>
            </div>
          )
        })}
      </div>

      <div ref={scroller} data-lenis-prevent className="relative h-[620px] overflow-y-auto">
        <div className="relative grid grid-cols-[52px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute right-2 font-mono text-[10px] text-dim" style={{ top: h * HOUR - 6 }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>

          {days.map((d, di) => {
            const today = sameDay(d, now)
            return (
              <div
                key={d.toISOString()}
                ref={di === 0 ? firstColumn : undefined}
                className={cn('relative border-l border-line', today && 'bg-white/[0.015]')}
                style={{
                  backgroundImage: `repeating-linear-gradient(180deg, transparent 0 ${HOUR - 1}px, rgb(255 255 255 / 0.05) ${HOUR - 1}px ${HOUR}px)`,
                }}
                onPointerMove={(e) => {
                  if (e.target !== e.currentTarget) return setGhost(null)
                  setGhost(slotAt(di, e))
                }}
                onPointerLeave={() => setGhost(null)}
                onDragOver={(e) => {
                  if (!drop || !e.dataTransfer.types.includes(drop.type)) return
                  e.preventDefault()
                  setGhost(slotAt(di, e))
                }}
                onDragLeave={() => setGhost(null)}
                onDrop={(e) => {
                  if (!drop || !e.dataTransfer.types.includes(drop.type)) return
                  e.preventDefault()
                  setGhost(null)
                  const at = new Date(d)
                  at.setHours(0, slotAt(di, e).minutes, 0, 0)
                  drop.onDrop(at, e.dataTransfer.getData(drop.type))
                }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return
                  const { minutes } = slotAt(di, e)
                  const at = new Date(d)
                  at.setHours(0, minutes, 0, 0)
                  if (at.getTime() > Date.now()) onCreate(at)
                }}
              >
                {ghost?.day === di && (() => {
                  const at = new Date(d)
                  at.setHours(0, ghost.minutes, 0, 0)
                  const past = at.getTime() <= Date.now()
                  return (
                    <div
                      className={cn(
                        'pointer-events-none absolute inset-x-1.5 flex items-center gap-1.5 rounded-md border border-dashed px-2 font-mono text-[10px]',
                        past ? 'border-white/10 text-dim' : 'border-accent-soft/50 bg-accent/[0.06] text-accent-soft',
                      )}
                      style={{ top: (ghost.minutes / 60) * HOUR + 2, height: HOUR / 2 - 4 }}
                    >
                      {past ? 'In the past' : (
                        <>
                          <Plus className="size-3" /> {fmtTime(at)}
                        </>
                      )}
                    </div>
                  )
                })()}

                {today && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (minutesOf(now) / 60) * HOUR }}>
                    <span className="-ml-[4px] size-2 rounded-full bg-accent" />
                    <span className="h-px flex-1 bg-accent" />
                  </div>
                )}

                {layouts[di].stacks.map((stack) => {
                  const at = new Date(stack[0].scheduled_at!)
                  const id = stack[0].id
                  const open = openStack === id
                  const platforms = [...new Set(stack.flatMap((p) => p.platforms))]
                  return (
                    <div
                      key={`stack-${id}`}
                      data-stack={id}
                      className={cn('absolute inset-x-1.5', open ? 'z-30' : 'z-[5]')}
                      style={{ top: (minutesOf(at) / 60) * HOUR + 2, height: (BLOCK_MIN / 60) * HOUR - 4 }}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenStack(open ? null : id)}
                        className={cn(
                          'size-full overflow-hidden rounded-md border bg-panel-3 px-2 py-1.5 text-left shadow-[3px_-3px_0_-1px_var(--color-panel-2),3px_-3px_0_0_var(--color-line-2)] transition-colors',
                          open || stack.some((p) => p.id === selectedId) ? 'border-white/30' : 'border-line-2 hover:border-white/20',
                        )}
                      >
                        <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                          <Layers className="size-3 shrink-0 text-fg" />
                          {fmtTime(at)}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] font-medium leading-tight">
                          {stack.length} posts
                          <span className="flex gap-0.5 text-muted">
                            {platforms.slice(0, 3).map((pl) => (
                              <PlatformIcon key={pl} id={pl} className="size-2.5" />
                            ))}
                          </span>
                        </p>
                      </button>
                      <AnimatePresence>
                        {open && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.2, ease }}
                            className={cn(
                              'absolute top-full mt-1.5 w-[260px] space-y-1 rounded-lg border border-line-2 bg-panel-3 p-1.5 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)]',
                              di >= 5 ? 'right-0' : 'left-0',
                            )}
                          >
                            {stack.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  onSelect(p.id)
                                  setOpenStack(null)
                                }}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-md border border-l-2 border-transparent px-2 py-1.5 text-left transition-colors hover:brightness-125',
                                  STATE[postState(p, now.getTime())].tone,
                                  selectedId === p.id && 'shadow-[0_0_0_1px_rgb(255_255_255_/_0.4)]',
                                )}
                              >
                                <PlatformIcon id={p.platforms[0]} className="size-3 shrink-0" />
                                <span className="min-w-0 flex-1 truncate text-[12px]">{titleOf(p)}</span>
                                <span className="font-mono text-[10px] text-dim">{fmtTime(p.scheduled_at!)}</span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })}

                {byDay[di].map((p, pi) => {
                  const at = new Date(p.scheduled_at!)
                  const state = postState(p, now.getTime())
                  const lane = layouts[di].lanes.get(p.id)
                  if (!lane) return null
                  const movable = p.status !== 'published'
                  return (
                    <motion.button
                      key={p.id}
                      type="button"
                      layout="position"
                      drag={movable}
                      dragMomentum={false}
                      dragSnapToOrigin
                      dragElastic={0}
                      whileDrag={{ scale: 1.03, zIndex: 30, boxShadow: '0 20px 40px -12px rgb(0 0 0 / 0.8)', cursor: 'grabbing' }}
                      onDragStart={() => {
                        dragged.current = true
                        setGhost(null)
                      }}
                      onDragEnd={(_, info) => {
                        // The click that may follow this pointerup is part of the drag, not a
                        // selection. Clear the flag right after it, whether or not it comes.
                        window.setTimeout(() => {
                          dragged.current = false
                        }, 0)
                        const dayShift = Math.round(info.offset.x / colWidth)
                        const minuteShift = Math.round(((info.offset.y / HOUR) * 60) / SNAP_MIN) * SNAP_MIN
                        if (dayShift === 0 && minuteShift === 0) return
                        const next = new Date(at)
                        next.setDate(next.getDate() + dayShift)
                        next.setMinutes(next.getMinutes() + minuteShift)
                        onMove(p, next)
                      }}
                      onClick={() => {
                        if (dragged.current) return
                        onSelect(p.id)
                      }}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease, delay: 0.05 + pi * 0.04 }}
                      className={cn(
                        'absolute overflow-hidden rounded-md border border-l-2 border-transparent px-2 py-1.5 text-left transition-shadow',
                        STATE[state].tone,
                        movable ? 'cursor-grab' : 'cursor-pointer',
                        selectedId === p.id && 'shadow-[0_0_0_1px_rgb(255_255_255_/_0.4)]',
                      )}
                      style={{
                        top: (minutesOf(at) / 60) * HOUR + 2,
                        height: (BLOCK_MIN / 60) * HOUR - 4,
                        left: `calc(${(lane.lane / lane.lanes) * 100}% + 6px)`,
                        width: `calc(${100 / lane.lanes}% - 12px)`,
                      }}
                    >
                      <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                        <PlatformIcon id={p.platforms[0]} className="size-3 shrink-0 text-fg" />
                        {fmtTime(at)}
                        {p.platforms.length > 1 && <span className="text-dim">+{p.platforms.length - 1}</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] font-medium leading-tight">{titleOf(p)}</p>
                    </motion.button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The month, a cell per day. Drag a post to another day to move it there at the same time;
 * click an empty part of a day to write one for it; click the date for its week by the hour.
 */
export function MonthGrid({
  days,
  month,
  posts,
  now,
  selectedId,
  onSelect,
  onCreate,
  onMove,
  onOpenDay,
  drop,
}: {
  days: Date[]
  /** Any day of the month shown: the days around it are dimmed. */
  month: Date
  posts: Post[]
  now: Date
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (at: Date) => void
  onMove: (post: Post, at: Date) => void
  onOpenDay: (day: Date) => void
  /** Something else that can be dropped on a day (the assistant's drafts): its drag type, and what to do with it. */
  drop?: { type: string; onDrop: (at: Date, value: string) => void }
}) {
  const [over, setOver] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [openDay, setOpenDay] = useState<number | null>(null)
  const rows = days.length / 7

  // The "+N more" list closes on a click anywhere outside it, or on Escape.
  useEffect(() => {
    if (openDay === null) return
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-more="${openDay}"]`)) setOpenDay(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpenDay(null)
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [openDay])

  const byDay = days.map((d) =>
    posts
      .filter((p) => p.scheduled_at && sameDay(new Date(p.scheduled_at), d))
      .sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!)),
  )
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(POST_DRAG) || (!!drop && e.dataTransfer.types.includes(drop.type))

  const dropOn = (e: DragEvent, d: Date) => {
    const id = e.dataTransfer.getData(POST_DRAG)
    if (id) {
      const post = posts.find((p) => p.id === Number(id))
      if (!post?.scheduled_at) return
      const from = new Date(post.scheduled_at)
      if (sameDay(from, d)) return
      const at = new Date(d)
      at.setHours(from.getHours(), from.getMinutes(), 0, 0)
      onMove(post, at)
    } else if (drop) {
      drop.onDrop(timeFor(d, now), e.dataTransfer.getData(drop.type))
    }
  }

  return (
    <div className="hidden md:block">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d, i) => (
          <p key={i} className={cn('px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-dim', i > 0 && 'border-l border-line')}>
            {d.toLocaleDateString(undefined, { weekday: 'short' })}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d, di) => {
          const items = byDay[di]
          const today = sameDay(d, now)
          const inMonth = d.getMonth() === month.getMonth()
          const past = addDays(d, 1) <= now
          const slot = timeFor(d, now)
          const open = slot.getTime() > now.getTime()
          const shown = items.length > MONTH_CHIPS ? items.slice(0, MONTH_CHIPS - 1) : items
          const hidden = items.length - shown.length
          const row = Math.floor(di / 7)
          return (
            <div
              key={d.toISOString()}
              className={cn(
                'group relative h-[118px] px-1.5 pb-1.5 pt-1 transition-colors',
                di % 7 > 0 && 'border-l border-line',
                row > 0 && 'border-t border-line',
                !inMonth && 'bg-black/20',
                today && 'bg-white/[0.02]',
                open && 'cursor-pointer hover:bg-white/[0.015]',
                over === di && (past ? 'bg-white/[0.02]' : 'bg-accent/[0.07] shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.12)]'),
              )}
              onClick={(e) => {
                if ((e.target as Element).closest('[data-chip], [data-more], button')) return
                if (open) onCreate(slot)
              }}
              onDragOver={(e) => {
                if (!accepts(e)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (over !== di) setOver(di)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === di ? null : o))
              }}
              onDrop={(e) => {
                if (!accepts(e)) return
                e.preventDefault()
                setOver(null)
                dropOn(e, d)
              }}
            >
              <div className="flex items-center justify-between pl-0.5">
                <button
                  type="button"
                  title="See this week by the hour"
                  onClick={() => onOpenDay(d)}
                  className={cn(
                    'grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[12.5px] font-medium tabular-nums tracking-[-0.01em] transition-colors',
                    today ? 'bg-accent text-on-accent' : inMonth ? 'text-muted hover:bg-white/[0.06] hover:text-fg' : 'text-dim hover:bg-white/[0.06] hover:text-muted',
                  )}
                >
                  {d.getDate() === 1 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.getDate()}
                </button>
                {open && (
                  <span className="flex items-center gap-1 pr-1 font-mono text-[10px] text-accent-soft opacity-0 transition-opacity group-hover:opacity-100">
                    <Plus className="size-3" />
                    {fmtTime(slot)}
                  </span>
                )}
              </div>

              <div className="mt-1 space-y-[3px]">
                {shown.map((p) => (
                  <MonthChip key={p.id} post={p} now={now} selected={selectedId === p.id} dragging={dragging === p.id} onSelect={onSelect} onDrag={setDragging} />
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    data-more={di}
                    onClick={() => setOpenDay(openDay === di ? null : di)}
                    className="flex h-[22px] w-full items-center rounded px-1.5 font-mono text-[10.5px] text-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
                  >
                    +{hidden} more
                  </button>
                )}
              </div>

              <AnimatePresence>
                {openDay === di && (
                  <motion.div
                    data-more={di}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.18, ease }}
                    className={cn(
                      'absolute z-30 w-[260px] rounded-lg border border-line-2 bg-panel-3 p-1.5 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)]',
                      row >= rows / 2 ? 'bottom-0' : 'top-0',
                      di % 7 >= 5 ? 'right-0' : 'left-0',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5 pt-0.5">
                      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">{fmtDay(d)}</p>
                      <button type="button" onClick={() => onOpenDay(d)} className="text-[11.5px] text-accent-soft hover:underline">
                        By the hour
                      </button>
                    </div>
                    <div data-lenis-prevent className="max-h-[240px] space-y-1 overflow-y-auto">
                      {items.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            onSelect(p.id)
                            setOpenDay(null)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md border border-l-2 border-transparent px-2 py-1.5 text-left transition-colors hover:brightness-125',
                            STATE[postState(p, now.getTime())].tone,
                            selectedId === p.id && 'shadow-[0_0_0_1px_rgb(255_255_255_/_0.4)]',
                          )}
                        >
                          <PlatformIcon id={p.platforms[0]} className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-[12px]">{titleOf(p)}</span>
                          <span className="font-mono text-[10px] text-dim">{fmtTime(p.scheduled_at!)}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthChip({
  post,
  now,
  selected,
  dragging,
  onSelect,
  onDrag,
}: {
  post: Post
  now: Date
  selected: boolean
  dragging: boolean
  onSelect: (id: number) => void
  onDrag: (id: number | null) => void
}) {
  const movable = post.status !== 'published'
  return (
    // A div, not a button: Firefox won't start a drag from a button.
    <div
      role="button"
      tabIndex={0}
      data-chip
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.setData(POST_DRAG, String(post.id))
        e.dataTransfer.effectAllowed = 'move'
        onDrag(post.id)
      }}
      onDragEnd={() => onDrag(null)}
      onClick={() => onSelect(post.id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onSelect(post.id)
      }}
      title={`${fmtTime(post.scheduled_at!)} · ${titleOf(post)}`}
      className={cn(
        'flex h-[22px] items-center gap-1.5 rounded border border-l-2 border-transparent px-1.5 transition-[opacity,filter,box-shadow] hover:brightness-125',
        STATE[postState(post, now.getTime())].tone,
        movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        selected && 'shadow-[0_0_0_1px_rgb(255_255_255_/_0.4)]',
        dragging && 'opacity-40',
      )}
    >
      <PlatformIcon id={post.platforms[0]} className="size-3 shrink-0 text-fg" />
      <span className="font-mono text-[10px] text-muted">{fmtTime(post.scheduled_at!)}</span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{titleOf(post)}</span>
    </div>
  )
}

/** Phones get a list per day instead of the grid; for a month, only the days with something on them. */
export function Agenda({
  days,
  month,
  posts,
  now,
  onSelect,
}: {
  days: Date[]
  /** Set in the month view: the days around it, and the empty ones, are left out. */
  month?: Date
  posts: Post[]
  now: Date
  onSelect: (id: number) => void
}) {
  const rows = days
    .map((d) => ({ d, items: posts.filter((p) => p.scheduled_at && sameDay(new Date(p.scheduled_at), d)) }))
    .filter(({ d, items }) => !month || (d.getMonth() === month.getMonth() && items.length > 0))
  if (month && rows.length === 0) return <p className="px-4 py-10 text-center text-[12.5px] text-dim md:hidden">Nothing planned this month.</p>
  return (
    <div className="divide-y divide-line md:hidden">
      {rows.map(({ d, items }) => (
        <div key={d.toISOString()} className="px-4 py-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
            {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
            {sameDay(d, now) && <span className="text-accent-soft"> · today</span>}
          </p>
          <div className="mt-2 space-y-1.5">
            {items.length === 0 && <p className="text-[12px] text-dim">Nothing planned.</p>}
            {items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                className={cn('flex w-full items-center gap-2.5 rounded-md border border-l-2 border-transparent px-2.5 py-2 text-left', STATE[postState(p, now.getTime())].tone)}
              >
                <Platforms ids={p.platforms} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{titleOf(p)}</span>
                <span className="font-mono text-[10px] text-dim">{fmtTime(p.scheduled_at!)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
