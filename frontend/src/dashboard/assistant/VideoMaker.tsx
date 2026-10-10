import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clapperboard, Film, LoaderCircle, Sparkles } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Btn, inputClass, Label, Segmented, Toggle } from '../ui'
import { useAssistant, type Draft, type VideoRecipe } from './store'

/*
 * A post's pictures as a short video with the assistant's voice (assistant/backend/reel.py): a line
 * per picture read in the voice picked under the message box, the pictures slowly moving, captions,
 * music from FlowAI Sound and an end card with a call to action. It's made into a draft of its own;
 * making it again changes that same draft.
 */

const MUSIC = [
  { value: 'none', label: 'No music' },
  { value: 'golden-hour', label: 'Golden hour · warm lo-fi' },
  { value: 'linen', label: 'Linen · airy ambient' },
  { value: 'atelier', label: 'Atelier · bright acoustic' },
  { value: 'pulse', label: 'Pulse · upbeat house' },
  { value: 'night-drive', label: 'Night drive · synthwave' },
  { value: 'bloom', label: 'Bloom · dreamy, cinematic' },
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
  captions: boolean
  motion: string
  placement: string
}

function formFrom(recipe: VideoRecipe | null | undefined, n: number, platform: string): Form {
  const lines = [...(recipe?.lines ?? [])].slice(0, n)
  return {
    lines: [...lines, ...Array(Math.max(0, n - lines.length)).fill('')],
    cta: recipe?.cta ?? '',
    cta_line: recipe?.cta_line ?? '',
    music: recipe ? (recipe.music ?? 'none') : 'golden-hour',
    captions: recipe?.captions ?? true,
    motion: recipe?.motion ?? 'auto',
    placement: recipe?.placement ?? (platform === 'x' ? 'post' : 'reel'),
  }
}

/** The Video section of a draft: make its pictures into a video, or make its video again. */
export function VideoMaker({ d }: { d: Draft }) {
  const a = useAssistant()
  // A video draft is made from another draft's pictures; a picture draft may have videos already
  const source = d.video ? a.drafts[d.video.from] : d
  const made = d.video ? d : d.videos.length ? a.drafts[d.videos[d.videos.length - 1]] : undefined
  const recipe = made?.video
  const n = source?.slides.length ?? 0
  const [form, setForm] = useState<Form>(() => formFrom(recipe, n, d.platform))
  const key = `${source?.id}-${made?.id}-${made?.version}-${n}`
  useEffect(() => setForm(formFrom(recipe, n, d.platform)), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const job = Object.values(a.jobs).find((j) => source && j.label === `Making the video of draft ${source.id}`)
  const pictures = source?.slides.filter((s) => s.kind === 'image').length ?? 0
  const hasVideoSlide = source?.slides.some((s) => s.kind === 'video')
  const written = form.lines.some((l) => l.trim())
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  if (!source) {
    return <p className="text-[12px] text-dim">The draft this video was made from is gone, so it can’t be made again.</p>
  }
  if (!d.video && (hasVideoSlide || !pictures)) {
    return (
      <p className="text-[12px] text-dim">
        {hasVideoSlide ? 'A video with a voice is made from pictures: this draft has a video slide.' : 'Add a picture first: each picture gets a line of the voiceover.'}
      </p>
    )
  }

  const make = () =>
    a.action('make_video', {
      draft: d.id,
      lines: form.lines.map((l) => l.trim()),
      cta: form.cta.trim(),
      cta_line: form.cta_line.trim(),
      music: form.music,
      captions: form.captions,
      motion: form.motion,
      placement: form.placement,
    })
  const writeForMe = () =>
    void a.say(
      `Write a short voiceover for draft ${source.id}, one line per picture, with a call to action at the end, and make it into a video${form.music !== 'none' ? ` with ${form.music} music` : ' without music'}.`,
    )

  return (
    <div className="space-y-3.5">
      <p className="text-[12px] leading-relaxed text-muted">
        {d.video ? (
          <>
            Made from{' '}
            <button type="button" className="text-fg underline decoration-white/25 underline-offset-2 hover:decoration-white/60" onClick={() => a.setCurrent(source.id)}>
              draft {source.id}
            </button>
            ’s pictures. Change the words, music or end card and make it again.
          </>
        ) : (
          <>
            The pictures move while the voice
            {a.voice ? ` (${a.voice.name})` : ''} reads a line over each, with captions and music.
            {made && (
              <>
                {' '}
                Its video is{' '}
                <button type="button" className="text-fg underline decoration-white/25 underline-offset-2 hover:decoration-white/60" onClick={() => a.setCurrent(made.id)}>
                  draft {made.id}
                </button>
                .
              </>
            )}
          </>
        )}
      </p>

      <div className="space-y-2">
        {form.lines.map((line, i) => {
          const s = source.slides[i]
          return (
            <div key={i} className="flex items-start gap-2.5">
              <span className="relative mt-0.5 h-12 shrink-0 overflow-hidden rounded-md bg-[#1c1c1c]" style={{ aspectRatio: `${source.size[0]} / ${source.size[1]}` }}>
                {s?.kind === 'image' && <img src={s.url} alt="" className="size-full object-cover" />}
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
          <select value={form.music} onChange={(e) => set({ music: e.target.value })} aria-label="Music" className={cn(inputClass, 'h-8 px-2 text-[12px]')}>
            {MUSIC.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
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
        {job && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
            <div className="rounded-lg border border-line px-3 py-2.5">
              <p className="flex items-center gap-2 text-[12px]">
                {job.status === 'failed' ? <Film className="size-3.5 text-fail" /> : <LoaderCircle className="size-3.5 animate-spin text-accent-soft" />}
                <span className={job.status === 'failed' ? 'text-fail' : ''}>{job.status === 'failed' ? `It couldn’t be made: ${job.text}` : 'Making the video'}</span>
                {job.status !== 'failed' && <span className="ml-auto font-mono text-[10.5px] text-dim">{job.text || 'voice…'}</span>}
              </p>
              {job.status !== 'failed' && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div className="h-full rounded-full bg-accent-soft" animate={{ width: job.text || '4%' }} transition={{ duration: 0.4, ease }} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="primary" icon={Clapperboard} onClick={make} disabled={!written || a.conn !== 'online' || (!!job && job.status !== 'failed')}>
          {made ? 'Make it again' : 'Make the video'}
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
