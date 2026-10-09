import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@.:-·/'

/**
 * One cell of a split-flap board. When its letter changes it riffles through a few others
 * before landing, the way the old station boards did.
 */
const Cell = memo(function Cell({ char, delay }: { char: string; delay: number }) {
  const [shown, setShown] = useState(' ')
  const [flipping, setFlipping] = useState(false)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      // The first time, the whole board riffles in.
      if (char === ' ') return
    }
    if (shown === char) return
    let n = 0
    const steps = 4 + Math.floor(Math.random() * 4)
    let timer = window.setTimeout(function tick() {
      n++
      if (n >= steps) {
        setShown(char)
        setFlipping(false)
        return
      }
      setFlipping(true)
      setShown(CHARSET[Math.floor(Math.random() * CHARSET.length)])
      timer = window.setTimeout(tick, 42)
    }, delay)
    return () => window.clearTimeout(timer)
    // Riffle only when the target letter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char])

  return (
    <span className={cn('flap-cell', flipping && 'flap-cell-flip')} aria-hidden>
      {shown === ' ' ? ' ' : shown}
    </span>
  )
})

/**
 * A word on the board, padded to its column: `width` cells, upper case. The cells beyond the
 * text stay blank, so columns line up like the real thing.
 */
export function Flap({ text, width, className, stagger = 0 }: { text: string; width: number; className?: string; stagger?: number }) {
  const value = text.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').padEnd(width, ' ').slice(0, width)
  return (
    <span className={cn('inline-flex gap-[2px]', className)} aria-label={text}>
      {[...value].map((c, i) => (
        <Cell key={i} char={CHARSET.includes(c) ? c : ' '} delay={stagger + i * 18} />
      ))}
    </span>
  )
}
