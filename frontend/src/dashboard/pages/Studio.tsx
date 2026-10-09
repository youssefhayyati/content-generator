import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, CalendarClock, Check, FileText, FolderKanban, ImagePlus, PenLine, Plus, Sparkles, Wand2, X } from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, type Asset, type Generation, type ModelInfo, type Project, type Registry } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam, useRouter } from '../../lib/router'
import { fmtRelative, PLATFORM_ORDER, useApi, useInvalidate } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { ReelMaker } from '../sound/ReelMaker'
import { SoundStudio } from '../sound/SoundStudio'
import { CanvasView } from '../studio/Canvas'
import { GenerationCard, ModelPicker, useGenerations } from '../studio/parts'
import { messageFor, retryGeneration, runMedia, runText } from '../studio/run'
import { useToast } from '../toast'
import { useUser } from '../Shell'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Panel, Segmented, Skeleton, Stagger } from '../ui'

type Tab = 'text' | 'image' | 'video' | 'sound' | 'reels' | 'recipes' | 'projects'
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'sound', label: 'Sound' },
  { value: 'reels', label: 'Reels' },
  { value: 'recipes', label: 'Recipes' },
  { value: 'projects', label: 'Projects' },
]

/** /dashboard/studio: go straight to a generator, run a recipe, or open a project's canvas. */
export default function Studio() {
  const project = useQueryParam('project')
  return project ? <CanvasView key={project} id={Number(project)} /> : <StudioHome />
}

