import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Bookmark, CalendarClock, ChevronDown, ChevronRight, ClipboardPaste, ExternalLink, Heart, ImagePlus, Loader2, MessageCircle, Plus, RefreshCw, Repeat2, Send, Sparkles, Trash2 } from 'lucide-react'
import { PlatformIcon, PLATFORMS } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, uploadFiles, type Account, type Asset, type Repost } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Skeleton, Stagger, Toggle } from '../ui'

type Net = Repost['source_platform']

const STATUS: Record<Repost['status'], { label: string; cls: string }> = {
  fetching: { label: 'Reading…', cls: 'border-white/10 text-muted' },
  failed: { label: 'Couldn’t read', cls: 'border-fail/30 text-fail' },
  captured: { label: 'Picked', cls: 'border-white/10 text-muted' },
  adapting: { label: 'Adapting…', cls: 'border-plan/30 text-plan' },
  adapted: { label: 'Adapted', cls: 'border-plan/30 text-plan' },
  scheduled: { label: 'Scheduled', cls: 'border-ok/25 text-ok' },
  dropped: { label: 'Dropped', cls: 'border-fail/30 text-fail' },
}

const POST_STATUS: Partial<Record<NonNullable<Repost['post_status']>, { label: string; cls: string }>> = {
  publishing: { label: 'Posting…', cls: 'border-plan/30 text-plan' },
  submitted: { label: 'Posted · unconfirmed', cls: 'border-warn/30 text-warn' },
  published: { label: 'Published', cls: 'border-ok/30 text-ok' },
  failed: { label: 'Failed on the phone', cls: 'border-fail/30 text-fail' },
}

const LIMIT: Record<Net, number> = { x: 280, instagram: 2200 }

const other = (n: Net): Net => (n === 'x' ? 'instagram' : 'x')

/** Which network a pasted link is a post on, as the backend reads it. */
function networkOf(url: string): Net | null {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.replace(/^(www\.|mobile\.|m\.)/, '')
    if ((host === 'x.com' || host === 'twitter.com') && /\/status(es)?\/\d+/.test(u.pathname)) return 'x'
    if (host === 'instagram.com' && /\/(p|reels?|tv)\/[\w-]+/.test(u.pathname)) return 'instagram'
  } catch {
    /* not a URL yet */
  }
  return null
}

const errorOf = (e: unknown, fallback: string) => (e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : fallback)

