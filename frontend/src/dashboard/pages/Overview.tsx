import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, CalendarDays, Check, Clock3, CloudLightning, PenLine, Plus, Workflow } from 'lucide-react'
import { PLATFORMS, PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import type { Post } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { BarList, ColumnChart } from '../charts'
import {
  firstName,
  fmtDay,
  fmtLongDay,
  fmtRelative,
  fmtTime,
  greeting,
  PLATFORM_ORDER,
  sameDay,
  titleOf,
  type Overview as OverviewData,
} from '../data'
import { useOverview, useUser } from '../Shell'
import { Btn, CountUp, EmptyState, PageHeader, Panel, Platforms, Skeleton, Stagger } from '../ui'

export default function Overview() {
  const user = useUser()
  const { data } = useOverview()
  const { navigate } = useRouter()

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title={
          <>
            {greeting()}, <Serif>{firstName(user.name)}.</Serif>
          </>
        }
        sub={fmtLongDay(new Date())}
        actions={
          <>
            <Btn icon={CalendarDays} onClick={() => navigate('/dashboard/calendar')}>
              Calendar
            </Btn>
            <Btn variant="primary" icon={Plus} onClick={() => navigate('/dashboard/create')}>
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

function Board({ overview }: { overview: OverviewData }) {
  const { navigate } = useRouter()
  const edit = (p: Post) => navigate(`/dashboard/create?post=${p.id}`)
  const next = overview.upcoming[0]
  const weekTotal = overview.week.reduce((s, d) => s + d.count, 0)
  const today = new Date()

  const platformRows = PLATFORM_ORDER.filter((id) => overview.platforms[id])
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
    .slice(0, 6)

  return (
    <div className="space-y-4">
      {overview.due > 0 && (
        <Stagger>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3 text-[13px]">
            <AlertTriangle className="size-4 text-warn" strokeWidth={1.75} />
            <p className="text-muted">
              <span className="text-fg">
                {overview.due} {overview.due === 1 ? 'post is' : 'posts are'} past {overview.due === 1 ? 'its' : 'their'} time.
              </span>{' '}
              Publishing to the networks isn’t connected yet, so post {overview.due === 1 ? 'it' : 'them'} yourself and mark{' '}
              {overview.due === 1 ? 'it' : 'them'} published.
            </p>
            <button
              type="button"
              onClick={() => navigate('/dashboard/library?status=scheduled')}
              className="ml-auto flex items-center gap-1.5 font-medium text-warn transition-colors hover:text-fg"
            >
              Review <ArrowRight className="size-3.5" />
            </button>
          </div>
        </Stagger>
      )}

      {overview.automation?.frozen.length > 0 && (
        <Stagger>
          <button
            type="button"
            onClick={() => navigate('/dashboard/comments')}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-fail/30 bg-fail/[0.07] px-4 py-3 text-left text-[13px] transition-colors hover:bg-fail/[0.1]"
          >
            <CloudLightning className="size-4 text-fail" strokeWidth={1.75} />
            <p className="text-muted">
              <span className="text-fg">Storm Guard froze {overview.automation.frozen.map((a) => `@${a.handle}`).join(', ')}.</span> Comments turned negative fast, so nothing
              approved before the storm goes out until you give the all clear.
            </p>
            <span className="ml-auto flex items-center gap-1.5 font-medium text-fail">
              Look <ArrowRight className="size-3.5" />
            </span>
          </button>
        </Stagger>
      )}

      {overview.automation && (overview.automation.flows_on > 0 || overview.automation.waiting_on_you > 0) && (
        <Stagger>
          <button
            type="button"
            onClick={() => navigate(overview.automation.waiting_on_you ? '/dashboard/inbox' : '/dashboard/flows')}
            className="group flex w-full flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-line bg-panel px-4 py-3 text-left text-[12.5px] transition-colors hover:border-line-2"
          >
            <Workflow className="size-4 text-accent-soft" strokeWidth={1.75} />
            <span className="text-muted">
              <span className="text-fg">{overview.automation.flows_on}</span> {overview.automation.flows_on === 1 ? 'flow' : 'flows'} working
            </span>
            <span className="text-muted">
              <span className="text-fg">{overview.automation.runs_today}</span> {overview.automation.runs_today === 1 ? 'run' : 'runs'} today
            </span>
            {overview.automation.waiting_on_you > 0 && (
              <span className="text-[#ff8fa3]">
                {overview.automation.waiting_on_you} {overview.automation.waiting_on_you === 1 ? 'draft wants' : 'drafts want'} your yes
              </span>
            )}
            <ArrowRight className="ml-auto size-3.5 text-dim transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-fg" />
          </button>
        </Stagger>
      )}

      <Stagger i={0}>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
          <Tile label="Drafts" value={overview.counts.draft} foot="Waiting for a time" />
          <Tile
            label="Scheduled"
            value={overview.counts.scheduled}
            foot={next ? `Next ${fmtRelative(next.scheduled_at!)}` : 'Nothing queued'}
          />
          <Tile label="Published" value={overview.counts.published} foot="Marked as posted" />
          <Tile label="This week" value={weekTotal} foot="Planned in the next 7 days" />
        </div>
      </Stagger>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Stagger i={1}>
          <Panel
            title="Up next"
            sub="Your next scheduled posts"
            actions={<LinkButton onClick={() => navigate('/dashboard/calendar')}>Calendar</LinkButton>}
            bodyClassName="p-2 md:p-2.5"
          >
            {overview.upcoming.length === 0 ? (
              <EmptyState
                icon={Clock3}
                title="Nothing scheduled"
                body="Give a draft a time, or drop it into your queue."
                action={
                  <Btn variant="primary" icon={PenLine} onClick={() => navigate('/dashboard/create')}>
                    Write a post
                  </Btn>
                }
                className="py-10"
              />
            ) : (
              <ul>
                {overview.upcoming.map((p, i) => {
                  const at = new Date(p.scheduled_at!)
                  return (
                    <motion.li
                      key={p.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, ease, delay: 0.2 + i * 0.05 }}
                    >
                      <button
                        type="button"
                        onClick={() => edit(p)}
                        className="group flex w-full items-center gap-4 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                      >
                        <span className="w-[68px] shrink-0">
                          <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                            {sameDay(at, today) ? 'Today' : fmtDay(at)}
                          </span>
                          <span className="block text-[17px] font-medium tracking-[-0.02em]">{fmtTime(at)}</span>
                        </span>
                        <span className="h-9 w-px shrink-0 bg-line-2" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] text-fg">{titleOf(p)}</span>
                          <span className="mt-0.5 block truncate text-[12px] text-dim">{p.body}</span>
                        </span>
                        <Platforms ids={p.platforms} className="hidden sm:flex" />
                        <span className="hidden w-24 shrink-0 text-right font-mono text-[10.5px] text-dim md:block">
                          {fmtRelative(p.scheduled_at!)}
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 -translate-x-1 text-dim opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
                      </button>
                    </motion.li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </Stagger>

        <div className="space-y-4">
          <Stagger i={2}>
            <Panel title="Next 7 days" sub={`${weekTotal} ${weekTotal === 1 ? 'post' : 'posts'} planned`}>
              <ColumnChart
                caption="Posts scheduled per day for the next seven days"
                data={overview.week.map((d, i) => {
                  const date = new Date(`${d.date}T00:00`)
                  return {
                    label: i === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' }),
                    full: date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
                    value: d.count,
                    current: i === 0,
                  }
                })}
              />
            </Panel>
          </Stagger>
          <Stagger i={3}>
            <QueueCard nextSlot={overview.next_slot} />
          </Stagger>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Stagger i={4}>
          <Panel
            title="Drafts"
            sub="Pick up where you left off"
            actions={<LinkButton onClick={() => navigate('/dashboard/library?status=draft')}>All drafts</LinkButton>}
          >
            {overview.drafts.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-dim">No drafts. Everything you’ve written has a time.</p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {overview.drafts.map((p, i) => (
                  <motion.button
                    key={p.id}
                    type="button"
                    onClick={() => edit(p)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease, delay: 0.3 + i * 0.05 }}
                    whileHover={{ y: -2 }}
                    className="group flex flex-col rounded-lg border border-line bg-white/[0.015] p-3.5 text-left transition-colors hover:border-line-2"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <Platforms ids={p.platforms} />
                      <span className="font-mono text-[10px] text-dim">edited {fmtRelative(p.updated_at)}</span>
                    </span>
                    <span className="mt-3 line-clamp-1 text-[13.5px] font-medium">{titleOf(p)}</span>
                    <span className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-dim">{p.body}</span>
                  </motion.button>
                ))}
              </div>
            )}
          </Panel>
        </Stagger>
        <Stagger i={5}>
          <Panel title="Where you post" sub="Posts per platform, all time">
            {platformRows.length ? (
              <BarList caption="Posts per platform" rows={platformRows} />
            ) : (
              <p className="py-6 text-center text-[13px] text-dim">No posts yet.</p>
            )}
          </Panel>
        </Stagger>
      </div>
    </div>
  )
}

function Tile({ label, value, foot }: { label: string; value: number; foot: string }) {
  return (
    <div className="bg-panel p-4 md:p-5">
      <p className="text-[12.5px] text-muted">{label}</p>
      <CountUp value={value} className="mt-3 block text-[28px] font-semibold leading-none tracking-[-0.03em] md:text-[32px]" />
      <p className="mt-3 truncate text-[11.5px] text-dim">{foot}</p>
    </div>
  )
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-fg">
      {children}
      <ArrowRight className="size-3 transition-transform duration-300 group-hover:translate-x-0.5" />
    </button>
  )
}

function QueueCard({ nextSlot }: { nextSlot: string | null }) {
  const { navigate } = useRouter()
  return (
    <Panel title="Queue" sub={nextSlot ? 'The next free posting time' : 'Posting times you can fill with one click'}>
      {nextSlot ? (
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{fmtDay(nextSlot)}</p>
            <p className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em]">{fmtTime(nextSlot)}</p>
            <p className="mt-2 text-[11.5px] text-dim">{fmtRelative(nextSlot)}</p>
          </div>
          <Btn size="sm" icon={Workflow} onClick={() => navigate('/dashboard/automations')}>
            Edit times
          </Btn>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-[12.5px] leading-snug text-dim">Pick the times you like to post, and “Add to queue” fills them in order.</p>
          <Btn size="sm" variant="primary" icon={Workflow} onClick={() => navigate('/dashboard/automations')}>
            Set up
          </Btn>
        </div>
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
      to: '/dashboard/create',
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
            <Btn variant="primary" icon={Plus} onClick={() => navigate('/dashboard/create')}>
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

