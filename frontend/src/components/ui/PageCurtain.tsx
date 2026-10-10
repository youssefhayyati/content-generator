import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ease, easeInOut } from '../../lib/motion'
import { isAppPath, useRouter } from '../../lib/router'
import { LogoMark } from './Logo'

const LABELS: Record<string, string> = {
  '/': 'Home',
  '/login': 'Log in',
  '/signup': 'Sign up',
  '/forgot-password': 'Reset',
  '/reset-password': 'Reset',
  '/privacy': 'Privacy',
  '/terms': 'Terms',
  '/cookies': 'Cookies',
}

const labelFor = (path: string) => (isAppPath(path) ? 'Studio' : (LABELS[path] ?? 'FlowAI'))

// Each layer is 100vh tall with a 15vh curved cap above and below it, so it travels
// 115vh to clear the screen completely in either direction.
const COVER = { duration: 0.75, ease: easeInOut }
const REVEAL = { duration: 0.85, ease: easeInOut }
const LAG = 0.09

// Same command structure in every state so the curve can morph.
const TOP_BULGE = 'M0 100 Q50 0 100 100 Z'
const TOP_FLAT = 'M0 100 Q50 100 100 100 Z'
const BOTTOM_FLAT = 'M0 0 Q50 0 100 0 Z'
const BOTTOM_BULGE = 'M0 0 Q50 100 100 0 Z'

/**
 * The page-to-page wipe. A thin band of bone leads, the dark panel carrying the
 * destination's name follows, and both leading edges arrive curved and settle flat.
 */
export function PageCurtain() {
  const { phase, target, covered, revealed } = useRouter()
  if (phase === 'idle') return null

  const covering = phase === 'cover'
  const path = target ? new URL(target, window.location.origin).pathname : '/'

  return (
    <div className="pointer-events-auto fixed inset-0 z-190" aria-hidden>
      <Layer index={0} covering={covering} fill="var(--color-bone)" />
      <Layer
        index={1}
        covering={covering}
        fill="var(--color-ink-2)"
        onDone={covering ? covered : undefined}
      >
        <div className="flex h-full flex-col justify-between px-5 py-6 md:px-10 md:py-8">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            <span className="flex items-center gap-2 text-fg">
              <LogoMark className="size-4" /> FlowAI
            </span>
            <span>Loading</span>
          </div>
          <div className="overflow-hidden text-center">
            <motion.p
              className="font-serif text-[clamp(3.5rem,11vw,10rem)] italic leading-[1.05] tracking-[-0.02em]"
              initial={{ y: '110%' }}
              animate={{ y: covering ? '0%' : '-110%' }}
              transition={{ duration: covering ? 0.8 : 0.5, ease, delay: covering ? 0.25 : 0 }}
            >
              {labelFor(path)}
            </motion.p>
          </div>
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
            <span>Create once. Publish everywhere.</span>
            <span>{path}</span>
          </div>
        </div>
      </Layer>
      {/* The reveal finishes when the trailing bone layer clears, so it owns that callback. */}
      {!covering && <RevealSentinel onDone={revealed} />}
    </div>
  )
}

function Layer({
  index,
  covering,
  fill,
  onDone,
  children,
}: {
  index: number
  covering: boolean
  fill: string
  onDone?: () => void
  children?: ReactNode
}) {
  // Covering: bone leads, ink follows. Revealing: ink lifts first, bone trails behind it.
  const delay = covering ? index * LAG : (1 - index) * LAG
  const transition = { ...(covering ? COVER : REVEAL), delay }

  return (
    <motion.div
      className="absolute inset-x-0 top-0 h-screen"
      style={{ zIndex: index }}
      initial={{ y: covering ? '115vh' : '0vh' }}
      animate={{ y: covering ? '0vh' : '-115vh' }}
      transition={transition}
      onAnimationComplete={onDone}
    >
      <svg className="absolute bottom-full left-0 h-[15vh] w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <motion.path
          fill={fill}
          initial={{ d: covering ? TOP_BULGE : TOP_FLAT }}
          animate={{ d: TOP_FLAT }}
          transition={transition}
        />
      </svg>
      <div className="h-full" style={{ background: fill }}>
        {children}
      </div>
      <svg className="absolute left-0 top-full h-[15vh] w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <motion.path
          fill={fill}
          initial={{ d: BOTTOM_FLAT }}
          animate={{ d: covering ? BOTTOM_FLAT : BOTTOM_BULGE }}
          transition={transition}
        />
      </svg>
    </motion.div>
  )
}

/** Fires once the slowest reveal layer has cleared the screen. */
function RevealSentinel({ onDone }: { onDone: () => void }) {
  return (
    <motion.span
      className="hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: REVEAL.duration + LAG }}
      onAnimationComplete={onDone}
    />
  )
}
