import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { animate, AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { LoaderCircle, X, type LucideIcon } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import type { User } from '../lib/api'
import { PlatformIcon, type PlatformId } from '../components/ui/PlatformIcon'
import { useRouter } from '../lib/router'
import { STATE, type PostState } from './data'
import { pageIndex } from './nav'

/* ------------------------------------------------------------------ */
/* Surfaces                                                             */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  sub,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-4 pt-4 md:px-5 md:pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-medium">{title}</h2>}
            {sub && <p className="mt-0.5 text-[11.5px] text-dim">{sub}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4 md:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Mono uppercase label, as used across the landing-page mock UIs. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('font-mono text-[10px] uppercase tracking-[0.14em] text-dim', className)}>{children}</p>
}

/** "(02) — Library", a big title that slides up out of a mask, and the page's actions. */
export function PageHeader({
  index: given,
  eyebrow,
  title,
  sub,
  actions,
}: {
  /** Defaults to the page's place in the sidebar. */
  index?: string
  eyebrow: string
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  const { path } = useRouter()
  const index = given ?? pageIndex(path)
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0">
        <motion.p
          className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
        >
          <span className="text-fg">({index})</span>
          <span className="h-px w-8 bg-current opacity-40" />
          {eyebrow}
        </motion.p>
        <h1 className="mt-4 overflow-hidden pb-[0.1em] text-[clamp(1.9rem,3.4vw,2.75rem)] font-medium leading-[1] tracking-[-0.045em]">
          <motion.span
            className="block"
            initial={{ y: '105%' }}
            animate={{ y: '0%' }}
            transition={{ duration: 0.9, ease, delay: 0.05 }}
          >
            {title}
          </motion.span>
        </h1>
        {sub && (
          <motion.p
            className="mt-3 max-w-[60ch] text-[14px] leading-snug text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.25 }}
          >
            {sub}
          </motion.p>
        )}
      </div>
      {actions && (
        <motion.div
          className="flex flex-wrap items-center gap-2"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease, delay: 0.15 }}
        >
          {actions}
        </motion.div>
      )}
    </header>
  )
}

/** Children rise in one after another. */
export function Stagger({ i = 0, children, className }: { i?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease, delay: 0.1 + i * 0.05 }}
    >
      {children}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Controls                                                             */
/* ------------------------------------------------------------------ */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger'
  size?: 'sm' | 'md'
  icon?: LucideIcon
  loading?: boolean
}

const BTN_VARIANT = {
  primary: 'bg-fg text-ink hover:bg-white hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_20%,transparent)] disabled:bg-fg/50',
  ghost: 'border border-line-2 text-fg hover:border-white/30 hover:bg-white/[0.04] disabled:text-dim',
  subtle: 'text-muted hover:bg-white/[0.05] hover:text-fg disabled:text-dim',
  danger: 'border border-fail/30 text-fail hover:bg-fail/10 disabled:opacity-50',
}

export function Btn({ variant = 'ghost', size = 'md', icon: Icon, loading, children, className, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,border-color,box-shadow] duration-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[12.5px]',
        BTN_VARIANT[variant],
        className,
      )}
    >
      {loading ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        Icon && <Icon className="size-3.5" strokeWidth={1.75} />
      )}
      {children}
    </button>
  )
}

export const inputClass =
  'h-9 w-full rounded-md border border-line-2 bg-white/[0.02] px-3 text-[13px] text-fg outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-dim hover:border-white/20 focus:border-accent-soft/60 focus:bg-white/[0.03] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)] disabled:opacity-60 [color-scheme:dark]'

export function FieldError({ message }: { message: string | null | undefined }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          role="alert"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.35, ease }}
          className="overflow-hidden font-mono text-[11px] text-fail"
        >
          <span className="block pt-1.5">{message}</span>
        </motion.p>
      )}
    </AnimatePresence>
  )
}

