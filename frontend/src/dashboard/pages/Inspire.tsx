import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, Flame, Heart, History, MessageCircle, Music2, Play, Search, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { ease } from '../../lib/motion'
import { useRouter } from '../../lib/router'
import { useToast } from '../toast'
import { Btn, EmptyState, inputClass, PageHeader, Segmented, Skeleton, Stagger } from '../ui'

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

type Saved = {
  last: Feed | null
  recent: Array<{ hashtag: string; results: number; searched_at: string }>
  tags: Array<{ tag: string; count: number }>
}

type Brief = { why_it_works: string; hook: string; video_prompt: string; model: string }

const PLATFORMS = [
  { value: 'tiktok' as const, label: 'TikTok' },
  { value: 'instagram' as const, label: 'Instagram' },
]

/** Somewhere to start on a first visit, before there is any history to suggest from. */
const STARTERS = ['candle', 'skincare', 'smallbusiness', 'homedecor', 'recipe', 'fitness']

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n))

const idOf = (item: Trend) => item.external_id || item.url

/** /dashboard/inspire: what is working on Instagram and TikTok, and the video prompt to make your own. */
export default function Inspire() {
  const toast = useToast()
  const { navigate } = useRouter()
  const [platform, setPlatform] = useState<Platform>('tiktok')
  const [hashtag, setHashtag] = useState('')
  const [feed, setFeed] = useState<Feed | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState('')
  const [making, setMaking] = useState<string | null>(null)

  const fetchSaved = useCallback(async (p: Platform) => {
    try {
      const history = await api<Saved>('/trends/searches', { query: { platform: p } })
      setSaved(history)
      return history
    } catch {
      // Suggestions are a convenience; losing them should not take the page down.
      return null
    }
  }, [])

  // Reopen the last search for this platform instead of paying for it again.
  useEffect(() => {
    let cancelled = false
    void fetchSaved(platform).then((history) => {
      if (cancelled || !history) return
      setFeed((current) => (current?.platform === platform ? current : history.last))
      setHashtag((current) => current || history.last?.hashtag || '')
    })

    return () => {
      cancelled = true
    }
  }, [platform, fetchSaved])

  const search = async (tag?: string) => {
    const query = (tag ?? hashtag).trim().replace(/^#+/, '')
    if (!query) return setFailure('Type a hashtag to search for.')
    setHashtag(query)
    setLoading(true)
    setFailure('')
    try {
      setFeed(await api<Feed>('/trends', { query: { platform, hashtag: query } }))
      void fetchSaved(platform)
    } catch (e) {
      setFeed(null)
      setFailure(e instanceof Error ? e.message : 'Could not load trends.')
    } finally {
      setLoading(false)
    }
  }

  /** Turn one post into a video prompt and hand it to the Creative Lab. */
  const make = async (item: Trend) => {
    setMaking(idOf(item))
    try {
      const brief = await api<Brief>('/trends/derive-prompt', {
        method: 'POST',
        body: {
          caption: item.caption || `A ${item.kind} post tagged ${item.hashtags.slice(0, 5).join(', ')}`,
          platform: item.platform,
          kind: item.kind,
          author: item.author.handle,
          hashtags: item.hashtags,
          sound: item.sound?.name,
          metrics: item.metrics,
        },
      })
      toast(`${brief.model} wrote the scene. Pick a model and make it.`)
      navigate(`/dashboard/studio?tab=video&prompt=${encodeURIComponent(brief.video_prompt)}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not write the prompt.', 'error')
    } finally {
      setMaking(null)
    }
  }

  const searchedBefore = saved?.recent.map((r) => ({ tag: r.hashtag })) ?? []
  const nothingSuggested = searchedBefore.length === 0 && (saved?.tags.length ?? 0) === 0

  return (
    <div>
      <PageHeader
        eyebrow="Inspire"
        title={
          <>
            What's working <Serif>right now.</Serif>
          </>
        }
        sub="Search a hashtag on TikTok or Instagram, see what the platform is rewarding, then turn any post into a video prompt and make your own in the Creative Lab."
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
          <Btn variant="primary" icon={Search} onClick={() => search()} loading={loading}>
            Search
          </Btn>
        </div>

        <div className="mt-3 space-y-2">
          {nothingSuggested ? (
            <Chips icon={Flame} label="Try" tags={STARTERS.map((tag) => ({ tag }))} onPick={search} />
          ) : (
            <>
              <Chips icon={History} label="Searched before" tags={searchedBefore} onPick={search} />
              <Chips icon={TrendingUp} label="Most tagged on these posts" tags={saved?.tags ?? []} onPick={search} />
            </>
          )}
        </div>

        <p className="mt-3 text-xs text-dim">
          {feed
            ? `${feed.items.length} posts for #${feed.hashtag} · checked ${new Date(feed.checked_at).toLocaleString()} · cost $${feed.cost.toFixed(3)} · kept, so reopening is free`
            : 'Each search is billed per post by the trend source, so results are saved and reused for 30 minutes.'}
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
              <TrendCard key={idOf(item)} item={item} i={i} busy={making === idOf(item)} onMake={() => make(item)} />
            ))}
          </div>
        )}
      </Stagger>
    </div>
  )
}

function Chips({ icon: Icon, label, tags, onPick }: { icon: LucideIcon; label: string; tags: Array<{ tag: string; count?: number }>; onPick: (tag: string) => void }) {
  if (!tags.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs text-dim">
        <Icon className="size-3" />
        {label}
      </span>
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          type="button"
          onClick={() => onPick(tag)}
          className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-2 hover:text-fg"
        >
          #{tag}
          {count ? <span className="ml-1 text-dim">{count}</span> : null}
        </button>
      ))}
    </div>
  )
}

function TrendCard({ item, i, busy, onMake }: { item: Trend; i: number; busy: boolean; onMake: () => void }) {
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
          <Btn size="sm" variant="primary" icon={Sparkles} onClick={onMake} loading={busy}>
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
