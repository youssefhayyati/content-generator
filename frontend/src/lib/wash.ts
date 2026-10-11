import { useState } from 'react'

/*
 * The colour at the edges of the studio's window: how strong the wash behind the glass is.
 * glass-ambient in index.css reads --wash. Chosen in Settings → Appearance, kept on this device.
 */

const KEY = 'flowai.wash'

/** Percent of the full wash, when nothing was chosen. Keep it the same as the fallback in index.css. */
export const WASH_DEFAULT = 50

function saved(): number | null {
  try {
    const raw = localStorage.getItem(KEY)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null
  } catch {
    return null
  }
}

const put = (percent: number | null) => {
  const root = document.documentElement
  if (percent === null) root.style.removeProperty('--wash')
  else root.style.setProperty('--wash', String(percent / 100))
}

/** Applies the saved strength; called before the first render so the page never flashes. */
export function applySavedWash() {
  put(saved())
}

/** The strength, 0–100, and the slider for it in Settings. Choosing null goes back to the default. */
export function useWash(): [number, (percent: number | null) => void] {
  const [percent, setPercent] = useState(() => saved() ?? WASH_DEFAULT)
  const choose = (next: number | null) => {
    setPercent(next ?? WASH_DEFAULT)
    put(next)
    try {
      if (next === null) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, String(next))
    } catch {
      /* not remembered, still applied */
    }
  }
  return [percent, choose]
}
