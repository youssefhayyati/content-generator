import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, Captions, Check, Mic, Music2, PenLine, Snowflake, UserCheck } from 'lucide-react'
import { PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { cn } from '../../lib/cn'
import { ease } from '../../lib/motion'
import { Flap } from '../live/Flap'

/*
 * The welcome's showreel: six short scenes of what FlowAI actually does, played for a demo brand
 * (Maison Cire, the candle studio the rest of the product uses for examples). Each scene is a few
 * seconds of the real feature's shape, built from the studio's own pieces: the flow current, the
 * split-flap board, the reel gradient.
 */

export const SCENE_MS = 4200

export const SCENES = [
  { id: 'adapt', verb: 'Writes', title: 'One brief, every platform', caption: 'Each network gets its own version, inside its limits.' },
  { id: 'picture', verb: 'Designs', title: 'Pictures from a sentence', caption: 'Photography and graphics from a prompt, on your brand.' },
  { id: 'reel', verb: 'Films', title: 'Reels with a voice and a score', caption: 'A script read aloud, an original track, captions burned in.' },
  { id: 'flow', verb: 'Automates', title: 'Flows that run on their own', caption: 'Recipes that write, wait and ask you, on a schedule.' },
  { id: 'publish', verb: 'Publishes', title: 'Phones that post, with proof', caption: 'Every post confirmed live, or honestly flagged.' },
  { id: 'storm', verb: 'Listens', title: 'Storm Guard keeps watch', caption: 'When comments turn, publishing freezes on its own.' },
] as const

/** Text that types itself in over `ms`, starting after `delay`. */
function useTypewriter(text: string, ms: number, delay = 0) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let i = 0
    let timer = 0
    const start = window.setTimeout(function tick() {
      i++
      setN(i)
      if (i < text.length) timer = window.setTimeout(tick, ms / text.length)
    }, delay)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(timer)
    }
  }, [text, ms, delay])
  return text.slice(0, n)
}

const Caret = () => <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-blink bg-accent" />

const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('rounded-xl border border-line-2 bg-panel-2', className)}>{children}</div>
)

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn('font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim', className)}>{children}</p>
)

/* ------------------------------------------------------------------ */
/* 01 — One brief, every platform                                       */
/* ------------------------------------------------------------------ */

const VERSIONS: Array<{ id: PlatformId; name: string; text: string; used: number; limit: number }> = [
  { id: 'instagram', name: 'Instagram', text: 'Autumn is here, and so is our new collection. Four scents, slow-poured in small batches for long evenings. #MaisonCire', used: 1204, limit: 2200 },
  { id: 'x', name: 'X', text: 'Autumn collection, out now. Four new scents, poured slow in Lyon.', used: 241, limit: 280 },
  { id: 'linkedin', name: 'LinkedIn', text: 'We’ve launched our autumn collection: four scents, each poured by hand in our Lyon studio.', used: 612, limit: 3000 },
]

