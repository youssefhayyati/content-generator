import { useEffect, useRef, useState, type ComponentType } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, ArrowUpRight, FolderKanban, Megaphone, MessageCircleQuestion, Sparkles, SquareDashed, Trash2, X } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Campaign, type CampaignSummary, type LabPayload, type Project } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam, useRouter } from '../../lib/router'
import { Conversation } from '../assistant/Conversation'
import { useAssistant } from '../assistant/store'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { Interview } from '../intake/Interview'
import { useToast } from '../toast'
import { Btn, EmptyState, Label, Modal, PageHeader, Select, Skeleton, Stagger } from '../ui'

const studio = (project: number) => `/dashboard/studio?project=${project}`

/**
 * Creative Lab's home: how to start (a few questions about the campaign, a campaign you have, or a
 * blank canvas), the projects, and the assistant beside them from the start, for whoever would
 * rather say what they want and let it ask the questions, make the project and build the nodes.
 */
export function LabHome() {
  const { navigate } = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const interview = async (depth: 'quick' | 'full') => {
    setBusy(depth)
    try {
      const c = await api<Campaign>('/campaigns', { method: 'POST', body: { depth } })
      navigate(`/dashboard/studio?brief=${c.id}`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The questions couldn’t start.')
      setBusy(null)
    }
  }
  const blank = async () => {
    setBusy('blank')
    try {
      const p = await api<LabPayload>('/lab/projects', { method: 'POST', body: {} })
      navigate(studio(p.project.id))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The project couldn’t be made.')
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader
        title={
          <>
            Make <Serif>anything.</Serif>
          </>
        }
        sub="Every project is a canvas of nodes: the brief, your logo and photos, the models that write, draw, film, voice and score, and where it’s posted. Answer a few questions to set the campaign, or tell the assistant what you want."
      />

      <div className="mt-10 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-10">
          <StartFrom />
          <Stagger i={0}>
            <Label className="mb-3">Start a project</Label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StartCard icon={MessageCircleQuestion} title="Quick brief" meta="5 questions · 1 min" body="The essentials, like an agency would ask. The AI picks the questions for what you make, and suggests the rest." onClick={() => void interview('quick')} busy={busy === 'quick'} primary />
              <StartCard icon={Sparkles} title="Thorough brief" meta="10 questions · 3 min" body="Your story, your customers, your voice and your look. The most personal content." onClick={() => void interview('full')} busy={busy === 'full'} />
              <StartCard icon={Megaphone} title="From a campaign you have" meta="its brief and photos" body="A campaign you’ve already set up: its brief, logo and photos open on the canvas." onClick={() => setPicking(true)} />
              <StartCard icon={SquareDashed} title="Blank canvas" meta="no brief for now" body="Put the nodes yourself. A brief can be added later, as a node." onClick={() => void blank()} busy={busy === 'blank'} />
            </div>
          </Stagger>
          <Stagger i={1}>
            <Label className="mb-3">Projects</Label>
            <LabProjects />
          </Stagger>
        </div>
        <Stagger i={1} className="xl:sticky xl:top-6">
          <AssistantPanel />
        </Stagger>
      </div>

      <PickCampaign open={picking} onClose={() => setPicking(false)} />
    </div>
  )
}

function StartCard({ icon: Icon, title, meta, body, onClick, busy, primary }: { icon: ComponentType<{ className?: string; strokeWidth?: number }>; title: string; meta: string; body: string; onClick: () => void; busy?: boolean; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={cn('group flex flex-col rounded-xl border bg-panel p-4 text-left transition-colors', primary ? 'border-accent/40 hover:border-accent/70' : 'border-line hover:border-line-2')}>
      <span className="flex items-center gap-2.5">
        <span className={cn('grid size-8 place-items-center rounded-lg', primary ? 'bg-accent/[0.12] text-accent-soft' : 'bg-white/[0.05] text-muted')}>
          <Icon className={cn('size-4', busy && 'animate-pulse')} strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium">{title}</span>
          <span className="block font-mono text-[10.5px] text-dim">{meta}</span>
        </span>
        <ArrowRight className="ml-auto size-4 shrink-0 text-dim transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-fg" strokeWidth={1.75} />
      </span>
      <span className="mt-3 text-[12.5px] leading-snug text-muted">{body}</span>
    </button>
  )
}

/**
 * The assistant, open on the home page: it can run the same questions in its chat (photos dropped
 * there come along), make the project, and build its nodes.
 */
function AssistantPanel() {
  const a = useAssistant()
  const toast = useToast()
  useEffect(() => {
    a.start()
  }, [])
  // It knows no project is open, so a request to make something starts with the campaign questions.
  useEffect(() => {
    if (a.conn === 'online') a.action('lab', { project: null, node: null, control: false })
  }, [a.conn])
  useLeftLab()
  return (
    <section aria-label="Assistant" className="flex h-[calc(100dvh-12rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-medium">
          <Sparkles className="size-3.5 text-accent-soft" /> Let the assistant do it
        </p>
        <p className="mt-1 text-[11.5px] leading-snug text-dim">Tell it what you want: “a reel and two posts for our new candle”. It asks the campaign questions here (drop your logo and photos in), makes the project and builds the nodes.</p>
      </div>
      <Conversation className="min-h-0 flex-1" onImport={() => toast('Open a campaign’s posts from the Campaigns page.')} />
    </section>
  )
}

/** Leaving Creative Lab tells the assistant, so it goes back to making posts its own way. */
export function useLeftLab() {
  const a = useAssistant()
  const live = useRef(a)
  live.current = a
  useEffect(
    () => () => {
      if (live.current.conn === 'online') live.current.action('lab', { left: true })
    },
    [],
  )
}

/** A campaign you have, on a new canvas with its brief and photos. */
function PickCampaign({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const { data: campaigns } = useApi<CampaignSummary[]>(open ? '/campaigns' : null)
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const p = await api<LabPayload>(`/campaigns/${id}/lab`, { method: 'POST' })
      onClose()
      navigate(studio(p.project.id))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The project couldn’t be made.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Start from a campaign">
      <div className="space-y-4">
        {!campaigns ? (
          <Skeleton className="h-10 rounded-lg" />
        ) : campaigns.length ? (
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Pick a campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || `Campaign ${c.id}`}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-[13px] text-muted">No campaigns yet. Start with the questions instead.</p>
        )}
        <p className="text-[11.5px] leading-snug text-dim">The brief becomes the first node, and its logo and photos become nodes under it, ready to connect.</p>
        <div className="flex justify-end gap-2">
          <Btn variant="subtle" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" icon={ArrowRight} disabled={!id} loading={busy} onClick={() => void go()}>
            Open the canvas
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

const MAKES: Record<string, string> = { picture: 'a picture from this prompt', video: 'a video from this prompt', reel: 'a reel from this sound', transcript: 'a transcript of this file' }

/**
 * Other pages send things here to be made (a prompt from Inspire, a sound from the gallery):
 * one click puts them on a new canvas, already wired.
 */
function StartFrom() {
  const make = useQueryParam('make')
  const prompt = useQueryParam('prompt')
  const asset = useQueryParam('asset')
  const { navigate } = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!make || !MAKES[make]) return null
  const go = async () => {
    setBusy(true)
    try {
      const p = await api<LabPayload>('/lab/projects', { method: 'POST', body: { name: prompt ? prompt.slice(0, 60) : null, start: { make, prompt, asset_id: asset ? Number(asset) : null } } })
      navigate(studio(p.project.id))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The project couldn’t be made.')
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/[0.06] p-4">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">Make {MAKES[make]}</p>
        {prompt && <p className="mt-1 line-clamp-2 text-[12px] text-muted">{prompt}</p>}
      </div>
      <Btn variant="primary" icon={ArrowRight} loading={busy} onClick={() => void go()}>
        Open it on a canvas
      </Btn>
      <button type="button" onClick={() => navigate('/dashboard/studio', { replace: true })} aria-label="Dismiss" className="grid size-8 place-items-center rounded-md text-dim hover:text-fg">
        <X className="size-4" />
      </button>
    </div>
  )
}

export function LabProjects() {
  const { data: projects } = useApi<Project[]>('/projects')
  const { navigate } = useRouter()
  const invalidate = useInvalidate()
  const toast = useToast()

  if (!projects) return <Skeleton className="h-[160px] rounded-xl" />
  if (!projects.length) {
    return <EmptyState icon={FolderKanban} title="No projects yet" body="Start one above, or ask the assistant: it can do the questions with you and build the first nodes." />
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {projects.map((p, i) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease, delay: Math.min(i, 8) * 0.04 }}
          className="group relative flex flex-col rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line-2"
        >
          <button type="button" onClick={() => navigate(studio(p.id))} className="absolute inset-0 rounded-xl" aria-label={`Open ${p.name}`} />
          <span className="flex items-start justify-between gap-3">
            <span className="truncate text-[14px] font-medium">{p.name}</span>
            <ArrowUpRight className="size-4 shrink-0 text-dim transition-transform duration-300 group-hover:rotate-45 group-hover:text-fg" strokeWidth={1.75} />
          </span>
          <span className="mt-6 flex items-center gap-2 font-mono text-[10.5px] text-dim">
            {p.nodes} node{p.nodes === 1 ? '' : 's'} · {fmtRelative(p.updated_at)}
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(`Delete “${p.name}”? What it made stays in the gallery.`)) return
                await api(`/projects/${p.id}`, { method: 'DELETE' }).catch(() => toast('It couldn’t be deleted.'))
                invalidate()
              }}
              className="relative ml-auto hidden text-dim hover:text-fail group-hover:block"
              aria-label="Delete the project"
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        </motion.div>
      ))}
    </div>
  )
}

