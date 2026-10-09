import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, FolderKanban, ImagePlus, PenLine, Plus, Send, Sparkles, Wand2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, type Asset, type Generation, type ModelInfo, type Project, type Registry } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam, useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { ReelMaker } from '../sound/ReelMaker'
import { SoundStudio } from '../sound/SoundStudio'
import { CanvasView } from '../studio/Canvas'
import { GenerationCard, ModelPicker, useGenerations } from '../studio/parts'
import { messageFor, retryGeneration, runMedia, runText } from '../studio/run'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Panel, Segmented, Skeleton, Stagger } from '../ui'

type Tab = 'text' | 'image' | 'video' | 'sound' | 'reels' | 'recipes' | 'projects'
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Photo' },
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
        eyebrow="Studio"
        title={
          <>
            Make <Serif>anything.</Serif>
          </>
        }
        sub="Write, make photos and videos, give your posts a voice and a soundtrack, cut reels, or run a recipe. Open a project to lay it all out on a canvas."
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

const RATIOS = ['1:1', '4:5', '9:16', '16:9'].map((v) => ({ value: v, label: v }))

function Generator({ kind, models, defaultText }: { kind: 'text' | 'image' | 'video'; models: ModelInfo[]; defaultText: string }) {
  const toast = useToast()
  const { navigate } = useRouter()
  const usable = models.filter((m) => m.kind === kind)
  const [model, setModel] = useState<string | null>(kind === 'text' ? defaultText : (usable.find((m) => m.available)?.id ?? usable[0]?.id ?? null))
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('4:5')
  const [duration, setDuration] = useState(5)
  const [start, setStart] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  const [streaming, setStreaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: feed, loading } = useGenerations({ kind })
  const invalidate = useInvalidate()
  const current = usable.find((m) => m.id === model)
  const needsImage = kind === 'video'

  const go = async () => {
    if (!prompt.trim()) return setError('Describe what you want.')
    if (needsImage && !start) return setError('Pick the image the video starts from.')
    setBusy(true)
    setError(null)
    try {
      if (kind === 'text') {
        setStreaming('')
        await runText({ prompt, model }, setStreaming)
      } else {
        await runMedia({
          kind,
          model,
          prompt,
          params: kind === 'image' ? { aspect_ratio: ratio } : { duration },
          input_asset_ids: start ? [start.id] : undefined,
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

          {needsImage && (
            <div>
              <Label>Starts from</Label>
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="mt-2 flex w-full items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12.5px] text-muted transition-colors hover:border-accent-soft/60 hover:text-fg"
              >
                {start ? <MediaThumb asset={start} className="size-12" /> : <ImagePlus className="m-3 size-5" strokeWidth={1.5} />}
                {start ? (start.name ?? 'Image') : 'Pick an image from the library'}
              </button>
              <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => setStart(a.find((x) => x.kind === 'image') ?? null)} max={1} initial={start ? [start] : []} />
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

          {kind === 'image' && (
            <div>
              <Label>Shape</Label>
              <Segmented id="ratio" label="Aspect ratio" options={RATIOS} value={ratio} onChange={setRatio} className="mt-2 w-fit" />
            </div>
          )}
          {kind === 'video' && (
            <div>
              <Label>Length</Label>
              <Segmented id="duration" label="Duration" options={[5, 10].map((v) => ({ value: v, label: `${v} s` }))} value={duration} onChange={setDuration} className="mt-2 w-fit" />
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
                    icon={Send}
                    onClick={() => navigate(g.kind === 'text' ? `/dashboard/create?body=${encodeURIComponent(g.output_text ?? '')}` : `/dashboard/create?assets=${g.outputs.map((a) => a.id).join(',')}`)}
                  >
                    Use in a post
                  </Btn>
                )
              }
            />
          ))
        )}
      </div>
    </div>
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
