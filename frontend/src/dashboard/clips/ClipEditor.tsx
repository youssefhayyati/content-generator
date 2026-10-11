import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Captions, Music2, MoveVertical, Palette, Plus, RotateCcw, Trash2, Wand2, X } from 'lucide-react'
import { api, ApiError, type Asset, type ClipEdit, type ClipFont, type ClipMusic, type ClipStyle, type LinkClip, type TimedWord } from '../../lib/api'
import { cn } from '../../lib/cn'
import { MediaPicker } from '../media/Media'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Modal, Segmented, Skeleton, Toggle } from '../ui'

/*
 * The highlight editor: the subtitles' words, how they look (font, size, colours, backdrop,
 * position) and music under the speech. The preview draws the subtitles over the clean master
 * the way the renderer burns them (same fonts, same line breaks, same 1080 × 1920 layout), and
 * saving renders the video again in the background.
 */

const W = 1080

type Tab = 'subtitles' | 'style' | 'music'
type Line = { id: number; start: number; end: number; text: string; words: TimedWord[] }

export function ClipEditor({ clip, onClose, onSaved }: { clip: LinkClip | null; onClose: () => void; onSaved: (clips: LinkClip[]) => void }) {
  return (
    <Modal open={!!clip} onClose={onClose} title={clip ? `Edit · ${clip.title ?? 'Highlight'}` : 'Edit'} full>
      {clip && <Editor key={clip.id} clip={clip} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function Editor({ clip, onClose, onSaved }: { clip: LinkClip; onClose: () => void; onSaved: (clips: LinkClip[]) => void }) {
  const toast = useToast()
  const [edit, setEdit] = useState<ClipEdit | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [style, setStyle] = useState<ClipStyle | null>(null)
  const [music, setMusic] = useState<ClipMusic>({ asset_id: null, volume: 0.25, original: 1 })
  const [tab, setTab] = useState<Tab>('subtitles')
  const [batch, setBatch] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)

  useEffect(() => {
    let live = true
    api<ClipEdit>(`/clips/${clip.id}/edit`)
      .then((e) => {
        if (!live) return
        setEdit(e)
        setLines(toLines(e.words))
        setStyle(e.style)
        setMusic(e.music)
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not open the editor.'))
    return () => {
      live = false
    }
  }, [clip.id])

  const words = useMemo(() => fromLines(lines), [lines])
  const fonts = edit?.fonts ?? []
  const font = fonts.find((f) => f.key === style?.font) ?? fonts[0]
  useFonts(fonts)

  const seek = (t: number) => {
    if (video.current) video.current.currentTime = t
    setTime(t)
  }
  const patch = (fields: Partial<ClipStyle>) => setStyle((s) => (s ? { ...s, ...fields } : s))

  const save = async () => {
    if (!style) return
    setSaving(true)
    try {
      const res = await api<{ data: LinkClip[] }>(`/clips/${clip.id}`, {
        method: 'PATCH',
        body: { words, style, music: { asset_id: music.asset_id, volume: music.volume, original: music.original }, apply_to_batch: batch },
      })
      onSaved(res.data)
      toast(res.data.length > 1 ? `Rendering ${res.data.length} highlights with the new look.` : 'Rendering your edit. The new video replaces the old one when it is done.')
      onClose()
    } catch (e) {
      const first = e instanceof ApiError ? Object.values(e.errors)[0]?.[0] : null
      toast(first ?? (e instanceof Error ? e.message : 'Could not save the edit.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <p className="p-8 text-center text-[13px] text-fail">{error}</p>
  if (!edit || !style || !font) {
    return (
      <div className="grid h-full gap-5 md:grid-cols-[minmax(0,1fr)_420px]">
        <Skeleton className="h-full min-h-80 rounded-xl" />
        <Skeleton className="h-full min-h-80 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="grid gap-5 md:h-full md:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] md:grid-rows-[minmax(0,1fr)]">
      <Preview
        src={edit.master_url ?? clip.asset?.url ?? ''}
        legacy={!edit.master_url}
        videoRef={video}
        words={style.captions ? words : []}
        style={style}
        font={font}
        title={style.title ? (style.title_text?.trim() || edit.title) : null}
        seconds={edit.seconds}
        music={music}
        onTime={setTime}
        onMove={(y) => patch({ y })}
      />

      <div className="flex min-h-0 flex-col">
        <Segmented
          id="clip-editor-tab"
          label="Edit"
          value={tab}
          onChange={setTab}
          className="self-start"
          options={[
            { value: 'subtitles', label: <><Captions className="size-3.5" /> Subtitles</> },
            { value: 'style', label: <><Palette className="size-3.5" /> Style</> },
            { value: 'music', label: <><Music2 className="size-3.5" /> Music{music.asset_id ? ' ·' : ''}</> },
          ]}
        />

        <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1" data-lenis-prevent>
          {tab === 'subtitles' && <SubtitlesTab lines={lines} setLines={setLines} time={time} onSeek={seek} style={style} patch={patch} title={edit.title} />}
          {tab === 'style' && <StyleTab style={style} patch={patch} fonts={fonts} sample={words.slice(0, 2).map((w) => w.text).join(' ')} defaults={edit.defaults} />}
          {tab === 'music' && <MusicTab music={music} setMusic={setMusic} />}
        </div>

        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {edit.batch_ready > 1 && (
            <label className="flex items-start gap-2.5 text-[12px] leading-snug text-muted">
              <input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
              <span>Use this look and music on all {edit.batch_ready} highlights from this link. Each keeps its own words.</span>
            </label>
          )}
          <div className="flex items-center justify-end gap-2">
            <Btn variant="subtle" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" icon={Wand2} loading={saving} onClick={() => void save()}>
              Save and render
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Preview                                                              */
/* ------------------------------------------------------------------ */

function Preview({
  src,
  legacy,
  videoRef,
  words,
  style,
  font,
  title,
  seconds,
  music,
  onTime,
  onMove,
}: {
  src: string
  legacy: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  words: TimedWord[]
  style: ClipStyle
  font: ClipFont
  title: string | null
  seconds: number
  music: ClipMusic
  onTime: (t: number) => void
  onMove: (y: number) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [width, setWidth] = useState(0)
  const [t, setT] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const k = width / W

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Follow the video frame by frame while it plays, so the lit word keeps up with the speech.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let raf = 0
    const tick = () => {
      setT(v.currentTime)
      onTime(v.currentTime)
      if (!v.paused) raf = requestAnimationFrame(tick)
    }
    const sync = () => {
      setPlaying(!v.paused)
      const a = audio.current
      if (a && a.src) {
        a.currentTime = a.duration ? v.currentTime % a.duration : v.currentTime
        if (v.paused) a.pause()
        else void a.play().catch(() => undefined)
      }
      cancelAnimationFrame(raf)
      tick()
    }
    v.addEventListener('play', sync)
    v.addEventListener('pause', sync)
    v.addEventListener('seeked', sync)
    v.addEventListener('timeupdate', tick)
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('play', sync)
      v.removeEventListener('pause', sync)
      v.removeEventListener('seeked', sync)
      v.removeEventListener('timeupdate', tick)
    }
  }, [videoRef, onTime])

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.min(1, music.original)
    if (audio.current) audio.current.volume = Math.min(1, music.volume)
  }, [music.original, music.volume, videoRef])

  const size = style.size * font.scale
  const phrases = useMemo(() => group(style.uppercase ? words.map((w) => ({ ...w, text: w.text.toUpperCase() })) : words, style.words, lineChars(style.words, Math.round(size))), [words, style.uppercase, style.words, size])
  const phrase = phrases.find((p) => t >= p.start && t < p.end)
  const active = phrase ? Math.max(0, phrase.words.reduce((last, w, i) => (w.start <= t ? i : last), 0)) : -1

  const drag = (e: ReactPointerEvent) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragging(true)
    const move = (ev: PointerEvent) => onMove(Math.round(Math.min(0.94, Math.max(0.06, (ev.clientY - box.top) / box.height)) * 1000) / 1000)
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const family = `"clip-font-${font.key}", system-ui, sans-serif`
  // Paused between phrases (or with no words at all), a faint stand-in shows where the subtitles sit.
  const placeholder = !phrase && style.captions && (dragging || !playing)

  return (
    <div className="flex min-h-0 flex-col items-center gap-2">
      <div ref={frame} className="relative aspect-[9/16] h-[62dvh] max-w-full overflow-hidden rounded-xl bg-black md:h-full md:max-h-full">
        <video ref={videoRef} src={src} className="size-full object-contain" controls playsInline preload="auto" />
        {music.asset && <audio ref={audio} src={music.asset.url} loop preload="auto" />}

        {k > 0 && title && t < Math.min(3.2, seconds) && (
          <p dir="auto" className="pointer-events-none absolute inset-x-0 text-center" style={{ top: 250 * k, padding: `0 ${90 * k}px`, fontFamily: family, fontSize: 64 * font.em * k, lineHeight: `${64 * k}px`, color: '#fff', ...outline('#000000', 6 * k, 0.4) }}>
            {title}
          </p>
        )}

        {k > 0 && (phrase || placeholder) && (
          <div
            className={cn('absolute inset-x-0 flex -translate-y-1/2 justify-center', dragging && 'outline-1 outline-dashed outline-white/50')}
            style={{ top: `${style.y * 100}%`, padding: `0 ${90 * k}px` }}
          >
            <p
              dir="auto"
              onPointerDown={drag}
              title="Drag to move the subtitles"
              className="cursor-grab touch-none select-none text-center active:cursor-grabbing"
              style={{ fontFamily: family, fontSize: size * font.em * k, lineHeight: `${size * k}px`, color: style.color, fontStyle: font.key === 'serif' ? 'italic' : undefined, letterSpacing: font.key === 'bold' ? -1 * k : undefined }}
            >
              {phrase ? (
                <Words phrase={phrase.words} active={active} style={style} k={k} size={size} />
              ) : (
                <span className={dragging ? 'opacity-80' : 'opacity-35'} style={backdrop(style, size, k)}>{style.uppercase ? 'SUBTITLES' : 'Subtitles'}</span>
              )}
            </p>
          </div>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-dim">
        <MoveVertical className="size-3" /> Drag the subtitles to move them.
        {legacy && <span className="text-warn"> Made before editing: its old subtitles show underneath until you save.</span>}
      </p>
    </div>
  )
}

function Words({ phrase, active, style, k, size }: { phrase: TimedWord[]; active: number; style: ClipStyle; k: number; size: number }) {
  return (
    <span style={{ ...backdrop(style, size, k), WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }}>
      {phrase.map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className="inline-block transition-transform duration-100" style={i === active ? { color: style.highlight ?? undefined, transform: 'scale(1.08)' } : undefined}>
            {clean(w.text)}
          </span>
        </span>
      ))}
    </span>
  )
}

/** The subtitle backdrop as the renderer draws it: a soft outline, a box, a drop shadow, or nothing. */
function backdrop(style: ClipStyle, size: number, k: number): CSSProperties {
  switch (style.backdrop) {
    case 'box': {
      const pad = size * 0.16 * k
      return { background: style.outline, padding: `${pad * 0.4}px ${pad}px` }
    }
    case 'shadow': {
      const s = Math.max(3, size * 0.06) * k
      return { textShadow: `${s}px ${s}px 0 ${rgba(style.outline, 0.62)}` }
    }
    case 'none':
      return {}
    default:
      return outline(style.outline, Math.max(2, size * 0.075) * k, 0.4)
  }
}

function outline(hex: string, width: number, alpha: number): CSSProperties {
  return { WebkitTextStroke: `${width * 2}px ${rgba(hex, alpha)}`, paintOrder: 'stroke fill' }
}

function rgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/* ------------------------------------------------------------------ */
/* Subtitles: the words                                                 */
/* ------------------------------------------------------------------ */

function SubtitlesTab({
  lines,
  setLines,
  time,
  onSeek,
  style,
  patch,
  title,
}: {
  lines: Line[]
  setLines: React.Dispatch<React.SetStateAction<Line[]>>
  time: number
  onSeek: (t: number) => void
  style: ClipStyle
  patch: (fields: Partial<ClipStyle>) => void
  title: string | null
}) {
  const edit = (id: number, text: string) => setLines((all) => all.map((l) => (l.id === id ? { ...l, text } : l)))
  const remove = (id: number) => setLines((all) => all.filter((l) => l.id !== id))
  // A new line goes in the gap after the one before it, or at the end.
  const add = (after: number) =>
    setLines((all) => {
      const i = all.findIndex((l) => l.id === after)
      const prev = all[i]
      const next = all[i + 1]
      const start = prev ? prev.end : 0
      const end = next ? Math.max(start + 0.4, next.start) : start + 1.5
      const line: Line = { id: Math.max(0, ...all.map((l) => l.id)) + 1, start, end, text: '', words: [] }
      return [...all.slice(0, i + 1), line, ...all.slice(i + 1)]
    })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
        <div>
          <p className="text-[13px] font-medium">Show subtitles</p>
          <p className="text-[11.5px] text-dim">Burned into the video, word by word.</p>
        </div>
        <Toggle on={style.captions} onChange={(captions) => patch({ captions })} label="Show subtitles" />
      </div>

      <div className="rounded-lg border border-line px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium">Title card</p>
            <p className="text-[11.5px] text-dim">At the top for the first 3 seconds.</p>
          </div>
          <Toggle on={style.title} onChange={(on) => patch({ title: on })} label="Title card" />
        </div>
        {style.title && (
          <input dir="auto" className={cn(inputClass, 'mt-2.5')} value={style.title_text ?? ''} placeholder={title ?? 'Title'} maxLength={80} onChange={(e) => patch({ title_text: e.target.value || null })} aria-label="Title text" />
        )}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Label>Transcript</Label>
          <span className="font-mono text-[10px] text-dim">{lines.length} lines · click a time to jump there</span>
        </div>
        {lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-2 p-5 text-center text-[12.5px] text-dim">
            No words were heard in this moment.
            <div className="mt-3"><Btn size="sm" icon={Plus} onClick={() => add(-1)}>Add a line</Btn></div>
          </div>
        ) : (
          <ol className={cn('space-y-1.5', !style.captions && 'opacity-50')}>
            {lines.map((l) => {
              const now = time >= l.start && time < l.end
              return (
                <li key={l.id} className={cn('group flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors', now ? 'border-accent-soft/50 bg-accent/[0.06]' : 'border-transparent hover:border-line')}>
                  <button type="button" onClick={() => onSeek(l.start + 0.01)} className="w-10 shrink-0 text-left font-mono text-[10.5px] text-dim hover:text-fg" title="Jump here">
                    {clock(l.start)}
                  </button>
                  <input
                    dir="auto"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-dim"
                    value={l.text}
                    placeholder="Type the words…"
                    onChange={(e) => edit(l.id, e.target.value)}
                    onFocus={() => onSeek(l.start + 0.01)}
                    aria-label={`Line at ${clock(l.start)}`}
                  />
                  <button type="button" onClick={() => add(l.id)} className="text-dim opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus:opacity-100" aria-label="Add a line after this one" title="Add a line after">
                    <Plus className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(l.id)} className="text-dim opacity-0 transition-opacity hover:text-fail group-hover:opacity-100 focus:opacity-100" aria-label="Remove this line" title="Remove line">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Style: font, size, colours, backdrop, position                       */
/* ------------------------------------------------------------------ */

const STYLES = [
  ['arabic', 'عربي · Arabic'],
  ['modern', 'Modern'],
  ['poster', 'Poster'],
  ['elegant', 'Elegant'],
  ['handwritten', 'Handwritten'],
  ['playful', 'Playful'],
  ['retro', 'Retro'],
  ['mono', 'Mono'],
] as const

const SWATCHES = ['#ffffff', '#000000', '#fde047', '#facc15', '#22d3ee', '#a5b4fc', '#f472b6', '#4ade80', '#fb923c', '#ef4444']

function StyleTab({ style, patch, fonts, sample, defaults }: { style: ClipStyle; patch: (fields: Partial<ClipStyle>) => void; fonts: ClipFont[]; sample: string; defaults: ClipStyle }) {
  const current = fonts.find((f) => f.key === style.font)
  const [group, setGroup] = useState(current?.style ?? 'modern')
  const shown = fonts.filter((f) => f.style === group)
  const text = sample.trim() || 'Aa Bb'
  const ready = useFonts(fonts)

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <Label>Font</Label>
          <button type="button" onClick={() => patch({ ...defaults, captions: style.captions, title: style.title, title_text: style.title_text })} className="flex items-center gap-1 text-[11px] text-dim hover:text-fg">
            <RotateCcw className="size-3" /> Reset look
          </button>
        </div>
        <div role="tablist" aria-label="Font styles" className="mb-2 flex flex-wrap gap-1">
          {STYLES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={group === id}
              onClick={() => setGroup(id)}
              className={cn('rounded-full border px-2.5 py-1 text-[11.5px] transition-colors', group === id ? 'border-accent-soft/60 bg-accent/12 text-fg' : 'border-line text-dim hover:border-line-2 hover:text-muted', current?.style === id && group !== id && 'text-muted')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {shown.map((f) => {
            const on = f.key === style.font
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => patch({ font: f.key })}
                aria-pressed={on}
                className={cn('flex min-w-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors', on ? 'border-accent-soft/60 bg-accent/10' : 'border-line hover:border-line-2 hover:bg-white/[0.02]')}
              >
                <span className={cn('block w-full truncate text-[19px] leading-tight text-fg transition-opacity', ready.has(f.key) ? 'opacity-100' : 'opacity-30')} style={{ fontFamily: `"clip-font-${f.key}", system-ui, sans-serif`, fontStyle: f.key === 'serif' ? 'italic' : undefined }}>
                  {style.uppercase ? text.toUpperCase() : text}
                </span>
                <span className="w-full truncate font-mono text-[9.5px] uppercase tracking-[0.05em] text-dim">{f.label}</span>
              </button>
            )
          })}
        </div>
        {/\p{Script=Arabic}/u.test(sample) && current?.style !== 'arabic' && (
          <p className="mt-2 text-[11.5px] leading-snug text-warn">This font has no Arabic letters, so Arabic words fall back to a plain font. The fonts under Arabic have both.</p>
        )}
      </div>

      <Slider label="Size" value={style.size} min={40} max={180} step={2} onChange={(size) => patch({ size })} format={(v) => `${v}px`} />

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField label="Text" value={style.color} onChange={(color) => patch({ color })} />
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Word being said</Label>
            <label className="flex items-center gap-1.5 text-[11px] text-dim">
              <input type="checkbox" checked={!!style.highlight} onChange={(e) => patch({ highlight: e.target.checked ? defaults.highlight ?? '#facc15' : null })} className="size-3.5 accent-[var(--color-accent)]" />
              Highlight
            </label>
          </div>
          {style.highlight ? <ColorField value={style.highlight} onChange={(highlight) => patch({ highlight })} /> : <p className="py-2 text-[11.5px] text-dim">Every word in the same colour.</p>}
        </div>
      </div>

      <div>
        <Label className="mb-1.5">Backdrop</Label>
        <Segmented
          id="clip-backdrop"
          label="Backdrop"
          value={style.backdrop}
          onChange={(backdrop) => patch({ backdrop })}
          options={[
            { value: 'outline', label: 'Outline' },
            { value: 'box', label: 'Box' },
            { value: 'shadow', label: 'Shadow' },
            { value: 'none', label: 'None' },
          ]}
        />
        {style.backdrop !== 'none' && <ColorField className="mt-2.5" label={style.backdrop === 'box' ? 'Box colour' : style.backdrop === 'shadow' ? 'Shadow colour' : 'Outline colour'} value={style.outline} onChange={(outline) => patch({ outline })} />}
      </div>

      <div>
        <Label className="mb-1.5">Position</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            id="clip-position"
            label="Position"
            value={nearest(style.y)}
            onChange={(y) => patch({ y })}
            options={[
              { value: 0.2, label: 'Top' },
              { value: 0.5, label: 'Middle' },
              { value: 0.724, label: 'Lower' },
              { value: 0.85, label: 'Bottom' },
            ]}
          />
        </div>
        <Slider className="mt-2.5" label="Height" value={Math.round(style.y * 100)} min={6} max={94} step={1} onChange={(v) => patch({ y: v / 100 })} format={(v) => `${v}% from top`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="mb-1.5">Words at a time</Label>
          <Segmented id="clip-words" label="Words at a time" value={style.words} onChange={(words) => patch({ words })} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
        </div>
        <div className="flex items-center justify-between gap-3 self-end rounded-lg border border-line px-3 py-2">
          <span className="text-[12.5px]">UPPERCASE</span>
          <Toggle on={style.uppercase} onChange={(uppercase) => patch({ uppercase })} label="Uppercase" />
        </div>
      </div>
    </div>
  )
}

function nearest(y: number) {
  const marks = [0.2, 0.5, 0.724, 0.85]
  const best = marks.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a))
  return Math.abs(best - y) < 0.02 ? best : -1
}

function ColorField({ label, value, onChange, className }: { label?: string; value: string; onChange: (hex: string) => void; className?: string }) {
  return (
    <div className={className}>
      {label && <Label className="mb-1.5">{label}</Label>}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-md border border-line-2" title="Any colour">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label={label ? `${label}: any colour` : 'Any colour'} />
          <span className="size-4 rounded" style={{ background: value }} />
        </label>
        {SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            aria-label={hex}
            className={cn('size-5 rounded-full border transition-transform hover:scale-110', value.toLowerCase() === hex ? 'border-white ring-2 ring-accent-soft/60' : 'border-white/20')}
            style={{ background: hex }}
          />
        ))}
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, format, className }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-[10.5px] text-dim">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" aria-label={label} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Music                                                                */
/* ------------------------------------------------------------------ */

function MusicTab({ music, setMusic }: { music: ClipMusic; setMusic: React.Dispatch<React.SetStateAction<ClipMusic>> }) {
  const [picking, setPicking] = useState(false)
  const track = music.asset

  return (
    <div className="space-y-5">
      {track ? (
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent/12 text-accent-soft"><Music2 className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{track.name ?? 'Sound'}</p>
              <p className="font-mono text-[10.5px] text-dim">{track.duration ? clock(track.duration) : ''} · loops if shorter than the clip</p>
            </div>
            <Btn size="sm" variant="subtle" icon={X} aria-label="Remove music" onClick={() => setMusic((m) => ({ ...m, asset_id: null, asset: null }))} />
          </div>
          <audio src={track.url} controls preload="none" className="mt-3 h-8 w-full" />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line-2 p-6 text-center">
          <Music2 className="mx-auto size-6 text-muted" strokeWidth={1.5} />
          <p className="mt-2 text-[13px] font-medium">No music yet</p>
          <p className="mx-auto mt-1 max-w-[34ch] text-[12px] leading-snug text-dim">Pick a track from your library or upload one. Only use music you have the rights to.</p>
        </div>
      )}
      <Btn icon={Music2} onClick={() => setPicking(true)}>{track ? 'Change music' : 'Add music'}</Btn>

      <Slider label="Music volume" value={Math.round(music.volume * 100)} min={0} max={100} step={1} onChange={(v) => setMusic((m) => ({ ...m, volume: v / 100 }))} format={(v) => `${v}%`} />
      <Slider label="Original sound" value={Math.round(music.original * 100)} min={0} max={150} step={5} onChange={(v) => setMusic((m) => ({ ...m, original: v / 100 }))} format={(v) => (v === 0 ? 'muted' : `${v}%`)} />
      <p className="text-[11.5px] leading-snug text-dim">The music steps down automatically whenever someone speaks, then comes back up. The preview plays it at a flat level.</p>

      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        kinds={['audio']}
        max={1}
        title="Choose music"
        initial={track ? [track] : []}
        onPick={(picked: Asset[]) => picked[0] && setMusic((m) => ({ ...m, asset_id: picked[0].id, asset: picked[0] }))}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Words, lines and phrases                                             */
/* ------------------------------------------------------------------ */

let nextId = 1

/** The transcript as editable lines: about a sentence or a breath each. */
function toLines(words: TimedWord[]): Line[] {
  return group(words, 9, 52, true).map((p) => ({ id: nextId++, start: p.words[0].start, end: p.words[p.words.length - 1].end, text: p.words.map((w) => w.text).join(' '), words: p.words }))
}

/** Lines back into timed words: unchanged word counts keep their timing, the rest share the line's time evenly. */
function fromLines(lines: Line[]): TimedWord[] {
  const out: TimedWord[] = []
  for (const l of lines) {
    const tokens = l.text.split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    if (tokens.length === l.words.length) {
      tokens.forEach((text, i) => out.push({ ...l.words[i], text }))
      continue
    }
    const step = Math.max(0.05, (l.end - l.start) / tokens.length)
    tokens.forEach((text, i) => out.push({ text, start: round(l.start + i * step), end: round(l.start + (i + 1) * step) }))
  }
  return out
}

/** Mirrors Captions::group on the server, so the preview breaks lines where the video will. */
function group(words: TimedWord[], maxWords: number, maxChars: number, sentences = false) {
  const groups: TimedWord[][] = []
  let current: TimedWord[] = []
  let chars = 0
  words.forEach((w, k) => {
    const text = w.text.trim()
    if (!text) return
    current.push({ text, start: w.start, end: w.end })
    chars += text.length + 1
    const next = words[k + 1]
    const pause = next ? next.start - w.end : 1
    const stop = sentences ? /[.!?…]["”»)]*$/.test(text) : /[.,!?;:…]["”»)]*$/.test(text)
    const full = current.length >= maxWords || (chars >= maxChars && current.length >= 2)
    if (full || (stop && (!sentences || current.length >= 6)) || pause > 0.55) {
      groups.push(current)
      current = []
      chars = 0
    }
  })
  if (current.length) groups.push(current)

  return groups.map((g, i) => {
    let end = g[g.length - 1].end
    const nextStart = groups[i + 1]?.[0].start
    end = nextStart !== undefined && nextStart - end < 0.6 ? nextStart : end + 0.25
    return { words: g, start: g[0].start, end }
  })
}

/** Mirrors Captions::lineChars. */
function lineChars(maxWords: number, size: number) {
  return Math.max(4, Math.round((Math.max(16, maxWords * 5) * 94) / Math.max(20, size)))
}

/** Captions drop commas and full stops; questions and exclamations keep theirs. */
function clean(word: string) {
  return word.replace(/[.,;:…]+(["”»)]*)$/, '$1') || word
}

function round(n: number) {
  return Math.round(n * 1000) / 1000
}

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* Fonts                                                                */
/* ------------------------------------------------------------------ */

const loading = new Map<string, Promise<void>>()

/** Load each subtitle font once for the page, from the file the renderer burns with; returns those that are in. */
function useFonts(fonts: ClipFont[]) {
  const [ready, setReady] = useState<Set<string>>(() => new Set())
  const key = fonts.map((f) => f.key).join(',')
  const load = useCallback((f: ClipFont) => {
    let p = loading.get(f.key)
    if (!p) {
      const face = new FontFace(`clip-font-${f.key}`, `url(${f.url})`)
      p = face.load().then(
        (done) => void document.fonts.add(done),
        () => undefined,
      )
      loading.set(f.key, p)
    }
    return p
  }, [])
  useEffect(() => {
    let live = true
    for (const f of fonts) void load(f).then(() => live && setReady((r) => (r.has(f.key) ? r : new Set(r).add(f.key))))
    return () => {
      live = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return ready
}