function StudioHome() {
  const { search, navigate } = useRouter()
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(search).get('tab') as Tab) || 'text')
  const { data: registry } = useApi<Registry>('/models')
  const [naming, setNaming] = useState(false)

  const pick = (t: Tab) => {
    setTab(t)
    navigate(`/dashboard/studio${t === 'text' ? '' : `?tab=${t}`}`, { replace: true })
  }

  return (
    <div>
      <PageHeader
        eyebrow="Creative Lab"
        title={
          <>
            Make <Serif>anything.</Serif>
          </>
        }
        sub="Create social images and video, give your posts a voice and a soundtrack, cut Reels, or run a recipe. Bring in references, choose a model, and keep every result in your Gallery."
        actions={
          <Btn variant="primary" icon={Plus} onClick={() => setNaming(true)}>
            New project
          </Btn>
        }
      />

      <Stagger i={0} className="no-scrollbar -mx-4 mt-10 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Segmented id="studio-tab" label="Generator" options={TABS} value={tab} onChange={pick} className="w-fit" />
      </Stagger>

      <Stagger i={1} className="mt-5">
        {!registry ? (
          <Skeleton className="h-[420px] rounded-xl" />
        ) : tab === 'projects' ? (
          <Projects onNew={() => setNaming(true)} />
        ) : tab === 'recipes' ? (
          <Recipes registry={registry} />
        ) : tab === 'sound' ? (
          <SoundStudio models={registry.models} />
        ) : tab === 'reels' ? (
          <ReelMaker models={registry.models} />
        ) : (
          <Generator key={tab} kind={tab} models={registry.models} defaultText={registry.default_text} />
        )}
      </Stagger>

      <NewProject open={naming} onClose={() => setNaming(false)} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* One generator: text, photo or video                                  */
/* ------------------------------------------------------------------ */

const FALLBACK_RATIOS = ['1:1', '4:5', '9:16', '16:9']
const SOCIAL_FORMATS = [
  { value: 'reel', label: 'Instagram Reel', ratio: '9:16', duration: 8 },
  { value: 'tiktok', label: 'TikTok', ratio: '9:16', duration: 8 },
  { value: 'short', label: 'YouTube Short', ratio: '9:16', duration: 8 },
  { value: 'feed', label: 'Feed post', ratio: '4:5', duration: 5 },
]
const CREATIVE_STARTS = {
  image: [
    ['Product launch', 'Premium product campaign image, editorial lighting, clear hero composition'],
    ['UGC look', 'Authentic creator-style phone photo, natural light, relatable setting'],
    ['Ad creative', 'High-converting paid social creative with generous clean space for copy'],
  ],
  video: [
    ['Hook first', 'Start with a scroll-stopping visual hook in the first second, then reveal the product'],
    ['Product demo', 'Show a clear satisfying product demonstration with close-up details'],
    ['Lifestyle story', 'Warm aspirational lifestyle moment with a natural camera move'],
  ],
} as const

function Generator({ kind, models, defaultText }: { kind: 'text' | 'image' | 'video'; models: ModelInfo[]; defaultText: string }) {
  const incomingPrompt = useQueryParam('prompt')
  const toast = useToast()
  const usable = models.filter((m) => m.kind === kind)
  const [model, setModel] = useState<string | null>(kind === 'text' ? defaultText : (usable.find((m) => m.available)?.id ?? usable[0]?.id ?? null))
  const [prompt, setPrompt] = useState(incomingPrompt ?? '')
  const [ratio, setRatio] = useState(kind === 'video' ? '9:16' : '4:5')
  const [duration, setDuration] = useState(kind === 'video' ? 8 : 5)
  const [resolution, setResolution] = useState<string | null>(null)
  const [audio, setAudio] = useState(true)
  const [seed, setSeed] = useState('')
  const [avoid, setAvoid] = useState('')
  const [brief, setBrief] = useState('')
  const [format, setFormat] = useState(kind === 'video' ? 'reel' : 'feed')
  const [variations, setVariations] = useState(1)
  const [references, setReferences] = useState<Asset[]>([])
  const [picking, setPicking] = useState(false)
  const [streaming, setStreaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishGeneration, setPublishGeneration] = useState<Generation | null>(null)
  const { data: feed, loading } = useGenerations({ kind })
  const invalidate = useInvalidate()
  const current = usable.find((m) => m.id === model)
  const caps = current?.capabilities ?? {}
  const ratios = (caps.aspect_ratios?.length ? caps.aspect_ratios : FALLBACK_RATIOS).map((value) => ({ value, label: value }))
  const durations = caps.durations?.length ? caps.durations : [5, 8, 10]
  const resolutions = caps.resolutions ?? []
  const maxInputs = caps.max_inputs ?? (kind === 'video' ? 1 : 0)
  const needsImage = !!caps.requires_image
  const maxOutputs = Math.min(caps.max_outputs ?? 1, 4)

  const chooseFormat = (value: string) => {
    setFormat(value)
    const picked = SOCIAL_FORMATS.find((item) => item.value === value)
    if (picked) {
      setRatio(picked.ratio)
      setDuration(picked.duration)
    }
  }

  const go = async () => {
    if (!prompt.trim()) return setError('Describe what you want.')
    if (needsImage && !references[0]) return setError('Pick the image the video starts from.')
    setBusy(true)
    setError(null)
    try {
      if (kind === 'text') {
        setStreaming('')
        await runText({ prompt, model }, setStreaming)
      } else {
        const creativePrompt = [brief, prompt.trim(), avoid.trim() ? `Avoid: ${avoid.trim()}.` : ''].filter(Boolean).join('. ')
        await runMedia({
          kind,
          model,
          prompt: creativePrompt,
          params: {
            ...(caps.aspect_ratios?.length ? { aspect_ratio: ratio } : {}),
            ...(kind === 'video' ? { duration } : {}),
            ...(resolution ? { resolution } : {}),
            ...(caps.audio && !caps.audio_always_on ? { audio } : {}),
            ...(seed ? { seed: Number(seed) } : {}),
            ...(kind === 'image' && variations > 1 ? { batch_size: variations } : {}),
            ...(avoid.trim() ? { negative_prompt: avoid.trim() } : {}),
          },
          input_asset_ids: references.length ? references.map((asset) => asset.id) : undefined,
        })
      }
      setPrompt('')
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setStreaming(null)
      setBusy(false)
      invalidate()
    }
  }

  const retry = async (g: Generation, change: { model?: string; prompt?: string }) => {
    try {
      await retryGeneration(g, change)
      invalidate()
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
      <Panel title={{ text: 'Text generator', image: 'Photo generator', video: 'Video generator' }[kind]} sub={current ? current.purpose : undefined} className="lg:sticky lg:top-20">
        <div className="space-y-4">
          <div>
            <Label>Model</Label>
            <ModelPicker models={models} kind={kind} value={model} onChange={setModel} className="mt-2" />
            {current && !current.available && <p className="mt-1.5 text-[11.5px] text-warn">{current.reason}</p>}
          </div>

          {kind !== 'text' && (
            <div className="rounded-lg border border-line bg-white/[0.015] p-3">
              <Label>Social brief</Label>
              <Segmented id="social-format" label="Social format" options={SOCIAL_FORMATS.map(({ value, label }) => ({ value, label: label.replace('Instagram ', '').replace('YouTube ', '') }))} value={format} onChange={chooseFormat} className="mt-2 w-full" />
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {CREATIVE_STARTS[kind].map(([label, direction]) => (
                  <button key={label} type="button" onClick={() => setBrief(direction)} className={cn('rounded-md border px-2 py-2 text-left text-[10.5px] transition-colors', brief === direction ? 'border-accent/50 bg-accent/[0.08] text-fg' : 'border-line text-dim hover:border-line-2 hover:text-muted')}>
                    {label}
                  </button>
                ))}
              </div>
              {brief && <button type="button" onClick={() => setBrief('')} className="mt-2 text-[11px] text-dim hover:text-fg">Clear creative direction</button>}
            </div>
          )}

          {maxInputs > 0 && (
            <div>
              <Label>{kind === 'video' ? (needsImage ? 'Starts from' : 'Start frame or reference') : 'Reference images'}</Label>
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="mt-2 flex w-full items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12.5px] text-muted transition-colors hover:border-accent-soft/60 hover:text-fg"
              >
                {references[0] ? <MediaThumb asset={references[0]} className="size-12" /> : <ImagePlus className="m-3 size-5" strokeWidth={1.5} />}
                {references.length ? `${references.length} image${references.length > 1 ? 's' : ''} selected${caps.end_frame && references[1] ? ' · includes end frame' : ''}` : needsImage ? 'Pick the starting image' : 'Optional: add references from the Gallery'}
              </button>
              <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(assets) => setReferences(assets.filter((asset) => asset.kind === 'image').slice(0, maxInputs))} max={maxInputs} initial={references} />
              {caps.end_frame && <p className="mt-1.5 text-[11px] text-dim">Choose two images to set a start and end frame.</p>}
              {references.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {references.map((asset, index) => (
                    <span key={asset.id} className="group relative shrink-0">
                      <MediaThumb asset={asset} className="size-14" />
                      <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 py-0.5 font-mono text-[8px] text-white">{caps.end_frame && index === 1 ? 'END' : index === 0 && kind === 'video' ? 'START' : `REF ${index + 1}`}</span>
                      <button type="button" aria-label="Remove reference" onClick={() => setReferences((items) => items.filter((item) => item.id !== asset.id))} className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border border-line bg-panel text-dim opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"><X className="size-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="block">
            <Label>{kind === 'video' ? 'Motion' : 'Prompt'}</Label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && go()}
              rows={5}
              placeholder={
                kind === 'text'
                  ? 'Five hooks for an autumn candle launch, warm and unhurried…'
                  : kind === 'image'
                    ? 'An amber candle jar on folded linen, soft morning window light, shallow depth of field…'
                    : 'Slow dolly in, the flame flickers, steam rises from a cup beside it…'
              }
              className={cn(inputClass, 'mt-2 h-auto resize-none py-2.5 leading-snug')}
            />
          </label>

          {kind !== 'text' && caps.aspect_ratios?.length !== 0 && (
            <div>
              <Label>{kind === 'video' ? 'Format' : 'Shape'}</Label>
              <Segmented id="ratio" label="Aspect ratio" options={ratios} value={ratios.some((item) => item.value === ratio) ? ratio : ratios[0].value} onChange={setRatio} className="mt-2 w-fit" />
            </div>
          )}
          {kind === 'video' && (
            <div>
              <Label>Length</Label>
              <Segmented id="duration" label="Duration" options={durations.map((v) => ({ value: v, label: `${v} s` }))} value={durations.includes(duration) ? duration : durations[0]} onChange={setDuration} className="mt-2 w-fit" />
            </div>
          )}
          {resolutions.length > 0 && (
            <div>
              <Label>Resolution</Label>
              <Segmented id="resolution" label="Resolution" options={resolutions.map((value) => ({ value, label: value.toUpperCase() }))} value={resolution && resolutions.includes(resolution) ? resolution : (caps.default_resolution ?? resolutions[0])} onChange={setResolution} className="mt-2 w-fit" />
            </div>
          )}
          {caps.audio && !caps.audio_always_on && (
            <label className="flex items-center justify-between rounded-md border border-line px-3 py-2.5 text-[12.5px]">
              <span>Generate sound</span>
              <input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} />
            </label>
          )}
          {caps.seed && (
            <label className="block">
              <Label>Seed <span className="normal-case text-dim">optional</span></Label>
              <input value={seed} onChange={(event) => setSeed(event.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="Random" inputMode="numeric" className={cn(inputClass, 'mt-2')} />
            </label>
          )}
          {kind !== 'text' && (
            <label className="block">
              <Label>What to avoid <span className="normal-case text-dim">optional</span></Label>
              <input value={avoid} onChange={(event) => setAvoid(event.target.value)} placeholder="Blurry text, distorted logo, cluttered background…" className={cn(inputClass, 'mt-2')} />
            </label>
          )}
          {kind === 'image' && maxOutputs > 1 && (
            <div>
              <Label>Variations</Label>
              <Segmented id="variations" label="Variations" options={Array.from({ length: maxOutputs }, (_, index) => ({ value: index + 1, label: `${index + 1}` }))} value={variations} onChange={setVariations} className="mt-2 w-fit" />
            </div>
          )}

          <FieldError message={error} />
          <Btn variant="primary" icon={Sparkles} onClick={go} loading={busy} disabled={!current?.available} className="w-full">
            {kind === 'text' ? 'Write' : kind === 'image' ? 'Make the photo' : 'Make the video'}
          </Btn>
        </div>
      </Panel>

      <div className="space-y-3">
        <AnimatePresence>
          {streaming !== null && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-accent/30 bg-panel p-4">
              <p className="font-mono text-[10.5px] text-accent-soft">Writing…</p>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{streaming || ' '}</p>
            </motion.div>
          )}
        </AnimatePresence>
        {!feed && loading ? (
          <Skeleton className="h-[200px] rounded-xl" />
        ) : feed && feed.length === 0 && streaming === null ? (
          <EmptyState icon={Wand2} title="Nothing made yet" body="What you make appears here, and photos and videos go into the media library." />
        ) : (
          feed?.map((g) => (
            <GenerationCard
              key={g.id}
              generation={g}
              models={models}
              onRetry={retry}
              actions={
                g.status === 'succeeded' && (
                  <Btn
                    size="sm"
                    variant="subtle"
                    icon={CalendarClock}
                    onClick={() => setPublishGeneration(g)}
                  >
                    Create & schedule
                  </Btn>
                )
              }
            />
          ))
        )}
      </div>
      <PublishFromLab generation={publishGeneration} onClose={() => setPublishGeneration(null)} />
    </div>
  )
}

/** A compact hand-off from a finished creative asset to the studio's multi-platform scheduler. */
function PublishFromLab({ generation, onClose }: { generation: Generation | null; onClose: () => void }) {
  const user = useUser()
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const nextMorning = () => {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    return { date: date.toISOString().slice(0, 10), time: '09:00' }
  }
  const initial = nextMorning()
  const [caption, setCaption] = useState('')
  const [platforms, setPlatforms] = useState<PlatformId[]>(user.preferences.platforms.length ? user.preferences.platforms : ['instagram', 'tiktok'])
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [mode, setMode] = useState<'draft' | 'schedule'>('schedule')
  const [saving, setSaving] = useState(false)

  // New output, new suggested caption. Keep an operator's edits while the modal stays open.
  const sourceCaption = generation?.kind === 'text' ? generation.output_text ?? '' : generation ? `Made in Creative Lab — ${generation.prompt}` : ''
  const effectiveCaption = caption || sourceCaption
  const toggle = (id: PlatformId) => setPlatforms((items) => (items.includes(id) ? items.filter((item) => item !== id) : PLATFORM_ORDER.filter((item) => item === id || items.includes(item))))
  const save = async () => {
    if (!generation || !effectiveCaption.trim() || !platforms.length) return
    const scheduledAt = new Date(`${date}T${time}`).toISOString()
    if (mode === 'schedule' && Number.isNaN(Date.parse(scheduledAt))) return toast('Choose a valid date and time.', 'error')
    setSaving(true)
    try {
      await api('/posts', {
        method: 'POST',
        body: {
          body: effectiveCaption.trim(),
          format: generation.kind === 'text' ? 'text' : generation.kind,
          platforms,
          status: mode === 'schedule' ? 'scheduled' : 'draft',
          scheduled_at: mode === 'schedule' ? scheduledAt : null,
          asset_ids: generation.outputs.map((asset) => asset.id),
        },
      })
      invalidate()
      toast(mode === 'schedule' ? 'Post scheduled across the selected platforms.' : 'Post saved as a draft.')
      onClose()
      navigate(mode === 'schedule' ? '/dashboard/calendar' : '/dashboard/library')
    } catch (error) {
      toast(messageFor(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!generation} onClose={onClose} title="Create a multi-platform post" className="max-w-2xl">
      {generation && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/[0.06] p-3">
            {generation.outputs[0] ? <MediaThumb asset={generation.outputs[0]} className="size-12" /> : <Sparkles className="m-3 size-5 text-accent-soft" />}
            <div className="min-w-0"><p className="text-[12.5px] font-medium">{generation.outputs.length ? `${generation.outputs.length} creative asset${generation.outputs.length > 1 ? 's' : ''} attached` : 'Text output attached'}</p><p className="truncate text-[11px] text-dim">{generation.model_label}</p></div>
          </div>
          <label className="block"><Label>Caption</Label><textarea value={effectiveCaption} onChange={(event) => setCaption(event.target.value)} rows={4} className={cn(inputClass, 'mt-2 h-auto resize-none py-2.5')} /></label>
          <div>
            <Label>Publish to</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLATFORM_ORDER.map((id) => {
                const active = platforms.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggle(id)}
                    aria-pressed={active}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] transition-colors',
                      active ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:text-fg',
                    )}
                  >
                    <PlatformIcon id={id} className="size-3.5" />
                    {PLATFORMS[id].name}
                    {active && <Check className="size-3" />}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-3"><Label>Publishing plan</Label><Segmented id="lab-post-mode" label="Publishing plan" options={[{ value: 'draft', label: 'Save draft' }, { value: 'schedule', label: 'Schedule' }]} value={mode} onChange={setMode} /></div>
            {mode === 'schedule' && <div className="mt-3 grid grid-cols-2 gap-2"><label><Label>Date</Label><input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} className={cn(inputClass, 'mt-1.5')} /></label><label><Label>Time</Label><input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={cn(inputClass, 'mt-1.5')} /></label></div>}
          </div>
          <div className="flex justify-end gap-2"><Btn variant="subtle" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon={mode === 'schedule' ? CalendarClock : FileText} onClick={save} loading={saving} disabled={!effectiveCaption.trim() || !platforms.length}>{mode === 'schedule' ? 'Schedule post' : 'Save draft'}</Btn></div>
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Recipes                                                              */
/* ------------------------------------------------------------------ */

function Recipes({ registry }: { registry: Registry }) {
  const invalidate = useInvalidate()
  const [recipe, setRecipe] = useState<string>('text_to_image')
  const r = registry.recipes[recipe]
  const imageModels = registry.models.filter((m) => m.kind === 'image')
  const videoModels = registry.models.filter((m) => m.kind === 'video')
  const [imageModel, setImageModel] = useState(imageModels.find((m) => m.available)?.id ?? null)
  const [videoModel, setVideoModel] = useState(videoModels.find((m) => m.available)?.id ?? null)
  const [prompt, setPrompt] = useState('')
  const [motion_, setMotion] = useState('')
  const [start, setStart] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: feed } = useGenerations({ kind: undefined })
  const recent = feed?.filter((g) => g.recipe) ?? []

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/recipes/${recipe}`, {
        method: 'POST',
        body: { prompt, motion: motion_ || null, image_model: r.steps.includes('image') ? imageModel : null, video_model: r.steps.includes('video') ? videoModel : null, asset_id: start?.id ?? null, duration: 5 },
      })
      setPrompt('')
      invalidate()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(registry.recipes).map(([id, x]) => (
            <button
              key={id}
              type="button"
              aria-pressed={recipe === id}
              onClick={() => setRecipe(id)}
              className={cn('rounded-xl border p-3 text-left transition-colors', recipe === id ? 'border-accent/50 bg-accent/[0.08]' : 'border-line bg-panel hover:border-line-2')}
            >
              <span className="block text-[13px] font-medium">{x.label}</span>
              <span className="mt-1 block text-[11.5px] leading-snug text-dim">{x.body}</span>
            </button>
          ))}
        </div>
        <Panel title={r.label} sub={`${r.steps.length} ${r.steps.length === 1 ? 'step' : 'steps'}: ${r.steps.join(' → ')}`}>
          <div className="space-y-4">
            {r.needs && (
              <div>
                <Label>{recipe === 'product_scene' ? 'Product photo' : 'Starts from'}</Label>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="mt-2 flex w-full items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12.5px] text-muted hover:border-accent-soft/60 hover:text-fg"
                >
                  {start ? <MediaThumb asset={start} className="size-12" /> : <ImagePlus className="m-3 size-5" strokeWidth={1.5} />}
                  {start ? (start.name ?? 'Image') : 'Pick an image'}
                </button>
                <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => setStart(a.find((x) => x.kind === 'image') ?? null)} max={1} initial={start ? [start] : []} />
              </div>
            )}
            <label className="block">
              <Label>{recipe === 'product_scene' ? 'The new scene' : recipe === 'image_to_video' ? 'Motion' : 'Prompt'}</Label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={cn(inputClass, 'mt-2 h-auto resize-none py-2')} />
            </label>
            {recipe === 'text_to_video' && (
              <label className="block">
                <Label>Then, the motion</Label>
                <input value={motion_} onChange={(e) => setMotion(e.target.value)} placeholder="Slow push in, the flame flickers" className={cn(inputClass, 'mt-2')} />
              </label>
            )}
            {r.steps.includes('image') && (
              <div>
                <Label>Image model</Label>
                <ModelPicker models={registry.models} kind="image" value={imageModel} onChange={setImageModel} className="mt-2" />
              </div>
            )}
            {r.steps.includes('video') && (
              <div>
                <Label>Video model</Label>
                <ModelPicker models={registry.models} kind="video" value={videoModel} onChange={setVideoModel} className="mt-2" />
              </div>
            )}
            <FieldError message={error} />
            <Btn variant="primary" icon={Wand2} onClick={run} loading={busy} disabled={!prompt.trim()} className="w-full">
              Run the recipe
            </Btn>
          </div>
        </Panel>
      </div>
      <div className="space-y-3">
        {recent.length === 0 ? (
          <EmptyState icon={Wand2} title="No recipes run yet" body="Each step starts on its own when the one before it finishes." />
        ) : (
          recent.map((g) => (
            <GenerationCard
              key={g.id}
              generation={g}
              models={registry.models}
              onRetry={async (x, change) => {
                await retryGeneration(x, change)
                invalidate()
              }}
              compact
            />
          ))
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Projects                                                             */
/* ------------------------------------------------------------------ */

function Projects({ onNew }: { onNew: () => void }) {
  const { data: projects } = useApi<Project[]>('/projects')
  const { navigate } = useRouter()

  if (!projects) return <Skeleton className="h-[160px] rounded-xl" />
  if (!projects.length) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No projects yet"
        body="A project is a canvas: drafts, photos, videos and notes, laid out side by side and connected."
        action={
          <Btn variant="primary" icon={Plus} onClick={onNew}>
            Start one
          </Btn>
        }
      />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((p, i) => (
        <motion.button
          key={p.id}
          type="button"
          onClick={() => navigate(`/dashboard/studio?project=${p.id}`)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease, delay: Math.min(i, 8) * 0.04 }}
          className="group flex flex-col rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line-2"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="truncate text-[14px] font-medium">{p.name}</span>
            <ArrowUpRight className="size-4 shrink-0 text-dim transition-transform duration-300 group-hover:rotate-45 group-hover:text-fg" strokeWidth={1.75} />
          </span>
          <span className="mt-6 font-mono text-[10.5px] text-dim">
            {p.nodes} on the canvas · {p.generations} made · {fmtRelative(p.updated_at)}
          </span>
        </motion.button>
      ))}
    </div>
  )
}

function NewProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const p = await api<Project>('/projects', { method: 'POST', body: { name: name.trim() } })
      onClose()
      setName('')
      navigate(`/dashboard/studio?project=${p.id}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="New project">
      <label className="block">
        <Label>Name</Label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} placeholder="Autumn launch" className={cn(inputClass, 'mt-2')} />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="subtle" onClick={onClose}>
          Cancel
        </Btn>
        <Btn variant="primary" icon={PenLine} onClick={create} loading={busy} disabled={!name.trim()}>
          Open the canvas
        </Btn>
      </div>
    </Modal>
  )
}
