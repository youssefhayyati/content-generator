import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, X } from 'lucide-react'
import { ease } from '../lib/motion'

type Toast = { id: number; tone: 'success' | 'error'; text: ReactNode }
type Push = (text: ReactNode, tone?: Toast['tone']) => void

const ToastContext = createContext<Push>(() => {})

export const useToast = () => useContext(ToastContext)

/** How long each stays: an error is something to read, so it stays longer. */
const LIFE = { success: 3800, error: 6500 }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const push = useCallback<Push>((text, tone = 'success') => {
    const id = ++nextId.current
    setToasts((t) => [...t.slice(-2), { id, tone, text }])
  }, [])
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[130] flex w-[min(360px,calc(100vw-2rem))] flex-col items-end gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ duration: 0.4, ease }}
              className="group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden glass-menu rounded-[12px] py-3 pl-4 pr-9 text-[13px]"
            >
              {t.tone === 'error' ? <CircleAlert className="mt-px size-4 shrink-0 text-fail" strokeWidth={1.75} /> : <DrawnCheck />}
              <span className="leading-snug text-fg">{t.text}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-dim opacity-0 transition-opacity duration-200 hover:bg-white/[0.08] hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
              {/* The time it has left, running out along the bottom. The bar's own animation is the
                  clock: hovering pauses both, so a toast you're reading doesn't leave. */}
              <span
                aria-hidden
                onAnimationEnd={() => dismiss(t.id)}
                className="toast-life absolute inset-x-0 bottom-0 h-px origin-left"
                style={{
                  animationDuration: `${LIFE[t.tone]}ms`,
                  background: t.tone === 'error' ? 'var(--color-fail)' : 'color-mix(in oklab, var(--color-ok) 70%, transparent)',
                }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

/** A tick that draws itself: the ring first, then the check. */
function DrawnCheck() {
  return (
    <svg viewBox="0 0 16 16" className="mt-px size-4 shrink-0 text-ok" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <motion.circle
        cx="8"
        cy="8"
        r="6.6"
        initial={{ pathLength: 0, rotate: -90 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease }}
        style={{ transformOrigin: 'center' }}
      />
      <motion.path d="M5.3 8.2 7.2 10l3.5-3.9" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.32, ease, delay: 0.32 }} />
    </svg>
  )
}
