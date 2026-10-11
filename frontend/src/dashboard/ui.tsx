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
import { STATE, type PostState } from './data'

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
  flush,
}: {
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** No padding around the body: for a list whose rows run edge to edge and pad themselves. */
  flush?: boolean
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 md:px-5 md:pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-medium">{title}</h2>}
            {sub && <p className="mt-0.5 text-[11.5px] text-dim">{sub}</p>}
          </div>
          {actions && <div className="flex max-w-full shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? 'mt-4' : 'p-4 md:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Mono uppercase label, as used across the landing-page mock UIs. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('font-mono text-[10px] uppercase tracking-[0.14em] text-dim', className)}>{children}</p>
}

/** A big title that slides up out of a mask, and the page's actions. */
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0">
        <h1 className="overflow-hidden pb-[0.1em] text-[clamp(1.9rem,3.4vw,2.75rem)] font-medium leading-[1] tracking-[-0.045em]">
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
  ghost: 'glass-control border border-line-2 text-fg hover:border-white/30 hover:bg-white/[0.1] disabled:text-dim',
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

export { inputClass } from './field'
export { ColorInput, DateInput, DateTimeInput, Popover, Select, TimeInput } from './pickers'

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
    <div role="radiogroup" aria-label={label} className={cn('glass-control flex rounded-lg border border-line p-0.5 text-[12px]', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 transition-colors',
            value === o.value ? 'text-fg' : 'text-dim hover:text-muted',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-[6px] bg-white/[0.16] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.2),0_1px_4px_rgb(0_0_0_/_0.35)]"
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
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 35 }}
        className={cn('size-3.5 rounded-full transition-colors duration-300', on ? 'bg-on-accent' : 'bg-white')}
      />
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
  full,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  className?: string
  /** Nearly the whole page, for looking at a picture or a video: lay it out with Viewer. */
  full?: boolean
  /** A wide sheet, for browsing a set of things. */
  wide?: boolean
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
          <div className="absolute inset-0 bg-ink/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            data-lenis-prevent
            // Never taller than the window: the title stays put and the body scrolls under it.
            className={cn(
              'glass-sheet relative flex w-full flex-col overflow-hidden rounded-2xl',
              full
                ? 'h-[calc(100dvh-2rem)] md:h-[calc(100dvh-3rem)] md:max-w-[calc(100vw-3rem)]'
                : // cn() only joins, and the stylesheet's order decides between two max-w-*: a width the
                  // caller asked for has to be the only one here.
                  cn('max-h-[calc(100dvh-2rem)] md:max-h-[calc(100dvh-3rem)]', !/\bmax-w-/.test(className ?? '') && (wide ? 'max-w-5xl' : 'max-w-md')),
              className,
            )}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.35, ease }}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5">
              <p className="min-w-0 truncate text-[13.5px] font-medium">{title}</p>
              <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-dim transition-colors hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Inside a full Modal: the picture or video as large as it fits, with its details and actions in a column beside it. */
export function Viewer({ media, children }: { media: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-5 sm:h-full sm:grid-cols-[minmax(0,1fr)_240px] sm:grid-rows-[minmax(0,1fr)]">
      <div className="flex h-[60dvh] items-center justify-center overflow-hidden rounded-lg bg-black sm:h-auto">{media}</div>
      <div className="flex flex-col gap-4 sm:min-h-0 sm:overflow-y-auto">{children}</div>
    </div>
  )
}

/** The classes for the img or video inside a Viewer: as large as it fits, never stretched. */
export const viewerMedia = 'max-h-full max-w-full object-contain'

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
              className="glass-menu z-[130] min-w-[200px] origin-top overflow-hidden rounded-[11px] p-1"
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
                    'flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px]',
                    item.danger ? 'text-fail hover:bg-fail hover:text-white' : 'text-fg hover:bg-accent hover:text-on-accent',
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
