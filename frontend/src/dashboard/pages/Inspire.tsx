import { useState } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, Copy, Flame, Heart, MessageCircle, Music2, Play, Search, Sparkles, Wand2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { ease } from '../../lib/motion'
import { useRouter } from '../../lib/router'
import { useToast } from '../toast'
import { Btn, EmptyState, inputClass, Modal, PageHeader, Segmented, Skeleton, Stagger } from '../ui'

type Platform = 'instagram' | 'tiktok'

type Trend = {
  platform: Platform
  external_id: string
  url: string
  caption: string
  hashtags: string[]
  kind: 'image' | 'video' | 'carousel'
  thumbnail: string | null
  duration: number | null
  author: { handle: string | null; name: string | null; avatar: string | null; followers: number; verified: boolean }
  sound: { name: string; author: string | null; original: boolean } | null
  metrics: { views: number; likes: number; comments: number; shares: number; saves: number }
  posted_at: string | null
}

type Feed = { items: Trend[]; platform: Platform; hashtag: string; checked_at: string; cost: number }

type Brief = {
  why_it_works: string
  hook: string
  beats: Array<{ shot: string; note: string }>
  visual_style: string
  caption: string
  hashtags: string[]
  image_prompt: string
  model: string
}

const PLATFORMS = [
  { value: 'tiktok' as const, label: 'TikTok' },
  { value: 'instagram' as const, label: 'Instagram' },
]

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n))

/** /dashboard/inspire: what is working on Instagram and TikTok, and the brief to make your own. */
export default function Inspire() {
  const toast = useToast()
  const [platform, setPlatform] = useState<Platform>('tiktok')
  const [hashtag, setHashtag] = useState('')
  const [feed, setFeed] = useState<Feed | null>(null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState('')
  const [remake, setRemake] = useState<Trend | null>(null)

  const search = async () => {
    if (!hashtag.trim()) return setFailure('Type a hashtag to search for.')
    setLoading(true)
    setFailure('')
    try {
      setFeed(await api<Feed>('/trends', { query: { platform, hashtag: hashtag.trim() } }))
    } catch (e) {
      setFeed(null)
      setFailure(e instanceof Error ? e.message : 'Could not load trends.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inspire"
        title={
          <>
            What's working <Serif>right now.</Serif>
          </>
        }
        sub="Search a hashtag on TikTok or Instagram, see what the platform is rewarding, then have the writer turn any post into a brief for your own original version."
      />

      <Stagger i={0} className="mt-10">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented id="inspire-platform" label="Platform" options={PLATFORMS} value={platform} onChange={setPlatform} className="w-fit" />
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim">#</span>
            <input
              aria-label="Hashtag"
              className={cn(inputClass, 'w-full pl-7')}
              placeholder="candle, autumn, skincare…"
              value={hashtag}
              onChange={(e) => setHashtag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
            />
          </div>
          <Btn variant="primary" icon={Search} onClick={search} loading={loading}>
            Search
          </Btn>
        </div>
        <p className="mt-2 text-xs text-dim">
          {feed
            ? `${feed.items.length} posts for #${feed.hashtag} · checked ${new Date(feed.checked_at).toLocaleString()} · cost $${feed.cost.toFixed(3)} · cached 30 min`
            : 'Each search is billed per post by the trend source, so results are cached for 30 minutes.'}
        </p>
        {failure && (
          <p role="alert" className="mt-3 text-sm text-fail">
            {failure}
          </p>
        )}
      </Stagger>

      <Stagger i={1} className="mt-8">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[320px] rounded-xl" />
            ))}
          </div>
        ) : !feed ? (
          <EmptyState icon={Flame} title="Search a hashtag" body="Pick a platform and a hashtag you compete on. You'll get the posts doing best for it, ranked by reach." />
        ) : feed.items.length === 0 ? (
          <EmptyState icon={Flame} title={`Nothing back for #${feed.hashtag}`} body="That hashtag returned no posts. Try a broader one." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {feed.items.map((item, i) => (
              <TrendCard key={item.external_id || item.url} item={item} i={i} onRemake={() => setRemake(item)} />
            ))}
          </div>
        )}
      </Stagger>

      <RemakeModal item={remake} onClose={() => setRemake(null)} toast={toast} />
    </div>
  )
}

