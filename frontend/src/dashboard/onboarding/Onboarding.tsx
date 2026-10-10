import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { ArrowLeft, ArrowRight, AtSign, Check, CornerDownLeft, LoaderCircle, Minus, RotateCcw, TriangleAlert } from 'lucide-react'
import { useLenis } from 'lenis/react'
import { LogoMark } from '../../components/ui/Logo'
import { applyPalette, Chip, PALETTES } from '../../components/ui/PalettePicker'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, apiStream, type User } from '../../lib/api'
import { cn } from '../../lib/cn'
import { ease, easeInOut } from '../../lib/motion'
import { useSession } from '../../lib/session'
import { count, firstName, useInvalidate } from '../data'
import { Flap } from '../live/Flap'
import { useToast } from '../toast'
import { inputClass, Label } from '../ui'
import { fallbackPost, firstBrief, handleFrom, RHYTHMS, TONES, type Answers } from './model'
import { FirstPost, Preview, WeekDots, type FirstPostState } from './Preview'
import { SCENE_MS, SCENES, SceneIndex, Showcase } from './Showcase'
import { Threads, useThread } from './Thread'

/*
 * The first minute of a new account. Five questions (brand, voice, first account, posting rhythm,
 * palette), with the studio assembling itself beside them. Then FlowAI sets all of it up for real
 * and writes the first post in the voice just described, as a draft. Skippable at every step.
 */

const STEPS = ['Brand', 'Voice', 'Account', 'Rhythm', 'Look'] as const
const FINALE = 6
const ALL_PLATFORMS = Object.keys(PLATFORMS) as PlatformId[]

const pad = (n: number) => String(n).padStart(2, '0')
const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms))
const reason = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

const stagger: Variants = { show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } }
const rise: Variants = { hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease } } }

type TaskId = 'studio' | 'account' | 'rhythm' | 'look' | 'post' | 'draft'
type TaskState = 'waiting' | 'running' | 'done' | 'skipped' | 'failed'
const TASKS: TaskId[] = ['studio', 'account', 'rhythm', 'look', 'post', 'draft']

/** Where each answer lands in the studio beside it, and where each finished task wires in. */
const ANSWER_SPOT: Record<number, string> = { 1: 'brand', 2: 'voice', 3: 'account', 4: 'rhythm' }
const TASK_SPOT: Record<TaskId, string> = { studio: 'brand', account: 'account', rhythm: 'rhythm', look: 'window', post: 'drafts', draft: 'drafts' }
const SLIDE = { type: 'spring', stiffness: 420, damping: 36 } as const

