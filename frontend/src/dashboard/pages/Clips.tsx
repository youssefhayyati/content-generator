import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clapperboard, FileText, Link2, PenLine, RefreshCw, Scissors, Trash2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type LinkClip } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, PageHeader, Panel, Segmented, Stagger } from '../ui'

type Platform = 'tiktok' | 'instagram'

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
  const [seconds, setSeconds] = useState(30)
  const [count, setCount] = useState(3)
  const [accent, setAccent] = useState('#a5b4fc')
  const [rights, setRights] = useState(false)
  const [clips, setClips] = useState<LinkClip[]>([])
  const [loading, setLoading] = useState(true)
  const [making, setMaking] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

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

  const submit = async () => {
    setErrors({})
    setMaking(true)
    try {
      const made = await api<{ data: LinkClip[] }>('/clips', {
        method: 'POST',
        body: { url: url.trim(), platform, seconds, count, accent, rights_confirmed: rights },
      })
      setClips((current) => [...made.data, ...current])
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

  return (
    <div>
      <PageHeader
        eyebrow="Highlights"
        title={<>One link. <Serif>Many vertical stories.</Serif></>}
        sub="Paste a YouTube video or an article once. FlowAI analyzes it once, selects several distinct moments or angles, then renders captioned 9:16 drafts for Reels or TikTok."
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
              <p className="mb-1.5 text-xs text-muted">Destination</p>
              <Segmented id="clip-platform" label="Destination" value={platform} onChange={setPlatform} options={[{ value: 'tiktok', label: 'TikTok' }, { value: 'instagram', label: 'Instagram Reel' }]} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted">Target length</p>
              <Segmented id="clip-seconds" label="Target length" value={seconds} onChange={setSeconds} options={[{ value: 15, label: '15s' }, { value: 30, label: '30s' }, { value: 45, label: '45s' }, { value: 60, label: '60s' }]} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted">Number of highlights</p>
              <Segmented id="clip-count" label="Number of highlights" value={count} onChange={setCount} options={[{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }, { value: 8, label: '8' }]} />
            </div>
            <label className="flex h-9 items-center gap-2 rounded-md border border-line-2 px-3 text-xs text-muted">
              <input aria-label="Caption accent" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} className="size-5 cursor-pointer border-0 bg-transparent p-0" />
              Caption accent
            </label>
          </div>

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
            <p className="mt-0.5 text-xs text-dim">Rendering continues in the background.</p>
          </div>
          <Btn size="sm" variant="subtle" icon={RefreshCw} onClick={() => void load()}>Refresh</Btn>
        </div>
        {loading ? (
          <div className="h-40 animate-pulse rounded-xl border border-line bg-panel" />
        ) : clips.length === 0 ? (
          <EmptyState icon={Clapperboard} title="No highlights yet" body="Paste a source above. The finished video will appear here and in your Gallery as a draft." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {clips.map((clip) => <ClipCard key={clip.id} clip={clip} onRetry={() => void retry(clip)} onRemove={() => void remove(clip)} />)}
          </div>
        )}
      </Stagger>
    </div>
  )
}

function ClipCard({ clip, onRetry, onRemove }: { clip: LinkClip; onRetry: () => void; onRemove: () => void }) {
  const { navigate } = useRouter()
  const Icon = clip.source_type === 'youtube' ? Clapperboard : FileText
  const active = ACTIVE.has(clip.status)
  const range = clip.start !== null && clip.end !== null ? `${clock(clip.start)}–${clock(clip.end)}` : null

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="grid min-h-48 sm:grid-cols-[170px_1fr]">
        <div className="relative min-h-44 bg-black/35">
          {clip.asset ? (
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
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-dim"><Icon className="size-3" /> {clip.source_type} · {clip.platform} · {clip.seconds}s{clip.batch_total > 1 ? ` · ${clip.batch_index}/${clip.batch_total}` : ''}</p>
              <h3 className="mt-2 line-clamp-2 text-sm font-medium">{clip.title || 'Preparing source…'}</h3>
            </div>
            <Status clip={clip} />
          </div>
          {clip.reason && <p className="mt-3 text-xs leading-relaxed text-muted">{clip.reason}</p>}
          {range && <p className="mt-2 font-mono text-[10px] text-dim">Selected moment {range}</p>}
          {clip.error && <p role="alert" className="mt-3 rounded-md border border-fail/25 bg-fail/5 px-3 py-2 text-xs leading-relaxed text-fail">{clip.error}</p>}
          <a href={clip.source_url} target="_blank" rel="noreferrer" className="mt-3 truncate text-[11px] text-dim underline decoration-white/15 underline-offset-2 hover:text-muted">{clip.source_url}</a>
          <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4">
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
