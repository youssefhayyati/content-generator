import { useState, type MouseEvent, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { useLenis } from 'lenis/react'
import { cn } from '../../lib/cn'
import { ease, easeInOut } from '../../lib/motion'
import { formatTime, useClock } from '../../lib/useClock'
import { Link, queueSection, useRouter } from '../../lib/router'
import { useSession } from '../../lib/session'
import { NAV } from './links'

const GROUPS = NAV.flatMap((n) => n.menu?.groups ?? [])

/**
 * The site menu, full screen at every size. It opens as a circle growing out of the menu
 * button and closes back into it. Phones get the sections as one big list; from lg up the
 * sections sit on the left and every page under them on the right.
 */
export function Menu({
  open,
  onClose,
  origin,
}: {
  open: boolean
  onClose: () => void
  origin: RefObject<HTMLElement | null>
}) {
  const lenis = useLenis()
  const { user } = useSession()
  const { path, navigate } = useRouter()
  const [hovered, setHovered] = useState<number | null>(null)

  // Lenis ignores scrollTo while stopped, so restart it before jumping. Away from home, go there first.
  const go = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault()
    onClose()
    if (path !== '/') {
      queueSection(href)
      navigate('/')
    } else if (lenis) {
      lenis.start()
      lenis.scrollTo(href, { offset: -80 })
    } else {
      document.querySelector(href)?.scrollIntoView()
    }
  }

  const r = origin.current?.getBoundingClientRect()
  const cx = r ? r.left + r.width / 2 : window.innerWidth - 40
  const cy = r ? r.top + r.height / 2 : 32
  const radius = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy))

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="menu"
          id="site-menu"
          className="fixed inset-0 z-90 overflow-y-auto bg-ink-2"
          initial={{ clipPath: `circle(0px at ${cx}px ${cy}px)` }}
          animate={{ clipPath: `circle(${radius}px at ${cx}px ${cy}px)` }}
          exit={{ clipPath: `circle(0px at ${cx}px ${cy}px)` }}
          transition={{ duration: 0.85, ease: easeInOut }}
          data-lenis-prevent
        >
          <div className="mx-auto flex min-h-full max-w-[1920px] flex-col px-4 pb-6 pt-24 md:px-6 lg:pt-28 xl:px-8">
            <motion.p
              className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-dim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.6 }}
            >
              <span>(Menu)</span>
              <span>0{NAV.length} sections</span>
            </motion.p>

            <div className="mt-5 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-16 xl:gap-24">
              <ul onPointerLeave={() => setHovered(null)}>
                {NAV.map((l, i) => (
                  <li key={l.label} className="relative overflow-hidden" onPointerEnter={() => setHovered(i)}>
                    <motion.a
                      href={l.href}
                      onClick={(e) => go(e, l.href)}
                      className={cn(
                        'group flex items-center justify-between py-3 text-[clamp(2.6rem,7.2vw,7.5rem)] font-medium leading-[1.02] tracking-[-0.05em] transition-colors duration-500 lg:py-2',
                        hovered !== null && hovered !== i && 'text-fg/25',
                      )}
                      initial={{ y: '105%', rotate: 4 }}
                      animate={{ y: '0%', rotate: 0 }}
                      transition={{ duration: 0.9, ease, delay: 0.28 + i * 0.06 }}
                      style={{ transformOrigin: '0% 100%' }}
                    >
                      <span className="flex items-baseline gap-4 lg:gap-6">
                        <span className="w-6 font-mono text-[11px] tracking-normal text-dim">0{i + 1}</span>
                        <span className="transition-transform duration-700 ease-expo group-hover:translate-x-4 group-active:translate-x-2">
                          {l.label}
                        </span>
                      </span>
                      <ArrowUpRight
                        className="size-6 text-dim transition-[rotate,color] duration-500 ease-expo group-hover:rotate-45 group-hover:text-accent group-active:rotate-45 lg:size-10"
                        strokeWidth={1.25}
                      />
                    </motion.a>
                    <motion.span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-px origin-left bg-line"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 1.1, ease, delay: 0.35 + i * 0.06 }}
                    />
                  </li>
                ))}
              </ul>

              <motion.div
                className="grid grid-cols-2 content-start gap-x-6 gap-y-8 lg:pt-3"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease, delay: 0.55 }}
              >
                {GROUPS.map((g) => (
                  <div key={g.title}>
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">{g.title}</p>
                    <ul className="mt-3 space-y-2.5 lg:space-y-3.5">
                      {g.items.map((q) => {
                        const Icon = q.icon
                        return (
                          <li key={q.label}>
                            <a href={q.href} onClick={(e) => go(e, q.href)} className="group flex items-start gap-2.5">
                              <Icon
                                className="mt-[3px] size-3.5 shrink-0 text-dim transition-colors duration-300 group-hover:text-accent"
                                strokeWidth={1.75}
                              />
                              <span>
                                <span className="block text-[14px] text-muted transition-colors duration-300 group-hover:text-fg group-active:text-fg lg:text-[15px]">
                                  {q.label}
                                </span>
                                <span className="hidden text-[13px] leading-snug text-dim lg:block">{q.desc}</span>
                              </span>
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </motion.div>
            </div>

            <motion.div
              className="mt-auto grid grid-cols-2 gap-2.5 pt-10 lg:ml-auto lg:w-[420px]"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease, delay: 0.7 }}
            >
              {user ? (
                <Link
                  to="/dashboard"
                  onClick={onClose}
                  className="col-span-2 grid h-12 place-items-center rounded-full bg-fg text-[14px] font-medium text-ink"
                >
                  Open Studio
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={onClose}
                    className="grid h-12 place-items-center rounded-full border border-line-2 text-[14px] font-medium transition-colors hover:border-fg/40"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/signup"
                    onClick={onClose}
                    className="grid h-12 place-items-center rounded-full bg-fg text-[14px] font-medium text-ink transition-colors hover:bg-accent hover:text-on-accent"
                  >
                    Start creating
                  </Link>
                </>
              )}
            </motion.div>

            <MenuFooter />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function MenuFooter() {
  const now = useClock()
  return (
    <motion.div
      className="mt-6 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.85 }}
    >
      <span>Create once. Publish everywhere.</span>
      <span className="tabular-nums">{formatTime(now)}</span>
    </motion.div>
  )
}
