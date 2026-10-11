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
  ghost: 'text-fg border border-line-2 hover:border-white/30 hover:bg-white/[0.04]',
}

export function Button({ href, children, variant = 'primary', size = 'md', arrow, className }: ButtonProps) {
  const onClick = useLinkClick(href)
  return (
    <Magnetic>
      <a
        href={href}
        onClick={onClick}
        className={cn(
          'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background-color,box-shadow,border-color] duration-300',
          sizes[size],
          variants[variant],
          className,
        )}
      >
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
