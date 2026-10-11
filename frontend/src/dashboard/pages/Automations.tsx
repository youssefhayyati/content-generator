import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, ListPlus, PenLine, Plus, Sparkles, X } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, type User } from '../../lib/api'
import { browserTimezone } from '../../lib/auth'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useSession } from '../../lib/session'
import { fmtDay, fmtRelative, fmtTime, useApi, useInvalidate, WEEKDAYS, type QueueState } from '../data'
import { NEW_POST } from '../nav'
import { useToast } from '../toast'
import { Btn, inputClass, Menu, PageHeader, Panel, Platforms, Skeleton, Stagger, TimeInput } from '../ui'

type Slot = { weekday: number; time: string }

const key = (s: Slot) => `${s.weekday}@${s.time}`
const sortSlots = (list: Slot[]) => [...list].sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time))
const sameSchedule = (a: Slot[], b: Slot[]) => sortSlots(a).map(key).join() === sortSlots(b).map(key).join()

const weekdays = (time: string) => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, time }))
const PRESETS: Array<{ label: string; slots: Slot[] }> = [
  { label: 'Weekdays at 09:30', slots: weekdays('09:30') },
  { label: 'Mon, Wed, Fri at 12:00', slots: [1, 3, 5].map((weekday) => ({ weekday, time: '12:00' })) },
  { label: 'Weekdays, morning and evening', slots: [...weekdays('09:00'), ...weekdays('17:30')] },
  { label: 'Every day at 18:00', slots: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, time: '18:00' })) },
]

