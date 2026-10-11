import { useRef, type PointerEvent, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useLinkClick } from '../../lib/router'

/** Pulls its child a little toward the pointer, then springs back. Mouse only. */
export function Magnetic({ children, strength = 0.3, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.4 })
  const sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.4 })

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    x.set((e.clientX - (r.left + r.width / 2)) * strength)
    y.set((e.clientY - (r.top + r.height / 2)) * strength)
  }
  const reset = () => {
    x.set(0)
    y.set(0)
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={{ x: sx, y: sy }}
      className={cn('inline-flex', className)}
    >
      {children}
    </motion.div>
  )
}

/** The label rolls up and is replaced by a copy of itself on hover. */
export function RollText({ children }: { children: ReactNode }) {
  return (
    <span className="relative block overflow-hidden">
      <span className="block transition-transform duration-500 ease-expo group-hover:-translate-y-full">{children}</span>
      <span aria-hidden className="absolute inset-0 block translate-y-full transition-transform duration-500 ease-expo group-hover:translate-y-0">
        {children}
      </span>
    </span>
  )
}

/**
 * Letter-by-letter RollText: each character rolls a beat after the one before it.
 * Hover is driven by the nearest `group` ancestor.
 */
export function RollChars({ children, stagger = 0.018 }: { children: string; stagger?: number }) {
  return (
    <span className="relative inline-flex overflow-hidden">
      <span className="sr-only">{children}</span>
      {[...children].map((c, i) => {
        const ch = c === ' ' ? ' ' : c
        const style = { transitionDelay: `${i * stagger}s` }
        return (
          <span key={i} aria-hidden className="relative inline-block">
            <span style={style} className="block transition-transform duration-500 ease-expo group-hover:-translate-y-full">
              {ch}
            </span>
            <span
              style={style}
              className="absolute inset-0 block translate-y-full transition-transform duration-500 ease-expo group-hover:translate-y-0"
            >
              {ch}
            </span>
          </span>
        )
      })}
    </span>
  )
}

type ButtonProps = {
  href: string
  children: ReactNode
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  arrow?: boolean
  className?: string
}

const sizes = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-14 px-7 text-[15px]',
}

const variants = {
  primary:
    'bg-fg text-ink hover:bg-white hover:shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-accent)_22%,transparent),0_10px_40px_-10px_color-mix(in_oklab,var(--color-accent)_60%,transparent)]',
  // Under a mouse the ghost fills from where the pointer came in (Fill, below); its label turns to ink.
  ghost: 'text-fg border border-line-2 hover:border-white/30 hover:bg-white/[0.04] [@media(pointer:fine)]:hover:border-fg [@media(pointer:fine)]:hover:bg-transparent [@media(pointer:fine)]:hover:text-ink',
}

/**
 * Where the pointer crossed into the button, and out of it again: a circle of the label's colour
 * grows from the entry point to fill the button, and on leaving shrinks back toward the exit, so
 * the fill follows the hand in and out. Mouse only; keyboard focus gets the plain hover.
 */
function useFill() {
  const ref = useRef<HTMLAnchorElement>(null)
  const place = (e: PointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType !== 'mouse' || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    ref.current.style.setProperty('--fx', `${e.clientX - r.left}px`)
    ref.current.style.setProperty('--fy', `${e.clientY - r.top}px`)
  }
  return { ref, onPointerEnter: place, onPointerLeave: place }
}

function Fill() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden rounded-[inherit] [@media(pointer:fine)]:block">
      <span className="absolute left-[var(--fx,50%)] top-[var(--fy,50%)] aspect-square w-[240%] -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-fg transition-transform duration-[650ms] ease-[cubic-bezier(0.33,1,0.68,1)] group-hover:scale-100" />
    </span>
  )
}

export function Button({ href, children, variant = 'primary', size = 'md', arrow, className }: ButtonProps) {
  const onClick = useLinkClick(href)
  const fill = useFill()
  const ghost = variant === 'ghost'
  return (
    <Magnetic>
      <a
        href={href}
        onClick={onClick}
        {...(ghost ? fill : {})}
        className={cn(
          'group relative isolate inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background-color,box-shadow,border-color,color,scale] duration-300 active:scale-[0.96] active:duration-100',
          sizes[size],
          variants[variant],
          className,
        )}
      >
        {ghost && <Fill />}
        <RollText>{children}</RollText>
        {arrow && (
          <ArrowRight
            className="size-4 transition-transform duration-500 ease-expo group-hover:-rotate-45"
            strokeWidth={1.75}
          />
        )}
      </a>
    </Magnetic>
  )
}
