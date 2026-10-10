import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { PlatformIcon } from '../components/ui/PlatformIcon'
import { LineReveal, Serif } from '../components/ui/Reveal'
import { GROUP_HUE, groupOf, iconOf, PORT_TONE } from '../dashboard/flows/look'
import { cn } from '../lib/cn'
import { ease } from '../lib/motion'
import { useMediaQuery } from '../lib/useMediaQuery'
import { caseById, MAKE_LABEL, VOICE_LABEL, type Case, type FlowStep, type Voice } from './cases'
import { Clip, monogram, Picture, PostCard } from './pieces'

/*
 * Four rooms, one brief each, played by the scroll: the brief brightens word by word while what
 * FlowAI made from it assembles beside it. On a wide screen each room holds still (sticky) while
 * the page scrolls through it; on a phone, or with reduced motion, each simply shows its end state.
 */

type Hand = { onOpen: (c: Case) => void; onMake: (c: Case) => void }

/**
 * A scroll-linked value, worked out in JS. framer hands plain range transforms of a scroll
 * progress to a native ViewTimeline, and for a range inside 0–1 the browser fills in the missing
 * end keyframe from the base value, so things fade back out once the range is passed.
 */
function useSpan(p: MotionValue<number>, [a, b]: [number, number], [from, to]: [number, number], unit = '') {
  return useTransform(p, (v) => {
    const n = from + (to - from) * Math.min(1, Math.max(0, (v - a) / (b - a)))
    return unit ? `${n}${unit}` : n
  })
}


export function Chapters(hand: Hand) {
  const wide = useMediaQuery('(min-width: 1024px)')
  const reduce = useReducedMotion()
  const pinned = wide && !reduce
  return (
    <div aria-label="Four cases, played through">
      <Adapt c={caseById('ember-fig')!} pinned={pinned} {...hand} />
      <Reel c={caseById('dawn-miles')!} pinned={pinned} {...hand} />
      <Build c={caseById('friday-specials')!} pinned={pinned} {...hand} />
      <Deal c={caseById('clay-to-cup')!} pinned={pinned} {...hand} />
    </div>
  )
}

