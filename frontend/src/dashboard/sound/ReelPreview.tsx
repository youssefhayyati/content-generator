import { useMemo } from 'react'
import type { Asset, TimedWord } from '../../lib/api'
import { cn } from '../../lib/cn'

export type ReelStyle = 'bold' | 'editorial' | 'pulse'

type Phrase = { words: TimedWord[]; start: number; end: number }

/**
 * Words into what's on screen at once — the same rules the renderer uses (Captions.php):
 * a few words for bold, a line for pulse, a page of sentences for editorial.
 */
export function phrases(words: TimedWord[], style: ReelStyle): Phrase[] {
  const [maxWords, maxChars, sentences] = style === 'editorial' ? [14, 90, true] : style === 'pulse' ? [4, 26, false] : [3, 16, false]
  const groups: TimedWord[][] = []
  let cur: TimedWord[] = []
  let chars = 0
  words.forEach((w, k) => {
    cur.push(w)
    chars += w.text.length + 1
    const next = words[k + 1]
    const pause = next ? next.start - w.end : 1
    const stop = sentences ? /[.!?…]["”»)]*$/.test(w.text) : /[.,!?;:…]["”»)]*$/.test(w.text)
    const full = cur.length >= maxWords || (chars >= maxChars && cur.length >= 2)
    if (full || (stop && (!sentences || cur.length >= 6)) || pause > 0.55) {
      groups.push(cur)
      cur = []
      chars = 0
    }
  })
  if (cur.length) groups.push(cur)
  return groups.map((g, i) => {
    const next = groups[i + 1]?.[0]?.start
    const last = g[g.length - 1].end
    return { words: g, start: g[0].start, end: next !== undefined && next - last < 0.6 ? next : last + 0.25 }
  })
}

