import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { Label, Skeleton } from '../ui'
import { useAssistant, type FontInfo, type TextBox } from './store'

/*
 * The fonts a text can use, by style (assistant/fonts/fonts.yaml): each one previewed in the
 * text's own words, in the very file the assistant draws it with (served at /assistant/fonts/).
 */

/** Loaded fonts, by name: each file is fetched once for the whole page. */
const loading = new Map<string, Promise<void>>()

const family = (f: FontInfo) => `assistant-font-${f.name}`

function load(f: FontInfo): Promise<void> {
  let p = loading.get(f.name)
  if (!p) {
    const face = new FontFace(family(f), `url(${f.url})`)
    p = face.load().then(
      (done) => void document.fonts.add(done),
      () => undefined, // the tile falls back to the page's font
    )
    loading.set(f.name, p)
  }
  return p
}

/** Fonts shown once their file is in, so a tile doesn't jump from the fallback. */
function useLoaded(fonts: FontInfo[]) {
  const [ready, setReady] = useState<Set<string>>(() => new Set())
  const key = fonts.map((f) => f.name).join(',')
  useEffect(() => {
    let live = true
    for (const f of fonts) void load(f).then(() => live && setReady((r) => (r.has(f.name) ? r : new Set(r).add(f.name))))
    return () => {
      live = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return ready
}

/** The text's first word or two, which is what fits on a tile. */
function preview(words: string) {
  let out = ''
  for (const w of words.trim().split(/\s+/)) {
    if (out && (out + ' ' + w).length > 13) break
    out = out ? `${out} ${w}` : w
  }
  return out || 'Aa'
}

export function FontPicker({ t, onChange }: { t: TextBox; onChange: (fields: Record<string, string>) => void }) {
  const a = useAssistant()
  const list = a.fonts
  const current = list?.fonts.find((f) => f.name === t.font)
  const [style, setStyle] = useState(current?.style ?? 'modern')
  useEffect(() => {
    if (current) setStyle(current.style)
  }, [current?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = list?.fonts.filter((f) => f.style === style) ?? []
  const ready = useLoaded(shown)
  const sample = preview(t.words)

  if (!list) {
    return (
      <div>
        <Label className="mb-1.5">Font</Label>
        <Skeleton className="h-24 rounded-lg" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Label>Font</Label>
        {current && (
          <span className="truncate font-mono text-[10px] text-dim" title={current.suits}>
            {current.label}
          </span>
        )}
      </div>
      <div role="tablist" aria-label="Font styles" className="mb-2 flex flex-wrap gap-1">
        {list.styles.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={style === s.id}
            onClick={() => setStyle(s.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
              style === s.id ? 'border-accent-soft/60 bg-accent/12 text-fg' : 'border-line text-dim hover:border-line-2 hover:text-muted',
              current?.style === s.id && style !== s.id && 'text-muted',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {shown.map((f) => {
          const on = f.name === t.font
          return (
            <button
              key={f.name}
              type="button"
              onClick={() => onChange({ font: f.name })}
              aria-pressed={on}
              aria-label={`${f.label}: ${f.suits}`}
              title={`${f.label} · ${f.suits}`}
              className={cn(
                'flex min-w-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors',
                on ? 'border-accent-soft/60 bg-accent/10' : 'border-line hover:border-line-2 hover:bg-white/[0.02]',
              )}
            >
              <span
                className={cn('block w-full truncate text-[19px] leading-tight text-fg transition-opacity', ready.has(f.name) ? 'opacity-100' : 'opacity-30')}
                style={{ fontFamily: `"${family(f)}", system-ui, sans-serif` }}
              >
                {sample}
              </span>
              <span className="w-full truncate font-mono text-[9.5px] uppercase tracking-[0.05em] text-dim">{f.label}</span>
            </button>
          )
        })}
      </div>
      {current && current.style === style && <p className="mt-1.5 text-[11px] leading-snug text-dim">{current.suits[0].toUpperCase() + current.suits.slice(1)}.</p>}
    </div>
  )
}
