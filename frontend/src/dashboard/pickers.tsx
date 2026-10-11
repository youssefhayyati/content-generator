import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsUpDown, Clock3 } from 'lucide-react'
import { cn } from '../lib/cn'
import { ease } from '../lib/motion'
import { inputClass } from './field'

/*
 * The studio's own pickers: a select, a date, a time and a date-and-time field. The browser's are
 * drawn by the system and can't be dressed, so these stand in for them with the same values going
 * in and out (an <option> list; 'YYYY-MM-DD', 'HH:MM', 'YYYY-MM-DDTHH:MM') and the same onChange
 * (e.target.value), and open a pane of glass instead: a Popover.
 */

/* ------------------------------------------------------------------ */
/* Popover                                                             */
/* ------------------------------------------------------------------ */

const GAP = 6
const EDGE = 8

type Place = { left: number; top?: number; bottom?: number; minWidth?: number; maxHeight: number; up: boolean }

/**
 * A pane of glass anchored to something: under it, or over it when there's more room there; kept
 * inside the window, and following its anchor while the page scrolls. Closes on a click outside,
 * on Escape (which stops there: a sheet behind it stays open) and when its anchor scrolls away.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  match,
  align = 'left',
  label,
  className,
  onKeyDown,
}: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: ReactNode
  /** At least as wide as the anchor. */
  match?: boolean
  align?: 'left' | 'right'
  label?: string
  className?: string
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    if (!open) return setPlace(null)
    const measure = () => {
      const a = anchor.current
      if (!a) return
      const r = a.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight) return close.current()
      const h = ref.current?.scrollHeight ?? 0
      const w = ref.current?.offsetWidth ?? r.width
      const below = window.innerHeight - r.bottom - GAP - EDGE
      const above = r.top - GAP - EDGE
      const up = h > below && above > below
      const left = Math.max(EDGE, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - EDGE))
      setPlace({
        left,
        top: up ? undefined : r.bottom + GAP,
        bottom: up ? window.innerHeight - r.top + GAP : undefined,
        minWidth: match ? r.width : undefined,
        maxHeight: Math.max(160, up ? above : below),
        up,
      })
    }
    measure()
    // Once more when it has been drawn and its real size is known.
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, anchor, align, match])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) close.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchor])

  // The keys go to the pane while it's open, and back to what opened it after.
  useEffect(() => {
    if (!open) return
    const a = anchor.current
    // A pane with its own keys (the month) asks for them; otherwise the pane itself takes them.
    const t = window.setTimeout(() => (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current)?.focus({ preventScroll: true }))
    return () => {
      window.clearTimeout(t)
      if (ref.current?.contains(document.activeElement)) a?.focus({ preventScroll: true })
    }
  }, [open, anchor])

  return createPortal(
    <AnimatePresence>
      {open && place && (
        <motion.div
          ref={ref}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          data-lenis-prevent
          onKeyDown={onKeyDown}
          // A pane opened from inside another popover is outside it in the page: its clicks stop here,
          // so that popover's "clicked elsewhere" doesn't close it and take this pane with it.
          onPointerDown={(e) => e.nativeEvent.stopPropagation()}
          style={{ position: 'fixed', left: place.left, top: place.top, bottom: place.bottom, minWidth: place.minWidth, maxHeight: place.maxHeight, transformOrigin: place.up ? 'bottom' : 'top' }}
          className={cn('glass-menu z-[140] overflow-y-auto overscroll-contain rounded-[11px] p-1 text-fg outline-none', className)}
          initial={{ opacity: 0, scale: 0.96, y: place.up ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16, ease }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** What a field hands its onChange: the one thing every handler here reads, e.target.value. */
const changed = <T,>(value: string, name?: string) => ({ target: { value, name }, currentTarget: { value, name } }) as unknown as ChangeEvent<T>

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

type Option = { value: string; label: ReactNode; text: string; disabled?: boolean; group?: string }

const textOf = (node: ReactNode): string =>
  node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : ''

/** The <option>s (and <optgroup>s) given as children, read as a list. */
function readOptions(children: ReactNode, group?: string): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>(child)) return []
    if (child.type === Fragment) return readOptions(child.props.children, group)
    if (child.type === 'optgroup') return readOptions(child.props.children, child.props.label)
    if (child.type !== 'option') return []
    const text = textOf(child.props.children)
    return [{ value: String(child.props.value ?? text), label: child.props.children, text, disabled: child.props.disabled, group }]
  })
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'multiple'> & {
  /** The field's own classes, in place of the usual input look (a smaller one in a toolbar, say). */
  fieldClassName?: string
}

/**
 * A select, written the way a native one is (<option> children, value, onChange), that opens a
 * glass list: a tick beside the chosen one, the palette under the pointer. Arrows, Home and End,
 * Enter, typing the first letters and Escape all work.
 */
export function Select({ className, fieldClassName, children, value, defaultValue, onChange, disabled, name, id, title, autoFocus, ...rest }: SelectProps) {
  const options = useMemo(() => readOptions(children), [children])
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [own, setOwn] = useState(() => (defaultValue == null ? undefined : String(defaultValue)))
  const current = value == null ? own : String(value)
  const chosen = options.find((o) => o.value === current) ?? options[0]
  const [active, setActive] = useState(0)
  const typed = useRef({ text: '', at: 0 })

  const show = () => {
    if (disabled) return
    setActive(Math.max(0, chosen ? options.indexOf(chosen) : 0))
    setOpen(true)
  }
  const pick = (o: Option) => {
    if (o.disabled) return
    setOpen(false)
    setOwn(o.value)
    if (o.value !== current) onChange?.(changed<HTMLSelectElement>(o.value, name))
  }
  const step = (from: number, by: number) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (!options[i].disabled) return i
    return from
  }
  // Typing letters jumps to the first option that starts with them, as a native select does.
  const seek = (key: string) => {
    const now = Date.now()
    typed.current = { text: now - typed.current.at > 700 ? key : typed.current.text + key, at: now }
    const hit = options.findIndex((o) => !o.disabled && o.text.toLowerCase().startsWith(typed.current.text.toLowerCase()))
    return hit
  }

  useEffect(() => {
    if (open) list.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => step(i, 1))
    else if (e.key === 'ArrowUp') setActive((i) => step(i, -1))
    else if (e.key === 'Home') setActive(step(-1, 1))
    else if (e.key === 'End') setActive(step(options.length, -1))
    else if (e.key === 'Enter' || e.key === ' ') options[active] && pick(options[active])
    else if (e.key === 'Tab') return setOpen(false)
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const hit = seek(e.key)
      if (hit >= 0) setActive(hit)
    } else return
    e.preventDefault()
  }
  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      show()
    } else if (e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const hit = seek(e.key)
      if (hit >= 0) pick(options[hit])
    }
  }

  let lastGroup: string | undefined
  return (
    <span className={cn('relative block', className)}>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={rest['aria-label']}
        aria-labelledby={rest['aria-labelledby']}
        aria-invalid={rest['aria-invalid']}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onTriggerKey}
        className={cn(fieldClassName ?? inputClass, 'flex items-center gap-2 text-left', open && 'border-accent-soft/60')}
      >
        <span className="min-w-0 flex-1 truncate">{chosen?.label}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} />
      </button>
      {name && <input type="hidden" name={name} value={current ?? ''} />}

      <Popover anchor={trigger} open={open} onClose={() => setOpen(false)} match onKeyDown={onListKey} label={rest['aria-label']} className="max-w-[min(420px,calc(100vw-16px))]">
        <div ref={list} role="listbox" onPointerLeave={() => setActive(chosen ? Math.max(0, options.indexOf(chosen)) : 0)}>
          {options.map((o, i) => {
            const head = o.group !== lastGroup ? o.group : undefined
            lastGroup = o.group
            return (
              <Fragment key={`${o.value}-${i}`}>
                {head && <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-dim first:pt-1">{head}</p>}
                <div
                  role="option"
                  aria-selected={o === chosen}
                  aria-disabled={o.disabled}
                  data-active={i === active}
                  onPointerMove={() => !o.disabled && setActive(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    'flex items-center gap-2 rounded-[7px] py-1.5 pl-2 pr-3 text-[13px] leading-tight',
                    o.disabled ? 'text-dim' : i === active ? 'bg-accent text-on-accent' : 'text-fg',
                  )}
                >
                  <Check className={cn('size-3.5 shrink-0', o === chosen ? 'opacity-100' : 'opacity-0')} strokeWidth={2.25} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </div>
              </Fragment>
            )
          })}
        </div>
      </Popover>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Dates and times                                                     */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** 'YYYY-MM-DD' as a local day (new Date() on that string would read it as UTC). */
const day = (s: string | undefined | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
const clock = (s: string | undefined | null) => {
  const m = /(\d{2}):(\d{2})/.exec(s ?? '')
  return m ? { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) } : null
}
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

type FieldProps = {
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  /** The field's classes; the usual input look when left out. */
  className?: string
  disabled?: boolean
  min?: string
  max?: string
  id?: string
  name?: string
  title?: string
  required?: boolean
  autoFocus?: boolean
  placeholder?: string
  'aria-label'?: string
  /** Typed dates have no "clear" of their own; this adds one to the pane. */
  clearable?: boolean
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
}

/** The button every date and time field is: the value written out, an icon, and the pane it opens. */
function FieldButton({
  refTo,
  open,
  onToggle,
  icon: Icon,
  text,
  empty,
  props,
}: {
  refTo: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: () => void
  icon: typeof CalendarDays
  text: string
  empty: boolean
  props: FieldProps
}) {
  return (
    <button
      ref={refTo}
      id={props.id}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={props['aria-label']}
      title={props.title}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      onClick={onToggle}
      onKeyDown={props.onKeyDown}
      className={cn(props.className ?? inputClass, 'flex items-center gap-2 text-left tabular-nums', open && 'border-accent-soft/60')}
    >
      <span className={cn('min-w-0 flex-1 truncate', empty && 'text-dim')}>{text}</span>
      <Icon className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} />
    </button>
  )
}