function Adapt() {
  const brief = useTypewriter('Announce the autumn collection. Warm, unhurried.', 900, 250)
  return (
    <div className="w-full max-w-[480px]">
      <Card className="px-4 py-3">
        <Mono>Brief</Mono>
        <p className="mt-1 text-[14px]">
          {brief}
          <Caret />
        </p>
      </Card>
      <svg viewBox="0 0 300 44" preserveAspectRatio="none" className="h-11 w-full" aria-hidden>
        {[50, 150, 250].map((x, i) => {
          const d = `M150 0 C150 22, ${x} 22, ${x} 44`
          return (
            <g key={x}>
              <motion.path d={d} fill="none" stroke="var(--color-line-2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease, delay: 1.1 + i * 0.08 }} />
              <path d={d} fill="none" stroke="var(--color-accent-glow)" strokeWidth={2} strokeDasharray="6 38" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="opacity-0 [animation:flow-dash_1.1s_linear_infinite,onb-fade-in_0.4s_1.5s_forwards]" />
            </g>
          )
        })}
      </svg>
      <div className="grid grid-cols-3 gap-2.5 [perspective:900px]">
        {VERSIONS.map((v, i) => (
          <motion.div
            key={v.id}
            initial={{ opacity: 0, y: 18, rotateX: -35 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 0.8, ease, delay: 1.4 + i * 0.16 }}
            style={{ transformOrigin: '50% 0%' }}
          >
            <Card className="flex h-full flex-col p-3">
              <span className="flex items-center gap-1.5 text-[11px] font-medium">
                <PlatformIcon id={v.id} className="size-3" />
                {v.name}
              </span>
              <p className="mt-2 line-clamp-5 flex-1 text-[11px] leading-snug text-muted">{v.text}</p>
              <span className="mt-3 block h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <motion.span className="block h-full origin-left rounded-full bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: v.used / v.limit }} transition={{ duration: 1, ease, delay: 1.9 + i * 0.16 }} />
              </span>
              <span className="mt-1 font-mono text-[9.5px] tabular-nums text-dim">
                {v.used.toLocaleString()} / {v.limit.toLocaleString()}
              </span>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 02 — Pictures from a sentence                                        */
/* ------------------------------------------------------------------ */

function Picture() {
  const prompt = useTypewriter('Amber candle on travertine, late sun, long soft shadow', 1000, 200)
  return (
    <div className="flex w-full max-w-[480px] items-center gap-5">
      <div className="relative aspect-[4/5] w-[52%] shrink-0 overflow-hidden rounded-xl border border-line-2 bg-[#160b06]">
        {/* The photograph: warm light, a stone ledge, the candle and its flame. */}
        <motion.div
          className="absolute inset-0"
          initial={{ filter: 'blur(22px) saturate(0.1) brightness(0.55)', scale: 1.15 }}
          animate={{ filter: 'blur(0px) saturate(1) brightness(1)', scale: 1 }}
          transition={{ duration: 1.8, ease, delay: 1.1 }}
        >
          <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 85% at 72% 18%, #f6cf96 0%, #c4743a 32%, #4a2413 70%, #170b06 100%)' }} />
          <div className="absolute inset-x-0 bottom-0 h-[32%]" style={{ background: 'linear-gradient(#cdb89b, #8f785d)' }} />
          <div className="absolute bottom-[26%] left-[8%] h-[5%] w-[52%] rounded-[50%] bg-black/35 blur-[6px]" />
          <div className="absolute bottom-[27%] left-1/2 h-[32%] w-[30%] -translate-x-1/2 rounded-[10px] shadow-[inset_-8px_0_14px_rgb(0_0_0_/_0.25)]" style={{ background: 'linear-gradient(90deg, #f8eedd, #e3cfb1)' }}>
            <span className="absolute inset-x-[18%] top-[38%] h-[22%] rounded-sm bg-[#2b1a10]/80" />
          </div>
          <motion.div
            className="absolute bottom-[59%] left-1/2 h-[9%] w-[6%] -translate-x-1/2 rounded-[50%_50%_45%_45%] bg-[#ffd98a] shadow-[0_0_34px_14px_rgb(255_190_90_/_0.55)]"
            animate={{ scaleY: [1, 1.12, 0.94, 1.06, 1], scaleX: [1, 0.94, 1.04, 0.97, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
        {/* The pass that develops it, top to bottom. */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-[color-mix(in_oklab,var(--color-accent-glow)_45%,transparent)] to-transparent mix-blend-screen"
          initial={{ top: '-20%' }}
          animate={{ top: '110%' }}
          transition={{ duration: 1.8, ease: 'easeInOut', delay: 1.1 }}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <Card className="px-3.5 py-3">
          <Mono>Prompt</Mono>
          <p className="mt-1 text-[12.5px] leading-snug">
            {prompt}
            <Caret />
          </p>
        </Card>
        <div className="flex flex-wrap gap-1.5">
          {['Soul 2', '4:5', 'Your product'].map((c, i) => (
            <motion.span key={c} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 + i * 0.1, duration: 0.5, ease }} className="rounded-full border border-line-2 px-2 py-0.5 text-[10.5px] text-muted">
              {c}
            </motion.span>
          ))}
        </div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3 }} className="flex items-center gap-1.5 text-[11.5px] text-ok">
          <Check className="size-3.5" strokeWidth={2.5} /> Ready in 6.4 s, saved to your gallery
        </motion.p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 03 — Reels with a voice and a score                                  */
/* ------------------------------------------------------------------ */

const LINE = ['Wonder', 'why', 'your', 'candles', 'burn', 'unevenly?']

function Bars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn('flex h-6 items-center gap-[3px]', className)} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-accent-soft"
          animate={{ height: ['20%', `${35 + ((i * 37) % 60)}%`, '30%', `${50 + ((i * 53) % 50)}%`, '20%'] }}
          transition={{ duration: 1.1 + (i % 4) * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.04 }}
        />
      ))}
    </span>
  )
}

