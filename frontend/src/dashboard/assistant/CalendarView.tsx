import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AudioWaveform, ChevronLeft, ChevronRight, Clock3, GripVertical, PenLine } from 'lucide-react'
import { PLATFORMS, PlatformIcon } from '../../components/ui/PlatformIcon'
import { api, type Page, type Post } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { addDays, fmtDateTime, postState, sameDay, startOfWeek, STATE, titleOf, useApi, useInvalidate, type PostState } from '../data'
import { Agenda, WeekGrid } from '../pages/Calendar'
import { useToast } from '../toast'
import { Btn, Label, Platforms, StateBadge } from '../ui'
import { useAssistant } from './store'

export const DRAFT_DRAG = 'application/x-assistant-draft'

const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

/**
 * The Calendar tab: the week as FlowAI has it. Drop one of the conversation's drafts on a slot to
 * book it there, drag a post to move it, click an empty slot to plan one with the assistant.
 */
export function CalendarView() {
  const a = useAssistant()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { navigate } = useRouter()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [selectedId, setSelectedId] = useState<number | null>(null)
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
  const drafts = Object.values(a.drafts).sort((x, y) => y.id - x.id)

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const counts = (['draft', 'scheduled', 'due', 'published'] as PostState[]).map((s) => ({ s, n: posts.filter((p) => postState(p, now.getTime()) === s).length }))

  const move = async (post: Post, at: Date) => {
    if (at.getTime() <= Date.now()) return toast('That time has already passed. Drop it somewhere in the future.', 'error')
    const iso = at.toISOString()
    setData((d) => d && { ...d, data: d.data.map((p) => (p.id === post.id ? { ...p, scheduled_at: iso } : p)) })
    try {
      await api(`/posts/${post.id}`, {
        method: 'PUT',
        body: { title: post.title, body: post.body, format: post.format, platforms: post.platforms, status: post.status, scheduled_at: iso },
      })
      toast(`Moved to ${fmtDateTime(iso)}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t move the post.', 'error')
    } finally {
      invalidate()
    }
  }

  const book = (at: Date, value: string) => {
    const d = a.drafts[Number(value)]
    if (!d) return
    if (at.getTime() <= Date.now()) return toast('That time has already passed. Drop it somewhere in the future.', 'error')
    a.schedule(d.id, at)
    toast(`Booking “${d.title || `Draft ${d.id}`}” for ${fmtDateTime(at.toISOString())}…`)
  }

  const plan = (at: Date) => {
    a.setInput(`Make a post for ${fmtDateTime(at.toISOString())} about `)
    a.inputRef.current?.focus()
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
        <p className="text-[15px] font-medium tracking-[-0.01em]">{monthYear(weekStart)}</p>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg">
            <ChevronRight className="size-4" />
          </button>
        </div>
        {!sameDay(weekStart, startOfWeek(now)) && (
          <Btn size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
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

      <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <WeekGrid
            key={weekStart.toISOString()}
            days={days}
            posts={posts}
            ready={!loading && !!data}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreate={plan}
            onMove={move}
            drop={{ type: DRAFT_DRAG, onDrop: book }}
          />
          <Agenda days={days} posts={posts} now={now} onSelect={setSelectedId} />
        </div>

        <aside className="border-t border-line p-4 @3xl:border-l @3xl:border-t-0">
          <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.3, ease }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
                    <Platforms ids={selected.platforms} className="text-fg" />
                    <span className="truncate">{selected.platforms.map((p) => PLATFORMS[p].name).join(', ')}</span>
                  </span>
                  <StateBadge state={postState(selected, now.getTime())} />
                </div>
                <p className="mt-4 text-[16px] font-medium leading-tight tracking-[-0.02em]">{titleOf(selected)}</p>
                {selected.scheduled_at && (
                  <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-dim">
                    <Clock3 className="size-3" />
                    {fmtDateTime(selected.scheduled_at)}
                  </p>
                )}
                <p className="mt-4 line-clamp-6 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg/85">{selected.body}</p>
                <div className="mt-5 grid gap-2">
                  {selected.platforms.some((p) => p === 'instagram' || p === 'x') && (
                    <Btn
                      size="sm"
                      variant="primary"
                      icon={AudioWaveform}
                      disabled={a.conn !== 'online'}
                      onClick={() => {
                        a.action('open_post', { post: selected.id })
                        setSelectedId(null)
                      }}
                    >
                      Open in the assistant
                    </Btn>
                  )}
                  <Btn size="sm" icon={PenLine} onClick={() => navigate(`/dashboard/create?post=${selected.id}`)}>
                    Edit in the Composer
                  </Btn>
                  <Btn size="sm" variant="subtle" onClick={() => setSelectedId(null)}>
                    Back to the drafts
                  </Btn>
                </div>
              </motion.div>
            ) : (
              <motion.div key="drafts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Label>Drafts in this conversation</Label>
                <p className="mt-1 text-[11.5px] leading-snug text-dim">Drag one onto the calendar to book it there.</p>
                <div className="mt-3 space-y-1.5">
                  {drafts.length === 0 && <p className="rounded-md border border-dashed border-line-2 px-3 py-4 text-center text-[12px] text-dim">Ask for a post, then drag it here.</p>}
                  {drafts.map((d) => {
                    const saved = a.saved[d.id]
                    return (
                      <div
                        key={d.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAFT_DRAG, String(d.id))
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        className="flex cursor-grab items-center gap-2.5 rounded-lg border border-line p-1.5 pr-2.5 transition-colors hover:border-line-2 active:cursor-grabbing"
                      >
                        <GripVertical className="size-3.5 shrink-0 text-dim" />
                        <span className="relative size-9 shrink-0 overflow-hidden rounded-md bg-white/[0.05]">
                          {d.slides[0]?.kind === 'image' && <img src={d.slides[0].url} alt="" draggable={false} className="size-full object-cover" />}
                          <PlatformIcon id={d.platform} className="absolute bottom-0.5 right-0.5 size-2.5 text-white drop-shadow" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{d.title || `Draft ${d.id}`}</span>
                          <span className="block truncate font-mono text-[10px] text-dim">
                            {d.label}
                            {saved ? ` · ${saved.status}${saved.when ? ` ${saved.when}` : ''}` : ' · not saved'}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>
    </section>
  )
}