/**
 * A new project's brief: the strategist's questions (5 or 10, picked by the AI for what you make),
 * with your logo and photos. Once it's done, or whenever you'd rather stop, the canvas opens with
 * the brief as its first node and the photos as nodes under it.
 */
export function LabBrief({ id }: { id: number }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Campaign>(`/campaigns/${id}`)
      .then(setCampaign)
      .catch(() => {
        toast('That brief doesn’t exist any more.')
        navigate('/dashboard/studio', { replace: true })
      })
  }, [id])

  const open = async () => {
    setBusy(true)
    try {
      const p = await api<LabPayload>(`/campaigns/${id}/lab`, { method: 'POST' })
      navigate(studio(p.project.id))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The project couldn’t be made.')
      setBusy(false)
    }
  }

  if (!campaign) return <Skeleton className="h-[70vh] rounded-xl" />
  return (
    <div>
      <PageHeader
        title={
          <>
            New project: <Serif>the brief.</Serif>
          </>
        }
        sub="Short questions, like a marketing agency would ask, fitted to what you make. Share your logo and photos of the product or the people when it asks (or drop them in any time). The answers become the brief node at the start of your canvas."
        actions={
          <>
            <Btn variant="subtle" icon={ArrowLeft} onClick={() => navigate('/dashboard/studio')}>
              Creative Lab
            </Btn>
            {!campaign.complete && (
              <Btn icon={ArrowRight} loading={busy} onClick={() => void open()}>
                Skip to the canvas
              </Btn>
            )}
          </>
        }
      />
      <div className="mt-6">
        <Interview initial={campaign} embedded onChange={setCampaign} onNext={() => void open()} nextBusy={busy} nextLabel="Open the canvas" />
      </div>
    </div>
  )
}
