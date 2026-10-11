import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clapperboard, LoaderCircle, Music2, Play, Search, Sparkles, Square } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Btn, inputClass, Label, Segmented, Skeleton, Toggle, Select } from '../ui'
import { useAssistant, useVoiceState, type Draft, type VideoRecipe, type Voice } from './store'
import { JobProgress } from './Jobs'
import { CloneVoice, describe, VoiceRow } from './Voices'

/*
 * A post's pictures as a short video with a voice over them (assistant/backend/reel.py): a line per
 * picture, the pictures slowly moving, captions, music and an end card with a call to action. The
 * video has a voice of its own: one that suits the post unless the person picks another (session.py,
 * cast_voice), kept for when it's made again. Its music is a song written for it from a description
 * (ACE-Step, assistant/backend/music.py), the post's own unless the person describes another, or one
 * of FlowAI Sound's moods. The video takes the place of the post's pictures in the same draft (they
 * stay in its history); making it again changes that same draft.
 */

const SONG = { value: 'song', label: 'A song written for it' }
const MUSIC = [
  { value: 'golden-hour', label: 'Golden hour · warm lo-fi' },
  { value: 'linen', label: 'Linen · airy ambient' },
  { value: 'atelier', label: 'Atelier · bright acoustic' },
  { value: 'pulse', label: 'Pulse · upbeat house' },
  { value: 'night-drive', label: 'Night drive · synthwave' },
  { value: 'bloom', label: 'Bloom · dreamy, cinematic' },
  { value: 'none', label: 'No music' },
]
const MOTION = [
  { value: 'auto', label: 'Mixed' },
  { value: 'zoom-in', label: 'Zoom in' },
  { value: 'zoom-out', label: 'Zoom out' },
  { value: 'pan', label: 'Pan' },
]
const PLACES: Record<string, Array<{ value: string; label: string }>> = {
  instagram: [
    { value: 'reel', label: 'Reel' },
    { value: 'story', label: 'Story' },
    { value: 'feed', label: 'Feed' },
  ],
  x: [{ value: 'post', label: 'Post' }],
}

type Form = {
  lines: string[]
  cta: string
  cta_line: string
  music: string
  /** The song described (music 'song'); empty: one that suits the post. */
  song: string
  /** Make the same song again as a new take, not the one it has. */
  retake: boolean
  captions: boolean
  motion: string
  placement: string
  /** Who reads it; null: one that suits the post, picked when it's made. */
  voice: Voice | null
}

function formFrom(recipe: VideoRecipe | null | undefined, n: number, platform: string, songs: boolean): Form {
  const lines = [...(recipe?.lines ?? [])].slice(0, n)
  return {
    lines: [...lines, ...Array(Math.max(0, n - lines.length)).fill('')],
    cta: recipe?.cta ?? '',
    cta_line: recipe?.cta_line ?? '',
    music: recipe ? (recipe.music ?? 'none') : songs ? 'song' : 'golden-hour',
    song: recipe?.song ?? '',
    retake: false,
    captions: recipe?.captions ?? true,
    motion: recipe?.motion ?? 'auto',
    placement: recipe?.placement ?? (platform === 'x' ? 'post' : 'reel'),
    voice: recipe?.voice ?? null,
  }
}

type Picture = { url: string | null; kind: 'image' | 'video' }

/** The pictures a draft's video is (or would be) made of, one voiceover line each, and their shape. */
function picturesOf(d: Draft, a: ReturnType<typeof useAssistant>): { pictures: Picture[]; shape: [number, number] } | null {
  if (!d.video) return { pictures: d.slides.map((s) => ({ url: s.url, kind: s.kind })), shape: d.size }
  if (d.video.pictures) {
    return {
      pictures: d.video.pictures.map((n) => {
        const p = a.pictures.find((x) => x.id === n)
        return { url: p?.url ?? null, kind: p?.kind ?? 'image' }
      }),
      shape: d.video.shape ?? d.size,
    }
  }
  // Made before videos went in place of the pictures: they're in the draft it was made from
  const source = a.drafts[d.video.from]
  return source && source.id !== d.id ? { pictures: source.slides.map((s) => ({ url: s.url, kind: s.kind })), shape: source.size } : null
}