export default function Automations() {
  const { user, setUser } = useSession()
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data } = useApi<QueueState>('/queue-slots')
  const [edited, setEdited] = useState<Slot[] | null>(null)
  const [saving, setSaving] = useState(false)

  const saved: Slot[] = data?.slots.map(({ weekday, time }) => ({ weekday, time })) ?? []
  const slots = edited ?? saved
  const dirty = edited !== null && !sameSchedule(edited, saved)

  const change = (next: Slot[]) => setEdited(sortSlots(next))
  const add = (slot: Slot) => !slots.some((s) => key(s) === key(slot)) && change([...slots, slot])
  const remove = (slot: Slot) => change(slots.filter((s) => key(s) !== key(slot)))

  const save = async () => {
    setSaving(true)
    try {
      await api<QueueState>('/queue-slots', { method: 'PUT', body: { slots } })
      setEdited(null)
      invalidate()
      toast(slots.length ? 'Posting times saved.' : 'Queue cleared.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save the schedule.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const tz = data?.timezone ?? user?.timezone ?? 'UTC'
  const browserTz = browserTimezone()

  const switchToBrowserTz = async () => {
    try {
      setUser(await api<User>('/user', { method: 'PATCH', body: { timezone: browserTz } }))
      invalidate()
      toast(`Queue times now follow ${browserTz}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t change the timezone.', 'error')
    }
  }

  return (
    <div className="pb-16">
      <PageHeader
        title={
          <>
            Posting <Serif>queue.</Serif>
          </>
        }
        sub="Pick the times you like to publish. “Add to queue” drops each post into the next free one, in order."
        actions={
          <Btn variant="primary" icon={PenLine} onClick={() => navigate(NEW_POST)}>
            Write a post
          </Btn>
        }
      />

      <div className="mt-10 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Stagger i={0}>
          <Panel
            title="Weekly schedule"
            sub={
              <>
                Times are in {tz}.
                {tz !== browserTz && (
                  <>
                    {' '}
                    Your browser is in {browserTz}.{' '}
                    <button type="button" onClick={switchToBrowserTz} className="text-accent-soft hover:underline">
                      Use that instead
                    </button>
                  </>
                )}
              </>
            }
            actions={
              <Menu
                items={[
                  ...PRESETS.map((p) => ({ label: p.label, icon: Sparkles, onSelect: () => change(p.slots) })),
                  { label: 'Clear every time', icon: X, danger: true, onSelect: () => change([]) },
                ]}
                trigger={({ toggle }) => (
                  <Btn size="sm" icon={Sparkles} onClick={toggle}>
                    Presets
                  </Btn>
                )}
              />
            }
            bodyClassName="p-0 md:p-0 mt-3"
          >
            {!data ? (
              <div className="space-y-px p-5">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {WEEKDAYS.map((name, i) => (
                  <DayRow
                    key={name}
                    name={name}
                    times={slots.filter((s) => s.weekday === i + 1).map((s) => s.time)}
                    onAdd={(time) => add({ weekday: i + 1, time })}
                    onRemove={(time) => remove({ weekday: i + 1, time })}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </Stagger>

        <div className="space-y-4">
          <Stagger i={1}>
            <Panel title="Next up" sub={dirty ? 'Save to see your new times here.' : 'The next posting times, and what fills them'}>
              {!data ? (
                <Skeleton className="h-48" />
              ) : data.upcoming.length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-dim">Add a posting time and it shows up here.</p>
              ) : (
                <ol className={cn('transition-opacity duration-300', dirty && 'opacity-50')}>
                  {data.upcoming.map((u, i) => (
                    <li key={u.at}>
                      {i > 0 && (
                        <div className="relative ml-[18px] h-3 w-px bg-line-2">
                          <motion.div
                            className="absolute inset-0 origin-top bg-accent-soft"
                            initial={{ scaleY: 0 }}
                            animate={{ scaleY: u.post || data.upcoming[i - 1].post ? 1 : 0 }}
                            transition={{ duration: 0.4, ease, delay: 0.3 + i * 0.06 }}
                          />
                        </div>
                      )}
                      <motion.div
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.5, ease, delay: 0.15 + i * 0.06 }}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                          u.post ? 'border-line-2 bg-card' : 'border-dashed border-white/10',
                        )}
                      >
                        <span className={cn('grid size-[22px] shrink-0 place-items-center rounded-full', u.post ? 'bg-accent text-on-accent' : 'border border-line-2 text-dim')}>
                          <CalendarClock className="size-3" strokeWidth={2} />
                        </span>
                        <span className="w-[86px] shrink-0">
                          <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{fmtDay(u.at)}</span>
                          <span className="block text-[13.5px] font-medium">{fmtTime(u.at)}</span>
                        </span>
                        {u.post ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/dashboard/create?post=${u.post!.id}`)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-[12.5px] text-fg hover:underline">{u.post.title}</span>
                            <Platforms ids={u.post.platforms} className="mt-1" />
                          </button>
                        ) : (
                          <span className="flex-1 text-[12px] text-dim">Free · {fmtRelative(u.at)}</span>
                        )}
                      </motion.div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </Stagger>

          <Stagger i={2}>
            <Panel title="How the queue works">
              <ol className="space-y-3 text-[12.5px]">
                {[
                  { icon: PenLine, text: 'Write a post and choose “Add to queue”.' },
                  { icon: ListPlus, text: 'It takes the next time above that nothing else has.' },
                  { icon: CalendarClock, text: 'It lands on your calendar, ready to move if plans change.' },
                ].map(({ icon: Icon, text }, i) => (
                  <motion.li
                    key={text}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease, delay: 0.4 + i * 0.08 }}
                    className="flex items-start gap-3 text-muted"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.05] text-fg">
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="pt-1">{text}</span>
                  </motion.li>
                ))}
              </ol>
            </Panel>
          </Stagger>
        </div>
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div
            className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 lg:pl-[var(--sidebar-w)]"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.45, ease }}
          >
            <div className="flex items-center gap-3 rounded-xl border border-line-2 bg-panel-3 py-2 pl-4 pr-2 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)]">
              <span className="size-1.5 animate-pulse rounded-full bg-warn" />
              <p className="text-[12.5px] text-muted">Unsaved changes</p>
              <Btn size="sm" variant="subtle" onClick={() => setEdited(null)}>
                Discard
              </Btn>
              <Btn size="sm" variant="primary" loading={saving} onClick={save}>
                Save schedule
              </Btn>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DayRow({
  name,
  times,
  onAdd,
  onRemove,
}: {
  name: string
  times: string[]
  onAdd: (time: string) => void
  onRemove: (time: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('09:00')

  const commit = () => {
    if (/^\d{2}:\d{2}$/.test(value)) onAdd(value)
    setAdding(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <span className="w-24 shrink-0 text-[13px]">{name}</span>
      <div className="flex min-h-8 flex-1 flex-wrap items-center gap-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {times.map((t) => (
            <motion.span
              key={t}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.25, ease }}
              className="group flex h-8 items-center gap-1 rounded-md border border-line-2 bg-white/[0.03] pl-2.5 pr-1 font-mono text-[12px]"
            >
              {t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                aria-label={`Remove ${t} on ${name}`}
                className="grid size-5 place-items-center rounded text-dim transition-colors hover:bg-white/[0.08] hover:text-fg"
              >
                <X className="size-3" />
              </button>
            </motion.span>
          ))}
          {times.length === 0 && !adding && (
            <motion.span key="none" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[12px] text-dim">
              No posting times
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {adding ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            commit()
          }}
        >
          <TimeInput value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label={`New time on ${name}`} className={cn(inputClass, 'h-8 w-[104px]')} />
          <Btn size="sm" variant="primary" type="submit">
            Add
          </Btn>
          <Btn size="sm" variant="subtle" onClick={() => setAdding(false)}>
            Cancel
          </Btn>
        </form>
      ) : (
        <Btn size="sm" variant="subtle" icon={Plus} onClick={() => setAdding(true)}>
          Add time
        </Btn>
      )}
    </li>
  )
}
