import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Captions, CheckCircle2, ChevronDown, Clapperboard, FileText, Link2, PenLine, RefreshCw, Scissors, Trash2 } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type LinkClip } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { ClipEditor } from '../clips/ClipEditor'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, PageHeader, Panel, Segmented, Stagger } from '../ui'

type Platform = LinkClip['platform']
type Placement = LinkClip['placement']

/** Where a highlight can go, and as what (the server's LinkClip::PLACEMENTS): the first is the default. */
const PLACEMENTS: Record<Platform, Placement[]> = {
  tiktok: ['video'],
  instagram: ['reel', 'story'],
  facebook: ['reel', 'story'],
  youtube: ['short'],
}
const PLATFORM_NAMES: Record<Platform, string> = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' }
const PLACEMENT_NAMES: Record<Placement, string> = { reel: 'Reel', story: 'Story', video: 'Video', short: 'Short' }
const COLORS = ['#ffffff', '#fde047', '#facc15', '#22d3ee', '#a5b4fc', '#f472b6', '#4ade80', '#fb923c']

const ACTIVE = new Set<LinkClip['status']>(['queued', 'downloading', 'reading', 'analyzing', 'writing', 'rendering'])
const STEPS: Record<LinkClip['status'], string> = {
  queued: 'Waiting for the media worker',
  downloading: 'Downloading the source video',
  reading: 'Reading the article',
  analyzing: 'Listening and choosing the strongest moment',
  writing: 'Writing a short narrated version',
  rendering: 'Rendering a vertical video with captions',
  ready: 'Draft ready',
  failed: 'Needs attention',
}

