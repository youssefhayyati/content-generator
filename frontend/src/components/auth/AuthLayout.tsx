import { createContext, useContext, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Link, useEntryDelay } from '../../lib/router'
import { RollChars } from '../ui/Button'
import { Logo } from '../ui/Logo'
import { Marquee } from '../ui/Marquee'
import { LineReveal } from '../ui/Reveal'

/** Seconds before the first entrance starts; children stagger from there. */
export const EntryContext = createContext(0.1)

/** Fades and lifts its children in, `i` beats after the page's entry delay. */
export function Enter({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  const base = useContext(EntryContext)
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease, delay: base + i * 0.06 }}
    >
      {children}
    </motion.div>
  )
}

/**
 * Split screen: the form on the left, a live product scene on the right (lg and up).
 * The scene column stays pinned while a long form scrolls.
 */
export function AuthLayout({ children, visual }: { children: ReactNode; visual: ReactNode }) {
  const delay = useEntryDelay()

  return (
    <EntryContext.Provider value={delay}>
      <div className="relative grid min-h-dvh grid-cols-1 bg-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
        <div className="relative isolate flex min-h-dvh min-w-0 flex-col px-5 py-5 md:px-10 md:py-7">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/2 -z-10 h-96 w-[90%] -translate-x-1/2 rounded-[50%] bg-accent/10 blur-[120px]"
          />

          <Enter i={0} className="flex items-center justify-between">
            <Logo href="/" />
            <Link
              to="/"
              className="group flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted transition-colors duration-300 hover:text-fg"
            >
              <ArrowLeft className="size-3.5 transition-transform duration-500 ease-expo group-hover:-translate-x-1" strokeWidth={1.75} />
              <RollChars>Back to site</RollChars>
            </Link>
          </Enter>

          <main className="flex flex-1 items-center py-12 md:py-16">
            <div className="mx-auto w-full max-w-[420px]">{children}</div>
          </main>

          <Enter i={14} className="-mx-5 mb-5 md:-mx-10 lg:hidden">
            <Marquee className="border-y border-line py-3">
              {['Generate', 'Adapt', 'Schedule', 'Publish'].map((w) => (
                <span key={w} className="flex items-center gap-6 pr-6 font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
                  {w}
                  <span className="size-1 rounded-full bg-accent" />
                </span>
              ))}
            </Marquee>
          </Enter>

          <Enter
            i={14}
            className="flex items-center justify-between font-mono text-[11px] text-dim"
          >
            <span>© 2026 FlowAI</span>
            <span className="flex gap-4">
              <Link to="/privacy" className="transition-colors hover:text-fg">
                Privacy
              </Link>
              <Link to="/terms" className="transition-colors hover:text-fg">
                Terms
              </Link>
            </span>
          </Enter>
        </div>

        <aside className="sticky top-0 hidden h-dvh p-3 lg:block">{visual}</aside>
      </div>
    </EntryContext.Provider>
  )
}

/** Section-number eyebrow, a masked two-line headline, and an optional line of support copy. */
export function AuthHeading({
  index,
  eyebrow,
  lines,
  sub,
}: {
  index: string
  eyebrow: string
  lines: ReactNode[]
  sub?: ReactNode
}) {
  const base = useContext(EntryContext)
  return (
    <div>
      <Enter i={1}>
        <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          <span className="text-fg">({index})</span>
          <span className="h-px w-8 bg-current opacity-40" />
          <span>{eyebrow}</span>
        </p>
      </Enter>
      <LineReveal
        as="h1"
        play
        delay={base + 0.08}
        lines={lines}
        className="mt-6 text-[clamp(2.9rem,5.2vw,4.4rem)] font-medium leading-[0.92] tracking-[-0.05em]"
      />
      {sub && (
        <Enter i={3}>
          <p className="mt-5 max-w-[36ch] text-[16px] leading-snug text-muted">{sub}</p>
        </Enter>
      )}
    </div>
  )
}

/** Inline route link: underline draws in from the left, arrow nudges forward. */
export function AuthLink({
  to,
  children,
  back,
  plain,
  className,
}: {
  to: string
  children: ReactNode
  /** Arrow points back, before the label. */
  back?: boolean
  /** No arrow at all. */
  plain?: boolean
  className?: string
}) {
  return (
    <Link to={to} className={cn('group inline-flex items-center gap-1.5', className ?? 'text-fg')}>
      {back && (
        <ArrowLeft className="size-3.5 transition-transform duration-500 ease-expo group-hover:-translate-x-1" strokeWidth={1.75} />
      )}
      <span className="relative">
        {children}
        <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-500 ease-expo group-hover:origin-left group-hover:scale-x-100" />
      </span>
      {!back && !plain && (
        <ArrowRight className="size-3.5 transition-transform duration-500 ease-expo group-hover:translate-x-1" strokeWidth={1.75} />
      )}
    </Link>
  )
}
