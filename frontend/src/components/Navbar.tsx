import { useEffect, useRef, useState, type Ref } from 'react'
import { motion, useMotionValueEvent, useScroll, useSpring } from 'framer-motion'
import { useLenis } from 'lenis/react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useReady } from '../lib/ready'
import { Link } from '../lib/router'
import { useSession } from '../lib/session'
import { Menu } from './nav/Menu'
import { Button, RollChars } from './ui/Button'
import { Logo } from './ui/Logo'

/*
 * Logo on the left; the call to action and the menu button on the right, at every size.
 * At the top of the page the bar is a transparent, full-bleed strip. Once the page moves
 * it draws itself in to a floating sheet. The menu itself is a full-screen overlay.
 */
export function Navbar() {
  const ready = useReady()
  const lenis = useLenis()
  const { user } = useSession()
  const { scrollY, scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 })

  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [paper, setPaper] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)

  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0
    setScrolled(y > 24)
    // Get out of the way while reading down; come back as soon as the reader scrolls up.
    setHidden(y > 640 && y > prev + 2)
  })

  // What the bar is floating over. Over a paper chapter it turns to paper too, instead of a dark
  // smudge on a light page. The plates are clipped as they open and fold, and hit-testing follows
  // the clip, so this reads the paper actually showing under the bar, not the section's box.
  useEffect(() => {
    let raf = 0
    const look = () => {
      raf = 0
      // Where the bar sits when it's showing, even if right now it's tucked away above the page.
      const under = document.elementsFromPoint(window.innerWidth / 2, 40).find((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.surface)
      setPaper(under?.dataset.surface === 'paper')
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(look)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    look()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  // Only take the scroll away while the menu is open, and always hand it back,
  // including when the page unmounts underneath an open menu.
  useEffect(() => {
    if (!lenis || !open) return
    lenis.stop()
    return () => lenis.start()
  }, [open, lenis])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const sheet = scrolled && !open
  const shown = !hidden || open

  return (
    <>
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={ready ? { y: shown ? 0 : -110, opacity: 1 } : undefined}
        transition={{ duration: 0.8, ease }}
        className={cn('fixed inset-x-0 top-0 z-100', paper && sheet && 'nav-paper')}
      >
        <div className={cn('transition-[padding] duration-700 ease-expo', sheet ? 'px-2 pt-2 md:px-3 md:pt-3' : 'px-0 pt-0')}>
          <div
            className={cn(
              'nav-sheet relative mx-auto max-w-[1920px] overflow-hidden border transition-[border-radius,background-color,border-color,box-shadow] duration-700 ease-expo',
              sheet
                ? 'rounded-[18px] border-line bg-panel/80 shadow-[0_30px_80px_-30px_rgb(0_0_0_/_0.9)] backdrop-blur-xl backdrop-saturate-150'
                : 'rounded-none border-transparent bg-transparent',
            )}
          >
            <nav
              className={cn(
                'flex h-16 items-center justify-between gap-6 transition-[padding] duration-700 ease-expo',
                sheet ? 'pl-4 pr-2.5 md:pl-5' : 'px-4 md:px-6 xl:px-8',
              )}
            >
              <Logo />

              <div className="flex items-center gap-1.5">
                {!user && (
                  <Link
                    to="/login"
                    className="group relative hidden h-9 items-center px-3 text-[13.5px] text-muted transition-colors duration-300 hover:text-fg sm:flex"
                  >
                    <RollChars>Log in</RollChars>
                  </Link>
                )}
                <Button href={user ? '/dashboard' : '/signup'} size="sm" arrow className="max-sm:hidden">
                  {user ? 'Open Studio' : 'Start Creating'}
                </Button>
                <MenuButton ref={menuButton} open={open} onClick={() => setOpen((o) => !o)} />
              </div>
            </nav>

            {/* Reading progress, drawn along the bottom edge of the sheet. */}
            <motion.div
              aria-hidden
              style={{ scaleX: progress }}
              className={cn(
                'absolute inset-x-0 bottom-0 h-px origin-left bg-linear-to-r from-accent/0 via-accent-soft to-fg transition-opacity duration-700',
                sheet ? 'opacity-100' : 'opacity-0',
              )}
            />
          </div>
        </div>
      </motion.header>

      <Menu open={open} onClose={() => setOpen(false)} origin={menuButton} />
    </>
  )
}

function MenuButton({
  open,
  onClick,
  ref,
}: {
  open: boolean
  onClick: () => void
  ref: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      aria-controls="site-menu"
      onClick={onClick}
      className="group relative flex h-9 items-center gap-3 rounded-full border border-line-2 pl-4 pr-3.5 transition-colors duration-300 hover:border-fg/40 md:h-10"
    >
      <span className="relative block h-[14px] overflow-hidden font-mono text-[10.5px] uppercase leading-[14px] tracking-[0.14em]">
        <motion.span className="block" animate={{ y: open ? '-50%' : '0%' }} transition={{ duration: 0.6, ease }}>
          <span className="block">Menu</span>
          <span className="block">Close</span>
        </motion.span>
      </span>
      <span className="relative block h-3 w-4">
        <span
          className={cn(
            'absolute left-0 top-1/2 h-px w-4 bg-fg transition-transform duration-500 ease-expo',
            open ? 'rotate-45' : '-translate-y-[3.5px] group-hover:-translate-y-[4.5px]',
          )}
        />
        <span
          className={cn(
            'absolute right-0 top-1/2 h-px bg-fg transition-[transform,width] duration-500 ease-expo',
            open ? 'w-4 -rotate-45' : 'w-2.5 translate-y-[3.5px] group-hover:w-4 group-hover:translate-y-[4.5px]',
          )}
        />
      </span>
    </button>
  )
}
