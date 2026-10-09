import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Pause, Play } from 'lucide-react'
import { api, type Asset, type AssetWords, type TimedWord } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'

/** Only one sound at a time: a player that starts tells the others to stop. */
const STOP_OTHERS = 'flowai:sound-play'

export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * A sound in the studio: its waveform as bars you can click to jump to, a play button, the
 * time. For a voiceover (or anything transcribed), the words follow along underneath: the
 * phrase being said, the word being said lit up.
 */
export function Player({
  asset,
  karaoke = true,
  compact,
  accent = 'var(--color-accent-soft)',
  className,
  onTime,
}: {
  asset: Asset
  karaoke?: boolean
  compact?: boolean
  accent?: string
  className?: string
  /** Called with the playhead as it moves (for previews that follow along). */
  onTime?: (seconds: number, playing: boolean) => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(asset.duration ?? 0)
  const [words, setWords] = useState<TimedWord[] | null>(null)
  const peaks = asset.sound?.peaks?.length ? asset.sound.peaks : FLAT
  const timed = karaoke && !!asset.sound?.timed

  // The words load on first play, not before: most players are never pressed.
  const loadWords = useCallback(() => {
    if (!timed || words) return
    api<AssetWords>(`/assets/${asset.id}/words`)
      .then((w) => setWords(w.words))
      .catch(() => setWords([]))
  }, [timed, words, asset.id])

  useEffect(() => {
    const stop = (e: Event) => {
      if ((e as CustomEvent).detail !== asset.id) audio.current?.pause()
    }
    window.addEventListener(STOP_OTHERS, stop)
    return () => window.removeEventListener(STOP_OTHERS, stop)
  }, [asset.id])

  // A smooth playhead: timeupdate fires only four times a second.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const t = audio.current?.currentTime ?? 0
      setTime(t)
      onTime?.(t, true)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, onTime])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) {
      loadWords()
      window.dispatchEvent(new CustomEvent(STOP_OTHERS, { detail: asset.id }))
      el.play().catch(() => setPlaying(false))
    } else {
      el.pause()
    }
  }

  const seek = (fraction: number) => {
    const el = audio.current
    if (!el || !duration) return
    el.currentTime = Math.max(0, Math.min(duration - 0.05, fraction * duration))
    setTime(el.currentTime)
    onTime?.(el.currentTime, !el.paused)
    loadWords()
  }

  const progress = duration ? time / duration : 0

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className={cn(
            'grid shrink-0 place-items-center rounded-full bg-fg text-ink transition-transform duration-300 hover:scale-105 active:scale-95',
            compact ? 'size-8' : 'size-10',
          )}
        >
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
        </button>
        <Bars peaks={peaks} progress={progress} accent={accent} height={compact ? 28 : 40} onSeek={seek} />
        <span className="w-[74px] shrink-0 text-right font-mono text-[10.5px] tabular-nums text-dim">
          {fmtClock(time)} / {fmtClock(duration)}
        </span>
      </div>
      <audio
        ref={audio}
        src={asset.url}
        preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          onTime?.(audio.current?.currentTime ?? 0, false)
        }}
        onEnded={() => {
          setPlaying(false)
          setTime(0)
          onTime?.(0, false)
        }}
      />
      {timed && (playing || time > 0) && words && words.length > 0 && <ReadAlong words={words} time={time} accent={accent} />}
    </div>
  )
}

const FLAT = Array.from({ length: 96 }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i * 0.7)))

/** The waveform as bars: played bars take the accent; click anywhere to jump there. */
export function Bars({ peaks, progress, accent, height = 40, onSeek, className }: { peaks: number[]; progress: number; accent: string; height?: number; onSeek?: (fraction: number) => void; className?: string }) {
  const n = peaks.length
  return (
    <svg
      viewBox={`0 0 ${n * 4} ${height}`}
      preserveAspectRatio="none"
      className={cn('min-w-0 flex-1 cursor-pointer', className)}
      style={{ height }}
      onPointerDown={(e) => {
        if (!onSeek) return
        const r = e.currentTarget.getBoundingClientRect()
        onSeek((e.clientX - r.left) / r.width)
      }}
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      {peaks.map((p, i) => {
        const h = Math.max(2, p * (height - 2))
        const played = i / n < progress
        return <rect key={i} x={i * 4 + 0.5} y={(height - h) / 2} width={2.6} height={h} rx={1.3} fill={played ? accent : 'currentColor'} className={played ? '' : 'text-white/20'} />
      })}
    </svg>
  )
}

/** The phrase being said, its words lighting up as they're spoken. */
function ReadAlong({ words, time, accent }: { words: TimedWord[]; time: number; accent: string }) {
  const phrases = useMemo(() => group(words), [words])
  const i = Math.max(0, phrases.findIndex((p) => time < p.end))
  const phrase = phrases[i] ?? phrases[phrases.length - 1]
  if (!phrase) return null
  return (
    <div className="mt-3 min-h-[2.6em] font-serif text-[19px] italic leading-snug">
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease }}>
          {phrase.words.map((w, k) => {
            const said = time >= w.start
            const now = said && time < w.end + 0.08
            return (
              <span key={k} className="transition-colors duration-150" style={{ color: now ? accent : said ? 'var(--color-fg)' : 'color-mix(in oklab, var(--color-fg) 28%, transparent)' }}>
                {w.text}{' '}
              </span>
            )
          })}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

/** Words into readable phrases: sentence ends, long pauses, or about nine words. */
export function group(words: TimedWord[], max = 9) {
  const out: Array<{ words: TimedWord[]; start: number; end: number }> = []
  let cur: TimedWord[] = []
  words.forEach((w, k) => {
    cur.push(w)
    const next = words[k + 1]
    if (cur.length >= max || /[.!?…]["”»)]*$/.test(w.text) || (next && next.start - w.end > 0.6) || !next) {
      out.push({ words: cur, start: cur[0].start, end: next ? next.start : w.end + 0.4 })
      cur = []
    }
  })
  return out
}
