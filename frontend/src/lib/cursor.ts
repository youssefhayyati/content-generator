import { useEffect, useState } from 'react'

/*
 * FlowAI's pointer, on the site and in the studio: the familiar arrow, pointing arrow and I-beam,
 * redrawn crisper and set in the palette. They are plain CSS cursor images, so the system still
 * moves them: no lag and nothing trailing behind. Settings → Appearance switches back to the
 * system cursor, which people who rely on an enlarged one need.
 */

const KEY = 'flowai.cursor'
const CHANGED = 'flowai:cursor'

/** The arrow in a 32-unit square, tip at (6, 4): a 45° edge, a notch and a slim tail. */
const ARROW = 'M6 4V20.8L9.8 17L12.7 23.5L15.1 22.5L12.2 16H18Z'
/** The I-beam, centred on (16, 16): curved serifs top and bottom and a short crossbar. */
const BEAM = 'M12.5 6.5C14.6 6.5 16 7.4 16 9C16 7.4 17.4 6.5 19.5 6.5M16 9V23M12.5 25.5C14.6 25.5 16 24.6 16 23C16 24.6 17.4 25.5 19.5 25.5M14.2 17.5H17.8'

/** Anything you click: it gets the pointing arrow. */
const CLICKABLE = [
  'a[href]',
  'button:not(:disabled)',
  'select:not(:disabled)',
  'summary',
  'label[for]',
  'input:is([type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=submit],[type=button],[type=reset]):not(:disabled)',
  ':is([role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option],[role=switch],[role=checkbox],[role=radio]):not([aria-disabled=true])',
].join(',')

/** Anything you type in: it gets the I-beam. */
const TYPING = [
  'input:not([type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=submit],[type=button],[type=reset],[type=hidden]):not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable]:not([contenteditable=false])',
].join(',')

type Tokens = { fg: string; ink: string; accent: string }

/** A soft shadow under every cursor, so it holds its edge on light pictures too. */
const shadow = (first = '') =>
  `<defs><filter id='s' x='-50%' y='-50%' width='200%' height='200%'>${first}<feDropShadow dy='1' stdDeviation='.9' flood-color='#000' flood-opacity='.55'/></filter></defs>`

function drawings({ fg, ink, accent }: Tokens) {
  // Mono's accent is its text colour, so its pointing arrow goes dark instead.
  const point = accent.toLowerCase() === fg.toLowerCase() ? ink : accent
  return {
    arrow: `${shadow()}<path d='${ARROW}' fill='${fg}' stroke='${ink}' stroke-width='2' stroke-linejoin='round' paint-order='stroke' filter='url(#s)'/>`,
    pointer: `${shadow(`<feDropShadow stdDeviation='1.4' flood-color='${accent}' flood-opacity='.4'/>`)}<path d='${ARROW}' fill='${point}' stroke='${fg}' stroke-width='2' stroke-linejoin='round' paint-order='stroke' filter='url(#s)'/>`,
    text: `${shadow()}<g fill='none' stroke-linecap='round' stroke-linejoin='round' filter='url(#s)'><path d='${BEAM}' stroke='${ink}' stroke-width='3.4'/><path d='${BEAM}' stroke='${fg}' stroke-width='1.4'/></g>`,
  }
}

const image = (body: string, size: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 32 32'>${body}</svg>`)}")`

/** Plain first, then a 2× copy for sharp screens wherever the browser takes image-set for cursors. */
function cursor(body: string, x: number, y: number, fallback: string) {
  const one = image(body, 32)
  const two = image(body, 64)
  return [
    `cursor: ${one} ${x} ${y}, ${fallback};`,
    `cursor: -webkit-image-set(${one} 1x, ${two} 2x) ${x} ${y}, ${fallback};`,
    `cursor: image-set(${one} 1x, ${two} 2x) ${x} ${y}, ${fallback};`,
  ].join(' ')
}

function sheet(tokens: Tokens) {
  const d = drawings(tokens)
  const arrow = cursor(d.arrow, 6, 4, 'default')
  const pointer = cursor(d.pointer, 6, 4, 'pointer')
  const text = cursor(d.text, 16, 16, 'text')
  // In the base layer, so a cursor-grab or disabled:cursor-not-allowed utility still wins.
  // Tailwind's cursor-pointer and cursor-default name the system cursors: those point at ours.
  return `
@layer base {
  html.custom-cursor { ${arrow} }
  html.custom-cursor :is(button, input, select, textarea):disabled { ${arrow} }
  html.custom-cursor :is(${CLICKABLE}) { ${pointer} }
  html.custom-cursor :is(${TYPING}) { ${text} }
}
html.custom-cursor .cursor-pointer:not(:disabled) { ${pointer} }
html.custom-cursor :is(.cursor-default, .disabled\\:cursor-default:disabled) { ${arrow} }
@media (width >= 64rem) {
  html.custom-cursor .lg\\:cursor-default { ${arrow} }
}`
}

let preferred = (() => {
  try {
    return localStorage.getItem(KEY) !== 'system'
  } catch {
    return true
  }
})()

/** Whether the custom cursor is on, and the switch for it in Settings. */
export function useCursorChoice(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(preferred)
  useEffect(() => {
    const sync = () => setOn(preferred)
    window.addEventListener(CHANGED, sync)
    return () => window.removeEventListener(CHANGED, sync)
  }, [])
  const choose = (next: boolean) => {
    preferred = next
    try {
      localStorage.setItem(KEY, next ? 'studio' : 'system')
    } catch {
      /* not remembered, still applied */
    }
    window.dispatchEvent(new Event(CHANGED))
  }
  return [on, choose]
}

/** Puts the custom cursor on the page, redrawn whenever the palette changes. */
export function useCursor() {
  const [on] = useCursorChoice()
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    const style = document.createElement('style')
    const paint = () => {
      const css = getComputedStyle(root)
      const token = (name: string) => css.getPropertyValue(`--color-${name}`).trim()
      style.textContent = sheet({ fg: token('fg'), ink: token('ink'), accent: token('accent') })
    }
    paint()
    document.head.append(style)
    root.classList.add('custom-cursor')
    const palette = new MutationObserver(paint)
    palette.observe(root, { attributes: true, attributeFilter: ['data-palette'] })
    return () => {
      palette.disconnect()
      style.remove()
      root.classList.remove('custom-cursor')
    }
  }, [on])
}
