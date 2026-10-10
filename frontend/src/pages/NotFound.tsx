import { motion } from 'framer-motion'
import { Navbar } from '../components/Navbar'
import { Button } from '../components/ui/Button'
import { LineReveal, Serif } from '../components/ui/Reveal'
import { ease } from '../lib/motion'
import { ReadyContext, useArrival } from '../lib/ready'
import { useDocumentTitle, useRouter } from '../lib/router'
import { useSession } from '../lib/session'

/** Any address the site doesn't know: say so plainly, and offer the two ways back. */
export default function NotFound() {
  useDocumentTitle('Page not found — FlowAI')
  const ready = useArrival()
  const { path } = useRouter()
  const { user } = useSession()

  return (
    <ReadyContext.Provider value={ready}>
      <div className="relative overflow-x-clip">
        <Navbar />
        <main className="container-x relative grid min-h-dvh content-center pb-20 pt-32">
          <motion.p
            aria-hidden
            className="pointer-events-none absolute -bottom-[0.12em] right-0 select-none text-[clamp(10rem,36vw,36rem)] font-semibold leading-[0.8] tracking-[-0.07em] text-fg/[0.05] tabular-nums"
            initial={{ opacity: 0, y: '6%' }}
            animate={ready ? { opacity: 1, y: '0%' } : undefined}
            transition={{ duration: 1.4, ease }}
          >
            404
          </motion.p>
          <div className="relative max-w-3xl">
            <motion.p
              className="flex min-w-0 items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
              initial={{ opacity: 0, y: 12 }}
              animate={ready ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.8, ease }}
            >
              <span className="text-fg">(404)</span>
              <span className="h-px w-8 shrink-0 bg-current opacity-40" />
              <span className="truncate normal-case tracking-normal">{path}</span>
            </motion.p>
            <LineReveal
              as="h1"
              play={ready}
              className="mt-8 text-[clamp(3rem,8vw,8.5rem)] font-medium leading-[0.88] tracking-[-0.055em]"
              lines={['This page', <Serif>wandered off.</Serif>]}
            />
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={ready ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.9, ease, delay: 0.3 }}
            >
              <p className="mt-8 max-w-[44ch] text-[17px] leading-relaxed text-muted">
                The link may be old, or the address mistyped. Everything else is right where you left it.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Button href="/" size="lg" arrow>
                  Back to home
                </Button>
                <Button href={user ? '/dashboard' : '/login'} variant="ghost" size="lg">
                  {user ? 'Open the studio' : 'Log in'}
                </Button>
              </div>
            </motion.div>
          </div>
        </main>
      </div>
    </ReadyContext.Provider>
  )
}
