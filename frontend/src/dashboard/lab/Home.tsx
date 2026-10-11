import { useEffect, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react'
import { motion } from 'framer-motion'
import { useLenis } from 'lenis/react'
import { ArrowLeft, ArrowRight, ArrowUpRight, FolderKanban, Megaphone, MessageCircleQuestion, Plus, Sparkles, SquareDashed, Trash2, X } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Campaign, type CampaignSummary, type LabCatalog, type LabPayload, type LabTemplate, type Project } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam, useRouter } from '../../lib/router'
import { Conversation } from '../assistant/Conversation'
import { assistantUrl } from '../assistant/link'
import { useAssistant } from '../assistant/store'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { Interview } from '../intake/Interview'
import { useToast } from '../toast'
import { Btn, BusyBadge, EmptyState, Label, Modal, PageHeader, Select, Skeleton, Stagger, inputClass } from '../ui'
import { TemplateBrowser, TemplateSheet, TemplateStrip } from './Gallery'
import { confirm } from '../confirm'

const studio = (project: number) => `/dashboard/studio?project=${project}`

/**
 * Creative Lab's home: how to start (a post straight from the assistant, a blank canvas, or a
 * campaign: a new one from a few questions, or one you have), the projects, and the assistant beside
 * them from the start, for whoever would rather say what they want and let it make the project and
 * build the nodes.
 */