/** A row of options with a pill that slides to the selected one. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  id,
  className,
  label,
}: {
  options: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (value: T) => void
  /** Unique per page, so pills in different controls don't animate between them. */
  id: string
  className?: string
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex rounded-md border border-line p-0.5 text-[12px]', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 transition-colors',
            value === o.value ? 'text-fg' : 'text-dim hover:text-muted',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-[5px] bg-white/[0.08]"
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            />
          )}
          <span className="relative flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-300',
        on ? 'justify-end border-accent/60 bg-accent' : 'justify-start border-line-2 bg-white/5',
      )}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 35 }} className="size-3.5 rounded-full bg-white" />
    </button>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('rounded border border-line-2 px-1 py-px font-mono text-[10px] text-dim', className)}>{children}</kbd>
  )
}

/* ------------------------------------------------------------------ */
/* Little things                                                        */
/* ------------------------------------------------------------------ */

export function StateBadge({ state, label, className }: { state: PostState; label?: string; className?: string }) {
  const s = STATE[state]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
        s.ring,
        s.text,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {label ?? s.label}
    </span>
  )
}

export function Platforms({ ids, className }: { ids: PlatformId[]; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-muted', className)}>
      {ids.map((id) => (
        <PlatformIcon key={id} id={id} className="size-3.5" />
      ))}
    </span>
  )
}

export function Avatar({ user, className }: { user: Pick<User, 'name' | 'avatar_url'>; className?: string }) {
  const [broken, setBroken] = useState(false)
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return user.avatar_url && !broken ? (
    <img
      src={user.avatar_url}
      alt=""
      onError={() => setBroken(true)}
      className={cn('size-7 shrink-0 rounded-full object-cover', className)}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full bg-[#2a2622] text-[10.5px] font-medium text-[#d8cbbb]',
        className,
      )}
    >
      {initials}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease }}
      className={cn('flex flex-col items-center px-6 py-14 text-center', className)}
    >
      <span className="relative grid size-12 place-items-center rounded-xl border border-line-2 text-muted">
        <span aria-hidden className="absolute inset-0 animate-ping rounded-xl border border-accent/20 [animation-duration:2.4s]" />
        <Icon className="size-5" strokeWidth={1.5} />
      </span>
      <p className="mt-5 text-[15px] font-medium tracking-[-0.01em]">{title}</p>
      {body && <p className="mt-1.5 max-w-[42ch] text-[13px] leading-snug text-dim">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  )
}

/** A number that counts up to its value the first time it's seen. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const from = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el || !inView) return
    if (reduce) {
      el.textContent = value.toLocaleString()
      return
    }
    const controls = animate(from.current, value, {
      duration: 1.1,
      ease,
      onUpdate: (v) => {
        el.textContent = Math.round(v).toLocaleString()
      },
    })
    from.current = value
    return () => controls.stop()
  }, [value, inView, reduce])

  return (
    <span ref={ref} className={className}>
      0
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Overlays                                                             */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  className?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            data-lenis-prevent
            className={cn(
              'relative w-full max-w-md overflow-hidden rounded-xl border border-line-2 bg-panel-2 shadow-[0_40px_120px_-30px_rgb(0_0_0_/_0.95)]',
              className,
            )}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.35, ease }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <p className="text-[13.5px] font-medium">{title}</p>
              <button type="button" onClick={onClose} aria-label="Close" className="text-dim transition-colors hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export type MenuItem = { label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; hint?: ReactNode }

/** Where the anchored dropdown should go, in viewport coordinates. */
function useAnchor(open: boolean, ref: RefObject<HTMLDivElement | null>, align: 'left' | 'right') {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos(align === 'right' ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: r.left })
  }, [open, ref, align])
  return pos
}

/** A small dropdown. Closes on outside click, Escape, scroll, or picking something. */
export function Menu({
  trigger,
  items,
  align = 'right',
  header,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
  header?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pos = useAnchor(open, ref, align)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = () => setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              role="menu"
              style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right }}
              className={cn(
                'z-[130] min-w-[200px] origin-top overflow-hidden rounded-lg border border-line-2 bg-panel-3 p-1 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)]',
              )}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.2, ease }}
            >
            {header}
            {items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors',
                    item.danger ? 'text-fail hover:bg-fail/10' : 'text-muted hover:bg-white/[0.06] hover:text-fg',
                  )}
                >
                  {Icon && <Icon className="size-3.5" strokeWidth={1.75} />}
                  <span className="flex-1">{item.label}</span>
                  {item.hint}
                </button>
              )
            })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
