import { useEffect, useState } from 'react'
import { Bookmark, ExternalLink, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useRouter } from '../../lib/router'
import { useToast } from '../toast'
import { Btn, inputClass, Modal, Panel } from '../ui'

type Idea = { id?: number; url: string; title: string; creator?: string; board?: string; notes?: string; video_id?: string; published_at?: string; short?: boolean }
type Feed = { items: Idea[]; checked_at: string }
const CHANNELS = [
  { label: 'TED · ideas & storytelling', id: 'UCAuUUnT6oDeKwE6v1NGQxug' },
  { label: 'NASA · science & space', id: 'UCLA_DiR1FfKNvjuUpBHmylQ' },
]

export function Inspiration() {
  const toast = useToast()
  const { navigate } = useRouter()
  const [channel, setChannel] = useState(CHANNELS[0].id)
  const [feed, setFeed] = useState<Feed | null>(null)
  const [saved, setSaved] = useState<Idea[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [view, setView] = useState('discover')
  const [query, setQuery] = useState('')
  const [shorts, setShorts] = useState(false)
  const [board, setBoard] = useState('')
  const [editing, setEditing] = useState<Idea | null>(null)
  const [remake, setRemake] = useState<Idea | null>(null)
  const [product, setProduct] = useState('')
  const [direction, setDirection] = useState('')
  const [saving, setSaving] = useState(false)
  const loadSaved = async () => setSaved(await api<Idea[]>('/inspirations'))
  useEffect(() => { loadSaved().catch((e) => toast(e.message, 'error')) }, [])
  const discover = async () => {
    setBusy(true); setFailure(''); setFeed(null)
    try { setFeed(await api<Feed>('/inspirations/discover', { query: { channel } })) }
    catch (e) { setFailure(e instanceof Error ? e.message : 'Could not load videos.') }
    finally { setBusy(false) }
  }
  useEffect(() => { void discover() }, [])
  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api('/inspirations', { method: 'POST', body: { ...editing, board: editing.board || 'Ideas' } })
      await loadSaved(); setEditing(null); toast('Saved to your inspiration board.')
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save.', 'error') }
    finally { setSaving(false) }
  }
  const remove = async (idea: Idea) => {
    try { await api('/inspirations/' + idea.id, { method: 'DELETE' }); await loadSaved() }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not remove.', 'error') }
  }
  const items = (view === 'discover' ? feed?.items ?? [] : saved).filter((item) =>
    (!shorts || item.short || item.url.includes('/shorts/')) &&
    (!board || item.board === board) &&
    [item.title, item.creator, item.notes].join(' ').toLowerCase().includes(query.toLowerCase()))
  const brief = remake ? [
    'Create an original vertical social video for ' + (product.trim() || '[your product or brand]') + '.',
    'Inspiration topic: ' + remake.title + '.',
    direction.trim() ? 'Creative direction: ' + direction.trim() : 'Use a clear opening hook, a concise demonstration, and a closing call to action.',
    'Use my own product images and brand identity. Create new scenes, wording and audio.',
    'Reference link (for the human reviewer; the model cannot watch this URL): ' + remake.url,
  ].join('\n\n') : ''
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-6">
        <p className="text-xl font-medium">Find an idea. Make it yours.</p>
        <p className="mt-2 text-sm text-muted">Collect recent videos, save creative notes, then build your own version in Creative Lab.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant={view === 'discover' ? 'primary' : 'subtle'} onClick={() => { setView('discover'); setBoard('') }}>Recent videos</Btn>
          <Btn variant={view === 'saved' ? 'primary' : 'subtle'} onClick={() => setView('saved')}>My boards · {saved.length}</Btn>
          <Btn onClick={() => setEditing({ title: '', url: '', board: 'Ideas', notes: '' })}>Add video link</Btn>
        </div>
      </div>
      {view === 'discover' && <Panel title="Discover from channels" sub="Recent uploads, not a verified trend ranking. Feeds refresh every five minutes.">
        <div className="flex flex-wrap gap-2">
          <select aria-label="Source channel" className={inputClass} value={CHANNELS.some((c) => c.id === channel) ? channel : ''} onChange={(e) => setChannel(e.target.value)}>
            <option value="" disabled>Custom channel</option>{CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input aria-label="YouTube channel ID" className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="YouTube channel ID (UC…)" />
          <Btn icon={RefreshCw} onClick={discover} loading={busy}>Load videos</Btn>
        </div>
        {feed && <p className="mt-2 text-xs text-dim">Checked {new Date(feed.checked_at).toLocaleString()} · Source: YouTube public channel feed</p>}
        {failure && <p role="alert" className="mt-3 text-sm text-fail">{failure}</p>}
      </Panel>}
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Search inspiration" className={inputClass} placeholder="Search titles, creators or notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} />Shorts only</label>
        {view === 'saved' && <select aria-label="Board" className={inputClass} value={board} onChange={(e) => setBoard(e.target.value)}><option value="">All boards</option>{[...new Set(saved.map((x) => x.board))].map((b) => <option key={b}>{b}</option>)}</select>}
      </div>
      {busy && view === 'discover' && <p className="text-muted">Loading recent videos…</p>}
      {!busy && !items.length && <p className="rounded-xl border border-line p-8 text-center text-muted">No matching videos. Load another channel or add a link to your board.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((idea) => <article key={idea.url} className="overflow-hidden rounded-xl border border-line bg-panel">
          {idea.video_id ? <iframe title={idea.title} src={'https://www.youtube-nocookie.com/embed/' + idea.video_id} loading="lazy" allowFullScreen className="aspect-video w-full border-0" /> : <a href={idea.url} target="_blank" rel="noreferrer" className="grid aspect-video place-items-center bg-white/5 text-muted"><ExternalLink />Open original video</a>}
          <div className="space-y-3 p-4">
            <p className="text-xs text-accent-soft">{idea.short ? 'Short' : 'Video'} · {idea.creator || 'Saved link'}{idea.board ? ' · ' + idea.board : ''}</p>
            <h3 className="text-sm font-medium">{idea.title}</h3>
            {idea.published_at && <p className="text-xs text-dim">Published {new Date(idea.published_at).toLocaleDateString()}</p>}
            {idea.notes && <p className="line-clamp-3 text-xs text-muted">{idea.notes}</p>}
            <a href={idea.url} target="_blank" rel="noreferrer" className="text-xs underline">View source ↗</a>
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" icon={Bookmark} onClick={() => setEditing(saved.find((s) => s.url === idea.url) ?? { ...idea, board: 'Ideas', notes: '' })}>{saved.some((s) => s.url === idea.url) ? 'Edit notes' : 'Save'}</Btn>
              <Btn size="sm" variant="primary" icon={Sparkles} onClick={() => { setRemake(idea); setDirection(idea.notes || ''); setProduct('') }}>Make my version</Btn>
              {idea.id && <Btn size="sm" icon={Trash2} onClick={() => remove(idea)}>Remove</Btn>}
            </div>
          </div>
        </article>)}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Save inspiration">
        {editing && <div className="space-y-3">
          {(['url', 'title', 'creator', 'board'] as const).map((field) => <label key={field} className="block text-xs capitalize">{field}<input className={inputClass + ' mt-1'} value={editing[field] || ''} onChange={(e) => setEditing({ ...editing, [field]: e.target.value })} /></label>)}
          <label className="block text-xs">Creative notes: hook, scenes, pacing<textarea rows={4} className={inputClass + ' mt-1 h-auto'} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
          <Btn variant="primary" onClick={save} loading={saving} disabled={!editing.title.trim() || !editing.url.trim()}>Save to board</Btn>
        </div>}
      </Modal>
      <Modal open={!!remake} onClose={() => setRemake(null)} title="Plan your version" className="max-w-2xl">
        <div className="space-y-4">
          <p className="text-xs text-muted">A brief built from your notes. No automatic video analysis or generation has run.</p>
          <label className="block text-sm">Your product / brand<input className={inputClass + ' mt-1'} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="What are you promoting?" /></label>
          <label className="block text-sm">What should your version do differently?<textarea rows={3} className={inputClass + ' mt-1 h-auto'} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="Describe the hook, scene sequence and style you want…" /></label>
          <pre className="whitespace-pre-wrap rounded-lg border border-line p-3 text-xs leading-relaxed">{brief}</pre>
          <Btn variant="primary" icon={Sparkles} disabled={!product.trim()} onClick={() => navigate('/dashboard/studio?tab=video&prompt=' + encodeURIComponent(brief))}>Review in Creative Lab</Btn>
        </div>
      </Modal>
    </div>
  )
}