export default function Clips() {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [platform, setPlatform] = useState<Platform>('tiktok')
  const [placement, setPlacement] = useState<Placement>('video')
  const [seconds, setSeconds] = useState(30)
  const [count, setCount] = useState(3)
  const [color, setColor] = useState('#ffffff')
  const [rights, setRights] = useState(false)
  const [clips, setClips] = useState<LinkClip[]>([])
  const [loading, setLoading] = useState(true)
  const [making, setMaking] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<LinkClip | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const result = await api<{ data: LinkClip[] }>('/clips')
      setClips(result.data)
    } catch (e) {
      if (!quiet) toast(e instanceof Error ? e.message : 'Could not load highlights.', 'error')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!clips.some((clip) => ACTIVE.has(clip.status))) return
    const timer = window.setInterval(() => void load(true), 2500)
    return () => window.clearInterval(timer)
  }, [clips, load])

  const choosePlatform = (next: Platform) => {
    setPlatform(next)
    setPlacement(PLACEMENTS[next][0])
  }
  const choosePlacement = (next: Placement) => {
    setPlacement(next)
    // A story is at most 60 seconds.
    if (next === 'story' && seconds > 60) setSeconds(60)
  }

  const submit = async () => {
    setErrors({})
    setMaking(true)
    try {
      const made = await api<{ data: LinkClip[] }>('/clips', {
        method: 'POST',
        body: { url: url.trim(), platform, placement, seconds, count, caption_color: color, rights_confirmed: rights },
      })
      setClips((current) => [...made.data, ...current])
      const batch = made.data[0]?.batch_id
      if (batch) setOpen((o) => ({ ...o, [batch]: true }))
      setUrl('')
      setRights(false)
      toast(`${made.data.length} highlight${made.data.length === 1 ? '' : 's'} queued from one source analysis.`)
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(e.errors).map(([key, values]) => [key, values[0]])))
      }
      toast(e instanceof Error ? e.message : 'Could not start the highlight.', 'error')
    } finally {
      setMaking(false)
    }
  }

  const retry = async (clip: LinkClip) => {
    try {
      const fresh = await api<{ data: LinkClip[] }>(`/clips/${clip.id}/retry`, { method: 'POST' })
      const updates = new Map(fresh.data.map((item) => [item.id, item]))
      setClips((all) => all.map((item) => updates.get(item.id) ?? item))
      toast(`Trying ${fresh.data.length} highlight${fresh.data.length === 1 ? '' : 's'} again.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not retry the highlight.', 'error')
    }
  }

  const remove = async (clip: LinkClip) => {
    try {
      await api(`/clips/${clip.id}`, { method: 'DELETE' })
      setClips((all) => all.filter((item) => item.id !== clip.id))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the highlight.', 'error')
    }
  }

  const groups = bySource(clips)

  return (
    <div>
      <PageHeader
        title={<>One link. <Serif>Many vertical stories.</Serif></>}
        sub="Paste a YouTube video or an article once. FlowAI analyzes it once, selects several distinct moments or angles, then renders captioned 9:16 drafts for the platform you choose."
      />

      <Stagger i={0} className="mt-10">
        <Panel title="Source" sub="Public YouTube links and readable article pages work best.">
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <label htmlFor="clip-url" className="mb-1.5 block text-xs text-muted">YouTube video or article URL</label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
                <input
                  id="clip-url"
                  className={cn(inputClass, 'pl-10')}
                  placeholder="https://youtube.com/watch?v=… or https://example.com/article"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && rights && url.trim() && void submit()}
                />
              </div>
              <FieldError message={errors.url} />
            </div>
            <Btn variant="primary" icon={Scissors} loading={making} disabled={!url.trim() || !rights} onClick={() => void submit()} className="lg:min-w-36">
              Make highlights
            </Btn>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-5">
            <div>
              <p className="mb-1.5 text-xs text-muted">Platform</p>
              <Segmented
                id="clip-platform"
                label="Platform"
                value={platform}
                onChange={choosePlatform}
                options={(Object.keys(PLACEMENTS) as Platform[]).map((id) => ({ value: id, label: <><PlatformIcon id={id} className="size-3.5" /> {PLATFORM_NAMES[id]}</> }))}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted">Type</p>
              <Segmented id="clip-placement" label="Type" value={placement} onChange={choosePlacement} options={PLACEMENTS[platform].map((p) => ({ value: p, label: PLACEMENT_NAMES[p] }))} />
              <FieldError message={errors.placement} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted">Length</p>
              <Segmented id="clip-seconds" label="Length" value={seconds} onChange={setSeconds} options={[15, 30, 45, 60].map((s) => ({ value: s, label: `${s}s` }))} />
              <FieldError message={errors.seconds} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted">Number</p>
              <Segmented id="clip-count" label="Number of highlights" value={count} onChange={setCount} options={[1, 3, 5, 8].map((n) => ({ value: n, label: String(n) }))} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted">Caption colour</p>
              <div className="flex h-9 items-center gap-1.5 rounded-md border border-line px-2">
                {COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setColor(hex)}
                    aria-label={`Caption colour ${hex}`}
                    aria-pressed={color === hex}
                    className={cn('size-5 rounded-full border transition-transform hover:scale-110', color === hex ? 'border-white ring-2 ring-accent-soft/60' : 'border-white/20')}
                    style={{ background: hex }}
                  />
                ))}
                <label className="relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-md border border-line-2" title="Any colour">
                  <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="Any caption colour" />
                  <span className="size-3.5 rounded" style={{ background: COLORS.includes(color) ? 'conic-gradient(#f87171, #facc15, #4ade80, #22d3ee, #a5b4fc, #f472b6, #f87171)' : color }} />
                </label>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-dim">Font, position, the words and music can be changed on each highlight afterwards.</p>

          <label className="mt-5 flex max-w-3xl items-start gap-2.5 text-xs leading-relaxed text-muted">
            <input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
            <span>I own this source or have permission to download, edit, and republish it. FlowAI keeps the source link with the draft for attribution and review.</span>
          </label>
          <FieldError message={errors.rights_confirmed} />
        </Panel>
      </Stagger>

      <Stagger i={1} className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">Your highlights</h2>
            <p className="mt-0.5 text-xs text-dim">Grouped by source. Rendering continues in the background.</p>
          </div>
          <Btn size="sm" variant="subtle" icon={RefreshCw} onClick={() => void load()}>Refresh</Btn>
        </div>
        {loading ? (
          <div className="h-40 animate-pulse rounded-xl border border-line bg-panel" />
        ) : clips.length === 0 ? (
          <EmptyState icon={Clapperboard} title="No highlights yet" body="Paste a source above. The finished video will appear here and in your Gallery as a draft." />
        ) : (
          <div className="space-y-3">
            {groups.map((group, index) => {
              const active = group.clips.some((clip) => ACTIVE.has(clip.status))
              const isOpen = open[group.key] ?? (index < 2 || active)
              return (
                <SourceGroup key={group.key} clips={group.clips} open={isOpen} onToggle={() => setOpen((o) => ({ ...o, [group.key]: !isOpen }))} onRetry={(clip) => void retry(clip)}>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {group.clips.map((clip) => <ClipCard key={clip.id} clip={clip} onRetry={() => void retry(clip)} onRemove={() => void remove(clip)} onEdit={() => setEditing(clip)} />)}
                  </div>
                </SourceGroup>
              )
            })}
          </div>
        )}
      </Stagger>

      <ClipEditor
        clip={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          const updates = new Map(saved.map((item) => [item.id, item]))
          setClips((all) => all.map((item) => updates.get(item.id) ?? item))
        }}
      />
    </div>
  )
}

/** Highlights from the same link together (one batch), newest source first, in the order they were made. */
function bySource(clips: LinkClip[]) {
  const groups: Array<{ key: string; clips: LinkClip[] }> = []
  const index = new Map<string, number>()
  for (const clip of clips) {
    const key = clip.batch_id ?? `clip-${clip.id}`
    if (!index.has(key)) {
      index.set(key, groups.length)
      groups.push({ key, clips: [] })
    }
    groups[index.get(key)!].clips.push(clip)
  }
  for (const group of groups) group.clips.sort((a, b) => a.batch_index - b.batch_index)
  return groups
}

function SourceGroup({ clips, open, onToggle, onRetry, children }: { clips: LinkClip[]; open: boolean; onToggle: () => void; onRetry: (clip: LinkClip) => void; children: React.ReactNode }) {
  const first = clips[0]
  const ready = clips.filter((clip) => clip.status === 'ready').length
  const failed = clips.find((clip) => clip.status === 'failed')
  const working = clips.filter((clip) => ACTIVE.has(clip.status))
  const progress = Math.round(clips.reduce((sum, clip) => sum + clip.progress, 0) / clips.length)
  const host = first.source_url.replace(/^https?:\/\/(www\.)?/, '')
  // Until the plan names each highlight, the clips carry the source's title.
  const title = first.source_title || first.title || host

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel/60">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronDown className={cn('size-4 shrink-0 text-dim transition-transform', !open && '-rotate-90')} />
          <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 text-muted">
            {first.source_type === 'youtube' ? <PlatformIcon id="youtube" className="size-4" /> : <FileText className="size-4" />}
          </span>
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-[13.5px] font-medium">{title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
              <span className="inline-flex items-center gap-1"><PlatformIcon id={first.platform} className="size-3" /> {PLATFORM_NAMES[first.platform]} {PLACEMENT_NAMES[first.placement]}</span>
              <span>· {clips.length} highlight{clips.length === 1 ? '' : 's'}</span>
              <span className={ready === clips.length ? 'text-ok' : undefined}>· {ready} ready</span>
              {working.length > 0 && <span className="text-accent-soft">· working {progress}%</span>}
              {failed && <span className="text-fail">· needs attention</span>}
            </span>
          </span>
        </button>
        <a href={first.source_url} target="_blank" rel="noreferrer" title={first.source_url} className="hidden max-w-64 truncate text-[11px] text-dim underline decoration-white/15 underline-offset-2 hover:text-muted md:block">
          {host}
        </a>
        {failed && <Btn size="sm" icon={RefreshCw} onClick={() => onRetry(failed)}>Try again</Btn>}
      </div>
      {working.length > 0 && !open && <div className="h-0.5 bg-white/5"><div className="h-full bg-accent-soft transition-all" style={{ width: `${progress}%` }} /></div>}
      {open && <div className="border-t border-line p-4">{children}</div>}
    </section>
  )
}

function ClipCard({ clip, onRetry, onRemove, onEdit }: { clip: LinkClip; onRetry: () => void; onRemove: () => void; onEdit: () => void }) {
  const { navigate } = useRouter()
  const Icon = clip.source_type === 'youtube' ? Clapperboard : FileText
  const active = ACTIVE.has(clip.status)
  const range = clip.start !== null && clip.end !== null ? `${clock(clip.start)}–${clock(clip.end)}` : null

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="grid min-h-48 sm:grid-cols-[170px_1fr]">
        <div className="relative min-h-44 bg-black/35">
          {clip.asset && !active ? (
            <video className="h-full w-full object-cover" src={clip.asset.url} poster={clip.asset.poster_url ?? undefined} controls preload="metadata" />
          ) : (
            <div className="flex h-full min-h-44 flex-col items-center justify-center gap-3 px-5 text-center">
              <Icon className="size-7 text-muted" strokeWidth={1.4} />
              {active && <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-accent-soft transition-all" style={{ width: `${clip.progress}%` }} /></div>}
              <p className="text-[11px] leading-snug text-dim">{STEPS[clip.status]}</p>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-dim"><PlatformIcon id={clip.platform} className="size-3" /> {PLACEMENT_NAMES[clip.placement]} · {clip.seconds}s{clip.batch_total > 1 ? ` · ${clip.batch_index}/${clip.batch_total}` : ''}</p>
              <h3 dir="auto" className="mt-2 line-clamp-2 text-sm font-medium">{clip.title || 'Preparing source…'}</h3>
            </div>
            <Status clip={clip} />
          </div>
          {clip.reason && <p className="mt-3 text-xs leading-relaxed text-muted">{clip.reason}</p>}
          {range && <p className="mt-2 font-mono text-[10px] text-dim">Selected moment {range}</p>}
          {clip.error && <p role="alert" className="mt-3 rounded-md border border-fail/25 bg-fail/5 px-3 py-2 text-xs leading-relaxed text-fail">{clip.error}</p>}
          <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4">
            {clip.editable && <Btn size="sm" icon={Captions} onClick={onEdit} title="Subtitles, their font, colour and position, and music">Edit subtitles & music</Btn>}
            {clip.status === 'ready' && clip.post_id && <Btn size="sm" variant="primary" icon={PenLine} onClick={() => navigate(`/dashboard/create?post=${clip.post_id}`)}>Open draft</Btn>}
            {clip.status === 'failed' && <Btn size="sm" icon={RefreshCw} onClick={onRetry}>Try again</Btn>}
            {!active && <Btn size="sm" variant="subtle" icon={Trash2} onClick={onRemove}>Remove</Btn>}
          </div>
        </div>
      </div>
    </article>
  )
}

function Status({ clip }: { clip: LinkClip }) {
  const ready = clip.status === 'ready'
  const failed = clip.status === 'failed'
  const Icon = ready ? CheckCircle2 : failed ? AlertTriangle : Scissors
  return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em]', ready ? 'border-ok/25 text-ok' : failed ? 'border-fail/25 text-fail' : 'border-accent-soft/25 text-accent-soft')}><Icon className={cn('size-3', !ready && !failed && 'animate-pulse')} />{clip.status}</span>
}

function clock(seconds: number) {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
