import { useRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react'
import { motion, useInView } from 'framer-motion'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'

/** Italic serif accent used inside headlines. Extra props (data-thread…) pass straight through. */
export function Serif({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} className={cn('font-serif font-normal italic tracking-[-0.01em] pr-[0.04em]', className)}>
      {children}
    </span>
  )
}

type LineRevealProps = {
  lines: ReactNode[]
  as?: ElementType
  className?: string
  lineClassName?: string
  delay?: number
  /** Force the animation state (the hero waits for the preloader). Defaults to in-view. */
  play?: boolean
}

/**
 * Each line slides up from behind a mask. The in-view check sits on the parent:
 * the lines start fully clipped, so observing them directly would never fire.
 */
export function LineReveal({ lines, as: Tag = 'h2', className, lineClassName, delay = 0, play }: LineRevealProps) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' })
  const show = play ?? inView

  return (
    <Tag ref={ref} className={className}>
      {lines.map((line, i) => (
        <span key={i} className={cn('-mb-[0.12em] block overflow-hidden pb-[0.12em]', lineClassName)}>
          <motion.span
            className="block will-change-transform"
            initial={{ y: '108%' }}
            animate={{ y: show ? '0%' : '108%' }}
            transition={{ duration: 1.15, ease, delay: delay + i * 0.09 }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  )
}

type RevealProps = {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
  as?: 'div' | 'li' | 'p' | 'span' | 'figure'
}

export function Reveal({ children, className, delay = 0, y = 28, as = 'div' }: RevealProps) {
  const Comp = motion[as]
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.9, ease, delay }}
    >
      {children}
    </Comp>
  )
}