/** A month to pick a day from: arrows move by day and week, Page Up and Down by month. */
function MonthGrid({ value, onPick, min, max }: { value: Date | null; onPick: (d: Date) => void; min?: Date | null; max?: Date | null }) {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => value ?? today)
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  // Monday first, six rows: the month, with the days around it that share its weeks.
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  const same = (a: Date | null, b: Date) => !!a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const off = (d: Date) => (!!min && d < new Date(min.getFullYear(), min.getMonth(), min.getDate())) || (!!max && d > new Date(max.getFullYear(), max.getMonth(), max.getDate()))
  const move = (days: number, months = 0) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + months, c.getDate() + days))

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowUp') move(-7)
    else if (e.key === 'ArrowDown') move(7)
    else if (e.key === 'PageUp') move(0, -1)
    else if (e.key === 'PageDown') move(0, 1)
    else if (e.key === 'Enter' || e.key === ' ') !off(cursor) && onPick(cursor)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="w-[252px] p-1.5 outline-none" tabIndex={0} data-autofocus onKeyDown={onKey}>
      <div className="flex items-center justify-between pb-1.5 pl-1.5">
        <p className="text-[13px] font-medium">{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        <span className="flex">
          <button type="button" aria-label="Previous month" onClick={() => move(0, -1)} className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-fg">
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </button>
          <button type="button" aria-label="Next month" onClick={() => move(0, 1)} className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-fg">
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center">
        {WEEK.map((w) => (
          <span key={w} className="pb-1 text-[10.5px] font-medium text-dim">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth()
          const picked = same(value, d)
          const disabled = off(d)
          return (
            <button
              key={iso(d)}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              aria-pressed={picked}
              onClick={() => onPick(d)}
              className={cn(
                'mx-auto grid size-8 place-items-center rounded-full text-[12.5px] tabular-nums transition-colors',
                picked
                  ? 'bg-accent font-medium text-on-accent'
                  : disabled
                    ? 'text-dim/40'
                    : cn(inMonth ? 'text-fg' : 'text-dim', 'hover:bg-white/10', same(today, d) && 'text-accent-soft ring-1 ring-inset ring-accent-soft/50', same(cursor, d) && !same(value, d) && 'bg-white/[0.07]'),
              )}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Two columns to set a time from, hours and minutes; each opens on the one that's set. */
function TimeColumns({ value, onPick }: { value: { h: number; m: number } | null; onPick: (h: number, m: number) => void }) {
  const hours = useRef<HTMLDivElement>(null)
  const minutes = useRef<HTMLDivElement>(null)
  const h = value?.h ?? 9
  const m = value?.m ?? 0
  useLayoutEffect(() => {
    for (const col of [hours.current, minutes.current]) {
      const on = col?.querySelector<HTMLElement>('[aria-pressed=true]')
      if (col && on) col.scrollTop = on.offsetTop - col.clientHeight / 2 + on.offsetHeight / 2
    }
  }, [])
  const column = (ref: RefObject<HTMLDivElement | null>, label: string, count: number, at: number, set: (n: number) => void) => (
    <div ref={ref} role="group" aria-label={label} data-lenis-prevent className="no-scrollbar relative h-[232px] w-[58px] overflow-y-auto overscroll-contain py-1">
      {Array.from({ length: count }, (_, n) => (
        <button
          key={n}
          type="button"
          aria-pressed={n === at}
          onClick={() => set(n)}
          className={cn('mx-auto grid h-7 w-[46px] place-items-center rounded-[7px] text-[13px] tabular-nums transition-colors', n === at ? 'bg-accent font-medium text-on-accent' : 'text-fg hover:bg-white/10')}
        >
          {pad(n)}
        </button>
      ))}
    </div>
  )
  return (
    <div className="flex divide-x divide-white/10 p-0.5">
      {column(hours, 'Hour', 24, h, (n) => onPick(n, m))}
      {column(minutes, 'Minute', 60, m, (n) => onPick(h, n))}
    </div>
  )
}

function PaneFoot({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 flex items-center justify-between border-t border-white/10 px-1.5 pb-0.5 pt-1.5">{children}</div>
}
const footBtn = 'rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-white/10 hover:text-fg'

/** A date, in and out as 'YYYY-MM-DD' like <input type="date">. */
export function DateInput(props: FieldProps) {
  const { value, onChange, name, min, max, clearable, placeholder = 'Pick a date' } = props
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const date = day(value)
  const set = (v: string) => {
    setOpen(false)
    if (v !== (value ?? '')) onChange?.(changed<HTMLInputElement>(v, name))
  }
  return (
    <>
      <FieldButton
        refTo={ref}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        icon={CalendarDays}
        text={date ? date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : placeholder}
        empty={!date}
        props={props}
      />
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={props['aria-label'] ?? 'Pick a date'}>
        <MonthGrid value={date} onPick={(d) => set(iso(d))} min={day(min)} max={day(max)} />
        <PaneFoot>
          <button type="button" className={footBtn} onClick={() => set(iso(new Date()))}>
            Today
          </button>
          {clearable && value ? (
            <button type="button" className={footBtn} onClick={() => set('')}>
              Clear
            </button>
          ) : null}
        </PaneFoot>
      </Popover>
    </>
  )
}

/** A time, in and out as 'HH:MM' like <input type="time">. */
export function TimeInput(props: FieldProps) {
  const { value, onChange, name, placeholder = 'Pick a time' } = props
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const time = clock(value)
  return (
    <>
      <FieldButton refTo={ref} open={open} onToggle={() => setOpen((o) => !o)} icon={Clock3} text={time ? `${pad(time.h)}:${pad(time.m)}` : placeholder} empty={!time} props={props} />
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={props['aria-label'] ?? 'Pick a time'} className="!overflow-hidden">
        <TimeColumns value={time} onPick={(h, m) => onChange?.(changed<HTMLInputElement>(`${pad(h)}:${pad(m)}`, name))} />
        <PaneFoot>
          <span className="px-1 text-[11.5px] text-dim">Hour · minute</span>
          <button type="button" className={footBtn} onClick={() => setOpen(false)}>
            Done
          </button>
        </PaneFoot>
      </Popover>
    </>
  )
}

/** A day and a time together, in and out as 'YYYY-MM-DDTHH:MM' like <input type="datetime-local">. */
export function DateTimeInput(props: FieldProps) {
  const { value, onChange, name, min, max, placeholder = 'Pick a date and time' } = props
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const date = day(value)
  const time = clock(value?.split('T')[1])
  const emit = (d: Date | null, t: { h: number; m: number } | null) => {
    const on = d ?? new Date()
    const at = t ?? { h: 9, m: 0 }
    onChange?.(changed<HTMLInputElement>(`${iso(on)}T${pad(at.h)}:${pad(at.m)}`, name))
  }
  const text = date ? `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${time ? `${pad(time.h)}:${pad(time.m)}` : '--:--'}` : placeholder
  return (
    <>
      <FieldButton refTo={ref} open={open} onToggle={() => setOpen((o) => !o)} icon={CalendarDays} text={text} empty={!date} props={props} />
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={props['aria-label'] ?? 'Pick a date and time'} className="!overflow-hidden">
        <div className="flex divide-x divide-white/10">
          <MonthGrid value={date} onPick={(d) => emit(d, time)} min={day(min)} max={day(max)} />
          <TimeColumns value={time} onPick={(h, m) => emit(date, { h, m })} />
        </div>
        <PaneFoot>
          <button type="button" className={footBtn} onClick={() => emit(new Date(), time)}>
            Today
          </button>
          <button type="button" className={footBtn} onClick={() => setOpen(false)}>
            Done
          </button>
        </PaneFoot>
      </Popover>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

type Hsv = { h: number; s: number; v: number }
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const hexOk = (s: string | undefined | null) => (/^#[0-9a-f]{6}$/i.test(s ?? '') ? (s as string).toLowerCase() : /^#[0-9a-f]{3}$/i.test(s ?? '') ? `#${[...(s as string).slice(1)].map((c) => c + c).join('')}`.toLowerCase() : null)
function toHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max }
}
function toHex({ h, s, v }: Hsv) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}
const SWATCHES = ['#ffffff', '#0b0b0c', '#f43f5e', '#f59e0b', '#84cc16', '#06b6d4', '#6366f1', '#a855f7']

/** Where on a track or a square the pointer is, 0 to 1 each way, followed while it's held down. */
function useDrag(onMove: (x: number, y: number) => void) {
  const at = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height))
  }
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      at(e)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => e.currentTarget.hasPointerCapture(e.pointerId) && at(e),
  }
}

/** A field of the hue to pick shade and strength from, the hues on a bar under it, the hex to type, a few to start from. */
function ColorPane({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  // The hue is kept here: a grey has none of its own, and would lose the one being worked in.
  const [hsv, setHsv] = useState(() => toHsv(value))
  const [typed, setTyped] = useState(value)
  useEffect(() => {
    if (toHex(hsv) !== value) setHsv(toHsv(value))
    setTyped(value)
    // Only when the colour changes from outside: the local hue is otherwise the one to keep.
  }, [value])
  const set = (next: Hsv) => {
    setHsv(next)
    onPick(toHex(next))
  }
  const field = useDrag((x, y) => set({ ...hsv, s: x, v: 1 - y }))
  const hue = useDrag((x) => set({ ...hsv, h: Math.min(359.9, x * 360) }))

  return (
    <div className="w-[228px] space-y-2.5 p-2">
      <div
        {...field}
        role="slider"
        aria-label="Shade"
        aria-valuetext={value}
        className="relative h-[140px] cursor-crosshair touch-none rounded-[8px]"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)`, backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)' }}
      >
        <span className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0_/_0.5)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
      </div>
      <div
        {...hue}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        aria-valuemin={0}
        aria-valuemax={360}
        className="relative h-3 cursor-pointer touch-none rounded-full"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <span className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0_/_0.5)]" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-7 shrink-0 rounded-md border border-white/20" style={{ background: value }} />
        <input
          aria-label="Hex colour"
          value={typed}
          spellCheck={false}
          onChange={(e) => {
            setTyped(e.target.value)
            const ok = hexOk(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)
            if (ok) {
              setHsv(toHsv(ok))
              onPick(ok)
            }
          }}
          onBlur={() => setTyped(value)}
          className={cn(inputClass, 'h-7 px-2 font-mono text-[12px] uppercase')}
        />
      </div>
      <div className="flex justify-between">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => {
              setHsv(toHsv(c))
              onPick(c)
            }}
            className={cn('size-5 rounded-full border transition-transform hover:scale-110', c === value ? 'border-white ring-2 ring-white/25' : 'border-white/20')}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * A colour, in and out as '#rrggbb' like <input type="color">. The button takes the caller's
 * classes (a swatch, or an invisible cover over one of their own) and is filled with the colour;
 * onBlur is given the colour when the pane closes, as leaving a native field would.
 */
export function ColorInput({
  value,
  onChange,
  onBlur,
  className,
  id,
  name,
  title,
  disabled,
  ...rest
}: {
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  onBlur?: (e: ChangeEvent<HTMLInputElement>) => void
  className?: string
  id?: string
  name?: string
  title?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const hex = hexOk(value) ?? '#ffffff'
  const latest = useRef(hex)
  latest.current = hex
  const close = () => {
    setOpen(false)
    onBlur?.(changed<HTMLInputElement>(latest.current, name))
  }
  return (
    <>
      <button
        ref={ref}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={rest['aria-label'] ?? 'Pick a colour'}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={className}
        style={{ backgroundColor: hex }}
      />
      {name && <input type="hidden" name={name} value={hex} />}
      <Popover anchor={ref} open={open} onClose={close} label={rest['aria-label'] ?? 'Pick a colour'} className="!overflow-hidden">
        <ColorPane value={hex} onPick={(v) => onChange?.(changed<HTMLInputElement>(v, name))} />
      </Popover>
    </>
  )
}

