import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, LoaderCircle, Pause, Play } from 'lucide-react'
import type { SoundCatalog } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'

type Voice = SoundCatalog['voices'][number]
type Mood = SoundCatalog['moods'][number]

/** One shared sample player: pressing another voice stops the first. */
let sample: HTMLAudioElement | null = null

/**
 * The voices, by language, each with its name, its character, and a sample to hear before
 * choosing. A sample is made the first time anyone asks for it, then kept.
 */
export function VoicePicker({ voices, value, onChange, className }: { voices: Voice[]; value: string | null; onChange: (id: string) => void; className?: string }) {
  const languages = useMemo(() => [...new Set(voices.map((v) => v.language))], [voices])
  const [language, setLanguage] = useState(() => voices.find((v) => v.id === value)?.language ?? languages[0])
  const [playing, setPlaying] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => () => sample?.pause(), [])

  const hear = (v: Voice) => {
    if (playing === v.id) {
      sample?.pause()
      setPlaying(null)
      return
    }
    sample?.pause()
    sample = new Audio(v.sample_url)
    setLoading(v.id)
    sample.oncanplay = () => setLoading(null)
    sample.onplay = () => setPlaying(v.id)
    sample.onended = sample.onpause = () => setPlaying((p) => (p === v.id ? null : p))
    sample.onerror = () => {
      setLoading(null)
      setPlaying(null)
    }
    sample.play().catch(() => setLoading(null))
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1">
        {languages.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLanguage(l)}
            className={cn('rounded-md px-2 py-1 text-[11.5px] transition-colors', language === l ? 'bg-white/[0.09] text-fg' : 'text-dim hover:text-muted')}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {voices
          .filter((v) => v.language === language)
          .map((v) => {
            const on = v.id === value
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => onChange(v.id)}
                onKeyDown={(e) => e.key === 'Enter' && onChange(v.id)}
                className={cn(
                  'group flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                  on ? 'border-accent-soft/50 bg-accent/[0.08]' : 'border-line hover:border-line-2 hover:bg-white/[0.02]',
                )}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    hear(v)
                  }}
                  aria-label={`Hear ${v.name}`}
                  className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full transition-colors', playing === v.id ? 'bg-fg text-ink' : 'bg-white/[0.06] text-muted hover:bg-white/[0.12] hover:text-fg')}
                >
                  {loading === v.id ? <LoaderCircle className="size-3.5 animate-spin" /> : playing === v.id ? <Pause className="size-3" fill="currentColor" /> : <Play className="size-3 translate-x-px" fill="currentColor" />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    {v.name}
                    <span className="font-mono text-[9.5px] font-normal uppercase tracking-[0.1em] text-dim">{v.gender === 'female' ? '♀' : '♂'}</span>
                    {on && <Check className="ml-auto size-3.5 text-accent-soft" />}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-dim">{v.style}</span>
                </span>
              </div>
            )
          })}
      </div>
    </div>
  )
}

/** The composer's moods as little paintings: pick the feeling, not the genre. */
export function MoodPicker({ moods, value, onChange, className }: { moods: Mood[]; value: string | null; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {moods.map((m, i) => {
        const on = m.id === value
        return (
          <motion.button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease, delay: i * 0.04 }}
            className={cn('group relative overflow-hidden rounded-lg border text-left transition-[border-color,transform] duration-300 hover:-translate-y-px', on ? 'border-white/40' : 'border-line hover:border-line-2')}
          >
            <span aria-hidden className="block h-14 transition-transform duration-700 group-hover:scale-105" style={{ background: `radial-gradient(120% 140% at 0% 0%, ${m.colors[0]}, transparent 60%), radial-gradient(120% 140% at 100% 100%, ${m.colors[1]}, transparent 65%), #0b0b0c` }} />
            <span className="block px-2.5 pb-2 pt-1.5">
              <span className="flex items-center justify-between text-[12.5px] font-medium">
                {m.label}
                <span className="font-mono text-[9.5px] text-dim">
                  {m.bpm[0]}–{m.bpm[1]} bpm
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-dim">{m.detail}</span>
            </span>
            {on && <Check className="absolute right-2 top-2 size-4 text-white drop-shadow" />}
          </motion.button>
        )
      })}
    </div>
  )
}

export const ACCENTS = ['#f5b04c', '#a5b4fc', '#5ee39a', '#ff8fa3', '#6ee7f2', '#ff5f57', '#ecebe6']

/** A few accents that read on dark and on paper, plus any colour you like. */
export function AccentPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ACCENTS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Accent ${c}`}
          className={cn('size-6 rounded-full border transition-transform hover:scale-110', value.toLowerCase() === c ? 'scale-110 border-white ring-2 ring-white/20' : 'border-white/10')}
          style={{ background: c }}
        />
      ))}
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn('relative size-6 overflow-hidden rounded-full border border-dashed border-white/25 text-[11px] text-dim hover:text-fg', !ACCENTS.includes(value.toLowerCase()) && 'border-solid border-white')}
        style={!ACCENTS.includes(value.toLowerCase()) ? { background: value } : undefined}
        aria-label="Any colour"
      >
        {ACCENTS.includes(value.toLowerCase()) && '+'}
        <input ref={input} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </button>
    </div>
  )
}
