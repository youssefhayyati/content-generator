import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { useLenis } from 'lenis/react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, X } from 'lucide-react'
import { Footer } from '../components/Footer'
import { Navbar } from '../components/Navbar'
import { PlatformIcon } from '../components/ui/PlatformIcon'
import { VelocityMarquee } from '../components/ui/Marquee'
import { LineReveal, Serif } from '../components/ui/Reveal'
import { cn } from '../lib/cn'
import { ease, easeInOut } from '../lib/motion'
import { ReadyContext, useArrival } from '../lib/ready'
import { useDocumentTitle, useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import { CASES, caseById, GROUPS, KIND_LABEL, MAKE_LABEL, makePath, VOICE_LABEL, type Case, type Group, type Voice } from '../showcase/cases'
import { Clip, FlowMap, FORMAT_ICON, monogram, Picture, PostCard, PostText, platformName, Tag } from '../showcase/pieces'
import { Stage } from '../showcase/stage'
import { Chapters } from '../showcase/Chapters'

const pad = (n: number) => String(n).padStart(2, '0')
const kindTag = (c: Case) =>
  c.kind === 'carousel'
    ? `Carousel · ${c.shots?.length}`
    : c.kind === 'reel'
      ? `Reel · 0:${pad(c.video?.seconds ?? 0)}`
      : c.kind === 'flow'
        ? `Flow · ${c.flow?.steps.length} steps`
        : c.kind === 'post' && (c.versions?.length ?? 0) > 1
          ? `Post · ${c.versions?.length} networks`
          : KIND_LABEL[c.kind]

/** Signed in, straight to the studio; otherwise sign up first and land there after. */
function useMake() {
  const { user } = useSession()
  const { navigate } = useRouter()
  return (path: string) => navigate(user ? path : `/signup?next=${encodeURIComponent(path)}`)
}

/** /showcase: what FlowAI made for a handful of demo brands, each one open to see how, and to make your own. */
export default function Showcase() {
  const ready = useArrival()
  const make = useMake()
  const { search, navigate } = useRouter()
  const open = caseById(new URLSearchParams(search).get('case'))
  useDocumentTitle(open ? `${open.title} — FlowAI Showcase` : 'Showcase — Made with FlowAI')
  const [group, setGroup] = useState<Group | 'all'>('all')
  const list = group === 'all' ? CASES : CASES.filter((c) => c.group === group)
  // Where the open case came from on the wall, so the viewer can grow out of it and shrink back.
  const [origin, setOrigin] = useState<DOMRect | null>(null)
  const pushed = useRef(false)

  const show = (c: Case, from: Element | null) => {
    setOrigin(from?.getBoundingClientRect() ?? null)
    pushed.current = true
    navigate(`/showcase?case=${c.id}`)
  }
  const close = () => {
    if (pushed.current) {
      pushed.current = false
      window.history.back()
    } else navigate('/showcase', { replace: true })
  }
  const step = (by: number) => {
    if (!open) return
    const i = CASES.indexOf(open)
    const next = CASES[(i + by + CASES.length) % CASES.length]
    setOrigin(null)
    navigate(`/showcase?case=${next.id}`, { replace: true })
  }

  return (
    <ReadyContext.Provider value={ready}>
      <div className="relative overflow-x-clip">
        <Navbar />
        <main>
          <Hero ready={ready} onOpen={show} />
          <Briefs />
          <Chapters onOpen={(c) => show(c, null)} onMake={(c) => make(makePath(c.make))} />
          <section aria-label="Cases" className="container-x pb-28 pt-28 md:pb-40 md:pt-40">
            <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              <span className="text-fg">(Everything)</span>
              <span className="h-px w-8 bg-current opacity-40" />
              <span>{CASES.length} cases</span>
            </p>
            <LineReveal className="mt-8 text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em]" lines={['Every case,', <Serif>in one place.</Serif>]} />
            <Filters group={group} onGroup={setGroup} />
            <Wall key={group} list={list} onOpen={show} />
          </section>
          <YourBrief />
        </main>
        <Footer />
      </div>

      <AnimatePresence>{open && <Viewer key="viewer" c={open} origin={origin} onClose={close} onStep={step} />}</AnimatePresence>
    </ReadyContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero({ ready, onOpen }: { ready: boolean; onOpen: (c: Case, from: Element | null) => void }) {
  // Every picture, clip, post, flow and plan on the page.
  const pieces = CASES.reduce((n, c) => n + (c.video ? 1 : (c.shots?.length ?? 0)) + (c.versions?.length ?? 0) + (c.flow ? 1 : 0) + (c.plan ? 1 : 0), 0)
  return (
    <header className="container-x grid items-center gap-12 pb-10 pt-32 lg:min-h-svh lg:grid-cols-12 lg:gap-8 lg:pb-16 lg:pt-28">
      <div className="relative z-10 lg:col-span-6">
        <motion.p
          className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
          initial={{ opacity: 0, y: 12 }}
          animate={ready ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease }}
        >
          <span className="text-fg">(Showcase)</span>
          <span className="h-px w-8 bg-current opacity-40" />
          <span>
            {CASES.length} briefs · {pieces} pieces
          </span>
        </motion.p>
        <LineReveal
          as="h1"
          play={ready}
          className="mt-8 text-[clamp(3.6rem,15vw,7rem)] font-medium leading-[0.86] tracking-[-0.06em] md:text-[clamp(5rem,9.5vw,10rem)]"
          lines={['Made with', <Serif>FlowAI.</Serif>]}
        />
        <motion.div initial={{ opacity: 0, y: 16 }} animate={ready ? { opacity: 1, y: 0 } : undefined} transition={{ duration: 0.9, ease, delay: 0.25 }}>
          <p className="mt-10 max-w-[44ch] text-[16px] leading-relaxed text-muted">
            Posts written in a brand’s own voice, pictures, reels, a flow and a launch plan, each from one brief. Scroll through four of them being made, then open any case to see exactly how, and make your own from it.
          </p>
          <p className="mt-5 max-w-[48ch] border-l border-line-2 pl-3 text-[12.5px] leading-relaxed text-dim">
            The brands are invented for this page. Everything else is what FlowAI returned from the brief, voice or prompt on each case, left as it came out.
          </p>
        </motion.div>
      </div>
      <Collage ready={ready} onOpen={onOpen} />
    </header>
  )
}

/** Where each piece of the hero's collage sits, how it leans, and how far it floats (depth). */
const COLLAGE: Array<{ id: string; left: number; top: number; w: number; rotate: number; depth: number; post?: boolean }> = [
  { id: 'ember-fig', left: 2, top: 6, w: 33, rotate: -6, depth: 0.5 },
  { id: 'dawn-miles', left: 38, top: 0, w: 26, rotate: 3, depth: 1 },
  { id: 'pappardelle', left: 69, top: 9, w: 30, rotate: 6, depth: 0.7 },
  { id: 'friday-stems', left: 7, top: 53, w: 27, rotate: 4, depth: 0.9 },
  { id: 'month-end', left: 37, top: 49, w: 35, rotate: -3, depth: 0.6, post: true },
  { id: 'the-pour', left: 76, top: 50, w: 22, rotate: -5, depth: 1.15 },
]

/**
 * A pile of real output, pinned up like a mood board. Each piece leans toward the pointer by its
 * depth and drifts up at its own speed as the page scrolls; a click opens its case.
 */
function Collage({ ready, onOpen }: { ready: boolean; onOpen: (c: Case, from: Element | null) => void }) {
  const reduce = useReducedMotion()
  const mx = useSpring(0, { stiffness: 60, damping: 18 })
  const my = useSpring(0, { stiffness: 60, damping: 18 })
  const { scrollY } = useScroll()
  useEffect(() => {
    if (reduce) return
    const move = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5)
      my.set(e.clientY / window.innerHeight - 0.5)
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [mx, my, reduce])

  return (
    <div className="relative aspect-[1/0.95] w-full lg:col-span-6 lg:aspect-auto lg:h-[min(80svh,780px)]">
      {COLLAGE.map((t, i) => {
        const c = caseById(t.id)!
        return <Piece key={t.id} t={t} c={c} i={i} ready={ready} mx={mx} my={my} scrollY={scrollY} onOpen={onOpen} />
      })}
    </div>
  )
}

function Piece({
  t,
  c,
  i,
  ready,
  mx,
  my,
  scrollY,
  onOpen,
}: {
  t: (typeof COLLAGE)[number]
  c: Case
  i: number
  ready: boolean
  mx: MotionValue<number>
  my: MotionValue<number>
  scrollY: MotionValue<number>
  onOpen: (c: Case, from: Element | null) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const x = useTransform(mx, (v) => v * t.depth * 36)
  const y = useTransform([my, scrollY], ([v, s]: number[]) => v * t.depth * 28 - s * t.depth * 0.28)
  const shot = c.shots?.[0]
  return (
    <motion.div className="absolute" style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.w}%`, x, y, zIndex: Math.round(t.depth * 10) }}>
      <motion.button
        ref={ref}
        type="button"
        onClick={() => onOpen(c, ref.current)}
        aria-label={`${c.title}, for ${c.brand.name}`}
        className={cn('group relative block w-full text-left', t.post && 'max-sm:hidden')}
        initial={{ opacity: 0, y: 80, rotate: t.rotate * 2.5, scale: 0.85 }}
        animate={ready ? { opacity: 1, y: 0, rotate: t.rotate, scale: 1 } : undefined}
        whileHover={{ rotate: 0, scale: 1.04 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18, delay: ready ? 0.15 + i * 0.08 : 0 }}
      >
        {t.post && c.versions ? (
          <PostCard c={c} version={c.versions[0]} clamp withShot={false} className="text-[12px]" />
        ) : c.video ? (
          <span className="block overflow-hidden rounded-[18px] border border-white/10 shadow-[0_40px_90px_-40px_rgb(0_0_0_/_0.95)]">
            <Clip c={c} className="aspect-[9/16] w-full object-cover" />
          </span>
        ) : shot ? (
          <span className="block overflow-hidden rounded-[18px] border border-white/10 shadow-[0_40px_90px_-40px_rgb(0_0_0_/_0.95)]">
            <Picture shot={shot} size="sm" eager className="h-auto w-full" />
          </span>
        ) : null}
        <span className="absolute -bottom-3 left-3 rounded-full bg-fg px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          {c.brand.name}
        </span>
      </motion.button>
    </motion.div>
  )
}

/** The briefs themselves, drifting past: one line in, everything below came out of it. */
function Briefs() {
  return (
    <div aria-hidden className="mt-20 border-y border-line py-5 md:mt-28">
      <VelocityMarquee speed={-1.2}>
        {CASES.map((c) => (
          <span key={c.id} className="flex items-center whitespace-nowrap pr-10 text-[15px] md:text-[17px]">
            <span className="font-serif italic text-fg/80">“{c.brief.length > 72 ? `${c.brief.slice(0, 70).trimEnd()}…` : c.brief}”</span>
            <ArrowRight className="mx-4 size-4 text-accent-soft" strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{kindTag(c)}</span>
          </span>
        ))}
      </VelocityMarquee>
    </div>
  )
}

function Filters({ group, onGroup }: { group: Group | 'all'; onGroup: (g: Group | 'all') => void }) {
  return (
    <div className="sticky top-20 z-20 mt-12 flex justify-center md:top-24">
      <div role="tablist" aria-label="Show" className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full border border-line-2 bg-panel/80 p-1 backdrop-blur-xl">
        {GROUPS.map((g) => {
          const n = g.id === 'all' ? CASES.length : CASES.filter((c) => c.group === g.id).length
          const on = g.id === group
          return (
            <button
              key={g.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => onGroup(g.id)}
              className={cn('relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13.5px] transition-colors duration-300', on ? 'text-ink' : 'text-muted hover:text-fg')}
            >
              {on && <motion.span layoutId="showcase-group" className="absolute inset-0 rounded-full bg-fg" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <span className="relative">{g.label}</span>
              <span className={cn('relative font-mono text-[10.5px]', on ? 'text-ink/50' : 'text-dim')}>{n}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The wall                                                            */
/* ------------------------------------------------------------------ */

const columnsFor = (w: number) => (w >= 1280 ? 4 : w >= 1024 ? 3 : w >= 640 ? 2 : 1)

/** How tall a case's card is for its width, near enough to balance the columns. */
function heightOf(c: Case) {
  const shot = c.shots?.[0]
  const visual =
    c.kind === 'reel' ? 16 / 9 : c.kind === 'carousel' ? 1 : c.kind === 'flow' ? 1.95 : c.kind === 'campaign' ? 1.25 : shot ? shot.h / shot.w : 1.2
  return visual + 0.2
}

/**
 * A masonry of cases: each goes into the shortest column so far, which keeps the columns level
 * and the reading order running across the rows (01, 02, 03…) rather than down each column.
 */
function Wall({ list, onOpen }: { list: Case[]; onOpen: (c: Case, from: Element | null) => void }) {
  const [n, setN] = useState(() => columnsFor(window.innerWidth))
  useEffect(() => {
    const on = () => setN(columnsFor(window.innerWidth))
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const columns = useMemo(() => {
    const cols: Case[][] = Array.from({ length: n }, () => [])
    const heights = new Array(n).fill(0)
    for (const c of list) {
      const k = heights.indexOf(Math.min(...heights))
      cols[k].push(c)
      heights[k] += heightOf(c)
    }
    return cols
  }, [list, n])

  return (
    <div className="mt-8 grid items-start gap-4 md:gap-5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {columns.map((col, k) => (
        <div key={k} className="flex min-w-0 flex-col gap-9">
          {col.map((c) => (
            <Card key={c.id} c={c} i={k} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Card({ c, i, onOpen }: { c: Case; i: number; onOpen: (c: Case, from: Element | null) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const reduce = useReducedMotion()
  return (
    <motion.figure
      className="group w-full"
      initial={reduce ? false : { opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 1, ease, delay: (i % 4) * 0.07 }}
    >
      <button
        ref={ref}
        type="button"
        onClick={() => onOpen(c, ref.current)}
        aria-label={`${c.title}, for ${c.brand.name}`}
        className="relative block w-full overflow-hidden rounded-[22px] border border-line bg-card text-left outline-none ring-accent-soft/60 transition-[border-color,box-shadow] duration-500 hover:border-line-2 focus-visible:ring-2"
      >
        <motion.div
          initial={reduce ? false : { clipPath: 'inset(22% 0% 0% 0%)', scale: 1.08 }}
          whileInView={{ clipPath: 'inset(0% 0% 0% 0%)', scale: 1 }}
          viewport={{ once: true, margin: '0px 0px -8% 0px' }}
          transition={{ duration: 1.3, ease, delay: (i % 4) * 0.07 }}
        >
          <Visual c={c} />
        </motion.div>
        <Tag className="absolute left-3 top-3">{kindTag(c)}</Tag>
        <span className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-fg text-ink opacity-0 transition-[opacity,rotate] duration-500 ease-expo group-hover:rotate-45 group-hover:opacity-100">
          <ArrowUpRight className="size-4" strokeWidth={2} />
        </span>
      </button>
      <figcaption className="mt-3 flex items-baseline gap-3 px-1">
        <span className="font-mono text-[10.5px] text-dim">{pad(CASES.indexOf(c) + 1)}</span>
        <span className="min-w-0">
          <span className="block text-[15.5px] font-medium leading-snug tracking-[-0.01em]">{c.title}</span>
          <span className="mt-0.5 block text-[12.5px] text-dim">
            {c.brand.name} · {c.brand.trade}
          </span>
        </span>
      </figcaption>
    </motion.figure>
  )
}

/** What a case shows on the wall. Pictures carry their brief on hover: one line in, this out. */
function Visual({ c }: { c: Case }) {
  const shot = c.shots?.[0]
  const brief = (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-3 bg-linear-to-t from-black/85 via-black/45 to-transparent px-4 pb-4 pt-16 opacity-0 transition-[opacity,translate] duration-500 ease-expo group-hover:translate-y-0 group-hover:opacity-100">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/55">The brief</span>
      <span className="mt-1 line-clamp-3 block font-serif text-[17px] italic leading-snug text-white">“{c.brief}”</span>
    </span>
  )

  if (c.kind === 'reel')
    return (
      <span className="relative block">
        <Clip c={c} className="aspect-[9/16] w-full object-cover" />
        {brief}
      </span>
    )

  if (c.kind === 'carousel' && c.shots) return <Carousel c={c} brief={brief} />

  if (c.kind === 'flow' && c.flow)
    return (
      <span className="relative block bg-panel px-4 pb-6 pt-14" style={{ background: 'radial-gradient(120% 70% at 50% 0%, color-mix(in oklab, var(--color-accent) 16%, transparent), transparent 70%), var(--color-panel)' }}>
        <FlowMap flow={c.flow} compact />
      </span>
    )

  if (c.kind === 'campaign' && c.plan && shot)
    return (
      <span className="block">
        <span className="relative block overflow-hidden">
          <Picture shot={shot} size="sm" className="aspect-[4/3] w-full object-cover transition-transform duration-1000 ease-expo group-hover:scale-[1.04]" />
        </span>
        <span className="block p-4 pb-5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">Big idea</span>
          <span className="mt-1 block font-serif text-[24px] italic leading-[1.05]">{c.plan.idea}</span>
          <span className="mt-4 flex items-center gap-3 text-[12px] text-muted">
            {c.plan.pillars.length} pillars · {c.plan.posts.length} posts
            <span className="ml-auto flex gap-1">
              {c.plan.posts.map((p, j) => {
                const Icon = FORMAT_ICON[p.format]
                return (
                  <span key={j} className="grid size-6 place-items-center rounded-md border border-line text-muted">
                    <Icon className="size-3" strokeWidth={1.75} />
                  </span>
                )
              })}
            </span>
          </span>
        </span>
      </span>
    )

  if (c.kind === 'post' && shot)
    return (
      <span className="relative block overflow-hidden">
        <Picture shot={shot} size="sm" className="h-auto w-full transition-transform duration-1000 ease-expo group-hover:scale-[1.04]" />
        <span className="absolute bottom-3 left-3 flex -space-x-1.5 transition-opacity duration-300 group-hover:opacity-0">
          {c.versions?.map((v) => (
            <span key={v.platform} className="grid size-8 place-items-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md">
              <PlatformIcon id={v.platform} className="size-3.5" />
            </span>
          ))}
        </span>
        {brief}
      </span>
    )

  if (c.kind === 'post' && c.versions)
    return (
      <span
        className="block px-5 pb-6 pt-14"
        style={{ background: 'radial-gradient(110% 80% at 100% 0%, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 65%), var(--color-card)' }}
      >
        <PostCard c={c} version={c.versions[0]} clamp className="rotate-[-1.2deg] transition-transform duration-700 ease-expo group-hover:rotate-0" />
      </span>
    )

  return shot ? (
    <span className="relative block overflow-hidden">
      <Picture shot={shot} size="sm" className="h-auto w-full transition-transform duration-1000 ease-expo group-hover:scale-[1.04]" />
      {brief}
    </span>
  ) : null
}

/** A carousel on the wall: the slides fanned behind the first, and dealt through while hovered. */
function Carousel({ c, brief }: { c: Case; brief: ReactNode }) {
  const shots = c.shots!
  const [at, setAt] = useState(0)
  const [hover, setHover] = useState(false)
  useEffect(() => {
    if (!hover) return
    const t = window.setInterval(() => setAt((n) => (n + 1) % shots.length), 950)
    return () => window.clearInterval(t)
  }, [hover, shots.length])

  return (
    <span className="relative block aspect-square overflow-hidden" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {shots.map((s, j) => (
        <motion.span
          key={s.src}
          className="absolute inset-0"
          initial={false}
          animate={{ opacity: j === at ? 1 : 0, scale: j === at ? 1 : 1.06 }}
          transition={{ duration: 0.7, ease }}
        >
          <Picture shot={s} size="sm" className="size-full object-cover" />
        </motion.span>
      ))}
      <span className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
        {shots.map((s, j) => (
          <span key={s.src} className={cn('h-1 rounded-full bg-white transition-all duration-500', j === at ? 'w-5 opacity-100' : 'w-1 opacity-50')} />
        ))}
      </span>
      {brief}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* The case viewer                                                     */
/* ------------------------------------------------------------------ */

function Viewer({ c, origin, onClose, onStep }: { c: Case; origin: DOMRect | null; onClose: () => void; onStep: (by: number) => void }) {
  const lenis = useLenis()
  const make = useMake()
  const reduce = useReducedMotion()
  const closeRef = useRef<HTMLButtonElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [version, setVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => setVersion(0), [c.id])

  // The page holds still underneath, and the keys move between cases.
  useEffect(() => {
    lenis?.stop()
    closeRef.current?.focus({ preventScroll: true })
    return () => lenis?.start()
  }, [lenis])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onStep(1)
      else if (e.key === 'ArrowLeft') onStep(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  // Grows out of the card that was clicked; without one (a shared link), it rises.
  const clip = useMemo(() => {
    if (!origin) return null
    const w = window.innerWidth
    const h = window.innerHeight
    return `inset(${origin.top}px ${w - origin.right}px ${h - origin.bottom}px ${origin.left}px round 22px)`
  }, [origin])
  const from = reduce ? { opacity: 0 } : clip ? { clipPath: clip } : { clipPath: 'inset(100% 0% 0% 0% round 0px)' }
  const to = reduce ? { opacity: 1 } : { clipPath: 'inset(0% 0% 0% 0% round 0px)' }

  const copyText = c.prompt ?? c.brief
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* Clipboard refused: nothing to do. */
    }
  }
  const index = CASES.indexOf(c)
  const next = CASES[(index + 1) % CASES.length]
  const v = c.versions?.[version]

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={c.title}
      className="fixed inset-0 z-[120] bg-ink"
      initial={from}
      animate={to}
      exit={{ ...from, transition: { duration: 0.6, ease: easeInOut } }}
      transition={{ duration: 0.85, ease: easeInOut }}
    >
      <div ref={scroller} className="flex h-full flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] lg:overflow-hidden" data-lenis-prevent>
        {/* The stage */}
        <div
          className="relative flex min-h-[50svh] shrink-0 items-center justify-center overflow-hidden px-4 pb-8 pt-16 lg:h-full lg:px-12 lg:py-12"
          style={{ background: `radial-gradient(80% 70% at 50% 45%, color-mix(in oklab, ${c.shots?.[0]?.tone ?? 'var(--color-accent)'} 70%, transparent), transparent 75%), var(--color-ink-2)` }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={c.id + (c.kind === 'post' ? version : '')}
              className="flex size-full items-center justify-center"
              initial={{ opacity: 0, scale: 0.94, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.6, ease, delay: origin ? 0.25 : 0.05 } }}
              exit={{ opacity: 0, scale: 0.97, filter: 'blur(6px)', transition: { duration: 0.25, ease } }}
            >
              <Stage c={c} version={version} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* The case */}
        <aside className="relative flex min-h-0 flex-col border-line bg-panel lg:border-l">
          <div className="flex-1 px-5 pb-8 pt-6 md:px-8 lg:overflow-y-auto lg:pt-20" data-lenis-prevent>
            <AnimatePresence mode="wait">
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease, delay: origin ? 0.3 : 0.05 } }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
              >
                <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">
                  <span className="text-fg">Case {pad(index + 1)}</span>
                  <span>/ {pad(CASES.length)}</span>
                  <span className="h-px w-6 bg-current opacity-40" />
                  <span>{KIND_LABEL[c.kind]}</span>
                </p>
                <h2 className="mt-5 text-[clamp(2rem,3.2vw,3rem)] font-medium leading-[0.98] tracking-[-0.045em]">{c.title}</h2>
                <p className="mt-4 flex items-center gap-2.5 text-[13px] text-muted">
                  <span className="grid size-7 place-items-center rounded-full bg-fg text-[9.5px] font-semibold text-ink">{monogram(c.brand.name)}</span>
                  {c.brand.name} · {c.brand.trade}
                  <span className="rounded-full border border-line-2 px-2 py-0.5 text-[10.5px] text-dim">Demo brand</span>
                </p>

                <Block title="The brief">
                  <p className="font-serif text-[23px] italic leading-[1.22] tracking-[-0.005em] text-fg">“{c.brief}”</p>
                  {c.fields && (
                    <dl className="mt-4 space-y-2.5">
                      {c.fields.map(([k, val]) => (
                        <div key={k} className="grid grid-cols-[86px_minmax(0,1fr)] gap-3 text-[13px] leading-snug">
                          <dt className="text-dim">{k}</dt>
                          <dd className="text-muted">{val}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </Block>

                {c.brand.voice && (c.versions || c.plan) && (
                  <Block title="The brand’s voice">
                    <dl className="space-y-2.5">
                      {(Object.keys(VOICE_LABEL) as Array<keyof Voice>)
                        .filter((k) => c.brand.voice?.[k])
                        .map((k) => (
                          <div key={k} className="grid grid-cols-[86px_minmax(0,1fr)] gap-3 text-[13px] leading-snug">
                            <dt className="text-dim">{VOICE_LABEL[k]}</dt>
                            <dd className="text-muted">{c.brand.voice?.[k]}</dd>
                          </div>
                        ))}
                    </dl>
                  </Block>
                )}

                {c.prompt && (
                  <Block title={c.video ? 'Clip prompt' : 'Picture prompt'}>
                    <p className="rounded-xl border border-line bg-white/[0.02] p-3 font-mono text-[12px] leading-relaxed text-muted">{c.prompt}</p>
                  </Block>
                )}

                {c.versions && (c.versions.length > 1 || c.kind !== 'post') && (
                  <Block title={c.versions.length > 1 ? `${c.versions.length} versions` : 'Caption'}>
                    {c.versions.length > 1 && (
                      <div role="tablist" aria-label="Versions" className="mb-3 flex flex-wrap gap-1.5">
                        {c.versions.map((x, j) => (
                          <button
                            key={x.platform}
                            role="tab"
                            type="button"
                            aria-selected={j === version}
                            onClick={() => {
                              setVersion(j)
                              // On a phone the post is up above the tabs: bring it back into view.
                              if (c.kind === 'post' && !window.matchMedia('(min-width: 1024px)').matches) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
                            }}
                            className={cn(
                              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-300',
                              j === version ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
                            )}
                          >
                            <PlatformIcon id={x.platform} className="size-3.5" />
                            {platformName(x)}
                          </button>
                        ))}
                      </div>
                    )}
                    {v && c.kind !== 'post' && (
                      <div className="rounded-xl border border-line bg-white/[0.02] p-3.5" style={{ ['--tag' as string]: 'var(--color-accent-soft)' }}>
                        <PostText text={v.text} className="text-[13.5px] leading-relaxed text-fg/90" />
                      </div>
                    )}
                  </Block>
                )}

                <Block title="What FlowAI did">
                  <ol className="space-y-2.5">
                    {c.made.map((m, j) => (
                      <li key={j} className="flex items-start gap-3 text-[13.5px] leading-snug">
                        <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[10px] text-dim">{j + 1}</span>
                        <span className="min-w-0 flex-1">{m.did}</span>
                        <span className="shrink-0 rounded-md border border-line px-2 py-0.5 font-mono text-[10.5px] text-dim">{m.model}</span>
                      </li>
                    ))}
                  </ol>
                </Block>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="sticky bottom-0 border-t border-line bg-panel/95 px-5 py-4 backdrop-blur md:px-8">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => make(makePath(c.make))}
                className="group flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-fg px-5 text-[14px] font-medium text-ink transition-[background-color,box-shadow] duration-300 hover:bg-white hover:shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-accent)_22%,transparent)]"
              >
                {MAKE_LABEL[c.make.tool]}
                <ArrowRight className="size-4 transition-transform duration-500 ease-expo group-hover:-rotate-45" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={copy}
                aria-label={c.prompt ? 'Copy the prompt' : 'Copy the brief'}
                title={c.prompt ? 'Copy the prompt' : 'Copy the brief'}
                className="grid size-12 shrink-0 place-items-center rounded-full border border-line-2 text-muted transition-colors hover:border-white/30 hover:text-fg"
              >
                {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" strokeWidth={1.75} />}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between text-[12.5px] text-dim">
              <button type="button" onClick={() => onStep(-1)} className="flex items-center gap-1.5 transition-colors hover:text-fg">
                <ArrowLeft className="size-3.5" /> Previous
              </button>
              <button type="button" onClick={() => onStep(1)} className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-fg">
                <span className="truncate">Next: {next.title}</span>
                <ArrowRight className="size-3.5 shrink-0" />
              </button>
            </div>
          </div>
        </aside>
      </div>

      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="fixed right-3 top-3 z-10 grid size-11 place-items-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-md transition-[background-color,rotate] duration-500 ease-expo hover:rotate-90 hover:bg-black/70 md:right-5 md:top-5"
      >
        <X className="size-5" strokeWidth={1.75} />
      </button>
    </motion.div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-5">
      <h3 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">{title}</h3>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Your turn                                                           */
/* ------------------------------------------------------------------ */

function YourBrief() {
  const make = useMake()
  const [brief, setBrief] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = brief.trim()
    make(text ? `/dashboard/create?${new URLSearchParams({ brief: text })}` : '/dashboard/create')
  }
  return (
    <section className="relative overflow-hidden bg-accent text-on-accent">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: 'radial-gradient(60% 90% at 85% 10%, color-mix(in oklab, var(--color-accent-glow) 45%, transparent), transparent 70%)' }}
      />
      <div className="container-x relative py-24 md:py-36">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-on-accent/70">(Your turn)</p>
        <LineReveal className="mt-8 text-[clamp(3rem,8.5vw,8.75rem)] font-medium leading-[0.88] tracking-[-0.055em]" lines={['Your brief', <Serif>goes here.</Serif>]} />
        <form onSubmit={submit} className="mt-12 flex max-w-[880px] flex-col gap-2 rounded-[22px] bg-ink/90 p-2 text-fg shadow-[0_40px_100px_-40px_rgb(0_0_0_/_0.8)] sm:flex-row sm:items-center sm:rounded-full">
          <label className="sr-only" htmlFor="your-brief">
            What should your first post be about?
          </label>
          <input
            id="your-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="A launch, a story from this week, tonight’s special…"
            className="h-12 min-w-0 flex-1 bg-transparent px-4 text-[16px] outline-none placeholder:text-dim"
          />
          <button type="submit" className="group flex h-12 items-center justify-center gap-2 rounded-full bg-fg px-6 text-[14px] font-medium text-ink transition-colors hover:bg-white">
            Write it with FlowAI
            <ArrowRight className="size-4 transition-transform duration-500 ease-expo group-hover:-rotate-45" strokeWidth={1.75} />
          </button>
        </form>
        <p className="mt-4 text-[13px] text-on-accent/70">It opens in the Composer with your brief filled in. New here? You’ll make an account first, and it will be waiting after.</p>
      </div>
    </section>
  )
}
