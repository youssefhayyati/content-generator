import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ease } from '../../lib/motion'

/*
 * The thread: when a question is answered, a line of current runs from where it was answered
 * to the part of the studio it fills in, the same lit line the Flows canvas draws between steps.
 * Where it lands flashes. Only on screens wide enough to show the studio beside the questions.
 */

type Line = { id: number; d: string; spot: string }

export function useThread(onLand: (spot: string) => void) {
  const [lines, setLines] = useState<Line[]>([])
  const seq = useRef(0)

  const fire = useCallback(
    (from: Element | null, spot: string) => {
      const to = document.querySelector(`[data-spot="${spot}"]`)
      if (!from || !to || !window.matchMedia('(min-width: 1024px)').matches) return
      const a = from.getBoundingClientRect()
      const b = to.getBoundingClientRect()
      const x1 = a.right
      const y1 = a.top + a.height / 2
      const x2 = b.left + Math.min(24, b.width / 2)
      const y2 = b.top + b.height / 2
      const bend = (x2 - x1) * 0.55
      const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
      const id = ++seq.current
      setLines((l) => [...l, { id, d, spot }])
      window.setTimeout(() => onLand(spot), 760)
      window.setTimeout(() => setLines((l) => l.filter((x) => x.id !== id)), 950)
    },
    [onLand],
  )

  return { lines, fire }
}

export function Threads({ lines }: { lines: Line[] }) {
  return (
    <svg className="pointer-events-none fixed inset-0 z-[150] size-full" aria-hidden>
      <defs>
        <filter id="onb-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <AnimatePresence>
        {lines.map((l) => (
          <motion.g key={l.id} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
            <motion.path d={l.d} fill="none" stroke="var(--color-accent)" strokeWidth={7} strokeOpacity={0.35} filter="url(#onb-glow)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.75, ease }} />
            <motion.path d={l.d} fill="none" stroke="var(--color-accent-glow)" strokeWidth={1.75} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.75, ease }} />
            <circle r={5} fill="var(--color-accent-glow)" filter="url(#onb-glow)">
              <animateMotion dur="0.75s" path={l.d} fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.19 1 0.22 1" />
            </circle>
            <circle r={2.5} fill="#fff">
              <animateMotion dur="0.75s" path={l.d} fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.19 1 0.22 1" />
            </circle>
          </motion.g>
        ))}
      </AnimatePresence>
    </svg>
  )
}
