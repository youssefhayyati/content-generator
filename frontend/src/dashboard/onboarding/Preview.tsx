import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bookmark, CalendarDays, Heart, Inbox, LayoutGrid, MessageCircle, PenLine, Repeat2 } from 'lucide-react'
import { LogoMark } from '../../components/ui/Logo'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { cn } from '../../lib/cn'
import { ease } from '../../lib/motion'
import { handleFrom, monogram, RHYTHMS, TONES, type Answers, type Slot } from './model'

export type FirstPostState = { text: string; writing: boolean }

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Reveals `text` at a typing pace, catching up as it streams in; starts over if the text is replaced. */
function useTyped(text: string) {
  const [shown, setShown] = useState('')
  const typed = useRef('')
  useEffect(() => {
    if (!text.startsWith(typed.current)) typed.current = ''
    let raf = 0
    const tick = () => {
      const s = typed.current
      if (s.length >= text.length) {
        typed.current = text
        setShown(text)
        return
      }
      typed.current = text.slice(0, s.length + Math.max(1, Math.min(3, Math.ceil((text.length - s.length) / 40))))
      setShown(typed.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text])
  return shown
}

/** The part of the studio the current question is filling in: lit, so the answer visibly lands somewhere. */
function Spot({ on, children, className }: { on: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg transition-[box-shadow,background-color] duration-500',
        on
          ? 'bg-accent/[0.07] shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-accent)_55%,transparent),0_0_32px_-8px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]'
          : 'shadow-[0_0_0_1px_transparent]',
        className,
      )}
    >
      {children}
    </div>
  )
}

const Bar = ({ w, className }: { w: string; className?: string }) => <span className={cn('block h-2 rounded-full bg-white/[0.07]', className)} style={{ width: w }} />

