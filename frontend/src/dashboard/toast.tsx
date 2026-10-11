import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { ease } from '../lib/motion'

type Toast = { id: number; tone: 'success' | 'error'; text: ReactNode }
type Push = (text: ReactNode, tone?: Toast['tone']) => void

const ToastContext = createContext<Push>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const push = useCallback<Push>((text, tone = 'success') => {
    const id = ++nextId.current
    setToasts((t) => [...t.slice(-2), { id, tone, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])

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
              className="pointer-events-auto flex w-full items-start gap-3 glass-menu rounded-[12px] px-4 py-3 text-[13px]"
            >
              {t.tone === 'error' ? (
                <CircleAlert className="mt-px size-4 shrink-0 text-fail" strokeWidth={1.75} />
              ) : (
                <CircleCheck className="mt-px size-4 shrink-0 text-ok" strokeWidth={1.75} />
              )}
              <span className="leading-snug text-fg">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
