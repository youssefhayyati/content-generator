import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, Clock3, Copy, MousePointerClick, PenLine, Plus, Trash2, Undo2 } from 'lucide-react'
import { PLATFORMS, PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, type Page, type Post } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import {
  addDays,
  fmtDateTime,
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
import { useToast } from '../toast'
import { Btn, Label, Modal, PageHeader, Platforms, StateBadge, Stagger } from '../ui'

const HOUR = 52
/** How much of an hour a post's block covers, in minutes. Posts are moments, not meetings. */
const BLOCK_MIN = 50
const SNAP_MIN = 15

const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const range = (a: Date, b: Date) =>
  `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

/** Side-by-side columns for posts whose blocks would overlap. */
function lanes(posts: Post[]) {
  const sorted = [...posts].sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!))
  const out = new Map<number, { lane: number; lanes: number }>()
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
    for (const [p, lane] of assigned) out.set(p.id, { lane, lanes: ends.length })
    cluster = []
  }

  for (const p of sorted) {
    const start = minutesOf(new Date(p.scheduled_at!))
    if (cluster.length && start >= clusterEnd) flush()
    cluster.push(p)
    clusterEnd = Math.max(clusterEnd, start + BLOCK_MIN)
  }
  if (cluster.length) flush()
  return out
}

export default function Calendar() {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [dir, setDir] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<Post | null>(null)
  const [now, setNow] = useState(() => new Date())

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const { data, loading, setData } = useApi<Page<Post>>('/posts', {
    from: weekStart.toISOString(),
    to: addDays(weekStart, 7).toISOString(),
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

  const shift = (weeks: number) => {
    setDir(weeks)
    setSelectedId(null)
    setWeekStart((w) => (weeks === 0 ? startOfWeek(new Date()) : addDays(w, weeks * 7)))
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

  const weekEnd = addDays(weekStart, 6)
  const isThisWeek = sameDay(weekStart, startOfWeek(now))

  return (
    <div>
      <PageHeader
        eyebrow="Calendar"
        title={
          <>
            See everything. <Serif>Plan ahead.</Serif>
          </>
        }
        sub="Drag a post to move it. Click an empty slot to write one for that time."
        actions={
          <Btn variant="primary" icon={Plus} onClick={() => navigate('/dashboard/create')}>
            New post
          </Btn>
        }
      />

      <Stagger i={0} className="mt-10">
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={monthYear(weekStart)}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.3, ease }}
                className="text-[15px] font-medium tracking-[-0.01em]"
              >
                {monthYear(weekStart)}
              </motion.p>
            </AnimatePresence>
            <span className="font-mono text-[11px] text-dim">{range(weekStart, weekEnd)}</span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous week" onClick={() => shift(-1)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" aria-label="Next week" onClick={() => shift(1)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg">
                <ChevronRight className="size-4" />
              </button>
            </div>
            {!isThisWeek && (
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
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div
                key={weekStart.toISOString()}
                custom={dir}
                initial={{ opacity: 0, x: dir * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -40 }}
                transition={{ duration: 0.35, ease }}
                className="min-w-0"
              >
                <WeekGrid
                  days={days}
                  posts={posts}
                  ready={!loading && !!data}
                  now={now}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onCreate={(at) => navigate(`/dashboard/create?at=${encodeURIComponent(at.toISOString())}`)}
                  onMove={reschedule}
                />
                <Agenda days={days} posts={posts} now={now} onSelect={setSelectedId} />
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
                        Its time has passed. Publishing to the networks isn’t connected yet, so post it yourself and mark it published.
                      </p>
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
  const firstColumn = useRef<HTMLDivElement>(null)
  const [colWidth, setColWidth] = useState(120)
  const [ghost, setGhost] = useState<{ day: number; minutes: number } | null>(null)
  const dragged = useRef(false)

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
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line">
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

                {byDay[di].map((p, pi) => {
                  const at = new Date(p.scheduled_at!)
                  const state = postState(p, now.getTime())
                  const lane = layouts[di].get(p.id) ?? { lane: 0, lanes: 1 }
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

/** Phones get a list per day instead of the grid. */
export function Agenda({ days, posts, now, onSelect }: { days: Date[]; posts: Post[]; now: Date; onSelect: (id: number) => void }) {
  return (
    <div className="divide-y divide-line md:hidden">
      {days.map((d) => {
        const items = posts.filter((p) => p.scheduled_at && sameDay(new Date(p.scheduled_at), d))
        return (
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
        )
      })}
    </div>
  )
}