function TrendCard({ item, i, onRemake }: { item: Trend; i: number; onRemake: () => void }) {
  const metrics = [
    item.metrics.views > 0 && { icon: Play, value: compact(item.metrics.views) },
    item.metrics.likes > 0 && { icon: Heart, value: compact(item.metrics.likes) },
    item.metrics.comments > 0 && { icon: MessageCircle, value: compact(item.metrics.comments) },
    item.metrics.saves > 0 && { icon: Bookmark, value: compact(item.metrics.saves) },
  ].filter(Boolean) as Array<{ icon: typeof Play; value: string }>

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.03 }}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-line-2"
    >
      <a href={item.url} target="_blank" rel="noreferrer" className="relative block aspect-[4/5] overflow-hidden bg-white/5">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-xs text-dim">No preview</span>
        )}
        <span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/90">
          {item.kind}
          {item.duration ? ` · ${item.duration}s` : ''}
        </span>
      </a>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          {item.author.avatar && <img src={item.author.avatar} alt="" referrerPolicy="no-referrer" className="size-6 rounded-full object-cover" />}
          <span className="truncate text-xs text-accent-soft">@{item.author.handle || 'unknown'}</span>
          {item.author.followers > 0 && <span className="shrink-0 text-xs text-dim">{compact(item.author.followers)} followers</span>}
        </div>

        <p className="line-clamp-3 text-sm leading-relaxed">{item.caption || <span className="text-dim">No caption</span>}</p>

        {item.sound && (
          <p className="flex items-center gap-1.5 truncate text-xs text-dim">
            <Music2 className="size-3 shrink-0" />
            {item.sound.name}
            {item.sound.original ? ' · original' : ''}
          </p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {metrics.map(({ icon: Icon, value }) => (
            <span key={value + Icon.name} className="flex items-center gap-1">
              <Icon className="size-3" />
              {value}
            </span>
          ))}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Btn size="sm" variant="primary" icon={Sparkles} onClick={onRemake}>
            Make my version
          </Btn>
          <a href={item.url} target="_blank" rel="noreferrer" className="self-center text-xs text-muted underline hover:text-fg">
            Original ↗
          </a>
        </div>
      </div>
    </motion.article>
  )
}

function RemakeModal({ item, onClose, toast }: { item: Trend | null; onClose: () => void; toast: ReturnType<typeof useToast> }) {
  const { navigate } = useRouter()
  const [product, setProduct] = useState('')
  const [angle, setAngle] = useState('')
  const [brief, setBrief] = useState<Brief | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    onClose()
    setBrief(null)
    setAngle('')
  }

  const derive = async () => {
    if (!item) return
    setBusy(true)
    try {
      setBrief(
        await api<Brief>('/trends/derive-prompt', {
          method: 'POST',
          body: {
            caption: item.caption || `A ${item.kind} post tagged ${item.hashtags.slice(0, 5).join(', ')}`,
            platform: item.platform,
            kind: item.kind,
            author: item.author.handle,
            hashtags: item.hashtags,
            sound: item.sound?.name,
            metrics: item.metrics,
            product,
            angle,
          },
        }),
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not write the brief.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    toast(`${what} copied.`)
  }

  return (
    <Modal open={!!item} onClose={close} title="Make my version" className="max-w-3xl">
      <div className="space-y-4">
        <p className="text-xs text-muted">
          The writer reads only what the platform published about this post — its caption, tags, sound and engagement. It cannot watch the video, so it takes the structure and writes you something original rather than a copy.
        </p>

        <label className="block text-sm">
          Your product or brand
          <input className={cn(inputClass, 'mt-1 w-full')} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="What are you promoting?" />
        </label>
        <label className="block text-sm">
          What should your version do differently?
          <textarea
            rows={2}
            className={cn(inputClass, 'mt-1 h-auto w-full')}
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="Calmer, show the process, lead with the problem…"
          />
        </label>

        <Btn variant="primary" icon={Wand2} onClick={derive} loading={busy} disabled={!product.trim()}>
          {brief ? 'Write it again' : 'Write the brief'}
        </Btn>

        {brief && (
          <div className="space-y-4 border-t border-line pt-4">
            <Section title="Why it works">
              <p className="text-sm leading-relaxed text-muted">{brief.why_it_works}</p>
            </Section>

            <Section title="Your hook">
              <p className="text-sm leading-relaxed">{brief.hook}</p>
            </Section>

            <Section title="Shot by shot">
              <ol className="space-y-2">
                {brief.beats.map((beat, n) => (
                  <li key={n} className="flex gap-3 text-sm">
                    <span className="shrink-0 text-xs text-dim">{String(n + 1).padStart(2, '0')}</span>
                    <span>
                      {beat.shot}
                      <span className="block text-xs text-muted">{beat.note}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="Look">
              <p className="text-sm leading-relaxed text-muted">{brief.visual_style}</p>
            </Section>

            <Section title="Caption" action={<Btn size="sm" icon={Copy} onClick={() => copy(`${brief.caption}\n\n${brief.hashtags.map((t) => `#${t}`).join(' ')}`, 'Caption')} />}>
              <p className="text-sm leading-relaxed">{brief.caption}</p>
              <p className="mt-2 text-xs text-accent-soft">{brief.hashtags.map((t) => `#${t}`).join(' ')}</p>
            </Section>

            <Section title="Image prompt" action={<Btn size="sm" icon={Copy} onClick={() => copy(brief.image_prompt, 'Prompt')} />}>
              <pre className="whitespace-pre-wrap rounded-lg border border-line p-3 text-xs leading-relaxed">{brief.image_prompt}</pre>
            </Section>

            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" icon={Sparkles} onClick={() => navigate(`/dashboard/studio?tab=image&prompt=${encodeURIComponent(brief.image_prompt)}`)}>
                Open in Creative Lab
              </Btn>
              <span className="self-center text-xs text-dim">Written by {brief.model}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wide text-dim">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}