export function LabHome({ actions }: { actions?: ReactNode }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const a = useAssistant()
  const lenis = useLenis()
  const panel = useRef<HTMLElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState(false)

  // A fresh conversation where the assistant asks what to make; below the projects on narrower screens, so it comes up.
  const newPost = () => {
    a.newPost()
    const el = panel.current
    if (el && el.getBoundingClientRect().top > window.innerHeight / 2) lenis?.scrollTo(el, { offset: -24 })
    a.inputRef.current?.focus({ preventScroll: true })
  }

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
  const blank = async (name: string) => {
    setNaming(false)
    setBusy('blank')
    try {
      const p = await api<LabPayload>('/lab/projects', { method: 'POST', body: { name: name.trim() || null } })
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
        actions={actions}
      />

      <div className="mt-10 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-10">
          <StartFrom />
          <Stagger i={0}>
            <WhatYouCanMake onAsk={(t) => {
              const el = panel.current
              if (el && el.getBoundingClientRect().top > window.innerHeight / 2) lenis?.scrollTo(el, { offset: -24 })
              void a.say(`I'd like to make ${t.name.toLowerCase()}, like the example: ${t.tagline}`)
            }} />
          </Stagger>
          <Stagger i={0} className="space-y-6">
            <div>
              <Label className="mb-3">Make a post</Label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StartCard icon={Plus} title="New post" meta="no questions" body="Tell the assistant what you want, a post, a reel or a story, and it makes it. No campaign to set up." onClick={newPost} busy={a.switching} primary />
                <StartCard icon={SquareDashed} title="Blank canvas" meta="no brief for now" body="Put the nodes yourself. A brief can be added later, as a node." onClick={() => setNaming(true)} busy={busy === 'blank'} />
              </div>
            </div>
            <div>
              <Label className="mb-3">Or set up a campaign first</Label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StartCard icon={MessageCircleQuestion} title="New campaign, quick" meta="5 questions · 1 min" body="Creates your campaign from the essentials, like an agency would ask. The AI picks the questions for what you make, and suggests the rest." onClick={() => void interview('quick')} busy={busy === 'quick'} />
                <StartCard icon={Sparkles} title="New campaign, thorough" meta="10 questions · 3 min" body="Creates your campaign from your story, your customers, your voice and your look. The most personal content." onClick={() => void interview('full')} busy={busy === 'full'} />
                <StartCard icon={Megaphone} title="From a campaign you have" meta="its brief and photos" body="A campaign you’ve already set up: its brief, logo and photos open on the canvas." onClick={() => setPicking(true)} className="sm:col-span-2" />
              </div>
            </div>
          </Stagger>
          <Stagger i={1}>
            <Label className="mb-3">Projects</Label>
            <LabProjects />
          </Stagger>
          <MadeAsDrafts />
        </div>
        <Stagger i={1} className="xl:sticky xl:top-6">
          <AssistantPanel ref={panel} />
        </Stagger>
      </div>

      <PickCampaign open={picking} onClose={() => setPicking(false)} />
      <NameCanvas open={naming} onClose={() => setNaming(false)} onCreate={(name) => void blank(name)} />
    </div>
  )
}

/** A blank canvas gets its name first (it can't be made without one), so it's easy to find again with the projects. */
function NameCanvas({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Name your canvas">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onCreate(name)
        }}
        className="space-y-4"
      >
        <div>
          <input autoFocus className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Autumn menu launch" aria-label="Canvas name" />
          <p className="mt-2 text-[11.5px] leading-snug text-dim">It’s saved as you work, under this name with your projects, so you can come back to it any time. You can rename it from the top of the canvas.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" disabled={!name.trim()}>
            Create canvas
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Every template, each shown by an example made with it, so what you can get is plain before you
 * start: a row of them at the top (all of them a click away), one opened big, then a project started
 * from it (or the assistant asked for one like it).
 */
function WhatYouCanMake({ onAsk }: { onAsk: (t: LabTemplate) => void }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const { data: catalog, error } = useApi<LabCatalog>('/lab/catalog')
  const [current, setCurrent] = useState<LabTemplate | null>(null)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const templates = catalog?.templates.filter((t) => !t.mine) ?? []
  const use = async (t: LabTemplate) => {
    try {
      const p = await api<LabPayload>('/lab/projects', { method: 'POST', body: { template: t.key, name: t.name } })
      navigate(studio(p.project.id))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The project couldn’t be made.')
    }
  }
  const ask = (t: LabTemplate) => {
    setOpen(false)
    setAll(false)
    onAsk(t)
  }
  // Without the catalog there are no templates to show; the rest of the page still works.
  if (!catalog) return error ? null : <Skeleton className="h-[300px] rounded-xl" />
  return (
    <>
      <TemplateStrip
        templates={templates}
        title={<Label>What you can make</Label>}
        sub="Every template, shown by an example made with it for a demo brand. Open one to see it big and how it was made, then start with it."
        onOpen={(t) => {
          setCurrent(t)
          setOpen(true)
        }}
        onAll={() => setAll(true)}
      />
      <TemplateSheet t={current} list={templates} catalog={catalog} open={open} onClose={() => setOpen(false)} onStep={setCurrent} onUse={(t) => void use(t)} useLabel="Start with this template" onAsk={ask} />
      <TemplateBrowser open={all} onClose={() => setAll(false)} templates={templates} catalog={catalog} onUse={(t) => void use(t)} useLabel="Start with this template" onAsk={ask} />
    </>
  )
}

function StartCard({ icon: Icon, title, meta, body, onClick, busy, primary, className }: { icon: ComponentType<{ className?: string; strokeWidth?: number }>; title: string; meta: string; body: string; onClick: () => void; busy?: boolean; primary?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={cn('group flex flex-col rounded-xl border bg-panel p-4 text-left transition-colors', primary ? 'border-accent/40 hover:border-accent/70' : 'border-line hover:border-line-2', className)}>
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
function AssistantPanel({ ref }: { ref?: Ref<HTMLElement> }) {
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
    <section ref={ref} aria-label="Assistant" className="flex h-[calc(100dvh-12rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-panel">
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

/**
 * What the assistant made as drafts (the old-school way), beside the projects: each conversation with its
 * posts and where they stand, a click from its drafts and their review.
 */
function MadeAsDrafts() {
  const a = useAssistant()
  const { navigate } = useRouter()
  const list = a.conversations.filter((c) => c.drafts > 0 && c.mode !== 'canvas')
  const busy = list.some((c) => c.activity)
  useEffect(() => {
    if (a.conn !== 'online') return
    a.refreshConversations()
    // While something is being made or posted for one of them, check back so the badge goes when it's done.
    if (!busy) return
    const t = window.setInterval(() => a.refreshConversations(), 4000)
    return () => window.clearInterval(t)
  }, [a.conn, busy])
  if (!list.length) return null
  const open = (id: string, draft?: number) => {
    a.openConversation(id, draft)
    navigate('/dashboard/assistant')
  }
  return (
    <Stagger i={1}>
      <Label className="mb-3">Made as drafts</Label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((c) => (
          <div key={c.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-4 transition-colors hover:border-line-2">
            <button type="button" onClick={() => open(c.id)} className="group flex items-start justify-between gap-3 text-left">
              <span className="truncate text-[14px] font-medium">{c.title}</span>
              {c.activity && <BusyBadge state={c.activity.state} title={c.activity.what} className="ml-auto" />}
              <ArrowUpRight className="size-4 shrink-0 text-dim transition-transform duration-300 group-hover:rotate-45 group-hover:text-fg" strokeWidth={1.75} />
            </button>
            {!!c.posts?.length && (
              // Every draft, a click from it on screen; the row scrolls sideways when there are many
              <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {c.posts.map((p) => (
                  <button
                    key={p.draft}
                    type="button"
                    onClick={() => open(c.id, p.draft)}
                    title={`${p.what}${p.title ? ` · ${p.title}` : ''} · ${p.status}`}
                    className="relative h-14 w-11 shrink-0 overflow-hidden rounded-md bg-black/40 outline-none ring-accent/60 transition-opacity hover:opacity-80 focus-visible:ring-2"
                  >
                    {p.thumb && (p.thumb.kind === 'video' ? <video src={assistantUrl(p.thumb.url)} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={assistantUrl(p.thumb.url)} alt="" className="size-full object-cover" />)}
                    {LIVE.has(p.status) && <span className="absolute bottom-1 right-1 size-1.5 rounded-full bg-ok" />}
                  </button>
                ))}
              </div>
            )}
            <span className="mt-3 font-mono text-[10.5px] text-dim">
              {c.drafts} post{c.drafts === 1 ? '' : 's'}
              {c.scheduled ? ` · ${c.scheduled} scheduled` : ''} · {fmtRelative(c.updated)}
            </span>
          </div>
        ))}
      </div>
    </Stagger>
  )
}

/** A draft's post that is booked or out (conversations.py, Conversation._posts). */
const LIVE = new Set(['scheduled', 'publishing', 'submitted', 'published'])

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
  const { data: projects, error, setData } = useApi<Project[]>('/projects')
  const { navigate } = useRouter()
  const invalidate = useInvalidate()
  const toast = useToast()
  const busy = !!projects?.some((p) => p.working || p.waiting)

  // While a canvas has nodes running or waiting, check back every few seconds so the badges stay true.
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => api<Project[]>('/projects').then(setData).catch(() => {}), 4000)
    return () => window.clearInterval(t)
  }, [busy, setData])

  if (!projects && error) return <EmptyState icon={FolderKanban} title="The projects couldn’t be loaded" body={error.message || 'Reload the page to try again.'} />
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
            {p.working > 0 ? (
              <BusyBadge state="working" title={`${p.working} node${p.working === 1 ? '' : 's'} running${p.waiting ? `, ${p.waiting} waiting for them` : ''}`} className="ml-auto" />
            ) : p.waiting > 0 ? (
              <BusyBadge state="waiting" title={`${p.waiting} node${p.waiting === 1 ? '' : 's'} waiting for nodes before them`} className="ml-auto" />
            ) : null}
            <ArrowUpRight className="size-4 shrink-0 text-dim transition-transform duration-300 group-hover:rotate-45 group-hover:text-fg" strokeWidth={1.75} />
          </span>
          <span className="mt-6 flex items-center gap-2 font-mono text-[10.5px] text-dim">
            {p.nodes} node{p.nodes === 1 ? '' : 's'} · {fmtRelative(p.updated_at)}
            <button
              type="button"
              onClick={async () => {
                if (!(await confirm({ title: `Delete “${p.name}”?`, body: 'What it made stays in the gallery.', action: 'Delete', danger: true }))) return
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
      .catch((e) => {
        toast(e instanceof ApiError && e.status !== 404 ? e.message : 'That brief doesn’t exist any more.')
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
