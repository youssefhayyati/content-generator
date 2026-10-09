import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Clapperboard, ImagePlus, Music2, Pause, Play, Send, Sparkles, X } from 'lucide-react'
import { api, type Account, type Asset, type AssetWords, type ModelInfo, type Page, type SoundCatalog, type TimedWord } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useApi, useInvalidate } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { GenerationCard, useGenerations } from '../studio/parts'
import { messageFor, retryGeneration } from '../studio/run'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Panel, Skeleton, Toggle } from '../ui'
import { AccentPicker } from './pickers'
import { Bars, fmtClock } from './Player'
import { ReelPreview, type ReelStyle } from './ReelPreview'

/**
 * Reels: a voice (or a track), music under it, a picture, a look — watched live in the phone
 * before anything renders, then rendered on the server with captions that follow every word.
 */
export function ReelMaker({ models }: { models: ModelInfo[] }) {
  const { search, navigate } = useRouter()
  const params = new URLSearchParams(search)
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data: catalog } = useApi<SoundCatalog>('/sound')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const { data: library } = useApi<Page<Asset>>('/assets', { kind: 'audio' })
  const sounds = library?.data ?? []
  const [voice, setVoice] = useState<Asset | null>(null)
  const [music, setMusic] = useState<Asset | null>(null)
  const [background, setBackground] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  const [style, setStyle] = useState<ReelStyle>('bold')
  const [account, setAccount] = useState<Account | null>(null)
  const [accent, setAccent] = useState('#f5b04c')
  const [title, setTitle] = useState('')
  const [captions, setCaptions] = useState(true)
  const [volume, setVolume] = useState(0.3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: feed, loading } = useGenerations({ kind: 'reel' })

  // Arriving from a voiceover, a track or the library with the sound already chosen.
  useEffect(() => {
    if (!sounds.length) return
    const a = Number(params.get('audio'))
    const m = Number(params.get('music'))
    if (a && !voice) setVoice(sounds.find((s) => s.id === a) ?? null)
    if (m && !music) setMusic(sounds.find((s) => s.id === m) ?? null)
    if (!a && !m && !voice && !music) {
      // Nothing chosen: start with the latest voice and the latest track, if there are some.
      setVoice(sounds.find((s) => s.sound?.type !== 'music') ?? null)
      setMusic(sounds.find((s) => s.sound?.type === 'music') ?? null)
    }
    // When the library arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library])

  const chooseAccount = (a: Account | null) => {
    setAccount(a)
    if (a) setAccent(a.sound.accent)
  }

  const render = async () => {
    if (!voice && !music) return setError('Pick a voice or a track for the reel to play.')
    setBusy(true)
    setError(null)
    try {
      await api('/generations', {
        method: 'POST',
        body: {
          kind: 'reel',
          prompt: title.trim() || (voice?.sound?.script?.split(/[.!?]/)[0]?.slice(0, 60) ?? music?.sound?.label ?? 'Reel'),
          input_asset_ids: [voice?.id ?? music!.id, ...(background ? [background.id] : [])],
          params: {
            style,
            accent,
            title: title.trim() || undefined,
            handle: account?.handle,
            captions,
            music_asset_id: voice && music ? music.id : undefined,
            music_volume: volume,
          },
        },
      })
      invalidate()
      toast('Rendering. Usually faster than the reel is long.')
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  if (!catalog || !library) return <Skeleton className="h-[560px] rounded-xl" />

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Make a reel" sub="Vertical, 1080 × 1920, ready for Reels, TikTok and Shorts.">
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="min-w-0 space-y-5">
              <SoundSlot label="Voice" hint="What’s said. The captions follow it." sounds={sounds.filter((s) => s.sound?.type !== 'music')} value={voice} onChange={setVoice} empty="Make a voiceover in Sound, or upload audio in the Library." onMake={() => navigate('/dashboard/studio?tab=sound')} />
              <SoundSlot label="Music" hint={voice ? 'Plays under the voice and steps aside when it speaks.' : 'Plays on its own, with the title on screen.'} sounds={sounds.filter((s) => s.sound?.type === 'music')} value={music} onChange={setMusic} empty="Compose a track in Sound." onMake={() => navigate('/dashboard/studio?tab=sound&mode=music')} />
              {voice && music && (
                <label className="block">
                  <span className="flex items-center justify-between">
                    <Label>Music level</Label>
                    <span className="font-mono text-[10.5px] text-dim">{Math.round(volume * 100)}%</span>
                  </span>
                  <input type="range" min={0.1} max={0.6} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
                </label>
              )}
              <div>
                <Label>Picture</Label>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => setPicking(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12.5px] text-muted transition-colors hover:border-accent-soft/60 hover:text-fg">
                    {background ? <MediaThumb asset={background} className="size-11" /> : <span className="grid size-11 place-items-center rounded-md" style={{ background: `linear-gradient(135deg, #050507, ${accent})` }}><ImagePlus className="size-4 text-white/80" /></span>}
                    <span className="truncate">{background ? (background.name ?? 'Picture') : 'A moving gradient · or pick a photo or video'}</span>
                  </button>
                  {background && <Btn size="sm" variant="subtle" icon={X} onClick={() => setBackground(null)} aria-label="No picture" />}
                </div>
                <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => setBackground(a[0] ?? null)} max={1} title="A photo or video for the reel" />
              </div>
            </div>

            <div className="min-w-0 space-y-5">
              <div>
                <Label>Look</Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {catalog.styles.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStyle(s.id)}
                      title={s.detail}
                      className={cn('overflow-hidden rounded-lg border text-left transition-colors', style === s.id ? 'border-white/40 bg-white/[0.04]' : 'border-line hover:border-line-2')}
                    >
                      <StyleSwatch style={s.id} accent={accent} />
                      <span className="block px-2 py-1.5 text-[12px] font-medium">{s.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-dim">{catalog.styles.find((s) => s.id === style)?.detail}</p>
              </div>
              <label className="block">
                <Label>For</Label>
                <select value={account?.id ?? ''} onChange={(e) => chooseAccount((accounts ?? []).find((a) => a.id === Number(e.target.value)) ?? null)} className={cn(inputClass, 'mt-2')}>
                  <option value="">No handle on screen</option>
                  {(accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <Label>Accent</Label>
                <div className="mt-2">
                  <AccentPicker value={accent} onChange={setAccent} />
                </div>
              </div>
              <label className="block">
                <Label>Title on screen</Label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={music && !voice ? 'Golden hour, in the atelier' : 'Why fifty hours?'} className={cn(inputClass, 'mt-2')} />
              </label>
              {voice && (
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px]">Captions that follow every word</span>
                  <Toggle on={captions} onChange={setCaptions} label="Captions" />
                </label>
              )}
            </div>
          </div>
          <FieldError message={error} />
          <Btn variant="primary" icon={Clapperboard} loading={busy} onClick={render} disabled={!voice && !music} className="mt-6 w-full sm:w-auto">
            Render the reel
          </Btn>
        </Panel>

        <Stage voice={voice} music={music} volume={volume} style={style} accent={accent} title={title} handle={account?.handle ?? null} background={background} captions={captions} />
      </div>

      <section>
        <Label>Rendered</Label>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {!feed && loading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : feed && !feed.length ? (
            <EmptyState icon={Clapperboard} title="No reels yet" body="Pick a voice and a look above: it plays in the phone first, then renders here." className="col-span-full" />
          ) : (
            feed?.map((g) => (
              <GenerationCard
                key={g.id}
                generation={g}
                models={models}
                compact
                onRetry={async (x, change) => {
                  await retryGeneration(x, change)
                  invalidate()
                }}
                actions={
                  g.status === 'succeeded' && g.outputs[0] ? (
                    <Btn size="sm" variant="subtle" icon={Send} onClick={() => navigate(`/dashboard/create?assets=${g.outputs[0].id}`)}>
                      Use in a post
                    </Btn>
                  ) : null
                }
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

/** A sound to choose: the latest ones as rows with their waveform, and the chosen one marked. */
function SoundSlot({ label, hint, sounds, value, onChange, empty, onMake }: { label: string; hint: string; sounds: Asset[]; value: Asset | null; onChange: (a: Asset | null) => void; empty: string; onMake: () => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? sounds : sounds.slice(0, 3)
  if (value && !shown.some((s) => s.id === value.id)) shown.unshift(value)
  return (
    <div>
      <span className="flex items-center justify-between">
        <Label>{label}</Label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-[11px] text-dim hover:text-fg">
            None
          </button>
        )}
      </span>
      <p className="mt-1 text-[11px] text-dim">{hint}</p>
      {sounds.length === 0 ? (
        <button type="button" onClick={onMake} className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-line-2 px-3 py-2.5 text-left text-[12px] text-dim hover:border-accent-soft/50 hover:text-fg">
          <Sparkles className="size-3.5" /> {empty}
        </button>
      ) : (
        <ul className="mt-2 space-y-1">
          {shown.map((s) => {
            const on = value?.id === s.id
            return (
              <li key={s.id}>
                <button type="button" onClick={() => onChange(on ? null : s)} className={cn('flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors', on ? 'border-accent-soft/50 bg-accent/[0.07]' : 'border-line hover:border-line-2')}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted">{s.sound?.type === 'music' ? <Music2 className="size-3.5" /> : <Play className="size-3" fill="currentColor" />}</span>
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate text-[12px]">{s.sound?.type === 'music' ? `${s.sound.label} · ${s.sound.key}` : (s.sound?.script ?? s.name)}</span>
                    <span className="mt-1 block text-white/30">
                      <Bars peaks={s.sound?.peaks ?? []} progress={0} accent="var(--color-accent-soft)" height={14} className="block w-full" />
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-dim">{s.duration ? fmtClock(s.duration) : ''}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {sounds.length > 3 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 text-[11px] text-dim hover:text-fg">
          {all ? 'Fewer' : `All ${sounds.length}`}
        </button>
      )}
    </div>
  )
}

/** A tiny painting of each look. */
function StyleSwatch({ style, accent }: { style: ReelStyle; accent: string }) {
  if (style === 'editorial')
    return (
      <span className="relative block h-16 bg-[#ecebe6]">
        <span className="absolute left-2 top-2 h-5 w-[calc(100%-1rem)] bg-[#c9c3b7]" />
        <span className="absolute left-2 top-9 h-[2px] w-3" style={{ background: accent }} />
        <span className="absolute inset-x-3 top-11 font-serif text-[9px] italic leading-none text-[#121212]">read along</span>
      </span>
    )
  if (style === 'pulse')
    return (
      <span className="relative flex h-16 items-center justify-center gap-[2px]" style={{ background: `linear-gradient(135deg, #050507, ${accent}55)` }}>
        {[5, 9, 14, 8, 16, 11, 6, 12, 7].map((h, i) => (
          <span key={i} className="w-[3px] rounded-full bg-white/90" style={{ height: h * 2 }} />
        ))}
      </span>
    )
  return (
    <span className="relative flex h-16 items-center justify-center" style={{ background: `linear-gradient(160deg, #0a0a0c, ${accent}66)` }}>
      <span className="text-[12px] font-extrabold text-white">
        big <span style={{ color: accent }}>words</span>
      </span>
    </span>
  )
}

/**
 * The phone: the reel playing live. The voice and the music play together, the music at its
 * level; the preview follows the voice's clock.
 */
function Stage({ voice, music, volume, style, accent, title, handle, background, captions }: { voice: Asset | null; music: Asset | null; volume: number; style: ReelStyle; accent: string; title: string; handle: string | null; background: Asset | null; captions: boolean }) {
  const main = useRef<HTMLAudioElement>(null)
  const bed = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [words, setWords] = useState<TimedWord[]>([])
  const lead = voice ?? music
  const duration = lead?.duration ?? 0

  useEffect(() => {
    setWords([])
    setTime(0)
    setPlaying(false)
    if (voice?.sound?.timed) api<AssetWords>(`/assets/${voice.id}/words`).then((w) => setWords(w.words)).catch(() => {})
  }, [voice?.id, voice?.sound?.timed])

  useEffect(() => {
    if (bed.current) bed.current.volume = voice ? volume : 1
  }, [volume, voice, music?.id])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      setTime(main.current?.currentTime ?? 0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = () => {
    const m = main.current
    if (!m) return
    if (m.paused) {
      m.play().catch(() => {})
      if (bed.current && voice) {
        bed.current.currentTime = m.currentTime % (bed.current.duration || Infinity)
        bed.current.play().catch(() => {})
      }
    } else {
      m.pause()
      bed.current?.pause()
    }
  }

  const peaks = useMemo(() => lead?.sound?.peaks ?? [], [lead])

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="flex flex-col items-center gap-4 lg:sticky lg:top-20">
      <div className="relative">
        <ReelPreview style={style} accent={accent} title={title} handle={handle} background={background} words={captions ? words : []} time={time} playing={playing} peaks={peaks} duration={duration} />
        {!lead && <p className="absolute inset-0 grid place-items-center px-8 text-center text-[12px] text-white/70">Pick a voice or a track to hear it here.</p>}
      </div>
      {lead && (
        <div className="flex w-[270px] items-center gap-3">
          <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play the preview'} className="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-ink transition-transform hover:scale-105">
            {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
          </button>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full bg-accent-soft" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
          </span>
          <span className="font-mono text-[10.5px] tabular-nums text-dim">{fmtClock(time)}</span>
        </div>
      )}
      <p className="max-w-[270px] text-center text-[11px] leading-snug text-dim">A live preview. The render is the same layout, with the music stepping aside whenever the voice speaks.</p>
      {lead && (
        <audio
          ref={main}
          src={lead.url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setTime(0)
            bed.current?.pause()
          }}
        />
      )}
      {voice && music && <audio ref={bed} src={music.url} preload="auto" loop />}
    </motion.div>
  )
}