/** /dashboard/reposts: reuse posts between X and Instagram — with permission recorded, and credit given. */
export default function Reposts() {
  const { data: reposts, loading, setData } = useApi<Repost[]>('/reposts')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [capturing, setCapturing] = useState(false)
  const targets = (accounts ?? []).filter((a) => a.platform === 'instagram' || a.platform === 'x')
  const fetching = reposts?.some((r) => r.status === 'fetching' || r.status === 'adapting')
  // Booked or going out on the phone: checked on, so it shows Published (and folds up) when it's up.
  const waiting = reposts?.some((r) => r.post_status === 'scheduled' || r.post_status === 'publishing')

  // While a post is being read in the background, check back every few seconds; while one is going out, less often.
  useEffect(() => {
    if (!fetching && !waiting) return
    const t = window.setInterval(() => api<Repost[]>('/reposts').then(setData).catch(() => {}), fetching ? 3000 : 15000)
    return () => window.clearInterval(t)
  }, [fetching, waiting, setData])

  return (
    <div>
      <PageHeader
        title={
          <>
            Between X and <Serif>Instagram.</Serif>
          </>
        }
        sub="Paste a post’s link from X or Instagram and say where it goes: a post, a reel or a story. Its text, photos and video are read, the AI writes three takes crediting the author, you pick and approve one, and the phone posts it."
        actions={
          <Btn variant="primary" icon={Plus} onClick={() => setCapturing(true)} disabled={targets.length === 0}>
            Pick a post
          </Btn>
        }
      />

      <Stagger i={0} className="mt-10">
        {!reposts && loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </div>
        ) : reposts && reposts.length === 0 ? (
          <EmptyState
            icon={Repeat2}
            title="Nothing picked yet"
            body={
              targets.length === 0
                ? 'Reposts land on your X or Instagram accounts. Add one on the Accounts page first.'
                : 'Paste a link to an X or Instagram post worth reusing. Permission comes first; adaptation after.'
            }
            action={
              targets.length > 0 ? (
                <Btn variant="primary" icon={Plus} onClick={() => setCapturing(true)}>
                  Pick the first one
                </Btn>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {reposts?.map((r, i) => (
              <RepostRow key={r.id} repost={r} i={i} />
            ))}
          </ul>
        )}
      </Stagger>

      <Capture open={capturing} accounts={targets} onClose={() => setCapturing(false)} />
    </div>
  )
}

function Thumb({ m }: { m: { kind: string; url: string; poster_url: string | null } }) {
  return (
    <span className="relative block size-16 shrink-0 overflow-hidden rounded-lg border border-line bg-white/[0.03]">
      {m.kind === 'video' && !m.poster_url ? (
        <video src={m.url} className="size-full object-cover" muted preload="metadata" />
      ) : (
        <img src={m.poster_url ?? m.url} alt="" className="size-full object-cover" loading="lazy" />
      )}
      {m.kind === 'video' && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 font-mono text-[9px] text-white">VIDEO</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Where it goes, and how it will look there                           */
/* ------------------------------------------------------------------ */

type Placement = 'feed' | 'reel' | 'story' | 'post'
type PreviewMedia = { id: number; kind: string; url: string; poster_url: string | null; width?: number | null; height?: number | null }

const PLACEMENTS: Record<Net, Placement[]> = { instagram: ['feed', 'reel', 'story'], x: ['post'] }
const PLACEMENT_LABEL: Record<Placement, string> = { feed: 'Post', reel: 'Reel', story: 'Story', post: 'Post' }
const PLACEMENT_NOTE: Record<Placement, string> = {
  feed: 'A feed post: the picture or video shows between 4:5 and 1.91:1, the caption and credit underneath.',
  reel: 'A reel: 9:16. A wider video is centred over a blurred copy of itself, as shown. The caption and credit show on it.',
  story: 'A story: 9:16, gone after 24 hours. Its line and the credit tag are drawn on it when it’s scheduled.',
  post: 'A post on X, with its photos or video under the text.',
}
// The shapes each placement takes (config/platforms.php): outside them the server reframes it, as shown.
const RANGE: Record<Placement, [number, number]> = { feed: [0.8, 1.91], reel: [0.54, 0.58], story: [0.54, 0.58], post: [0.5, 2] }

const ANGLE_LABEL: Record<Repost['options'][number]['angle'], string> = { faithful: 'Faithful', take: 'Your take', punchy: 'Punchy' }
const tagText = (tags?: string[] | null) => (tags ?? []).map((t) => `#${t}`).join(' ')
/** A story's line by default: the caption's first sentence, short enough to sit on the picture. */
const storyLine = (caption?: string | null) => {
  const first = (caption ?? '').split(/(?<=[.!?…])\s|\n/)[0]?.trim() ?? ''
  return first.length > 90 ? first.slice(0, 89).trimEnd() + '…' : first
}

const ratioOf = (m?: PreviewMedia) => (m?.width && m?.height ? m.width / m.height : null)

/** As the server picks it (RepostController::placement): a tall video is a reel, the rest a feed post. */
function defaultPlacement(net: Net, media: PreviewMedia[]): Placement {
  if (net === 'x') return 'post'
  const first = media[0]
  return first?.kind === 'video' && (ratioOf(first) ?? 1) < 0.7 ? 'reel' : 'feed'
}

function PlacementChoice({ net, value, onChange, hasVideo }: { net: Net; value: Placement; onChange: (p: Placement) => void; hasVideo: boolean }) {
  const options = PLACEMENTS[net]
  if (options.length < 2) return null
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-white/[0.02] p-1">
      {options.map((p) => {
        const off = p === 'reel' && !hasVideo
        return (
          <button
            key={p}
            type="button"
            disabled={off}
            title={off ? 'A reel needs a video' : undefined}
            onClick={() => onChange(p)}
            className={cn(
              'h-7 rounded-md text-[12px] font-medium transition-colors',
              value === p ? 'bg-white/10 text-fg' : 'text-muted hover:text-fg',
              off && 'cursor-not-allowed opacity-40 hover:text-muted',
            )}
          >
            {PLACEMENT_LABEL[p]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The picture or video as the placement shows it. When its shape is outside the placement's, it sits
 * whole over a blurred copy of itself: what the server makes of it on scheduling (RepostSource::fit).
 */
function Framed({ m, placement, aspect }: { m?: PreviewMedia; placement: Placement; aspect: number }) {
  if (!m) return <div className="grid size-full place-items-center bg-white/[0.03] text-[11px] text-dim">No photo or video</div>
  const [lo, hi] = RANGE[placement]
  const ratio = ratioOf(m)
  const fits = ratio === null || (ratio >= lo - 0.005 && ratio <= hi + 0.005) || Math.abs(ratio - aspect) < 0.02
  const media = (cls: string) =>
    m.kind === 'video' ? (
      <video src={m.url} poster={m.poster_url ?? undefined} className={cls} muted loop autoPlay playsInline preload="metadata" />
    ) : (
      <img src={m.poster_url ?? m.url} alt="" className={cls} />
    )
  return (
    <div className="relative size-full overflow-hidden bg-black">
      {!fits && <div className="absolute inset-0 scale-110 blur-2xl brightness-[0.62] saturate-[0.8]">{media('size-full object-cover')}</div>}
      {media(cn('relative size-full', fits ? 'object-cover' : 'object-contain'))}
    </div>
  )
}

function RepostPreview({
  net,
  placement,
  media,
  body,
  handle,
  storyText,
  credit,
  className,
}: {
  net: Net
  placement: Placement
  media: PreviewMedia[]
  body: string
  handle: string
  storyText?: string
  credit?: string | null
  className?: string
}) {
  const first = media[0]
  const ratio = ratioOf(first)

  if (net === 'x') {
    return (
      <div className={cn('rounded-xl border border-line bg-black p-3', className)}>
        <p className="text-[12px] font-semibold">
          @{handle} <span className="font-normal text-dim">· now</span>
        </p>
        <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-[12px] leading-snug">{body}</p>
        {first && (
          <div className="mt-2 aspect-video overflow-hidden rounded-xl border border-line">
            <Framed m={first} placement="post" aspect={16 / 9} />
          </div>
        )}
      </div>
    )
  }

  if (placement === 'feed') {
    // The feed shows the media at its own shape, within 4:5 to 1.91:1.
    const aspect = Math.min(1.91, Math.max(0.8, ratio ?? 0.8))
    return (
      <div className={cn('overflow-hidden rounded-xl border border-line bg-black', className)}>
        <p className="flex items-center gap-2 px-2.5 py-2 text-[11.5px] font-semibold">
          <span className="size-5 rounded-full bg-linear-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]" />
          {handle}
        </p>
        <div style={{ aspectRatio: aspect }}>
          <Framed m={first} placement="feed" aspect={aspect} />
        </div>
        <div className="flex items-center gap-3 px-2.5 pt-2 text-fg">
          <Heart className="size-4" strokeWidth={1.6} />
          <MessageCircle className="size-4" strokeWidth={1.6} />
          <Send className="size-4" strokeWidth={1.6} />
          <Bookmark className="ml-auto size-4" strokeWidth={1.6} />
        </div>
        <p className="line-clamp-3 px-2.5 pb-2.5 pt-1.5 text-[11px] leading-snug">
          <span className="font-semibold">{handle}</span> {body}
        </p>
      </div>
    )
  }

  // Reel and story: full 9:16 screens.
  return (
    <div className={cn('relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-xl border border-line', className)}>
      <Framed m={first} placement={placement} aspect={9 / 16} />
      {placement === 'story' ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-linear-to-b from-black/55 to-transparent p-2">
            <div className="h-0.5 rounded-full bg-white/80" />
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-white">
              <span className="size-5 rounded-full bg-linear-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]" />
              {handle} <span className="font-normal text-white/70">now</span>
            </p>
          </div>
          {/* Where RepostSource::sticker draws them on the 1080 × 1920 frame: the line 520 px up, the credit 300 px up. */}
          {storyText?.trim() && (
            <p className="absolute inset-x-[10%] bottom-[27%] text-center">
              <span className="box-decoration-clone rounded-[3px] bg-white px-1.5 py-0.5 text-[12px] font-extrabold leading-[1.45] text-[#141414]">{storyText.trim()}</span>
            </p>
          )}
          {credit && (
            <p className="absolute inset-x-0 bottom-[15.6%] text-center">
              <span className="rounded-[3px] bg-black/55 px-1.5 py-0.5 text-[8px] font-semibold text-white">{credit}</span>
            </p>
          )}
          <div className="absolute inset-x-2.5 bottom-2.5 flex items-center gap-2">
            <span className="h-7 flex-1 rounded-full border border-white/50 px-3 text-[10px] leading-7 text-white/70">Send message</span>
            <Heart className="size-4 text-white" strokeWidth={1.8} />
            <Send className="size-4 text-white" strokeWidth={1.8} />
          </div>
        </>
      ) : (
        <>
          <div className="absolute bottom-16 right-2 flex flex-col items-center gap-3.5 text-white">
            <Heart className="size-[18px]" strokeWidth={1.8} />
            <MessageCircle className="size-[18px]" strokeWidth={1.8} />
            <Send className="size-[18px]" strokeWidth={1.8} />
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-2.5 pt-8 text-white">
            <p className="text-[11px] font-semibold">{handle}</p>
            <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-white/90">{body}</p>
          </div>
        </>
      )}
    </div>
  )
}

function RepostRow({ repost: r, i }: { repost: Repost; i: number }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { navigate } = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<Asset | null>(null)
  const file = useRef<HTMLInputElement>(null)
  // Once it's a post, the badge follows the post: posting, up, or failed on the phone.
  const status = (r.status === 'scheduled' && r.post_status && POST_STATUS[r.post_status]) || STATUS[r.status]
  const to = (r.account?.platform ?? other(r.source_platform)) as Net
  const toName = PLATFORMS[to].name
  const media: PreviewMedia[] = added ? [added] : r.media
  const needsMedia = to === 'instagram' && media.length === 0
  // Where it goes, picked on the preview: as the server would pick it until the person does.
  const [picked, setPlacement] = useState<Placement | null>(null)
  const saved = r.placement && PLACEMENTS[to].includes(r.placement) ? r.placement : null
  const placement = picked ?? saved ?? defaultPlacement(to, media)
  // A story's line, drawn on it: as saved, else the caption's first sentence.
  const [storyText, setStoryText] = useState(r.story_text ?? storyLine(r.caption))
  useEffect(() => setStoryText(r.story_text ?? storyLine(r.caption)), [r.story_text, r.caption])
  const credit = r.attribution && r.author ? `@${r.author} on ${PLATFORMS[r.source_platform].name}` : null

  const run = async (label: string, fn: () => Promise<unknown>, then: string) => {
    setBusy(label)
    try {
      await fn()
      invalidate()
      if (then) toast(then)
    } catch (e) {
      toast(errorOf(e, 'Something went wrong.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  // The caption and hashtags as edited here; the preview and the count follow them as they're typed.
  const savedTags = (r.hashtags ?? []).join(' ')
  const [caption, setCaption] = useState(r.caption ?? '')
  const [tags, setTags] = useState(tagText(r.hashtags))
  const [ask, setAsk] = useState('')
  // Each follows its own saved value, so saving one doesn't undo typing in the other.
  useEffect(() => setCaption(r.caption ?? ''), [r.caption])
  useEffect(() => setTags(tagText(r.hashtags)), [savedTags]) // eslint-disable-line react-hooks/exhaustive-deps
  const tagList = tags.split(/[\s,]+/).map((t) => t.replace(/^#+/, '')).filter(Boolean)
  const changed = caption.trim() !== (r.caption ?? '').trim() || tagList.join(' ') !== savedTags
  const body = [caption.trim(), r.attribution ? `Credit: @${r.author} on ${PLATFORMS[r.source_platform].name}` : '', tagList.map((t) => `#${t}`).join(' ')].filter(Boolean).join('\n\n')
  const save = () => api(`/reposts/${r.id}`, { method: 'PATCH', body: { caption: caption.trim(), hashtags: tagList } })
  const saveIfChanged = () => {
    if (changed && caption.trim()) void run('save', save, '')
  }
  const pick = (o: Repost['options'][number]) => {
    setCaption(o.caption)
    setTags(tagText(o.hashtags))
    void run('save', () => api(`/reposts/${r.id}`, { method: 'PATCH', body: { caption: o.caption, hashtags: o.hashtags } }), '')
  }
  const rewrite = () => {
    void run('adapt', () => api(`/reposts/${r.id}/adapt`, { method: 'POST', body: { placement, instruction: ask.trim() || undefined } }), 'Rewritten: three new takes.').then(() => setAsk(''))
  }

  // Up already: only the list entry goes (deleting here can't take it off the network). Booked: the post goes too.
  const live = r.post_status === 'published' || r.post_status === 'submitted'
  const remove = () => {
    const who = r.author ? `@${r.author}’s` : 'this'
    const ask = live
      ? `Remove ${who} repost from this list? The post stays on ${toName} and on the record.`
      : r.post_id
        ? `Delete ${who} repost and its post? It won’t go out.`
        : `Drop ${who} repost?`
    if (!window.confirm(ask)) return
    void run('delete', () => api(`/reposts/${r.id}`, { method: 'DELETE' }), live ? 'Removed from the list.' : r.post_id ? 'Deleted, with its post.' : '')
  }

  // Up already: one line, opened again on a click (nothing is left to do on it).
  const [open, setOpen] = useState(false)

  const upload = async (f: File) => {
    setBusy('upload')
    try {
      const [asset] = await uploadFiles<Asset[]>('/assets', [f])
      setAdded(asset)
    } catch (e) {
      toast(errorOf(e, 'Couldn’t upload it.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (live && !open) {
    const thumb = media[0]
    return (
      <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.02 }}>
        <article className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5">
          <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={false} title="Show the whole repost">
            <ChevronRight className="size-3.5 shrink-0 text-dim" strokeWidth={2} />
            {thumb && (
              <span className="size-8 shrink-0 overflow-hidden rounded-md border border-line bg-white/[0.03]">
                <img src={thumb.poster_url ?? thumb.url} alt="" className="size-full object-cover" loading="lazy" />
              </span>
            )}
            {/* The names keep their room; the caption takes what's left. */}
            <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-[12.5px]">
              <PlatformIcon id={r.source_platform} className="size-3.5 shrink-0" />
              <span className="max-w-[180px] truncate font-medium">{r.author ? `@${r.author}` : PLATFORMS[r.source_platform].name + ' post'}</span>
              <ArrowRight className="size-3 shrink-0 text-dim" strokeWidth={1.75} />
              <PlatformIcon id={to} className="size-3.5 shrink-0" />
              <span className="max-w-[180px] truncate text-muted">@{r.account?.handle}</span>
            </span>
            <span className={cn('shrink-0 rounded-full border px-2 py-px text-[10.5px]', status.cls)}>{status.label}</span>
            <span className="hidden min-w-0 flex-1 truncate text-[12px] text-dim md:block">{r.caption}</span>
          </button>
          {r.post_id && (
            <Btn size="sm" variant="subtle" onClick={() => navigate(`/dashboard/create?post=${r.post_id}`)}>
              Open the post
            </Btn>
          )}
          <span className="shrink-0 font-mono text-[10.5px] text-dim">{fmtRelative(r.created_at)}</span>
        </article>
      </motion.li>
    )
  }

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.02 }}>
      <article className="rounded-xl border border-line bg-panel p-4">
        {live && (
          <button type="button" onClick={() => setOpen(false)} className="mb-2 flex items-center gap-1 text-[11.5px] text-dim hover:text-fg" aria-expanded>
            <ChevronDown className="size-3.5" strokeWidth={2} /> Collapse
          </button>
        )}
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03]">
            <PlatformIcon id={r.source_platform} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <a href={r.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[13px] font-medium hover:underline">
                {r.author ? `@${r.author}` : PLATFORMS[r.source_platform].name + ' post'}
                <ExternalLink className="size-3 text-dim" strokeWidth={1.75} />
              </a>
              <span className="flex items-center gap-1 text-[11px] text-dim">
                <ArrowRight className="size-3" strokeWidth={1.75} />
                <PlatformIcon id={to} className="size-3" />@{r.account?.handle}
              </span>
              <span className={cn('flex items-center gap-1 rounded-full border px-2 py-px text-[10.5px]', status.cls)}>
                {(r.status === 'fetching' || r.status === 'adapting') && <Loader2 className="size-3 animate-spin" />}
                {status.label}
              </span>
              {r.attribution && r.status !== 'fetching' && r.status !== 'failed' && <span className="rounded-full border border-line-2 px-2 py-px text-[10.5px] text-muted">credited</span>}
            </div>

            {r.status === 'fetching' && (
              <p className="mt-1.5 text-[12.5px] text-dim">Reading the post’s text, photos and video…{r.placement ? ` Then it’s adapted as a ${PLACEMENT_LABEL[r.placement].toLowerCase()}.` : ''}</p>
            )}
            {r.status === 'adapting' && <p className="mt-1.5 text-[12.5px] text-dim">Writing three takes{r.placement ? ` for a ${PLACEMENT_LABEL[r.placement].toLowerCase()}` : ''}: it can take a minute or two.</p>}
            {r.status === 'failed' && <p className="mt-2 rounded-lg border border-fail/20 px-2.5 py-1.5 text-[11.5px] text-fail">{r.error}</p>}
            {r.status === 'captured' && r.error && <p className="mt-2 rounded-lg border border-warn/25 px-2.5 py-1.5 text-[11.5px] text-warn">{r.error} Adapt it again below.</p>}
            {r.source_text && <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-snug text-muted">{r.source_text}</p>}

            {media.length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto">
                {media.map((m) => (
                  <Thumb key={m.id} m={m} />
                ))}
              </div>
            )}

            {r.permission !== 'pending' && r.permission_note && (
              <p className={cn('mt-2 rounded-lg border px-2.5 py-1.5 text-[11.5px]', r.permission === 'allowed' ? 'border-ok/20 text-ok' : 'border-fail/20 text-fail')}>
                Reuse {r.permission}: {r.permission_note}
              </p>
            )}

            {r.status === 'adapted' && r.body && (
              <div className="mt-3 grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
                <div>
                  <PlacementChoice net={to} value={placement} onChange={setPlacement} hasVideo={media.some((m) => m.kind === 'video')} />
                  <RepostPreview net={to} placement={placement} media={media} body={body} handle={r.account?.handle ?? ''} storyText={storyText} credit={credit} className="mt-2.5" />
                </div>
                <div className="min-w-0 space-y-2.5">
                  {placement === 'story' && (
                    <label className="block rounded-lg border border-accent/30 bg-accent/[0.05] p-3">
                      <span className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-soft">
                        <span>Text on the story</span>
                        <span className={cn(storyText.length > 160 && 'text-fail')}>{storyText.length}/160</span>
                      </span>
                      <input
                        value={storyText}
                        onChange={(e) => setStoryText(e.target.value)}
                        onBlur={() => storyText !== (r.story_text ?? '') && void run('save', () => api(`/reposts/${r.id}`, { method: 'PATCH', body: { story_text: storyText.trim() || null } }), '')}
                        placeholder="A short line, drawn on the story"
                        maxLength={160}
                        className={cn(inputClass, 'mt-1.5')}
                      />
                      <span className="mt-1.5 block text-[11px] leading-snug text-dim">
                        Stories show no caption, so this line{credit ? ' and the credit tag' : ''} are drawn on the picture or video, as in the preview. Leave it empty for none. Emoji can’t be drawn.
                      </span>
                    </label>
                  )}
                  {r.options.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.options.map((o, n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => pick(o)}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                            o.caption === caption ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line-2 text-muted hover:text-fg',
                          )}
                        >
                          {ANGLE_LABEL[o.angle]}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="block">
                    <span className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
                      <span>{placement === 'story' ? 'Caption (kept on the record; stories don’t show it)' : `${toName} caption`}</span>
                      <span className={cn(body.length > LIMIT[to] && 'text-fail')}>
                        {body.length}/{LIMIT[to]}
                      </span>
                    </span>
                    <textarea value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={saveIfChanged} rows={6} className={cn(inputClass, 'mt-1.5 h-auto py-2 leading-snug')} />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Hashtags</span>
                    <input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={saveIfChanged} placeholder="#realmadrid #laliga" className={cn(inputClass, 'mt-1.5')} />
                  </label>
                  {r.attribution && (
                    <p className="text-[11.5px] text-dim">
                      Added after the caption: <span className="text-muted">Credit: @{r.author} on {PLATFORMS[r.source_platform].name}</span>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <input
                      value={ask}
                      onChange={(e) => setAsk(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && rewrite()}
                      placeholder="Ask for a rewrite: “in Darija”, “funnier”, “shorter”…"
                      className={cn(inputClass, 'min-w-0 flex-1')}
                    />
                    <Btn size="sm" icon={Sparkles} loading={busy === 'adapt'} onClick={rewrite}>
                      Rewrite for {PLACEMENT_LABEL[placement].toLowerCase()}
                    </Btn>
                  </div>
                  <p className="text-[11.5px] leading-snug text-dim">{PLACEMENT_NOTE[placement]}</p>
                </div>
              </div>
            )}

            {r.status !== 'adapted' && r.body && (
              <div className="mt-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
                <p className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
                  <span>{toName} post</span>
                  <span className={cn(r.body.length > LIMIT[to] && 'text-fail')}>
                    {r.body.length}/{LIMIT[to]}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-snug">{r.body}</p>
              </div>
            )}

            {r.status === 'adapted' && needsMedia && (
              <p className="mt-2 rounded-lg border border-plan/25 px-2.5 py-1.5 text-[11.5px] text-plan">Instagram needs a photo or video, and this post had none. Add one to schedule it.</p>
            )}

            {r.account && !r.account.posts_from_phone && ['captured', 'adapted', 'scheduled'].includes(r.status) && (
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 rounded-lg border border-warn/25 px-2.5 py-1.5 text-[11.5px] text-warn">
                {r.account.phone === 'automation_off' ? `@${r.account.handle}’s phone is linked, but automation is off` : `@${r.account.handle} has no phone`}, so{' '}
                {r.status === 'scheduled' ? 'this post waits and never goes out by itself' : 'it won’t go out by itself once scheduled'}.
                <button type="button" onClick={() => navigate('/dashboard/accounts')} className="underline underline-offset-2 hover:text-fg">
                  {r.account.phone === 'automation_off' ? 'Turn automation on' : 'Link a phone'}
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {r.status === 'failed' && (
            <Btn size="sm" icon={RefreshCw} loading={busy === 'fetch'} onClick={() => run('fetch', () => api(`/reposts/${r.id}/fetch`, { method: 'POST' }), 'Reading it again…')}>
              Try again
            </Btn>
          )}
          {/* Adapting it is allowing its reuse: the server records that as the person's. */}
          {r.status === 'captured' && r.permission !== 'denied' && (
            <Btn size="sm" variant="primary" icon={Sparkles} loading={busy === 'adapt'} onClick={() => run('adapt', () => api(`/reposts/${r.id}/adapt`, { method: 'POST', body: { placement } }), 'Adapted: three takes to pick from. Review it, then schedule it.')}>
              Adapt for {toName}
            </Btn>
          )}
          {r.status === 'adapted' && to === 'instagram' && (
            <>
              <input ref={file} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Btn size="sm" variant={needsMedia ? 'primary' : undefined} icon={ImagePlus} loading={busy === 'upload'} onClick={() => file.current?.click()}>
                {needsMedia ? 'Add a photo or video' : 'Replace media'}
              </Btn>
            </>
          )}
          {r.status === 'adapted' && (
            <Btn
              size="sm"
              variant="primary"
              icon={CalendarClock}
              disabled={needsMedia}
              loading={busy === 'schedule'}
              onClick={() =>
                run(
                  'schedule',
                  async () => {
                    if (changed) await save()
                    await api(`/reposts/${r.id}/schedule`, {
                      method: 'POST',
                      body: { placement, ...(placement === 'story' ? { story_text: storyText.trim() || null } : {}), ...(added ? { asset_ids: [added.id] } : {}) },
                    })
                  },
                  `Scheduled as ${PLACEMENT_LABEL[placement].toLowerCase()}. The phone posts it at its time.`,
                )
              }
            >
              Approve & schedule
            </Btn>
          )}
          {r.status === 'scheduled' && r.post_id && (
            <Btn size="sm" onClick={() => navigate(`/dashboard/create?post=${r.post_id}`)}>Open the post</Btn>
          )}
          {r.post_status !== 'publishing' && (
            <Btn size="sm" variant="subtle" icon={Trash2} onClick={remove} loading={busy === 'delete'}>
              {live ? 'Remove from list' : r.post_id ? 'Delete post' : 'Drop'}
            </Btn>
          )}
          <span className="ml-auto font-mono text-[10.5px] text-dim">{fmtRelative(r.created_at)}</span>
        </div>
      </article>

    </motion.li>
  )
}

/**
 * Pick a post by its link: read in the background (or pasted by hand when it's private), and, when it says
 * where it goes, adapted for that right after, so it shows here ready to review.
 */
function Capture({ open, accounts, onClose }: { open: boolean; accounts: Account[]; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [accountId, setAccountId] = useState<number | ''>('')
  const [url, setUrl] = useState('')
  const [placement, setPlacement] = useState<Placement | 'later'>('later')
  const [manual, setManual] = useState(false)
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const from = networkOf(url)
  const to = from ? other(from) : null
  const choices = to ? accounts.filter((a) => a.platform === to) : accounts
  // The account the phone posts from comes first, when nobody picked one.
  const target = choices.find((a) => a.id === accountId) ?? choices.find((a) => a.device_id && a.automation) ?? choices[0]
  const as = placement === 'later' ? null : PLACEMENT_LABEL[placement].toLowerCase()
  useEffect(() => setPlacement('later'), [to])

  const close = () => {
    setUrl('')
    setAuthor('')
    setText('')
    setManual(false)
    setPlacement('later')
    setErrors({})
    onClose()
  }

  const paste = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim()
      if (clip) setUrl(clip)
    } catch {
      toast('The browser didn’t let us read the clipboard: paste it with Ctrl+V.', 'error')
    }
  }

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      await api('/reposts', {
        method: 'POST',
        body: {
          account_id: target?.id,
          source_url: url.trim(),
          ...(placement !== 'later' ? { placement } : {}),
          ...(manual ? { author: author.replace(/^@/, ''), source_text: text } : {}),
        },
      })
      invalidate()
      toast(as ? `Picked. ${manual ? 'Adapting' : 'Reading it, then adapting'} it as a ${as}: it shows here when it’s ready.` : manual ? 'Picked. Adapt it when you’re ready.' : 'Picked. Reading the post…')
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k, e.field(k) ?? e.message])))
      else toast(e instanceof Error ? e.message : 'Couldn’t pick it.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="New repost">
      <div className="space-y-5">
        <div>
          <Label>Link to the post</Label>
          <div className="mt-2 flex gap-1.5">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/someone/status/…" className={cn(inputClass, 'min-w-0 flex-1')} autoFocus />
            <Btn size="sm" icon={ClipboardPaste} onClick={paste} className="h-auto shrink-0">
              Paste
            </Btn>
          </div>
          <FieldError message={errors.source_url} />
          {from && to ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
              <PlatformIcon id={from} className="size-3" />
              {PLATFORMS[from].name} post
              <ArrowRight className="size-3" strokeWidth={1.75} />
              <PlatformIcon id={to} className="size-3" />
              reposted on {PLATFORMS[to].name}
            </p>
          ) : (
            <p className="mt-2 text-[11.5px] text-dim">{url.trim() ? 'That isn’t a link to one post yet.' : 'A post on X (x.com/…/status/…) or Instagram (instagram.com/p/… or /reel/…).'}</p>
          )}
        </div>

        <div>
          <Label>To account</Label>
          {choices.length === 0 ? (
            <p className="mt-2 text-[12px] text-dim">{to ? `Add an ${PLATFORMS[to].name} account first.` : 'No accounts yet.'}</p>
          ) : (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {choices.map((a) => {
                const state = !a.device_id ? 'none' : a.automation ? 'ready' : 'automation_off'
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAccountId(a.id)}
                    className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors', target?.id === a.id ? 'border-accent/50 bg-accent/[0.07]' : 'border-line hover:border-line-2')}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-2 bg-white/[0.03]">
                      <PlatformIcon id={a.platform} className="size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">@{a.handle}</span>
                      <span className={cn('flex items-center gap-1 text-[11px]', state === 'ready' ? 'text-ok' : state === 'automation_off' ? 'text-warn' : 'text-dim')}>
                        <span className={cn('size-1.5 rounded-full', state === 'ready' ? 'bg-ok' : state === 'automation_off' ? 'bg-warn' : 'bg-white/25')} />
                        {state === 'ready' ? `Posts from ${a.device?.name ?? 'its phone'}` : state === 'automation_off' ? 'Phone linked, automation off' : 'No phone: won’t post by itself'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <FieldError message={errors.account_id} />
        </div>

        {to && (
          <div>
            <Label>Post it as</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['later', ...PLACEMENTS[to]] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlacement(p)}
                  className={cn('h-8 rounded-md border px-3 text-[12px] font-medium transition-colors', placement === p ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line-2 text-muted hover:text-fg')}
                >
                  {p === 'later' ? 'Choose later' : PLACEMENT_LABEL[p]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-dim">
              {as ? `It’s read and adapted as a ${as} in one go; you review it before anything is booked.` : 'Read it first, then pick Post, Reel or Story on its preview.'}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
          <div>
            <p className="text-[13px] font-medium">Paste the text myself</p>
            <p className="text-[11.5px] text-dim">For a private post we can’t read. Its media won’t come along; add some before scheduling.</p>
          </div>
          <Toggle on={manual} onChange={setManual} label="Paste the text myself" />
        </div>
        {manual && (
          <>
            <label className="block">
              <Label>Author’s handle</Label>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="@someone" className={cn(inputClass, 'mt-2')} />
              <FieldError message={errors.author} />
            </label>
            <label className="block">
              <Label>The post’s text</Label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste the post here — the AI adapts this." className={cn(inputClass, 'mt-2 h-auto py-2 leading-snug')} />
              <FieldError message={errors.source_text} />
            </label>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Btn variant="subtle" onClick={close}>
            Cancel
          </Btn>
          <Btn variant="primary" icon={as ? Sparkles : undefined} onClick={save} loading={saving} disabled={!from || !target || (manual && (!author.trim() || !text.trim()))}>
            {as ? `${manual ? 'Adapt' : 'Read & adapt'} as ${as}` : manual ? 'Pick it' : 'Read the post'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