export function Onboarding() {
  const { user, setUser } = useSession()
  const invalidate = useInvalidate()
  const toast = useToast()
  const lenis = useLenis()
  const me = user!

  const [step, setStep] = useState(0)
  const [a, setA] = useState<Answers>(() => ({
    brand: '',
    about: '',
    tone: 'friendly',
    avoid: '',
    platform: me.preferences.platforms[0] ?? 'instagram',
    handle: '',
    rhythm: 'weekdays',
    palette: document.documentElement.dataset.palette ?? 'indigo',
  }))
  const [skipAccount, setSkipAccount] = useState(false)
  const [tasks, setTasks] = useState<Record<TaskId, { state: TaskState; note?: string }>>(
    () => Object.fromEntries(TASKS.map((t) => [t, { state: 'waiting' }])) as Record<TaskId, { state: TaskState }>,
  )
  const [post, setPost] = useState<FirstPostState | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const account = useRef<number | null>(null)
  const draft = useRef<number | null>(null)
  const built = useRef(false)
  const [scene, setScene] = useState(0)
  const [hits, setHits] = useState<Record<string, number>>({})
  const [launching, setLaunching] = useState(false)
  const ringRef = useRef<HTMLSpanElement>(null)
  const land = useCallback((spot: string) => setHits((h) => ({ ...h, [spot]: (h[spot] ?? 0) + 1 })), [])
  const { lines, fire } = useThread(land)
  const wired = (id: TaskId) => fire(document.querySelector(`[data-task="${id}"]`), TASK_SPOT[id])

  // The welcome's showreel moves on by itself; picking a scene restarts its clock.
  useEffect(() => {
    if (step !== 0) return
    const t = window.setTimeout(() => setScene((n) => (n + 1) % SCENES.length), SCENE_MS)
    return () => window.clearTimeout(t)
  }, [step, scene])

  const set = (patch: Partial<Answers>) => setA((prev) => ({ ...prev, ...patch }))
  const mark = (id: TaskId, state: TaskState, note?: string) => setTasks((t) => ({ ...t, [id]: { state, note } }))

  // The page underneath stays put while this is open.
  useEffect(() => {
    lenis?.stop()
    const html = document.documentElement
    const before = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      lenis?.start()
      html.style.overflow = before
    }
  }, [lenis])

  // The handle starts as the brand, until it's typed by hand.
  const handleTouched = useRef(false)
  useEffect(() => {
    if (step === 3 && !handleTouched.current) set({ handle: handleFrom(a.brand) })
    // Only on arriving at the account step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const valid = [
    true,
    a.brand.trim().length >= 2 && a.about.trim().length >= 6,
    true,
    skipAccount || /^@?[\w.-]+$/.test(a.handle.trim()),
    true,
    true,
  ][step]

  const go = (to: number) => {
    setError(null)
    setStep(to)
  }
  const next = () => {
    if (!valid || step >= FINALE) return
    // The answer runs along a thread into the part of the studio it fills in.
    const spot = ANSWER_SPOT[step]
    if (spot && !(step === 3 && skipAccount)) fire(document.querySelector('[data-continue]'), spot)
    go(step + 1)
  }
  const back = () => step > 0 && step < FINALE && go(step - 1)

  /* ------------------------------------------------------------------ */
  /* The finale: set everything up for real, then write the first post  */
  /* ------------------------------------------------------------------ */

  const write = async (): Promise<string> => {
    mark('post', 'running')
    setPost({ text: '', writing: true })
    let out = ''
    let done = false
    let failure: string | null = null
    try {
      await apiStream(
        '/onboarding/first-post',
        { brief: firstBrief(a, account.current !== null), format: 'text', platforms: [a.platform], tone: a.tone, account_id: account.current },
        ({ event, data }) => {
          if (event === 'delta') {
            out += (data as { text: string }).text
            setPost({ text: out.trimStart(), writing: true })
          } else if (event === 'done') done = true
          else if (event === 'error') failure = (data as { message: string }).message
        },
      )
      if (!done || !out.trim()) throw new ApiError(0, failure ?? 'The writer stopped early.')
      const text = out.trim()
      setPost({ text, writing: false })
      mark('post', 'done')
      wired('post')
      return text
    } catch (e) {
      const text = fallbackPost(a)
      setPost({ text, writing: false })
      setCanRetry(false)
      mark('post', 'done', e instanceof ApiError && e.status === 503 ? 'AI writing isn’t switched on here yet, so this one is written from your answers.' : 'Written from your answers this time.')
      wired('post')
      return text
    }
  }

  const draftBody = (text: string) => ({ title: null, body: text, format: 'text', platforms: [a.platform], status: 'draft', account_id: account.current })

  useEffect(() => {
    if (step !== FINALE || built.current) return
    built.current = true
    void (async () => {
      mark('studio', 'running')
      await pause(450)
      try {
        setUser(await api<User>('/user', { method: 'PATCH', body: { preferences: { studio: a.brand.trim() } } }))
        mark('studio', 'done')
        wired('studio')
      } catch (e) {
        mark('studio', 'failed', reason(e))
      }

      if (skipAccount) mark('account', 'skipped')
      else {
        mark('account', 'running')
        await pause(400)
        try {
          const created = await api<{ id: number }>('/accounts', {
            method: 'POST',
            body: {
              platform: a.platform,
              handle: a.handle.trim(),
              name: a.brand.trim(),
              profile: { tone: a.tone, topics: a.about.trim(), avoid: a.avoid.trim() || null },
            },
          })
          account.current = created.id
          mark('account', 'done')
          wired('account')
        } catch (e) {
          mark('account', 'failed', reason(e))
        }
      }

      const slots = RHYTHMS.find((r) => r.id === a.rhythm)!.slots
      if (!slots.length) mark('rhythm', 'skipped')
      else {
        mark('rhythm', 'running')
        await pause(400)
        try {
          await api('/queue-slots', { method: 'PUT', body: { slots } })
          mark('rhythm', 'done')
          wired('rhythm')
        } catch (e) {
          mark('rhythm', 'failed', reason(e))
        }
      }

      mark('look', 'running')
      await pause(350)
      mark('look', 'done')
      wired('look')

      setCanRetry(true)
      const text = await write()

      mark('draft', 'running')
      await pause(300)
      try {
        draft.current = (await api<{ id: number }>('/posts', { method: 'POST', body: draftBody(text) })).id
        mark('draft', 'done')
        wired('draft')
      } catch (e) {
        mark('draft', 'failed', reason(e))
      }
      invalidate()
    })()
    // Runs once, with the answers as they were when the last question was answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  /** One more version; the API allows two in all, and the draft takes the new one. */
  const retry = async () => {
    setCanRetry(false)
    mark('draft', 'waiting')
    const text = await write()
    if (draft.current) {
      mark('draft', 'running')
      try {
        await api(`/posts/${draft.current}`, { method: 'PUT', body: draftBody(text) })
        mark('draft', 'done')
      } catch (e) {
        mark('draft', 'failed', reason(e))
      }
    }
  }

  const close = async (finished: boolean) => {
    setClosing(true)
    setError(null)
    if (finished) {
      // The curtain rises with the studio's name on it; the dashboard is behind it when it lifts.
      setLaunching(true)
      await pause(1100)
    }
    try {
      const done = await api<User>('/user', { method: 'PATCH', body: { preferences: { onboarding: 'done' } } })
      invalidate()
      // Stay where they arrived: the dashboard, or the studio page a showcase case sent them to.
      if (finished && draft.current) toast('Your first post is waiting in Drafts.')
      // Leaving onboarding unmounts this, which plays the exit below.
      setUser(done)
    } catch (e) {
      setClosing(false)
      setLaunching(false)
      setError(reason(e))
    }
  }

  /**
   * The new palette washes over the screen from the swatch that was picked, a lit ring riding
   * its edge. The ring lives in the new page, which shows live inside the growing circle, so the
   * two travel together. Without view transitions the ring still sweeps over the new colours.
   */
  const pickPalette = (id: string, origin: HTMLElement) => {
    const r = origin.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const easing = `cubic-bezier(${ease.join(', ')})`
    const ring = () => {
      const el = ringRef.current
      if (!el) return
      Object.assign(el.style, { left: `${x - reach}px`, top: `${y - reach}px`, width: `${reach * 2}px`, height: `${reach * 2}px` })
      el.animate({ transform: ['scale(0)', 'scale(1)'] }, { duration: 1100, easing })
      el.animate({ opacity: [1, 1, 0], offset: [0, 0.7, 1] }, { duration: 1100 })
    }
    const apply = () => {
      flushSync(() => set({ palette: id }))
      applyPalette(id)
    }
    if (still) return apply()
    if (!document.startViewTransition) {
      apply()
      return ring()
    }
    document
      .startViewTransition(apply)
      .ready.then(() => {
        // One clock for both, or the ring runs ahead of the edge and is clipped away with it.
        ring()
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
          { duration: 1100, easing, pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {})
  }

  const settled = TASKS.every((t) => tasks[t].state !== 'waiting' && tasks[t].state !== 'running')
  const tone = TONES.find((t) => t.id === a.tone)!
  const rhythm = RHYTHMS.find((r) => r.id === a.rhythm)!
  const palette = PALETTES.find((p) => p.id === a.palette) ?? PALETTES[0]
  const handle = a.handle.trim().replace(/^@/, '')
  const order = [...me.preferences.platforms, ...ALL_PLATFORMS.filter((p) => !me.preferences.platforms.includes(p))]

  const labels: Record<TaskId, string> = {
    studio: `Studio named ${a.brand.trim()}`,
    account: skipAccount ? 'Accounts: you’ll add them later' : `@${handle} added on ${PLATFORMS[a.platform].name}, in a ${tone.name.toLowerCase()} voice`,
    rhythm: rhythm.slots.length ? `${count(rhythm.slots.length, 'posting time')} a week` : 'Posting times: you’ll pick them later',
    look: `${palette.name} palette`,
    post: 'Your first post, written in your voice',
    draft: 'Saved to your drafts',
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      data-lenis-prevent
      className="fixed inset-0 z-[140] flex flex-col bg-ink text-fg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ y: '-100%', transition: { duration: 0.9, ease: easeInOut } }}
      transition={{ duration: 0.6, ease }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
        if ((e.target as HTMLElement).tagName === 'BUTTON') return
        e.preventDefault()
        next()
      }}
    >
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line px-5 md:px-8">
        <span className="flex items-center gap-2.5 text-[14px] font-medium">
          <LogoMark className="size-4" />
          FlowAI
        </span>
        <span className="hidden h-4 w-px bg-line-2 sm:block" />
        <span className="hidden truncate text-[13px] text-dim sm:block">Setting up {a.brand.trim() || 'your studio'}</span>

        <div className="ml-auto flex items-center gap-5">
          <div className="flex items-center gap-3" aria-label={step === 0 ? 'Welcome' : step === FINALE ? 'Ready' : `Step ${step} of ${STEPS.length}: ${STEPS[step - 1]}`}>
            <span className="hidden text-[10px] md:block">
              <Flap text={step === 0 ? 'Welcome' : step === FINALE ? (settled ? 'Ready' : 'Building') : `${pad(step)}/${pad(STEPS.length)} ${STEPS[step - 1]}`} width={14} />
            </span>
            <span className="flex gap-1">
              {STEPS.map((s, i) => (
                <span key={s} className="h-1 w-6 overflow-hidden rounded-full bg-white/[0.08] md:w-8">
                  <motion.span className="block h-full origin-left bg-accent" initial={false} animate={{ scaleX: step > i ? 1 : 0 }} transition={{ duration: 0.6, ease }} />
                </span>
              ))}
            </span>
          </div>
          {step < FINALE && (
            <button type="button" onClick={() => close(false)} disabled={closing} className="text-[12.5px] text-dim transition-colors hover:text-fg disabled:opacity-50">
              Skip setup
            </button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        <div className="min-h-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[600px] flex-col justify-center px-5 py-12 md:px-10 lg:mx-0 lg:ml-auto lg:mr-12 xl:mr-20">
            <AnimatePresence mode="wait">
              <motion.section key={step} initial="hidden" animate="show" exit={{ opacity: 0, y: -14, transition: { duration: 0.22 } }} variants={stagger}>
                {step === 0 && (
                  <>
                    <Eyebrow>Welcome, {firstName(me.name)}</Eyebrow>
                    <Title>
                      Let’s build your <Serif>studio.</Serif>
                    </Title>
                    <motion.p variants={rise} className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[17px] text-muted">
                      FlowAI
                      <span className="text-[19px]">
                        <Flap text={SCENES[scene].verb} width={9} />
                      </span>
                      for you.
                    </motion.p>
                    <Lead>
                      Five short questions, about a minute. FlowAI sets up your account, your posting rhythm and your look, then writes your first post in your
                      voice. Nothing is published without your yes.
                    </Lead>
                    <motion.div variants={rise} className="mt-8 border-t border-line pt-4">
                      <SceneIndex scene={scene} onPick={setScene} />
                    </motion.div>
                    <Actions onNext={next} label="Start" />
                  </>
                )}

                {step === 1 && (
                  <>
                    <Eyebrow index={1}>Brand</Eyebrow>
                    <Title>
                      What are we <Serif>calling it?</Serif>
                    </Title>
                    <Lead>The name your audience knows, and a line on what you make. FlowAI writes from both.</Lead>
                    <motion.div variants={rise} className="mt-9">
                      <Label>Brand or studio name</Label>
                      <input
                        autoFocus
                        value={a.brand}
                        onChange={(e) => set({ brand: e.target.value })}
                        maxLength={60}
                        placeholder="Maison Cire"
                        className="mt-2 w-full border-0 border-b border-line-2 bg-transparent pb-3 text-[30px] font-medium tracking-[-0.03em] outline-none transition-colors duration-300 placeholder:text-white/15 focus:border-accent-soft/70"
                      />
                    </motion.div>
                    <motion.div variants={rise} className="mt-7">
                      <Label>What do you make, and for whom?</Label>
                      <textarea
                        value={a.about}
                        onChange={(e) => set({ about: e.target.value })}
                        maxLength={280}
                        rows={3}
                        placeholder="Hand-poured soy candles for people who like slow evenings."
                        className={cn(inputClass, 'mt-2 h-auto resize-none px-4 py-3 text-[15px] leading-relaxed')}
                      />
                    </motion.div>
                    <Actions onBack={back} onNext={next} disabled={!valid} />
                  </>
                )}

                {step === 2 && (
                  <>
                    <Eyebrow index={2}>Voice</Eyebrow>
                    <Title>
                      How does it <Serif>sound?</Serif>
                    </Title>
                    <Lead>Pick the voice FlowAI writes in. It’s saved on your account, so every post after this one sounds the same.</Lead>
                    <motion.div variants={rise} role="radiogroup" aria-label="Voice" className="mt-9 grid gap-2.5 sm:grid-cols-2">
                      {TONES.map((t) => {
                        const on = a.tone === t.id
                        return (
                          <button
                            key={t.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => set({ tone: t.id })}
                            className={cn(
                              'relative flex flex-col justify-start rounded-xl border p-4 text-left transition-[border-color,background-color] duration-300',
                              on ? 'border-transparent' : 'border-line-2 hover:border-white/25 hover:bg-white/[0.02]',
                            )}
                          >
                            {on && <motion.span layoutId="onb-tone" transition={SLIDE} className="absolute inset-0 rounded-xl border border-accent/70 bg-accent/[0.08]" />}
                            <span className="relative flex w-full items-center justify-between">
                              <span className="text-[14px] font-medium">{t.name}</span>
                              <span className={cn('grid size-4 place-items-center rounded-full border transition-colors', on ? 'border-accent bg-accent text-on-accent' : 'border-line-2')}>
                                {on && <Check className="size-2.5" strokeWidth={3} />}
                              </span>
                            </span>
                            <span className="relative mt-2 block text-[13px] leading-snug text-muted">“{t.line(a.brand.trim() || 'Your brand')}”</span>
                          </button>
                        )
                      })}
                    </motion.div>
                    <motion.div variants={rise} className="mt-6">
                      <Label>Anything it should never say? (optional)</Label>
                      <input
                        value={a.avoid}
                        onChange={(e) => set({ avoid: e.target.value })}
                        maxLength={200}
                        placeholder="Exclamation marks, the word “luxury”…"
                        className={cn(inputClass, 'mt-2 h-11 px-4 text-[14px]')}
                      />
                    </motion.div>
                    <Actions onBack={back} onNext={next} />
                  </>
                )}

                {step === 3 && (
                  <>
                    <Eyebrow index={3}>Account</Eyebrow>
                    <Title>
                      Where does it <Serif>go first?</Serif>
                    </Title>
                    <Lead>One account to start. You can add more, and link a phone to publish automatically, whenever you like.</Lead>
                    <motion.div variants={rise} role="radiogroup" aria-label="Platform" className="mt-9 flex flex-wrap gap-2">
                      {order.map((p) => {
                        const on = a.platform === p
                        return (
                          <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => {
                              set({ platform: p })
                              setSkipAccount(false)
                            }}
                            className={cn(
                              'relative flex h-10 items-center rounded-full border px-3.5 text-[13px] transition-colors duration-300',
                              on ? 'border-transparent text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
                            )}
                          >
                            {on && <motion.span layoutId="onb-platform" transition={SLIDE} className="absolute inset-0 rounded-full bg-fg" />}
                            <span className="relative flex items-center gap-2">
                              <PlatformIcon id={p} className="size-3.5" />
                              {PLATFORMS[p].name}
                            </span>
                          </button>
                        )
                      })}
                    </motion.div>
                    <motion.div variants={rise} className="mt-7">
                      <Label>Your handle on {PLATFORMS[a.platform].name}</Label>
                      <span className="relative mt-2 block">
                        <AtSign className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-dim" strokeWidth={1.75} />
                        <input
                          autoFocus
                          value={a.handle}
                          onChange={(e) => {
                            handleTouched.current = true
                            setSkipAccount(false)
                            set({ handle: e.target.value.replace(/^@/, '') })
                          }}
                          maxLength={60}
                          placeholder="yourbrand"
                          className={cn(inputClass, 'h-12 pl-10 font-mono text-[15px]', skipAccount && 'opacity-50')}
                        />
                      </span>
                      {!valid && a.handle.trim() && <p className="mt-2 text-[12px] text-fail">Letters, numbers, dots, dashes and underscores, as it appears on {PLATFORMS[a.platform].name}.</p>}
                    </motion.div>
                    <Actions
                      onBack={back}
                      onNext={next}
                      disabled={!valid}
                      extra={
                        <button
                          type="button"
                          onClick={() => {
                            setSkipAccount(true)
                            go(4)
                          }}
                          className="text-[12.5px] text-dim transition-colors hover:text-fg"
                        >
                          I’ll add accounts later
                        </button>
                      }
                    />
                  </>
                )}

                {step === 4 && (
                  <>
                    <Eyebrow index={4}>Rhythm</Eyebrow>
                    <Title>
                      How often do you <Serif>post?</Serif>
                    </Title>
                    <Lead>These become your posting times. “Add to queue” drops each approved post into the next free one.</Lead>
                    <motion.div variants={rise} role="radiogroup" aria-label="Posting rhythm" className="mt-9 space-y-2">
                      {RHYTHMS.map((r) => {
                        const on = a.rhythm === r.id
                        return (
                          <button
                            key={r.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => set({ rhythm: r.id })}
                            className={cn(
                              'relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-5 rounded-xl border px-4 py-3 text-left transition-[border-color,background-color] duration-300',
                              on ? 'border-transparent' : 'border-line-2 hover:border-white/25 hover:bg-white/[0.02]',
                            )}
                          >
                            {on && <motion.span layoutId="onb-rhythm" transition={SLIDE} className="absolute inset-0 rounded-xl border border-accent/70 bg-accent/[0.08]" />}
                            <span className="relative min-w-0">
                              <span className="block text-[14px] font-medium">{r.name}</span>
                              <span className="block truncate text-[12.5px] text-muted">{r.detail}</span>
                            </span>
                            <span className="relative w-28">
                              <WeekDots slots={r.slots} />
                            </span>
                          </button>
                        )
                      })}
                    </motion.div>
                    <motion.p variants={rise} className="mt-4 text-[12px] text-dim">
                      Times are in {me.timezone ?? 'UTC'}. You can change them any time in Automations.
                    </motion.p>
                    <Actions onBack={back} onNext={next} />
                  </>
                )}

                {step === 5 && (
                  <>
                    <Eyebrow index={5}>Look</Eyebrow>
                    <Title>
                      Make it <Serif>yours.</Serif>
                    </Title>
                    <Lead>Pick a palette. The whole studio changes with it, starting now. You can switch any time in Settings.</Lead>
                    <motion.div variants={rise} role="radiogroup" aria-label="Palette" className="mt-9 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {PALETTES.map((p) => {
                        const on = a.palette === p.id
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={(e) => pickPalette(p.id, e.currentTarget)}
                            className={cn(
                              'rounded-xl border p-2 text-left transition-[border-color,background-color] duration-300',
                              on ? 'border-accent/70 bg-accent/[0.08]' : 'border-line-2 hover:border-white/25',
                            )}
                          >
                            <Chip swatch={p.swatch} />
                            <span className="mt-2 flex items-center justify-between px-0.5">
                              <span className="text-[12.5px]">{p.name}</span>
                              {on && <Check className="size-3.5 text-accent" strokeWidth={2.5} />}
                            </span>
                          </button>
                        )
                      })}
                    </motion.div>
                    <Actions onBack={back} onNext={next} label="Build my studio" />
                  </>
                )}

                {step === FINALE && (
                  <>
                    <Eyebrow>{settled ? 'Ready' : 'Setting up'}</Eyebrow>
                    <Title>
                      {settled ? (
                        <>
                          Your studio is <Serif>ready.</Serif>
                        </>
                      ) : (
                        <>
                          Building your <Serif>studio…</Serif>
                        </>
                      )}
                    </Title>
                    <motion.ul variants={rise} className="mt-9 space-y-3.5">
                      {TASKS.map((t) => (
                        <TaskRow key={t} id={t} state={tasks[t].state} label={labels[t]} note={tasks[t].note} />
                      ))}
                    </motion.ul>
                    {post && (
                      <motion.div variants={rise} className="mt-8 lg:hidden">
                        <FirstPost a={a} post={post} />
                      </motion.div>
                    )}
                    <motion.div variants={rise} className="mt-10 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => close(true)}
                        disabled={!settled || closing}
                        className="group flex h-11 items-center gap-2 rounded-lg bg-fg px-5 text-[14px] font-medium text-ink transition-[background-color,opacity] duration-300 hover:bg-white disabled:opacity-40"
                      >
                        {closing ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        Enter your studio
                        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                      </button>
                      {settled && canRetry && tasks.post.state === 'done' && (
                        <button
                          type="button"
                          onClick={retry}
                          className="flex h-11 items-center gap-2 rounded-lg border border-line-2 px-4 text-[13px] text-muted transition-colors hover:border-white/30 hover:text-fg"
                        >
                          <RotateCcw className="size-3.5" strokeWidth={1.75} />
                          Write another version
                        </button>
                      )}
                    </motion.div>
                    <motion.p variants={rise} className="mt-5 max-w-[46ch] text-[12.5px] leading-relaxed text-dim">
                      Your first post is a draft. Edit it, give it a time, or leave it: nothing is published until you say so.
                    </motion.p>
                  </>
                )}

                {error && <p className="mt-4 text-[12.5px] text-fail">{error}</p>}
              </motion.section>
            </AnimatePresence>
          </div>
        </div>

        <div className="relative hidden min-h-0 items-center justify-center overflow-hidden border-l border-line bg-ink-2 lg:flex">
          <div
            aria-hidden
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage: 'linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(65% 60% at 50% 50%, #000, transparent)',
            }}
          />
          <div aria-hidden className="absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.16] blur-[120px] transition-colors duration-700" />
          <div className="relative w-full max-w-[640px] px-12 [perspective:1600px] xl:px-16">
            <AnimatePresence mode="wait">
              {step === 0 ? (
                <motion.div
                  key="showcase"
                  className="flex h-[520px] items-center"
                  exit={{ opacity: 0, scale: 0.86, rotateY: 22, filter: 'blur(10px)', transition: { duration: 0.55, ease } }}
                >
                  <Showcase scene={scene} />
                </motion.div>
              ) : (
                <motion.div key="studio">
                  <Preview a={a} step={step} name={firstName(me.name)} post={post} accountShown={step >= 3 && !skipAccount} hits={hits} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
            {step === 0 ? `Fig. ${pad(scene + 1)} — ${SCENES[scene].title}, for a demo brand` : step === FINALE ? 'Your studio' : 'Your studio, as you build it'}
          </p>
        </div>
      </div>

      <Threads lines={lines} />

      {/* The palette wash's leading edge; placed and played from pickPalette. */}
      <span
        ref={ringRef}
        aria-hidden
        className="pointer-events-none fixed z-[155] rounded-full border-[3px] border-accent-glow opacity-0 shadow-[0_0_48px_8px_color-mix(in_oklab,var(--color-accent)_60%,transparent),inset_0_0_48px_8px_color-mix(in_oklab,var(--color-accent)_40%,transparent)]"
      />

      <AnimatePresence>
        {launching && (
          <motion.div
            className="fixed inset-0 z-[160] flex flex-col justify-between bg-accent px-5 py-6 text-on-accent md:px-10 md:py-8"
            initial={{ y: '100%', borderTopLeftRadius: '50% 14vh', borderTopRightRadius: '50% 14vh' }}
            animate={{ y: '0%', borderTopLeftRadius: '0% 0vh', borderTopRightRadius: '0% 0vh' }}
            transition={{ duration: 0.8, ease: easeInOut }}
          >
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] opacity-70">
              <span className="flex items-center gap-2">
                <LogoMark className="size-4" /> FlowAI
              </span>
              <span>Opening your studio</span>
            </div>
            <div className="overflow-hidden text-center">
              <motion.p
                className="font-serif text-[clamp(3.5rem,11vw,10rem)] italic leading-[1.05] tracking-[-0.02em]"
                initial={{ y: '110%' }}
                animate={{ y: '0%' }}
                transition={{ duration: 0.9, ease, delay: 0.3 }}
              >
                {a.brand.trim() || 'Your studio'}
              </motion.p>
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] opacity-70">
              <span>Create once. Publish everywhere.</span>
              <span>/dashboard</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */

function Eyebrow({ index, children }: { index?: number; children: ReactNode }) {
  return (
    <motion.p variants={rise} className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
      {index !== undefined && <span className="text-fg">({pad(index)})</span>}
      {index !== undefined && <span className="h-px w-8 bg-current opacity-40" />}
      {children}
    </motion.p>
  )
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1 id="onboarding-title" className="mt-6 overflow-hidden pb-[0.08em] text-[clamp(2.4rem,4.2vw,3.75rem)] font-medium leading-[0.98] tracking-[-0.045em]">
      <motion.span className="block origin-bottom-left" variants={{ hidden: { y: '105%', rotate: 4 }, show: { y: '0%', rotate: 0, transition: { duration: 1, ease } } }}>
        {children}
      </motion.span>
    </h1>
  )
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <motion.p variants={rise} className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-muted">
      {children}
    </motion.p>
  )
}

function Actions({ onBack, onNext, disabled, label = 'Continue', extra }: { onBack?: () => void; onNext: () => void; disabled?: boolean; label?: string; extra?: ReactNode }) {
  return (
    <motion.div variants={rise} className="mt-10 flex flex-wrap items-center gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid size-11 place-items-center rounded-lg border border-line-2 text-muted transition-colors hover:border-white/30 hover:text-fg"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </button>
      )}
      <button
        type="button"
        data-continue
        onClick={onNext}
        disabled={disabled}
        className="group flex h-11 items-center gap-2 rounded-lg bg-fg px-5 text-[14px] font-medium text-ink transition-[background-color,opacity] duration-300 hover:bg-white disabled:opacity-35"
      >
        {label}
        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
      </button>
      <span className="hidden items-center gap-1.5 font-mono text-[10.5px] text-dim sm:flex">
        or press Enter <CornerDownLeft className="size-3" />
      </span>
      {extra && <span className="ml-auto">{extra}</span>}
    </motion.div>
  )
}

function TaskRow({ id, state, label, note }: { id: TaskId; state: TaskState; label: string; note?: string }) {
  return (
    <li data-task={id} className={cn('flex items-start gap-3 transition-opacity duration-500', state === 'waiting' ? 'opacity-35' : 'opacity-100')}>
      <span
        className={cn(
          'mt-px grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-500',
          state === 'done' ? 'border-accent bg-accent text-on-accent' : state === 'failed' ? 'border-warn/50 text-warn' : 'border-line-2 text-dim',
        )}
      >
        {state === 'running' && <LoaderCircle className="size-3 animate-spin text-accent-soft" />}
        {state === 'done' && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
            <Check className="size-3" strokeWidth={3} />
          </motion.span>
        )}
        {state === 'skipped' && <Minus className="size-3" />}
        {state === 'failed' && <TriangleAlert className="size-2.5" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-[14.5px]', state === 'skipped' ? 'text-muted' : 'text-fg')}>{label}</span>
        {note && <span className="mt-0.5 block text-[12px] text-dim">{note}</span>}
      </span>
    </li>
  )
}
