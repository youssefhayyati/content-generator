import { useEffect, useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { ArrowUp } from 'lucide-react'
import { Logo } from './ui/Logo'

const REPO = 'https://github.com/youssefhayyati/content-generator'

// Every link goes somewhere real; anything without a page yet is left out.
const COLUMNS: Array<{ title: string; links: Array<[label: string, href: string]> }> = [
  {
    title: 'Product',
    links: [
      ['Features', '#features'],
      ['Automations', '#automations'],
      ['Platforms', '#platforms'],
      ['Security', '#security'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['Documentation', REPO],
      ['Guides', '#product'],
      ['API', `${REPO}/tree/master/backend/app/Http/Controllers/AgentController.php`],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['Privacy', '#resources'],
      ['Terms', '#resources'],
      ['Cookies', '#resources'],
    ],
  },
]

export function Footer() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] })
  const wordY = useTransform(scrollYProgress, [0, 1], ['40%', '0%'])

  return (
    <footer id="resources" ref={ref} className="relative overflow-hidden border-t border-line pt-20 md:pt-28">
      <div className="container-x">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-4">
            <Logo />
            <p className="mt-4 max-w-[26ch] text-[15px] leading-snug text-muted">AI-powered content automation.</p>
            <p className="mt-10 font-mono text-[11px] leading-relaxed text-dim">
              Built for people who’d
              <br />
              rather be making things.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-4 md:col-span-8">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{c.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {c.links.map(([l, href]) => (
                    <li key={l}>
                      <a
                        href={href}
                        {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
                        className="group relative text-[14px] text-muted transition-colors hover:text-fg"
                      >
                        {l}
                        <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-500 ease-expo group-hover:origin-left group-hover:scale-x-100" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-line py-6 font-mono text-[11px] text-dim">
          <span>© 2026 FlowAI. All rights reserved.</span>
          <a href="#top" className="group flex items-center gap-2 uppercase tracking-[0.16em] transition-colors hover:text-fg">
            Back to top
            <ArrowUp className="size-3.5 transition-transform duration-500 ease-expo group-hover:-translate-y-1" />
          </a>
        </div>
      </div>

      <Wordmark y={wordY} />
    </footer>
  )
}

const WORD = 'FlowAI'

/**
 * The closing wordmark. With a mouse, each letter swells toward the heaviest weight of the variable font
 * as the pointer comes near, and thins out as it leaves, so the word ripples under the cursor.
 */
function Wordmark({ y }: { y: MotionValue<string> }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const letters = useRef<Array<HTMLSpanElement | null>>([])
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reduce || !window.matchMedia('(pointer: fine)').matches) return
    let raf = 0
    let px = 0
    let py = 0
    let near = false

    const paint = () => {
      raf = 0
      const reach = window.innerWidth * 0.15
      letters.current.forEach((l) => {
        if (!l) return
        const r = l.getBoundingClientRect()
        const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2))
        // At rest (no pointer on the page) the letters go back to exactly how the word is styled.
        const k = Math.exp(-(d * d) / (2 * reach * reach))
        l.style.fontVariationSettings = near ? `'wght' ${Math.round(200 + 700 * k)}` : ''
        l.style.color = near ? `color-mix(in oklab, var(--color-fg) ${(5 + 13 * k).toFixed(1)}%, transparent)` : ''
      })
    }
    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      near = true
      if (!raf) raf = requestAnimationFrame(paint)
    }
    const onLeave = () => {
      near = false
      if (!raf) raf = requestAnimationFrame(paint)
    }

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        window.addEventListener('pointermove', onMove, { passive: true })
      } else {
        window.removeEventListener('pointermove', onMove)
        onLeave()
      }
    })
    io.observe(el)
    document.addEventListener('pointerleave', onLeave)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [reduce])

  return (
    <div aria-hidden className="pointer-events-none select-none overflow-hidden">
      <motion.p
        ref={ref}
        style={{ y }}
        className="-mb-[0.2em] text-center text-[27vw] font-semibold leading-[0.8] tracking-[-0.07em] text-fg/[0.06]"
      >
        {[...WORD].map((c, i) => (
          <span
            key={i}
            ref={(node) => void (letters.current[i] = node)}
            className="inline-block transition-[font-variation-settings,color] duration-700 ease-expo"
          >
            {c}
          </span>
        ))}
      </motion.p>
    </div>
  )
}
