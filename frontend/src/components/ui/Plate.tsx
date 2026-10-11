import { useRef, type ReactNode, type RefObject } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { cn } from '../../lib/cn'

/**
 * A painted backdrop for a section (paper, or the accent): it opens out from a rounded card
 * as the section arrives, and folds back in as it leaves. Put it first inside an `isolate` section.
 * `surface` names what it's painted as, so the site's bar can tell what it's floating over.
 */
export function Plate({ target, className, surface = 'paper' }: { target: RefObject<HTMLElement | null>; className: string; surface?: 'paper' | 'signal' }) {
  const { scrollYProgress: arrive } = useScroll({ target, offset: ['start end', 'start 0.2'] })
  const { scrollYProgress: leave } = useScroll({ target, offset: ['end 0.8', 'end start'] })
  const clipPath = useTransform([arrive, leave], ([a, b]: number[]) => {
    const open = Math.min(a, 1 - b)
    const side = (1 - open) * 4
    return `inset(${(1 - a) * 90}px ${side}vw ${b * 90}px ${side}vw round ${(1 - open) * 44}px)`
  })
  return <motion.div aria-hidden data-surface={surface} className={cn('absolute inset-0 -z-10', className)} style={{ clipPath }} />
}

/** Several sections sharing one sheet of paper, so the backdrop doesn't fold away between them. */
export function PaperChapter({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-thread-surface="paper" className="relative isolate text-ink">
      <Plate target={ref} className="bg-bone" />
      {children}
    </div>
  )
}