/** A room: tall enough to scroll through while its stage holds still, tinted by what's in it. */
function Room({ pinned, height, glow, children }: { pinned: boolean; height: string; glow: string; children: (p: MotionValue<number>) => ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const done = useMotionValue(1)
  return (
    <section
      ref={ref}
      className="relative"
      style={{
        height: pinned ? height : undefined,
        background: `radial-gradient(80% 65% at 72% 50%, color-mix(in oklab, ${glow} 55%, transparent), transparent 72%), var(--color-ink)`,
      }}
    >
      <div className={pinned ? 'sticky top-0 flex h-svh items-center overflow-hidden' : 'relative overflow-hidden py-24'}>{children(pinned ? scrollYProgress : done)}</div>
    </section>
  )
}

function Head({ n, c, title }: { n: number; c: Case; title: [string, string] }) {
  return (
    <>
      <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        <span className="text-fg">(0{n}/04)</span>
        <span className="h-px w-8 bg-current opacity-40" />
        <span>
          {c.brand.name} · {c.brand.trade}
        </span>
      </p>
      <LineReveal className="mt-6 text-[clamp(2.6rem,5vw,5.25rem)] font-medium leading-[0.92] tracking-[-0.05em]" lines={[title[0], <Serif>{title[1]}</Serif>]} />
    </>
  )
}

/** The brief, its words lighting up across [from, to] of the room's progress. */
function Brief({ text, p, from = 0.02, to = 0.3, className }: { text: string; p: MotionValue<number>; from?: number; to?: number; className?: string }) {
  const words = text.split(' ')
  return (
    <p className={cn('mt-8 max-w-[34ch] font-serif text-[clamp(1.35rem,1.9vw,1.9rem)] italic leading-[1.22] tracking-[-0.005em]', className)}>
      <span className="text-fg/40">“</span>
      {words.map((w, i) => (
        <Word key={i} p={p} range={[from + ((to - from) * i) / words.length, from + ((to - from) * (i + 1)) / words.length]} last={i === words.length - 1}>
          {w}
        </Word>
      ))}
    </p>
  )
}

/** The last word carries the closing quote, so the mark can never wrap onto a line of its own. */
function Word({ p, range, last, children }: { p: MotionValue<number>; range: [number, number]; last?: boolean; children: string }) {
  const opacity = useSpan(p, range, [0.16, 1])
  return last ? (
    <motion.span style={{ opacity }} className="whitespace-nowrap">
      {children}
      <span className="text-fg/40">”</span>
    </motion.span>
  ) : (
    <motion.span style={{ opacity }}>{children} </motion.span>
  )
}

function Actions({ c, onOpen, onMake }: { c: Case } & Hand) {
  return (
    <div className="mt-10 flex flex-wrap gap-2.5">
      <button
        type="button"
        onClick={() => onMake(c)}
        className="group flex h-11 items-center gap-2 rounded-full bg-fg px-5 text-[14px] font-medium text-ink transition-[background-color,box-shadow] duration-300 hover:bg-white hover:shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-accent)_22%,transparent)]"
      >
        {MAKE_LABEL[c.make.tool]}
        <ArrowRight className="size-4 transition-transform duration-500 ease-expo group-hover:-rotate-45" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onOpen(c)}
        className="flex h-11 items-center gap-2 rounded-full border border-line-2 px-5 text-[14px] text-fg transition-colors hover:border-white/30 hover:bg-white/[0.04]"
      >
        Open the case
        <ArrowUpRight className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}

/** Fades and lifts in over [from, from + 0.08] of the room. */
function Appear({ p, from, children, className }: { p: MotionValue<number>; from: number; children: ReactNode; className?: string }) {
  const opacity = useSpan(p, [from, from + 0.08], [0, 1])
  const y = useSpan(p, [from, from + 0.08], [14, 0])
  return (
    <motion.div style={{ opacity, y }} className={className}>
      {children}
    </motion.div>
  )
}

function VoiceNotes({ voice, p, from }: { voice: Voice; p: MotionValue<number>; from: number }) {
  const keys = (['tone', 'avoid', 'hashtags'] as Array<keyof Voice>).filter((k) => voice[k])
  return (
    <div className="mt-8 max-w-[44ch] space-y-2.5 border-l border-line-2 pl-4">
      <Appear p={p} from={from}>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">Written in the brand’s voice</p>
      </Appear>
      {keys.map((k, i) => (
        <Appear key={k} p={p} from={from + 0.04 * (i + 1)}>
          <p className="text-[13.5px] leading-snug text-muted">
            <span className="mr-2 text-fg">{VOICE_LABEL[k]}</span>
            {voice[k]}
          </p>
        </Appear>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 01 · One brief, three networks                                      */
/* ------------------------------------------------------------------ */

function Adapt({ c, pinned, onOpen, onMake }: { c: Case; pinned: boolean } & Hand) {
  const [ig, x, li] = ['instagram', 'x', 'linkedin'].map((id) => c.versions!.find((v) => v.platform === id)!)
  return (
    <Room pinned={pinned} height="340vh" glow="#6b3a17">
      {(p) => (
        <div className="container-x grid w-full items-center gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Head n={1} c={c} title={['One brief,', 'three networks.']} />
            <Brief text={c.brief} p={p} />
            {c.brand.voice && <VoiceNotes voice={c.brand.voice} p={p} from={0.66} />}
            <Actions c={c} onOpen={onOpen} onMake={onMake} />
          </div>
          {pinned ? (
            <div className="relative h-[82svh] lg:col-span-7">
              <Fanned p={p} range={[0.36, 0.52]} to={{ x: -64, y: -70, rotate: -7 }}>
                <PostCard c={c} version={x} clamp />
              </Fanned>
              <Fanned p={p} range={[0.5, 0.66]} to={{ x: 62, y: 60, rotate: 6 }}>
                <PostCard c={c} version={li} clamp />
              </Fanned>
              <Fanned p={p} range={[0.04, 0.2]} rise to={{ x: 0, y: 0, rotate: -1.5 }} top>
                <PostCard c={c} version={ig} clamp />
              </Fanned>
              <Appear p={p} from={0.2} className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-2">
                {[ig, x, li].map((v, i) => (
                  <Appear key={v.platform} p={p} from={[0.2, 0.5, 0.64][i]}>
                    <span className="flex items-center gap-1.5 rounded-full border border-line-2 bg-black/40 px-3 py-1.5 text-[12px] text-muted backdrop-blur">
                      <PlatformIcon id={v.platform} className="size-3.5" />
                      {v.model}
                    </span>
                  </Appear>
                ))}
              </Appear>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {[ig, x, li].map((v) => (
                <PostCard key={v.platform} c={c} version={v} clamp />
              ))}
            </div>
          )}
        </div>
      )}
    </Room>
  )
}

/** A post card that comes out from behind the stack to its place in the fan. */
function Fanned({
  p,
  range,
  to,
  rise,
  top,
  children,
}: {
  p: MotionValue<number>
  range: [number, number]
  to: { x: number; y: number; rotate: number }
  rise?: boolean
  top?: boolean
  children: ReactNode
}) {
  const x = useSpan(p, range, [0, to.x], '%')
  const y = useSpan(p, range, [rise ? 120 : 0, to.y])
  const rotate = useSpan(p, range, [0, to.rotate])
  const opacity = useSpan(p, [range[0], range[0] + (range[1] - range[0]) * 0.4], [0, 1])
  const scale = useSpan(p, range, [rise ? 0.9 : 0.94, 1])
  return (
    <motion.div style={{ x, y, rotate, opacity, scale }} className={cn('absolute left-1/2 top-1/2 w-[min(330px,30vw)] -translate-x-1/2 -translate-y-1/2', top ? 'z-20' : 'z-10')}>
      {children}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* 02 · One sentence, a sunrise reel                                   */
/* ------------------------------------------------------------------ */

function Reel({ c, pinned, onOpen, onMake }: { c: Case; pinned: boolean } & Hand) {
  const caption = c.versions![0]
  const lines = caption.text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
  return (
    <Room pinned={pinned} height="300vh" glow="#7a5232">
      {(p) => (
        <>
          <Sunrise p={p} />
          <div className="container-x relative grid w-full items-center gap-14 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Head n={2} c={c} title={['One sentence,', 'a sunrise reel.']} />
              <Brief text={c.brief} p={p} />
              <Appear p={p} from={0.32} className="mt-8 max-w-[46ch]">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">Clip prompt</p>
                <p className="mt-2 font-mono text-[12.5px] leading-relaxed text-muted">{c.prompt}</p>
              </Appear>
              <Appear p={p} from={0.4} className="mt-5 flex flex-wrap gap-1.5">
                {[...c.made.map((m) => m.model), '9:16', '5 s'].map((t) => (
                  <span key={t} className="rounded-full border border-line-2 bg-black/30 px-3 py-1 font-mono text-[11px] text-muted">
                    {t}
                  </span>
                ))}
              </Appear>
              <Actions c={c} onOpen={onOpen} onMake={onMake} />
            </div>
            <div className="flex justify-center lg:col-span-7">
              <Phone c={c} p={p} lines={lines} pinned={pinned} />
            </div>
          </div>
        </>
      )}
    </Room>
  )
}

/** A warm light rising behind the stage as the room is scrolled through. */
function Sunrise({ p }: { p: MotionValue<number> }) {
  const y = useSpan(p, [0, 1], [55, -5], '%')
  const opacity = useTransform(p, (v) => (v < 0.5 ? 0.35 + v * 0.9 : 0.8 - (v - 0.5) * 0.4))
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-[62%] top-1/2 size-[80vh] -translate-x-1/2 rounded-full blur-3xl"
      style={{ y, opacity, background: 'radial-gradient(circle, #f6b47a 0%, color-mix(in oklab, #f6b47a 30%, transparent) 40%, transparent 70%)' }}
    />
  )
}

function Phone({ c, p, lines, pinned }: { c: Case; p: MotionValue<number>; lines: string[]; pinned: boolean }) {
  const scale = useSpan(p, [0, 0.25], [0.88, 1])
  const rotate = useSpan(p, [0, 0.25], [-6, 0])
  return (
    <motion.div style={pinned ? { scale, rotate } : undefined} className="relative aspect-[9/16] h-[min(78svh,760px)] max-w-full overflow-hidden rounded-[32px] border border-white/15 shadow-[0_60px_140px_-50px_rgb(0_0_0_/_0.95)] max-lg:h-auto max-lg:w-[min(320px,80vw)]">
      <Clip c={c} size="full" className="size-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/35 to-transparent p-5 pt-24 text-white">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <span className="grid size-7 place-items-center rounded-full bg-white text-[9px] text-black">{monogram(c.brand.name)}</span>@{c.brand.handle}
          <PlatformIcon id={c.versions![0].platform} className="ml-auto size-4 text-white/80" />
        </p>
        <div className="mt-2 space-y-0.5 text-[13px] font-medium leading-snug">
          {lines.map((l, i) => (
            <Appear key={i} p={p} from={0.3 + i * 0.07}>
              <p>{l}</p>
            </Appear>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* 03 · Said once, runs every Friday                                    */
/* ------------------------------------------------------------------ */

/** The sentence, cut where each part of it became a step (the steps' `at`). */
const SAID: Array<[string, number | null]> = [
  ['Every Friday at 4pm', 0],
  [', ', null],
  ['write tonight’s specials post for Instagram', 1],
  [' and ', null],
  ['score how well it fits our voice', 2],
  ['. ', null],
  ['If it scores under 7,', 3],
  [' ', null],
  ['rewrite it.', 4],
  [' Then ', null],
  ['wait for my approval', 5],
  [' and ', null],
  ['post it in the next free slot.', 6],
]
/** Which phrase each step of the composed flow came from. */
const FROM: Record<string, number> = { schedule: 0, write: 1, score: 2, check: 3, rewrite: 4, approve_low: 5, approve_good: 5, post_low: 6, post_good: 6 }

function Build({ c, pinned, onOpen, onMake }: { c: Case; pinned: boolean } & Hand) {
  const [shown, setShown] = useState(pinned ? -1 : 6)
  return (
    <Room pinned={pinned} height="360vh" glow="var(--color-accent)">
      {(p) => (
        <div className="container-x grid w-full items-center gap-14 lg:grid-cols-12">
          <Progress p={p} pinned={pinned} onStep={setShown} />
          <div className="lg:col-span-5">
            <Head n={3} c={c} title={['Said once,', 'runs every Friday.']} />
            <p className="mt-8 max-w-[36ch] font-serif text-[clamp(1.35rem,1.9vw,1.9rem)] italic leading-[1.3] tracking-[-0.005em]">
              <span className="text-fg/40">“</span>
              {SAID.map(([text, at], i) =>
                at === null ? (
                  <span key={i} className="text-fg/35">
                    {text}
                  </span>
                ) : (
                  <span
                    key={i}
                    className={cn(
                      'rounded-[6px] px-0.5 transition-[color,background-color,box-shadow] duration-500',
                      at <= shown ? 'text-fg' : 'text-fg/30',
                      at === shown && 'bg-accent/25 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_25%,transparent)]',
                    )}
                  >
                    {text}
                  </span>
                ),
              )}
              <span className="text-fg/40">”</span>
            </p>
            <p className="mt-6 max-w-[44ch] text-[14px] leading-relaxed text-muted">
              Typed into Flows as one sentence. FlowAI turned each part into a step, and put an approval in front of the post.
            </p>
            <Actions c={c} onOpen={onOpen} onMake={onMake} />
          </div>
          <div className="flex justify-center lg:col-span-7">
            <FlowGrow steps={c.flow!.steps} links={c.flow!.links} shown={shown} />
          </div>
        </div>
      )}
    </Room>
  )
}

/** Turns the room's progress into how many phrases have become steps. */
function Progress({ p, pinned, onStep }: { p: MotionValue<number>; pinned: boolean; onStep: (n: number) => void }) {
  useMotionValueEvent(p, 'change', (v) => pinned && onStep(Math.min(6, Math.floor((v - 0.08) / 0.1))))
  return null
}

const ROW = 72

/** The flow, a step at a time: a node arrives when its phrase lights up, and its line draws in. */
function FlowGrow({ steps, links, shown }: { steps: FlowStep[]; links: NonNullable<Case['flow']>['links']; shown: number }) {
  const rows = Math.max(...steps.map((s) => s.row)) + 1
  const H = rows * ROW
  const LANE = [17, 50, 83]
  const at = (id: string) => steps.find((s) => s.id === id)!
  const pt = (s: FlowStep) => ({ x: LANE[s.lane] * 3, y: s.row * ROW + ROW / 2 })
  return (
    <div className="relative h-[min(80svh,720px)] max-lg:h-auto max-lg:w-full" style={{ aspectRatio: `300 / ${H}` }}>
      <svg viewBox={`0 0 300 ${H}`} className="absolute inset-0 size-full overflow-visible" preserveAspectRatio="none" aria-hidden>
        {links.map((l, i) => {
          const a = pt(at(l.from))
          const b = pt(at(l.to))
          const dy = (b.y - a.y) * 0.5
          const on = FROM[l.to] <= shown
          return (
            <motion.path
              key={i}
              d={`M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`}
              fill="none"
              stroke={PORT_TONE[l.port]}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={{ pathLength: on ? 1 : 0, opacity: on ? 0.7 : 0 }}
              transition={{ duration: 0.7, ease }}
            />
          )
        })}
      </svg>
      {steps.map((s) => {
        const Icon = iconOf(s.type)
        const hue = GROUP_HUE[groupOf(s.type)]
        const on = FROM[s.id] <= shown
        return (
          <motion.div
            key={s.id}
            className="absolute flex w-[33%] items-center gap-1.5 rounded-lg border border-line-2 bg-panel-2 px-1.5 py-1.5 shadow-[0_14px_40px_-14px_rgb(0_0_0_/_0.9)] lg:w-[31%] lg:gap-2 lg:px-2"
            style={{ left: `${LANE[s.lane]}%`, top: `${((s.row * ROW + ROW / 2) / H) * 100}%`, x: '-50%', y: '-50%' }}
            initial={false}
            animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.8, filter: on ? 'blur(0px)' : 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <span className="grid size-5 shrink-0 place-items-center rounded lg:size-6" style={{ background: `color-mix(in oklab, ${hue} 18%, transparent)`, color: hue }}>
              <Icon className="size-3 lg:size-3.5" strokeWidth={2} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[11px] font-medium text-fg lg:text-[12px]">{s.label}</span>
              <span className="block truncate text-[10px] text-dim lg:text-[10.5px]">{s.detail}</span>
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 04 · Clay to cup, in five slides                                    */
/* ------------------------------------------------------------------ */

const STEPS = ['Wedging', 'Throwing', 'Trimming', 'Glazing', 'Fired']

function Deal({ c, pinned, onOpen, onMake }: { c: Case; pinned: boolean } & Hand) {
  const track = useRef<HTMLDivElement>(null)
  const [travel, setTravel] = useState(0)
  useLayoutEffect(() => {
    const el = track.current
    if (!el || !pinned) return
    const measure = () => setTravel(Math.max(0, el.scrollWidth - window.innerWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pinned])

  return (
    <Room pinned={pinned} height="380vh" glow="#6a4a2e">
      {(p) => (
        <div className="w-full">
          <Slide p={p} travel={travel} pinned={pinned} track={track}>
            <div className="flex w-[min(520px,88vw)] shrink-0 flex-col justify-center pl-4 pr-10 md:pl-6 xl:pl-8">
              <Head n={4} c={c} title={['Clay to cup,', 'in five slides.']} />
              <Brief text={c.brief} p={p} from={0.0} to={0.16} />
              <Actions c={c} onOpen={onOpen} onMake={onMake} />
            </div>
            {c.shots!.map((s, i) => (
              <figure key={s.src} className="shrink-0">
                <div className="aspect-square h-[min(64svh,600px)] overflow-hidden rounded-[22px] border border-white/10 shadow-[0_50px_120px_-50px_rgb(0_0_0_/_0.95)] max-lg:h-auto max-lg:w-[78vw]">
                  <Picture shot={s} size="full" className="size-full object-cover" />
                </div>
                <figcaption className="mt-4 flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                  <span className="text-[17px] font-medium tracking-[-0.01em]">{STEPS[i]}</span>
                </figcaption>
              </figure>
            ))}
            <div className="flex w-[min(460px,85vw)] shrink-0 flex-col justify-center pr-8">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">Caption · {c.versions![0].model}</p>
              <p className="mt-3 line-clamp-[12] whitespace-pre-line text-[14px] leading-relaxed text-muted">{c.versions![0].text}</p>
            </div>
          </Slide>
        </div>
      )}
    </Room>
  )
}

function Slide({ p, travel, pinned, track, children }: { p: MotionValue<number>; travel: number; pinned: boolean; track: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const x = useSpan(p, [0.2, 0.95], [0, -travel])
  return (
    <motion.div ref={track} style={pinned ? { x } : undefined} className={cn('flex items-center gap-8 md:gap-10', !pinned && 'no-scrollbar snap-x snap-mandatory overflow-x-auto px-4 [&>*]:snap-start')}>
      {children}
    </motion.div>
  )
}