/** Seven days, a mark for each posting time: the rhythm as a picture. */
export function WeekDots({ slots, size = 'sm' }: { slots: Slot[]; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('grid grid-cols-7', size === 'md' ? 'gap-1.5' : 'gap-1')}>
      {DAYS.map((d, i) => {
        const n = slots.filter((s) => s.weekday === i + 1).length
        return (
          <span key={i} className="flex flex-col items-center gap-1">
            {size === 'md' && <span className="font-mono text-[9px] text-dim">{d}</span>}
            <span className={cn('flex w-full flex-col justify-end gap-[3px] rounded-[5px] bg-white/[0.04] p-[3px]', size === 'md' ? 'h-14' : 'h-6 min-w-3')}>
              {Array.from({ length: n }, (_, k) => (
                <motion.span
                  key={k}
                  layout
                  initial={{ scaleY: 0, opacity: 0 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ duration: 0.4, ease, delay: i * 0.03 }}
                  className={cn('block origin-bottom rounded-[3px] bg-accent', size === 'md' ? 'h-2' : 'h-1')}
                />
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** The first post as it will look in the feed, typing itself in. */
export function FirstPost({ a, post, className }: { a: Answers; post: FirstPostState; className?: string }) {
  const shown = useTyped(post.text)
  const typing = post.writing || shown.length < post.text.length
  const brand = a.brand.trim()
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-line-2 bg-panel-2', className)}>
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-[14px] font-semibold text-on-accent">{monogram(brand)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{brand}</span>
          <span className="block truncate text-[11.5px] text-dim">@{a.handle || handleFrom(brand)} · Draft</span>
        </span>
        <PlatformIcon id={a.platform} className="size-4 text-muted" />
      </div>
      <div className="min-h-[7.5rem] px-4 pb-4 pt-3 text-[14px] leading-relaxed">
        {shown ? (
          <p className="whitespace-pre-line">
            {shown}
            {typing && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-blink bg-accent" />}
          </p>
        ) : (
          <div className="space-y-2 pt-1">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent-soft">Writing in your voice…</p>
            <span className="skeleton block h-2.5 w-[92%] rounded-full" />
            <span className="skeleton block h-2.5 w-[78%] rounded-full" />
            <span className="skeleton block h-2.5 w-[55%] rounded-full" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-5 border-t border-line px-4 py-2.5 text-dim">
        <Heart className="size-4" strokeWidth={1.75} />
        <MessageCircle className="size-4" strokeWidth={1.75} />
        <Repeat2 className="size-4" strokeWidth={1.75} />
        <Bookmark className="ml-auto size-4" strokeWidth={1.75} />
      </div>
    </div>
  )
}

const NAV = [
  { label: 'Overview', icon: LayoutGrid },
  { label: 'Inbox', icon: Inbox },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Composer', icon: PenLine },
]

const partOfDay = () => {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
}

/**
 * A miniature of the studio that assembles itself as the questions are answered: the brand in the
 * corner, the account in the sidebar, the week filling with posting times, the voice, the palette,
 * and at the end the first post. Tilted like a product shot until it's finished, then square.
 */
export function Preview({ a, step, name, post, accountShown }: { a: Answers; step: number; name: string; post: FirstPostState | null; accountShown: boolean }) {
  const brand = a.brand.trim()
  const about = a.about.trim()
  const tone = TONES.find((t) => t.id === a.tone)!
  // The week stays empty until the rhythm question: nothing appears before it's been asked.
  const slots = step >= 4 ? RHYTHMS.find((r) => r.id === a.rhythm)!.slots : []
  const finale = step === 6

  return (
    <div className="relative [perspective:1800px]">
      <motion.div
        initial={{ opacity: 0, y: 30, rotateX: 6, rotateY: -12 }}
        animate={finale ? { opacity: 0.4, x: 64, y: -56, rotateX: 0, rotateY: 0, scale: 0.86 } : { opacity: 1, x: 0, y: 0, rotateX: 4, rotateY: -9, scale: 1 }}
        transition={{ duration: 1.2, ease }}
        style={{ transformStyle: 'preserve-3d' }}
        className="overflow-hidden rounded-2xl border border-line-2 bg-panel shadow-[0_70px_140px_-50px_rgb(0_0_0_/_0.95)]"
      >
        <div className="flex h-9 items-center gap-1.5 border-b border-line px-3.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 rounded-full bg-white/12" />
          ))}
          <span className="ml-3 truncate rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-dim">flowai / {handleFrom(brand) || 'your-studio'}</span>
        </div>

        <div className="grid h-[430px] grid-cols-[156px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-3 border-r border-line bg-panel-2/60 p-2.5">
            <Spot on={step === 1} className="flex items-center gap-2 p-1.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-[13px] font-semibold text-on-accent transition-colors duration-500">
                {brand ? (
                  <motion.span key={monogram(brand)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4, ease }}>
                    {monogram(brand)}
                  </motion.span>
                ) : (
                  <LogoMark className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                {brand ? <span className="block truncate text-[12px] font-medium">{brand}</span> : <Bar w="80%" />}
                <span className="mt-0.5 block text-[10px] text-dim">studio</span>
              </span>
            </Spot>

            <div className="space-y-0.5">
              {NAV.map((n, i) => (
                <span key={n.label} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]', i === 0 ? 'bg-white/[0.06] text-fg' : 'text-dim')}>
                  <n.icon className="size-3.5" strokeWidth={1.75} />
                  {n.label}
                </span>
              ))}
            </div>

            <div>
              <p className="px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-dim">Accounts</p>
              <Spot on={step === 3} className="mt-1.5 p-1.5">
                <AnimatePresence mode="wait" initial={false}>
                  {accountShown && a.handle ? (
                    <motion.span
                      key={a.platform + a.handle}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35, ease }}
                      className="flex items-center gap-1.5 text-[11px]"
                    >
                      <PlatformIcon id={a.platform} className="size-3" />
                      <span className="truncate">@{a.handle.replace(/^@/, '')}</span>
                    </motion.span>
                  ) : (
                    <motion.span key="none" className="flex items-center gap-1.5" exit={{ opacity: 0 }}>
                      <span className="size-3 shrink-0 rounded bg-white/[0.07]" />
                      <Bar w="70%" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </Spot>
            </div>
          </aside>

          <main className="flex min-w-0 flex-col gap-3 p-4">
            <div>
              <p className="text-[17px] font-medium tracking-[-0.02em]">
                Good {partOfDay()}, <Serif>{name}.</Serif>
              </p>
              <div className="mt-1 h-4">{about ? <p className="truncate text-[11px] text-muted">{about}</p> : <Bar w="60%" className="mt-1.5" />}</div>
            </div>

            <Spot on={step === 4} className="border border-line p-3">
              <span className="flex items-center justify-between">
                <span className="text-[11px] font-medium">This week</span>
                <span className="font-mono text-[9.5px] text-dim">{slots.length ? `${slots.length} times` : 'no times yet'}</span>
              </span>
              <span className="mt-2 block">
                <WeekDots slots={slots} />
              </span>
            </Spot>

            <Spot on={step === 2} className="border border-line p-3">
              <span className="flex items-center justify-between">
                <span className="text-[11px] font-medium">Voice</span>
                {step >= 2 && <span className="rounded-full border border-accent/40 px-2 py-px text-[9.5px] text-accent-soft">{tone.name}</span>}
              </span>
              <span className="mt-1.5 block h-8">
                {step >= 2 && brand ? (
                  <motion.span key={tone.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="line-clamp-2 text-[11px] leading-snug text-muted">
                    “{tone.line(brand)}”
                  </motion.span>
                ) : (
                  <span className="block space-y-1.5 pt-1">
                    <Bar w="90%" />
                    <Bar w="55%" />
                  </span>
                )}
              </span>
            </Spot>

            <Spot on={finale} className="min-h-0 flex-1 border border-line p-3">
              <span className="flex items-center justify-between">
                <span className="text-[11px] font-medium">Drafts</span>
                {post && <span className="rounded-full bg-white/[0.06] px-2 py-px text-[9.5px] text-muted">1</span>}
              </span>
              {post?.text ? (
                <span className="mt-2 flex gap-2">
                  <PlatformIcon id={a.platform} className="mt-0.5 size-3" />
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted">{post.text}</span>
                </span>
              ) : (
                <span className="mt-2.5 block space-y-1.5">
                  <Bar w="85%" />
                  <Bar w="40%" />
                </span>
              )}
            </Spot>
          </main>
        </div>
      </motion.div>

      {/* At the end the first post comes out of the window at full size, in front of it. */}
      <AnimatePresence>
        {finale && post && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease, delay: 0.35 }}
            className="absolute -bottom-10 -left-6 w-[400px] max-w-[85%]"
          >
            <FirstPost a={a} post={post} className="shadow-[0_50px_100px_-30px_rgb(0_0_0_/_0.95)]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
