import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, CircleAlert, LoaderCircle } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useAssistant, type Job } from './store'

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const took = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** Ticks every second while on, for a running clock. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [on])
  return now
}

/** In the conversation, under what was said: what is being made right now, live. */
export function JobsBar() {
  const a = useAssistant()
  const jobs = Object.values(a.jobs)
  return (
    <AnimatePresence initial={false}>
      {jobs.length > 0 && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="shrink-0 overflow-hidden border-t border-line">
          <div data-lenis-prevent className="max-h-64 space-y-2 overflow-y-auto px-4 py-2.5 md:px-5">
            {jobs.map((j) => (
              <JobProgress key={j.id} job={j} compact />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** One job: what it makes, the stage it is at and how far (a bar that fills when the model counts its steps), its
 * clock, and the stages it went through with how long each took. compact: those stages folded until asked for. */
export function JobProgress({ job, compact = false, title }: { job: Job; compact?: boolean; title?: string }) {
  const running = job.status === 'running'
  const failed = job.status === 'failed'
  const done = job.status === 'done'
  const now = useNow(running)
  const [open, setOpen] = useState(!compact)
  const line = failed ? `Couldn’t finish: ${job.text}` : done ? `Done${job.text ? ` · ${job.text}` : ''}` : job.text || 'Starting…'

  return (
    <div className={cn('rounded-lg border px-3 py-2.5', failed ? 'border-fail/30' : done ? 'border-ok/25' : 'border-line')}>
      <div className="flex items-center gap-2 text-[12.5px]">
        {failed ? <CircleAlert className="size-3.5 shrink-0 text-fail" /> : done ? <Check className="size-3.5 shrink-0 text-ok" /> : <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent-soft" />}
        <span className={cn('min-w-0 flex-1 truncate', failed && 'text-fail')}>{title ?? job.label}</span>
        <span className="font-mono text-[10.5px] tabular-nums text-dim">{mmss(now - job.started)}</span>
        {job.log.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Hide the steps' : 'Show the steps'}
            title={open ? 'Hide the steps' : 'Show the steps'}
            className="-my-1 -mr-1 grid size-6 shrink-0 place-items-center rounded text-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
          >
            <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
          </button>
        )}
      </div>
      <p className={cn('mt-1 flex items-baseline gap-2 pl-[22px] text-[11.5px] leading-snug', failed ? 'text-fail/90' : 'text-muted')} aria-live="polite">
        <span className={cn('min-w-0 flex-1', failed ? 'line-clamp-2' : 'truncate')}>{line}</span>
        {running && job.share != null && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-dim">{Math.round(job.share * 100)}%</span>}
      </p>
      {!failed && (
        <div className="ml-[22px]">
          <Bar share={done ? 1 : job.share} />
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && job.log.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
            <ol className="ml-[22px] mt-2.5 space-y-1 border-l border-line pl-3">
              {job.log.map((l, i) => {
                const current = running && i === job.log.length - 1
                const until = job.log[i + 1]?.at ?? (current ? now : null)
                return (
                  <li key={`${i}-${l.text}`} className="relative flex items-baseline gap-2.5 font-mono text-[10.5px] leading-snug">
                    <span aria-hidden className={cn('absolute -left-[15.5px] top-[5px] size-[6px] rounded-full', current ? 'animate-pulse bg-accent-soft' : 'bg-line-2')} />
                    <span className="shrink-0 tabular-nums text-dim">{mmss(l.at - job.started)}</span>
                    <span className={cn('min-w-0 flex-1', current ? 'text-fg' : 'text-muted')}>{l.text}</span>
                    {until != null && <span className="shrink-0 tabular-nums text-dim">{took(until - l.at)}</span>}
                  </li>
                )
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** How much of the stage is done; while that isn't known, a sweep that says it's working. */
function Bar({ share }: { share: number | null }) {
  const still = useReducedMotion()
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
      {share != null ? (
        <motion.div className="h-full rounded-full bg-accent-soft" initial={false} animate={{ width: `${Math.max(3, share * 100)}%` }} transition={{ duration: 0.4, ease }} />
      ) : (
        <motion.div className="h-full w-1/4 rounded-full bg-accent-soft/60" animate={still ? { x: '150%' } : { x: ['-100%', '400%'] }} transition={still ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
      )}
    </div>
  )
}