function Reel() {
  const [word, setWord] = useState(-1)
  useEffect(() => {
    const t = window.setInterval(() => setWord((w) => (w < LINE.length - 1 ? w + 1 : w)), 380)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="flex w-full max-w-[480px] items-center justify-center gap-5">
      <div className="relative aspect-[9/16] h-[330px] shrink-0 overflow-hidden rounded-2xl border border-line-2">
        <div className="absolute inset-0 animate-[reel-gradient_7s_ease-in-out_infinite_alternate] bg-[length:200%_200%]" style={{ backgroundImage: 'linear-gradient(135deg, #1d120c, #6b3a1c 35%, #d29a58 55%, #4a2413 80%, #1d120c)' }} />
        <div className="absolute left-1/2 top-[38%] size-24 -translate-x-1/2 rounded-full bg-[#ffcf86]/40 blur-2xl" />
        <div className="absolute inset-x-3 top-3 h-0.5 overflow-hidden rounded-full bg-white/25">
          <motion.span className="block h-full origin-left bg-white" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: SCENE_MS / 1000, ease: 'linear' }} />
        </div>
        <span className="absolute right-3 top-5 font-mono text-[9.5px] text-white/80">0:12</span>
        <p className="absolute inset-x-4 bottom-[22%] text-center text-[15px] font-semibold leading-tight text-white [text-shadow:0_2px_12px_rgb(0_0_0_/_0.6)]">
          {LINE.map((w, i) => (
            <span key={w} className={cn('transition-colors duration-200', i === word ? 'text-[#ffd98a]' : i < word ? 'text-white' : 'text-white/35')}>
              {w}{' '}
            </span>
          ))}
        </p>
      </div>
      <div className="w-[190px] space-y-2.5">
        {[
          { icon: Mic, label: 'Voice', value: 'Warm narrator · EN', body: <Bars n={18} /> },
          { icon: Music2, label: 'Original score', value: 'Golden hour · 92 bpm', body: <Bars n={18} className="opacity-60" /> },
          { icon: Captions, label: 'Captions', value: 'Word by word, burned in', body: null },
        ].map((r, i) => (
          <motion.div key={r.label} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease, delay: 0.4 + i * 0.15 }}>
            <Card className="px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium">
                <r.icon className="size-3.5 text-accent-soft" strokeWidth={1.75} />
                {r.label}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-dim">{r.value}</span>
              {r.body && <span className="mt-1.5 block">{r.body}</span>}
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 04 — Flows that run on their own                                     */
/* ------------------------------------------------------------------ */

const NODES = [
  { icon: CalendarClock, title: 'Every weekday, 08:30', sub: 'Starts the flow', tone: 'text-warn' },
  { icon: PenLine, title: 'Write a post', sub: 'In the account’s voice', tone: 'text-plan' },
  { icon: UserCheck, title: 'Ask you', sub: 'One tap in the Inbox', tone: 'text-fail' },
  { icon: Check, title: 'Into the next free slot', sub: 'On the calendar', tone: 'text-ok' },
]

function Flow() {
  const [at, setAt] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setAt((a) => (a + 1) % (NODES.length + 1)), 800)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="w-full max-w-[340px]">
      <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mb-4 block w-fit rounded-full border border-line-2 px-2.5 py-1 text-[10.5px] text-muted">
        Recipe · Daily drop
      </motion.span>
      {NODES.map((n, i) => (
        <div key={n.title}>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease, delay: 0.15 + i * 0.18 }}>
            <div className={cn('relative flex items-center gap-3 rounded-xl border bg-panel-2 px-3.5 py-2.5 transition-colors duration-300', at === i ? 'flow-thinking border-transparent' : 'border-line-2')}>
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg border border-line-2', n.tone)}>
                <n.icon className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">{n.title}</span>
                <span className="block text-[10.5px] text-dim">{n.sub}</span>
              </span>
              {at > i && <Check className="size-3.5 text-ok" strokeWidth={2.5} />}
            </div>
          </motion.div>
          {i < NODES.length - 1 && (
            <svg viewBox="0 0 10 26" className="mx-auto h-[26px] w-2.5" aria-hidden>
              <path d="M5 0 V26" stroke="var(--color-line-2)" strokeWidth={1.5} />
              {at > i && <path d="M5 0 V26" stroke="var(--color-accent-glow)" strokeWidth={2} strokeDasharray="4 10" className="[animation:flow-dash_0.9s_linear_infinite]" />}
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 05 — Phones that post, with proof                                    */
/* ------------------------------------------------------------------ */

const STEPS_ON_PHONE = ['Open Instagram', 'Add the picture', 'Paste the caption', 'Share', 'Find it on the profile']

function Publish() {
  const [done, setDone] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setDone((d) => Math.min(d + 1, STEPS_ON_PHONE.length)), 520)
    return () => window.clearInterval(t)
  }, [])
  const status = done === 0 ? 'BOOKED' : done < STEPS_ON_PHONE.length ? 'POSTING' : 'LIVE'
  return (
    <div className="w-full max-w-[480px] space-y-5">
      <Card className="px-4 py-3 text-[13px]">
        <div className="grid grid-cols-[52px_minmax(0,1fr)_28px_86px] gap-3 pb-2">
          {['Time', 'Account', 'To', 'Status'].map((h) => (
            <Mono key={h}>{h}</Mono>
          ))}
        </div>
        {[
          { time: '19:30', handle: '@maisoncire', to: 'instagram' as PlatformId, status },
          { time: '21:00', handle: '@maison-cire', to: 'linkedin' as PlatformId, status: 'BOOKED' },
        ].map((r) => (
          <div key={r.time} className="grid grid-cols-[52px_minmax(0,1fr)_28px_86px] items-center gap-3 py-1">
            <Flap text={r.time} width={5} />
            <Flap text={r.handle} width={12} className="overflow-hidden" />
            <span className="grid size-6 place-items-center rounded bg-white/[0.06]">
              <PlatformIcon id={r.to} className="size-3" />
            </span>
            <span className={cn(r.status === 'LIVE' ? '[--flap-ink:var(--color-ok)]' : r.status === 'POSTING' ? '[--flap-ink:var(--color-warn)]' : '')}>
              <Flap text={r.status} width={7} />
            </span>
          </div>
        ))}
      </Card>
      <div className="flex items-center gap-5">
        <div className="relative h-[190px] w-[104px] shrink-0 rounded-[20px] border-2 border-line-2 bg-panel-2 p-2">
          <span className="mx-auto mb-2 block h-1 w-8 rounded-full bg-white/15" />
          <div className="h-[118px] overflow-hidden rounded-lg" style={{ background: 'radial-gradient(120% 85% at 72% 18%, #f6cf96 0%, #c4743a 40%, #4a2413 90%)' }} />
          <span className="mt-2 block h-1.5 w-3/4 rounded-full bg-white/15" />
          <span className="mt-1 block h-1.5 w-1/2 rounded-full bg-white/10" />
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {STEPS_ON_PHONE.map((s, i) => (
            <li key={s} className={cn('flex items-center gap-2 text-[12px] transition-colors duration-300', i < done ? 'text-fg' : 'text-dim')}>
              <span className={cn('grid size-4 place-items-center rounded-full border transition-colors duration-300', i < done ? 'border-ok bg-ok text-ink' : 'border-line-2')}>
                {i < done && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              {s}
            </li>
          ))}
          <motion.li initial={false} animate={{ opacity: done >= STEPS_ON_PHONE.length ? 1 : 0, y: done >= STEPS_ON_PHONE.length ? 0 : 6 }} className="pt-1 font-mono text-[10.5px] text-ok">
            Confirmed live · 25 steps · 27 s
          </motion.li>
        </ul>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 06 — Storm Guard keeps watch                                         */
/* ------------------------------------------------------------------ */

const COMMENTS = [
  { who: 'ana', text: 'Love the new scent, gorgeous.', mood: 'ok' },
  { who: 'ben', text: 'Shipping took three weeks??', mood: 'warn' },
  { who: 'cy', text: 'Worst customer service ever.', mood: 'fail' },
  { who: 'dee', text: 'Never buying again.', mood: 'fail' },
] as const

function Storm() {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setShown((s) => Math.min(s + 1, COMMENTS.length)), 560)
    return () => window.clearInterval(t)
  }, [])
  const share = [0, 0.1, 0.3, 0.5, 0.64][shown]
  const frozen = shown >= COMMENTS.length
  const arc = 'M10 60 A50 50 0 0 1 110 60'
  return (
    <div className="flex w-full max-w-[480px] items-start gap-5">
      <Card className="w-[170px] shrink-0 px-4 py-4 text-center">
        <svg viewBox="0 0 120 66" className="w-full" aria-hidden>
          <path d={arc} fill="none" stroke="var(--color-line-2)" strokeWidth={8} strokeLinecap="round" />
          <motion.path
            d={arc}
            fill="none"
            strokeWidth={8}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: share, stroke: share > 0.55 ? 'var(--color-fail)' : share > 0.25 ? 'var(--color-warn)' : 'var(--color-ok)' }}
            transition={{ duration: 0.5, ease }}
          />
        </svg>
        <p className="-mt-3 text-[22px] font-medium tabular-nums tracking-[-0.03em]">{Math.round(share * 100)}%</p>
        <p className="text-[10.5px] text-dim">negative, last hour</p>
        <motion.p
          initial={false}
          animate={{ opacity: frozen ? 1 : 0, scale: frozen ? 1 : 0.9 }}
          className="mx-auto mt-3 flex w-fit items-center gap-1 rounded-full border border-plan/40 bg-plan/10 px-2 py-0.5 text-[10.5px] text-plan"
        >
          <Snowflake className="size-3" /> Frozen
        </motion.p>
      </Card>
      <div className="min-w-0 flex-1 space-y-2">
        <AnimatePresence initial={false}>
          {COMMENTS.slice(0, shown).map((c) => (
            <motion.div key={c.who} initial={{ opacity: 0, y: -10, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} transition={{ duration: 0.45, ease }}>
              <Card className="flex items-center gap-2.5 px-3 py-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[10px] uppercase text-muted">{c.who[0]}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px]">{c.text}</span>
                <span className={cn('size-1.5 shrink-0 rounded-full', c.mood === 'ok' ? 'bg-ok' : c.mood === 'warn' ? 'bg-warn' : 'bg-fail')} />
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
        <motion.p initial={false} animate={{ opacity: frozen ? 1 : 0 }} className="pt-1 text-[11.5px] leading-snug text-muted">
          Publishing paused on @maisoncire. Nothing scheduled walks into a backlash.
        </motion.p>
      </div>
    </div>
  )
}

const RENDER: Record<(typeof SCENES)[number]['id'], () => ReactNode> = {
  adapt: () => <Adapt />,
  picture: () => <Picture />,
  reel: () => <Reel />,
  flow: () => <Flow />,
  publish: () => <Publish />,
  storm: () => <Storm />,
}

/** The scene in play, with its caption; each one replays from the start when it comes round. */
export function Showcase({ scene, className }: { scene: number; className?: string }) {
  const s = SCENES[scene]
  return (
    <div className={cn('relative flex h-full w-full flex-col items-center justify-center', className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={s.id}
          className="flex w-full justify-center"
          initial={{ opacity: 0, y: 26, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -18, filter: 'blur(8px)', transition: { duration: 0.35 } }}
          transition={{ duration: 0.7, ease }}
        >
          {RENDER[s.id]()}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** The showreel's table of contents, ticking along with it; any line jumps to its scene. */
export function SceneIndex({ scene, onPick }: { scene: number; onPick: (i: number) => void }) {
  return (
    <ol className="space-y-1">
      {SCENES.map((s, i) => {
        const on = i === scene
        return (
          <li key={s.id}>
            <button type="button" onClick={() => onPick(i)} className={cn('group relative w-full overflow-hidden rounded-lg px-3 py-2 text-left transition-colors duration-300', on ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]')}>
              <span className="flex items-baseline gap-3">
                <span className={cn('font-mono text-[10.5px] tabular-nums transition-colors', on ? 'text-accent-soft' : 'text-dim')}>{String(i + 1).padStart(2, '0')}</span>
                <span className={cn('text-[13.5px] transition-colors', on ? 'text-fg' : 'text-muted group-hover:text-fg')}>{s.title}</span>
              </span>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.span initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease }} className="block overflow-hidden pl-[30px]">
                    <span className="block pt-0.5 text-[12px] text-dim">{s.caption}</span>
                  </motion.span>
                )}
              </AnimatePresence>
              {on && <motion.span key={`bar-${scene}`} className="absolute inset-x-0 bottom-0 h-px origin-left bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: SCENE_MS / 1000, ease: 'linear' }} />}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

