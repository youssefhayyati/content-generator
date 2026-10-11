import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

type Tip = { text: string; x: number; y: number; up: boolean }

const DELAY = 450
const EDGE = 8

/**
 * The studio's tooltips. Anything with a title gets one, and the browser's own (drawn by the
 * system, never glass) is kept from showing: while the pointer is over the element its title is
 * held in data-tip, and given back when the pointer leaves. Mounted once, in the Shell.
 */
export function Tips() {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let el: HTMLElement | null = null
    let timer = 0
    let watch: MutationObserver | null = null

    const place = () => {
      if (!el) return
      const text = el.getAttribute('data-tip')
      if (!text) return
      const r = el.getBoundingClientRect()
      const up = r.bottom + 44 > window.innerHeight
      setTip({ text, x: Math.max(EDGE + 70, Math.min(r.left + r.width / 2, window.innerWidth - EDGE - 70)), y: up ? r.top - 7 : r.bottom + 7, up })
    }
    const leave = () => {
      window.clearTimeout(timer)
      watch?.disconnect()
      watch = null
      if (el) {
        const text = el.getAttribute('data-tip')
        if (text != null && !el.hasAttribute('title')) el.setAttribute('title', text)
        el.removeAttribute('data-tip')
        el = null
      }
      setTip(null)
    }
    const hold = (target: HTMLElement) => {
      const text = target.getAttribute('title')
      if (text == null) return
      target.setAttribute('data-tip', text)
      target.removeAttribute('title')
    }
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const target = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null
      if (!target || target === el) return
      leave()
      if (!target.getAttribute('title')?.trim()) return
      el = target
      hold(target)
      // A title that changes while hovered ("Copy" to "Copied") is taken again, and shown.
      watch = new MutationObserver(() => {
        if (el && el.hasAttribute('title')) {
          hold(el)
          setTip((t) => (t ? { ...t, text: el?.getAttribute('data-tip') ?? t.text } : t))
        }
      })
      watch.observe(target, { attributes: true, attributeFilter: ['title'] })
      timer = window.setTimeout(place, DELAY)
    }
    const out = (e: PointerEvent) => {
      if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) leave()
    }

    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('pointerdown', leave, true)
    document.addEventListener('keydown', leave, true)
    window.addEventListener('scroll', leave, true)
    window.addEventListener('blur', leave)
    return () => {
      leave()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('pointerdown', leave, true)
      document.removeEventListener('keydown', leave, true)
      window.removeEventListener('scroll', leave, true)
      window.removeEventListener('blur', leave)
    }
  }, [])

  return createPortal(
    <AnimatePresence>
      {tip && (
        <motion.div
          role="tooltip"
          className="glass-menu pointer-events-none fixed z-[170] max-w-[min(300px,calc(100vw-16px))] whitespace-pre-line rounded-[8px] px-2.5 py-1.5 text-[12px] leading-snug text-fg"
          style={{ left: tip.x, top: tip.up ? undefined : tip.y, bottom: tip.up ? window.innerHeight - tip.y : undefined, x: '-50%' }}
          initial={{ opacity: 0, y: tip.up ? 3 : -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14 }}
        >
          {tip.text}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