/** The Video section of a draft: make its pictures into a video in its place, or make its video again. */
export function VideoMaker({ d }: { d: Draft }) {
  const a = useAssistant()
  const source = picturesOf(d, a)
  // How it was made, to make it again: its own video, the one made from these pictures last time, or
  // (from before videos went in place of the pictures) a separate video draft
  const older = !d.video && d.videos.length ? a.drafts[d.videos[d.videos.length - 1]] : undefined
  const recipe = d.video ?? d.last_video ?? older?.video ?? null
  const n = source?.pictures.length ?? 0
  const [form, setForm] = useState<Form>(() => formFrom(recipe, n, d.platform, a.songs))
  const key = `${d.id}-${d.version}-${older?.version}-${n}-${a.songs}`
  useEffect(() => setForm(formFrom(recipe, n, d.platform, a.songs)), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const making = new Set([`Making the video of draft ${d.id}`, ...(d.video ? [`Making the video of draft ${d.video.from}`] : [])])
  const job = Object.values(a.jobs).find((j) => making.has(j.label))
  const pictures = source?.pictures.filter((s) => s.kind === 'image').length ?? 0
  const hasVideoSlide = !d.video && d.slides.some((s) => s.kind === 'video')
  const written = form.lines.some((l) => l.trim())
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  if (!source) {
    return <p className="text-[12px] text-dim">The pictures this video was made from are gone, so it can’t be made again. Go back to a version with pictures in the history.</p>
  }
  if (!d.video && (hasVideoSlide || !pictures)) {
    return (
      <p className="text-[12px] text-dim">
        {hasVideoSlide ? 'A video with a voice is made from pictures: this draft has a video slide.' : 'Add a picture first: each picture gets a line of the voiceover.'}
      </p>
    )
  }

  // The song it has stays as it is unless it's described anew or a new take is asked for
  const described = form.song.trim()
  const sameSong = recipe?.music === 'song' && described === (recipe.song ?? '') && !form.retake
  // Songs off: a song it had is kept (the composer plays in its place), a new one is the composer's
  const music = form.music !== 'song' ? form.music : !a.songs ? (recipe?.music === 'song' ? undefined : 'golden-hour') : sameSong ? undefined : described || 'song'
  const make = () =>
    a.action('make_video', {
      draft: d.id,
      lines: form.lines.map((l) => l.trim()),
      cta: form.cta.trim(),
      cta_line: form.cta_line.trim(),
      ...(music !== undefined ? { music } : {}),
      captions: form.captions,
      motion: form.motion,
      placement: form.placement,
      ...(form.voice ? { voice: form.voice.id } : {}),
    })
  const writeForMe = () =>
    void a.say(
      `Write a short voiceover for draft ${d.id}, one line per picture, with a call to action at the end, and make it into a video${form.music === 'song' ? (described ? ` with this music: ${described}` : ' with a song that suits the post') : form.music !== 'none' ? ` with ${form.music} music` : ' without music'}, ${form.voice ? `read by the voice ${form.voice.name} (voice ${form.voice.id})` : 'read by a voice that suits the post'}.`,
    )

  return (
    <div className="space-y-3.5">
      <p className="text-[12px] leading-relaxed text-muted">
        {d.video ? (
          'Made from this post’s pictures (they’re in its history). Change the words, music or end card and make it again.'
        ) : (
          <>
            The pictures move while a voice that suits the post reads a line over each, with captions and music. The video takes their place in this post; they stay in its history.
            {older && (
              <>
                {' '}
                An earlier video of it is{' '}
                <button type="button" className="text-fg underline decoration-white/25 underline-offset-2 hover:decoration-white/60" onClick={() => a.setCurrent(older.id)}>
                  draft {older.id}
                </button>
                .
              </>
            )}
          </>
        )}
      </p>

      <div className="space-y-2">
        {form.lines.map((line, i) => {
          const s = source.pictures[i]
          return (
            <div key={i} className="flex items-start gap-2.5">
              <span className="relative mt-0.5 h-12 shrink-0 overflow-hidden rounded-md bg-[#1c1c1c]" style={{ aspectRatio: `${source.shape[0]} / ${source.shape[1]}` }}>
                {s?.kind === 'image' && s.url && <img src={s.url} alt="" className="size-full object-cover" />}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 font-mono text-[9px] text-white">{i + 1}</span>
              </span>
              <textarea
                value={line}
                rows={Math.min(5, Math.max(2, Math.ceil(line.length / 44)))}
                onChange={(e) =>
                  set({
                    lines: form.lines.map((l, k) => (k === i ? e.target.value : l)),
                  })
                }
                placeholder={i === 0 ? 'The hook: what the voice says over picture 1' : `What it says over picture ${i + 1}`}
                aria-label={`Voiceover for picture ${i + 1}`}
                className={cn(inputClass, 'h-auto min-h-12 resize-y py-1.5 text-[12.5px] leading-snug')}
              />
            </div>
          )
        })}
      </div>

      <VideoVoice draft={d.id} lines={form.lines} voice={form.voice} made={!!recipe?.voice} onChange={(voice) => set({ voice })} />

      <div>
        <Label className="mb-1.5">End card</Label>
        <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <input
            value={form.cta}
            onChange={(e) => set({ cta: e.target.value })}
            maxLength={40}
            placeholder="Button: Order now"
            aria-label="Button on the end card"
            className={cn(inputClass, 'h-8 text-[12.5px]')}
          />
          <input
            value={form.cta_line}
            onChange={(e) => set({ cta_line: e.target.value })}
            placeholder="Said over it: Order yours today, link in bio."
            aria-label="What the voice says on the end card"
            className={cn(inputClass, 'h-8 text-[12.5px]')}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-[12rem] flex-1">
          <Label className="mb-1.5">Music</Label>
          <Select value={form.music} onChange={(e) => set({ music: e.target.value })} aria-label="Music" fieldClassName={cn(inputClass, 'h-8 px-2 text-[12px]')}>
            {[...(a.songs || form.music === 'song' ? [SONG] : []), ...MUSIC].map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="mb-1.5">Motion</Label>
          <Segmented id={`motion-${d.id}`} label="Motion" value={form.motion} onChange={(motion) => set({ motion })} options={MOTION} className="text-[11.5px]" />
        </div>
        {PLACES[d.platform].length > 1 && (
          <div>
            <Label className="mb-1.5">As</Label>
            <Segmented id={`as-${d.id}`} label="Format" value={form.placement} onChange={(placement) => set({ placement })} options={PLACES[d.platform]} className="text-[11.5px]" />
          </div>
        )}
        <label className="flex h-8 items-center gap-2 text-[12px] text-muted">
          <Toggle on={form.captions} onChange={(captions) => set({ captions })} label="Captions" />
          Captions
        </label>
      </div>

      <AnimatePresence initial={false}>
        {form.music === 'song' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease }} className="-mt-1 overflow-hidden">
            <div className="flex items-center gap-3 pt-1">
              <label className="relative block min-w-0 flex-1">
                <Music2 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
                <input
                  value={form.song}
                  onChange={(e) => set({ song: e.target.value, retake: false })}
                  maxLength={300}
                  placeholder="upbeat acoustic pop, ukulele, hand claps, 112 bpm"
                  aria-label="Describe the music"
                  className={cn(inputClass, 'h-8 pl-8 text-[12.5px]')}
                />
              </label>
              {recipe?.music === 'song' && described === (recipe.song ?? '') && (
                <label className="flex h-8 shrink-0 items-center gap-2 text-[12px] text-muted">
                  <Toggle on={form.retake} onChange={(retake) => set({ retake })} label="A new take of this song" />
                  New take
                </label>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-dim">
              {!a.songs
                ? 'Songs are off right now, so Golden hour plays instead. They come back once the music service is running.'
                : sameSong
                  ? 'Made again with the same song. Describe another, or ask for a new take.'
                  : described
                    ? 'Written for this video from your words: genre, instruments, mood and tempo work best. No vocals.'
                    : 'Left empty, a song that suits the post is written for it.'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {job && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
            <JobProgress job={job} compact title="Making the video" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="primary" icon={Clapperboard} onClick={make} disabled={!written || a.conn !== 'online' || job?.status === 'running'}>
          {d.video ? 'Make it again' : 'Make the video'}
        </Btn>
        {!d.video && (
          <Btn size="sm" variant="subtle" icon={Sparkles} onClick={writeForMe} disabled={a.conn !== 'online'}>
            {written ? 'Rewrite it for me' : 'Write it for me'}
          </Btn>
        )}
      </div>
    </div>
  )
}

/**
 * Who reads the video: the voice picked for it (to suit the post, or by the person), to hear and
 * change. Changing it finds the voices that fit a description, or without one, those that suit the
 * post best; the new one is used when the video is made (again).
 */
function VideoVoice({ draft, lines, voice, made, onChange }: { draft: number; lines: string[]; voice: Voice | null; made: boolean; onChange: (v: Voice | null) => void }) {
  const a = useAssistant()
  const speaking = useVoiceState(a.link) === 'speaking'
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [lang, setLang] = useState('')
  const find = a.findVideoVoices
  const online = a.conn === 'online'

  // Without words: the voices that suit the post as it is now (its lines too); with words, as you type
  useEffect(() => {
    if (!open || !online) return
    const t = window.setTimeout(() => find(draft, q.trim(), lang, q.trim() ? undefined : lines.map((l) => l.trim())), q.trim() ? 300 : 0)
    return () => window.clearTimeout(t)
  }, [open, online, q, lang, draft, find]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = a.videoVoices?.draft === draft ? a.videoVoices : null
  const searching = !list || list.q !== q.trim() || list.lang !== lang
  const chosen = (v: Voice) => !!voice && (v.id === voice.id || (!!v.catalog && v.id === voice.archetype))
  const pick = (v: Voice) => {
    onChange(v)
    setOpen(false)
  }
  const mine = mineRow(list?.mine, list?.voices ?? [])
  const sampling = !!voice && a.sample?.id === voice.id
  const playing = sampling && !a.sample!.loading && speaking

  return (
    <div>
      <Label className="mb-1.5">Voice</Label>
      <div className="flex items-center gap-2.5 rounded-lg border border-line py-2 pl-2 pr-2">
        {voice ? (
          <button
            type="button"
            onClick={() => (playing ? a.interrupt() : a.previewVoice(voice, !!voice.catalog))}
            disabled={(sampling && a.sample!.loading) || !online}
            aria-label={playing ? 'Stop the sample' : `Hear ${voice.name}`}
            title={playing ? 'Stop' : 'Hear it'}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-60',
              playing ? 'border-accent-soft/60 text-accent-soft' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
            )}
          >
            {sampling && a.sample!.loading ? <LoaderCircle className="size-3.5 animate-spin" /> : playing ? <Square className="size-3" fill="currentColor" /> : <Play className="size-3.5 translate-x-px" fill="currentColor" />}
          </button>
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-2 text-accent-soft">
            <Sparkles className="size-3.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium">{voice ? voice.name : 'One that suits the post'}</p>
          <p className="line-clamp-2 text-[11px] leading-snug text-muted">
            {voice ? describe(voice) || (made ? 'The voice of the last video' : 'Your pick') : 'Picked from what the post says and who it’s for when the video is made.'}
          </p>
        </div>
        <Btn size="sm" onClick={() => setOpen((o) => !o)} disabled={!online && !open} aria-expanded={open} className="shrink-0">
          {open ? 'Close' : voice ? 'Change' : 'Choose'}
        </Btn>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
            <div className="pt-2">
              {list && !list.choosable ? (
                <>
                  <div className="space-y-1.5">
                    {list.voices.map((v, i) => (
                      <VoiceRow key={v.id} v={v} i={i} catalog={false} current={chosen(v)} speaking={speaking} onUse={() => pick(v)} currentLabel="Chosen" />
                    ))}
                  </div>
                  {list.clonable && <CloneVoice className="mt-2" onCloned={pick} />}
                  <p className="mt-2 px-1 text-[11.5px] leading-snug text-dim">
                    This assistant has its own voice{list.clonable ? ' and the ones cloned here' : ''}. Connected to a VoiceStudio server (TTS_URL), a video can be read by any of over a thousand.
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-2 flex gap-1.5">
                    <label className="relative block min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Describe it: warm young woman, upbeat…"
                        aria-label="Describe the voice"
                        className={cn(inputClass, 'h-8 pl-8 text-[12.5px]')}
                      />
                    </label>
                    <div className="w-[8.75rem] shrink-0">
                      <Select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" fieldClassName={cn(inputClass, 'h-8 px-2 text-[12px]')}>
                        <option value="">{list?.language && !q.trim() ? `${list.language} (the post’s)` : 'Any language'}</option>
                        {(list?.languages ?? []).map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] leading-snug text-dim">
                    {searching && <LoaderCircle className="size-3 shrink-0 animate-spin" />}
                    {list?.error
                      ? list.error
                      : !q.trim()
                        ? list?.described && !searching
                          ? `Suits the post: ${list.described}.`
                          : 'Finding the voices that suit the post…'
                        : 'The closest to your description, best first.'}
                  </p>
                  {!list ? (
                    <div className="space-y-1.5">
                      {Array.from({ length: 3 }, (_, i) => (
                        <Skeleton key={i} className="h-[52px] rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    <div data-lenis-prevent className={cn('max-h-[19rem] space-y-1.5 overflow-y-auto transition-opacity', searching && 'opacity-60')}>
                      {list.voices.map((v, i) => (
                        <VoiceRow key={v.id} v={v} i={i} catalog={!!v.catalog} current={chosen(v)} speaking={speaking} onUse={() => pick(v)} currentLabel="Chosen" />
                      ))}
                      {!list.voices.length && <p className="px-1 text-[11.5px] text-dim">No voice matches. Try fewer words, or another language.</p>}
                    </div>
                  )}
                  {mine && (
                    <div className="mt-3">
                      <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-dim">The assistant’s own voice</p>
                      <VoiceRow v={mine} i={0} catalog={false} current={chosen(mine)} speaking={speaking} onUse={() => pick(mine)} currentLabel="Chosen" />
                    </div>
                  )}
                  {list?.clonable && <CloneVoice className="mt-3" onCloned={pick} />}
                  {voice && !made && (
                    <button type="button" onClick={() => onChange(null)} className="mt-2.5 px-1 text-[11.5px] text-muted underline decoration-white/25 underline-offset-2 hover:text-fg hover:decoration-white/60">
                      Let it pick one that suits the post instead
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The assistant's own voice, when it isn't among the voices found already. */
function mineRow(mine: Voice | undefined, found: Voice[]) {
  return mine && !found.some((v) => v.id === mine.id) ? mine : null
}