const clean = (w: string) => w.replace(/[.,;:…]+(["”»)]*)$/u, '$1')

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`
}

/**
 * The reel, played in the page before it's rendered: the same layout, the same captions
 * following the same words, the waveform moving with the sound. 1080 × 1920 drawn at a quarter.
 */
export function ReelPreview({
  style,
  accent,
  title,
  handle,
  background,
  words,
  time,
  playing,
  peaks,
  duration,
  className,
}: {
  style: ReelStyle
  accent: string
  title: string
  handle: string | null
  background: Asset | null
  words: TimedWord[]
  time: number
  playing: boolean
  peaks: number[]
  duration: number
  className?: string
}) {
  const list = useMemo(() => phrases(words, style), [words, style])
  const now = list.find((p) => time >= p.start && time < p.end) ?? (time === 0 && !playing ? list[0] : undefined)
  const showTitle = !!title && (style === 'editorial' || time < 3.2 || !words.length)
  const photo = background && (background.kind === 'image' || background.kind === 'video') ? background : null
  const light = mix(accent, '#ffffff', 0.3)
  const progress = duration ? Math.min(1, time / duration) : 0
  // A quarter of 1080 × 1920; everything below is in those design pixels, scaled.
  const s = 0.25

  return (
    <div className={cn('relative aspect-[9/16] w-[270px] overflow-hidden rounded-[28px] border-[6px] border-[#16161a] bg-black shadow-[0_40px_90px_-30px_rgb(0_0_0_/_0.9)]', className)}>
      {/* Background */}
      {style === 'editorial' ? (
        <div className="absolute inset-0 bg-[#ecebe6]">
          {photo && (
            <div className="absolute overflow-hidden" style={{ left: 40 * s, top: 150 * s, width: 1000 * s, height: 1000 * s }}>
              <Media asset={photo} playing={playing} drift />
            </div>
          )}
        </div>
      ) : style === 'pulse' && photo ? (
        <div className="absolute inset-0">
          <div className="absolute inset-0 scale-110 blur-[10px] brightness-[0.6] saturate-[1.25]">
            <Media asset={photo} playing={playing} />
          </div>
          <div className="absolute overflow-hidden" style={{ left: 154 * s, top: 330 * s, width: 772 * s, height: 772 * s, padding: 6 * s, background: light }}>
            <Media asset={photo} playing={playing} />
          </div>
        </div>
      ) : photo ? (
        <div className="absolute inset-0">
          <Media asset={photo} playing={playing} drift />
          {style === 'bold' && <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgb(0 0 0 / 0.18), transparent 35%, rgb(0 0 0 / 0.78))' }} />}
        </div>
      ) : (
        <div
          className="absolute inset-0 animate-[reel-gradient_18s_ease-in-out_infinite_alternate] bg-[length:200%_200%]"
          style={{ backgroundImage: `linear-gradient(135deg, ${mix(accent, '#040406', 0.9)}, ${mix(accent, '#040406', 0.72)} 45%, ${mix(accent, '#040406', 0.56)})` }}
        />
      )}

      {/* Title */}
      {showTitle && style !== 'editorial' && (
        <p className="absolute inset-x-0 text-center font-extrabold leading-tight text-white" style={{ top: 215 * s, fontSize: 64 * s, padding: `0 ${90 * s}px`, textShadow: '0 1px 6px rgb(0 0 0 / 0.6)' }}>
          {title}
        </p>
      )}
      {style === 'editorial' && (
        <>
          <span className="absolute" style={{ left: 90 * s, top: (photo ? 1180 : 520) * s, width: 72 * s, height: 6 * s, background: accent }} />
          {title && (
            <p className="absolute font-mono uppercase text-[#121212]" style={{ left: 90 * s, top: (photo ? 1215 : 560) * s, fontSize: 34 * s, letterSpacing: 2 * s }}>
              {title}
            </p>
          )}
        </>
      )}

      {/* Captions */}
      {now && style === 'bold' && (
        <p className="absolute inset-x-0 text-center font-extrabold leading-tight tracking-[-0.01em] text-white" style={{ top: (1130 - 60) * s, fontSize: 94 * s, padding: `0 ${90 * s}px`, textShadow: '0 0 7px rgb(0 0 0 / 0.55)' }}>
          {now.words.map((w, k) => {
            const on = time >= w.start && (k === now.words.length - 1 || time < now.words[k + 1].start)
            return (
              <span key={k} className="inline-block transition-transform duration-100" style={{ color: on ? light : undefined, transform: on ? 'scale(1.08)' : undefined }}>
                {clean(w.text)}
                {k < now.words.length - 1 ? ' ' : ''}
              </span>
            )
          })}
        </p>
      )}
      {now && style === 'pulse' && (
        <p className="absolute inset-x-0 text-center font-semibold leading-tight text-white" style={{ top: (1665 - 40) * s, fontSize: 62 * s, padding: `0 ${90 * s}px`, textShadow: '0 0 5px rgb(0 0 0 / 0.6)' }}>
          {now.words.map((w, k) => {
            const on = time >= w.start && (k === now.words.length - 1 || time < now.words[k + 1].start)
            return (
              <span key={k} style={{ opacity: on ? 1 : 0.56 }}>
                {clean(w.text)}{' '}
              </span>
            )
          })}
        </p>
      )}
      {now && style === 'editorial' && (
        <p className="absolute inset-x-0 text-center font-serif italic leading-[1.1] text-[#121212]" style={{ top: ((photo ? 1500 : 980) - 150) * s, fontSize: 96 * s, padding: `0 ${90 * s}px` }}>
          {now.words.map((w, k) => (
            <span key={k} style={{ opacity: time >= w.start ? 1 : 0.24 }}>
              {w.text}{' '}
            </span>
          ))}
        </p>
      )}

      {/* Waveform */}
      <Wave
        peaks={peaks}
        progress={progress}
        playing={playing}
        color={style === 'editorial' ? accent : 'white'}
        opacity={style === 'pulse' ? 0.92 : style === 'editorial' ? 0.95 : 0.55}
        box={style === 'editorial' ? [90, photo ? 1765 : 1640, 900, 70] : style === 'pulse' ? [60, photo ? 1215 : 820, 960, 280] : [110, 1590, 860, 110]}
        scale={s}
        line={style === 'editorial'}
      />

      {handle && (
        <p className={cn('absolute font-mono', style === 'editorial' ? 'text-[#121212]/70' : 'inset-x-0 text-center text-white/80')} style={{ left: style === 'editorial' ? 90 * s : undefined, bottom: (style === 'editorial' ? 80 : 98) * s, fontSize: 32 * s }}>
          @{handle.replace(/^@/, '')}
        </p>
      )}
    </div>
  )
}

function Media({ asset, playing, drift }: { asset: Asset; playing: boolean; drift?: boolean }) {
  return asset.kind === 'video' ? (
    <video src={asset.url} muted loop playsInline autoPlay={playing} className="size-full object-cover" />
  ) : (
    <img src={asset.url} alt="" draggable={false} className={cn('size-full object-cover', drift && playing && 'animate-[reel-drift_24s_ease-in-out_infinite_alternate]')} />
  )
}

/** The waveform near the playhead, moving like the rendered one does. */
function Wave({ peaks, progress, playing, color, opacity, box, scale, line }: { peaks: number[]; progress: number; playing: boolean; color: string; opacity: number; box: [number, number, number, number]; scale: number; line?: boolean }) {
  const [x, y, w, h] = box
  const n = 48
  const at = Math.floor(progress * peaks.length)
  const bars = Array.from({ length: n }, (_, i) => {
    const p = peaks[Math.min(peaks.length - 1, Math.max(0, at - n / 2 + i))] ?? 0.2
    const wobble = playing ? 0.75 + 0.25 * Math.sin(i * 1.7 + progress * 90) : 0.6
    return Math.max(0.04, p * wobble)
  })
  return (
    <svg className="absolute" style={{ left: x * scale, top: y * scale, width: w * scale, height: h * scale, opacity }} viewBox={`0 0 ${n * 4} 100`} preserveAspectRatio="none" aria-hidden>
      {line ? (
        <polyline fill="none" stroke={color} strokeWidth={3} points={bars.map((b, i) => `${i * 4 + 2},${50 - (i % 2 ? 1 : -1) * b * 45}`).join(' ')} />
      ) : (
        bars.map((b, i) => <rect key={i} x={i * 4 + 0.6} y={50 - b * 48} width={2.8} height={b * 96} rx={1.4} fill={color} />)
      )}
    </svg>
  )
}
