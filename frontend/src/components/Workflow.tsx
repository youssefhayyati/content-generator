import { useCallback, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { motion, useMotionValue, useMotionValueEvent, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, Check, Clock3, LoaderCircle } from 'lucide-react'
import { cn } from '../lib/cn'
import { useMediaQuery } from '../lib/useMediaQuery'
import { Caret, Field } from './mock/Mock'
import { GenArt } from './ui/GenArt'
import { Plate } from './ui/Plate'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

type StepUI = ComponentType<{ on: boolean }>

const STEPS: Array<{ title: string; body: string; ui: StepUI }> = [
  { title: 'Idea', body: 'Enter your idea or prompt.', ui: StepIdea },
  { title: 'Generate', body: 'AI creates text, images or video.', ui: StepGenerate },
  { title: 'Customize', body: 'Review and edit the generated content.', ui: StepCustomize },
  { title: 'Choose Platforms', body: 'Select where the content should go.', ui: StepPlatforms },
  { title: 'Schedule', body: 'Choose when it should be published.', ui: StepSchedule },
  { title: 'Publish', body: 'Automation publishes it for you.', ui: StepPublish },
]

export function Workflow() {
  const wide = useMediaQuery('(min-width: 1024px)')
  return wide ? <PinnedWorkflow /> : <StackedWorkflow />
}

function Heading({ thread }: { thread: boolean }) {
  return (
    <>
      <SectionLabel index="05" thread={thread} signal>
        Workflow
      </SectionLabel>
      <LineReveal
        className="mt-10 text-[clamp(2.8rem,5.6vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.055em]"
        lines={['Build once.', 'Let automation', <Serif>do the rest.</Serif>]}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Desktop: vertical scroll drives a horizontal track                   */
/* ------------------------------------------------------------------ */

function PinnedWorkflow() {
  const sectionRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const stepsRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLDivElement | null>>([])
  const metrics = useRef({ dist: 0, lineStart: 0, lineWidth: 1, nodes: [] as number[] })

  const [dist, setDist] = useState(0)
  const [active, setActive] = useState(0)
  const x = useMotionValue(0)
  const fill = useMotionValue(0)

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })

  // Written by hand rather than with useTransform: the ranges come from layout
  // measurements, and they change whenever the window does.
  const update = useCallback(
    (p: number) => {
      const m = metrics.current
      const nx = -p * m.dist
      x.set(nx)
      const readLine = window.innerWidth * 0.58 - nx
      fill.set(Math.min(1, Math.max(0, (readLine - m.lineStart) / m.lineWidth)))
      setActive(m.nodes.filter((n) => n <= readLine).length)
    },
    [x, fill],
  )

  useLayoutEffect(() => {
    const measure = () => {
      const track = trackRef.current
      const steps = stepsRef.current
      if (!track || !steps) return
      const d = Math.max(0, track.scrollWidth - window.innerWidth)
      metrics.current = {
        dist: d,
        lineStart: steps.offsetLeft,
        lineWidth: steps.offsetWidth,
        nodes: cardRefs.current.map((c) => (c ? steps.offsetLeft + c.offsetLeft + 8 : Infinity)),
      }
      setDist(d)
      update(scrollYProgress.get())
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (trackRef.current) ro.observe(trackRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [scrollYProgress, update])

  useMotionValueEvent(scrollYProgress, 'change', update)

  const barScale = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <section
      id="workflow"
      ref={sectionRef}
      data-thread="rail"
      data-side="left"
      data-thread-surface="signal"
      className="relative isolate text-on-accent"
      style={{ height: `calc(100vh + ${dist}px)` }}
    >
      <Plate target={sectionRef} className="bg-accent" surface="signal" />
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
        <motion.div
          ref={trackRef}
          style={{ x }}
          className="relative flex w-max items-stretch gap-[7vw] pl-[max(3rem,calc((100vw-1440px)/2+3rem))] pr-[12vw]"
        >
          <div className="flex w-[40vw] max-w-[620px] shrink-0 flex-col justify-between py-2">
            <div>
              <Heading thread={false} />
            </div>
            <Reveal delay={0.2} className="flex items-end justify-between gap-6">
              <p className="max-w-[30ch] text-[17px] leading-snug text-on-accent/75">
                Six steps you’d normally do by hand. Set them up once — then they run on their own.
              </p>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-on-accent/60">
                Scroll <ArrowRight className="size-3.5" />
              </span>
            </Reveal>
          </div>

          <div ref={stepsRef} className="relative flex gap-5">
            <div className="absolute inset-x-0 top-[7px] h-px bg-on-accent/25" />
            <motion.div
              className="absolute inset-x-0 top-[7px] h-px origin-left bg-on-accent"
              style={{ scaleX: fill }}
            />
            {STEPS.map((s, i) => (
              <div key={s.title} ref={(el) => void (cardRefs.current[i] = el)}>
                <StepCard index={i} step={s} on={i < active} />
              </div>
            ))}
          </div>
        </motion.div>

        <div className="container-x absolute inset-x-0 bottom-8 flex items-center gap-6 font-mono text-[11px] text-on-accent/65">
          <span className="tabular-nums text-on-accent">
            {String(Math.max(1, active)).padStart(2, '0')} <span className="text-on-accent/65">/ 06</span>
          </span>
          <div className="h-px flex-1 bg-on-accent/20">
            <motion.div className="h-px origin-left bg-on-accent" style={{ scaleX: barScale }} />
          </div>
          <span className="uppercase tracking-[0.16em]">{STEPS[Math.max(0, active - 1)].title}</span>
        </div>
      </div>
    </section>
  )
}

function StepCard({ index, step, on }: { index: number; step: (typeof STEPS)[number]; on: boolean }) {
  const UI = step.ui
  return (
    <div className="relative w-[min(26rem,34vw)] shrink-0 pt-12">
      <span
        className={cn(
          'absolute left-0 top-0 grid size-[15px] place-items-center rounded-full border transition-colors duration-500',
          on ? 'border-on-accent bg-on-accent' : 'border-on-accent/40 bg-accent',
        )}
      >
        <span className={cn('size-[5px] rounded-full transition-colors duration-500', on ? 'bg-accent' : 'bg-on-accent/40')} />
      </span>
      <div
        className={cn(
          'flex h-[min(430px,56vh)] flex-col rounded-xl border border-white/10 bg-ink-2 p-6 text-fg shadow-[0_40px_80px_-30px_rgb(0_0_0_/_0.55)] transition-[opacity,translate] duration-700 ease-expo',
          on ? 'opacity-100' : 'translate-y-3 opacity-60',
        )}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Step {String(index + 1).padStart(2, '0')}</p>
        <h3 className="mt-3 text-[32px] font-medium leading-none tracking-[-0.04em]">{step.title}</h3>
        <p className="mt-2 text-[14.5px] text-muted">{step.body}</p>
        <div className="mt-auto">
          <UI on={on} />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mobile / tablet: a plain vertical timeline                           */
/* ------------------------------------------------------------------ */

function StackedWorkflow() {
  const sectionRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: listRef, offset: ['start 0.7', 'end 0.7'] })

  return (
    <section
      id="workflow"
      ref={sectionRef}
      data-thread-surface="signal"
      className="relative isolate py-28 text-on-accent md:py-36"
    >
      <Plate target={sectionRef} className="bg-accent" surface="signal" />
      <div className="container-x">
        <Heading thread />
        <div ref={listRef} data-thread="rail" data-side-sm="right" className="relative mt-16 pl-8">
          <div aria-hidden className="absolute bottom-0 left-[7px] top-0 w-px bg-on-accent/25" />
          <motion.div
            aria-hidden
            className="absolute bottom-0 left-[7px] top-0 w-px origin-top bg-on-accent"
            style={{ scaleY: scrollYProgress }}
          />
          <ol className="space-y-6">
          {STEPS.map((s, i) => {
            const UI = s.ui
            return (
              <Reveal as="li" key={s.title} className="relative">
                <span className="absolute -left-8 top-6 grid size-[15px] place-items-center rounded-full border border-on-accent bg-on-accent">
                  <span className="size-[5px] rounded-full bg-accent" />
                </span>
                <div className="rounded-xl border border-white/10 bg-ink-2 p-6 text-fg shadow-[0_30px_60px_-30px_rgb(0_0_0_/_0.55)]">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Step {String(i + 1).padStart(2, '0')}</p>
                  <h3 className="mt-3 text-3xl font-medium tracking-[-0.04em]">{s.title}</h3>
                  <p className="mt-2 text-[15px] text-muted">{s.body}</p>
                  <div className="mt-6">
                    <UI on />
                  </div>
                </div>
              </Reveal>
            )
          })}
          </ol>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Step illustrations                                                   */
/* ------------------------------------------------------------------ */

function StepIdea({ on }: { on: boolean }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line-2 bg-white/[0.03] p-3.5 text-[13px] leading-snug">
        Launch post for Tempo, our AI planner. Friendly, a bit bold.
        {on && <Caret />}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11.5px] text-muted">
        {['Launch', 'Behind the scenes', 'Tips thread'].map((t) => (
          <span key={t} className="rounded-full border border-line px-2.5 py-1">
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

function StepGenerate({ on }: { on: boolean }) {
  const rows = [
    { label: 'Post copy', meta: '3 variations' },
    { label: 'Image', meta: '4:5 · 2 options', art: 'orb' as const },
    { label: 'Video', meta: '9:16 · 0:15', art: 'sun' as const },
  ]
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.label} className="flex items-center gap-3 rounded-lg border border-line p-2.5 text-[13px]">
          {r.art ? (
            <GenArt variant={r.art} className="size-9 rounded-md" />
          ) : (
            <span className="grid size-9 place-items-center rounded-md bg-white/5 font-serif text-lg italic">Aa</span>
          )}
          <div>
            <p>{r.label}</p>
            <p className="font-mono text-[10.5px] text-dim">{r.meta}</p>
          </div>
          <span className="ml-auto">
            {on ? (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25, delay: i * 0.15 }}
                className="grid size-5 place-items-center rounded-full bg-fg text-ink"
              >
                <Check className="size-3" strokeWidth={3} />
              </motion.span>
            ) : (
              <LoaderCircle className="size-4 animate-spin text-dim" />
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function StepCustomize({ on }: { on: boolean }) {
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-line bg-white/[0.02] p-3.5 text-[13px] leading-relaxed text-fg/90">
        Meet Tempo — the planner that{' '}
        <span className={cn('transition-all duration-700', on ? 'text-dim line-through' : '')}>leverages AI to optimize</span>{' '}
        <motion.span
          className="rounded bg-accent/20 px-0.5 text-accent-soft"
          initial={false}
          animate={{ opacity: on ? 1 : 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          reads your notes and plans
        </motion.span>{' '}
        your day.
      </p>
      <div className="flex gap-1.5 text-[11.5px]">
        {['Shorter', 'Warmer', 'Add a hook'].map((t, i) => (
          <span
            key={t}
            className={cn('rounded-md border px-2.5 py-1', i === 1 && on ? 'border-white/30 text-fg' : 'border-line text-muted')}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

const PICKS: Array<{ id: PlatformId; picked: boolean }> = [
  { id: 'linkedin', picked: true },
  { id: 'instagram', picked: true },
  { id: 'x', picked: true },
  { id: 'tiktok', picked: false },
  { id: 'facebook', picked: false },
  { id: 'youtube', picked: false },
]

function StepPlatforms({ on }: { on: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PICKS.map((p, i) => {
        const sel = on && p.picked
        return (
          <div
            key={p.id}
            className={cn(
              'relative flex flex-col items-start gap-3 rounded-lg border p-2.5 transition-colors duration-500',
              sel ? 'border-white/30 bg-white/[0.05]' : 'border-line',
            )}
            style={{ transitionDelay: `${i * 90}ms` }}
          >
            <PlatformIcon id={p.id} className={cn('size-4', sel ? 'text-fg' : 'text-dim')} />
            <span className={cn('text-[11px]', sel ? 'text-fg' : 'text-dim')}>{PLATFORMS[p.id].name}</span>
            {sel && (
              <span className="absolute right-2 top-2 grid size-3.5 place-items-center rounded-full bg-accent">
                <Check className="size-2.5 text-white" strokeWidth={3} />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepSchedule({ on }: { on: boolean }) {
  // October 2026 starts on a Thursday.
  const offset = 3
  const days = Array.from({ length: 31 }, (_, i) => i + 1)
  return (
    <div>
      <div className="flex items-center justify-between">
        <Field>October 2026</Field>
        <span className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 font-mono text-[10.5px] text-muted">
          <Clock3 className="size-3" /> 09:30
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-7 gap-1 text-center font-mono text-[10.5px]">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="pb-1 text-dim">
            {d}
          </span>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <span key={`e${i}`} />
        ))}
        {days.map((d) => (
          <span
            key={d}
            className={cn(
              'grid h-6 place-items-center rounded transition-colors duration-500',
              d === 6 && on ? 'bg-fg text-ink' : [7, 8, 9].includes(d) && on ? 'bg-white/10 text-fg' : 'text-muted',
            )}
          >
            {d}
          </span>
        ))}
      </div>
    </div>
  )
}

function StepPublish({ on }: { on: boolean }) {
  return (
    <ul className="space-y-2">
      {(['linkedin', 'instagram', 'x'] as const).map((id, i) => (
        <li key={id} className="flex items-center gap-3 rounded-lg border border-line p-3 text-[13px]">
          <PlatformIcon id={id} className="size-4" />
          {PLATFORMS[id].name}
          <span
            className={cn(
              'ml-auto flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors duration-500',
              on ? 'border-ok/30 text-ok' : 'border-line text-dim',
            )}
            style={{ transitionDelay: `${i * 200}ms` }}
          >
            <span className={cn('size-1.5 rounded-full', on ? 'bg-ok' : 'bg-draft')} />
            {on ? 'Published' : 'Queued'}
          </span>
        </li>
      ))}
    </ul>
  )
}
