import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Check, CircleAlert, Clapperboard, LoaderCircle, RotateCcw } from 'lucide-react'
import { api, ApiError, type Account, type Asset, type Campaign, type CampaignItem } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { AssetModal, MediaThumb } from '../media/Media'
import { useToast } from '../toast'
import { Btn, Label, Panel, Skeleton } from '../ui'
import { AccountChips, AgentTimeline, FORMAT_ICON, FORMAT_LABEL, Pill } from './shared'

const ITEM_STATE = {
  planned: { tone: 'dim', label: 'Waiting' },
  producing: { tone: 'accent', label: 'Being made' },
  needs_media: { tone: 'warn', label: 'Needs media' },
  ready: { tone: 'ok', label: 'Ready' },
  failed: { tone: 'fail', label: 'Failed' },
} as const

const SHOT_STATE = {
  planned: { tone: 'dim', label: 'Waiting' },
  still: { tone: 'accent', label: 'Drawing the frame' },
  moving: { tone: 'accent', label: 'Making it move' },
  done: { tone: 'ok', label: 'Done' },
  failed: { tone: 'fail', label: 'Failed' },
} as const

/**
 * Production: the content being made from the plan and the brief, as it happens. Nothing to
 * approve here — the writer, visual director and media team work, and this is the window onto
 * it. It polls while anything is generating (see `useCampaign`), so stills and clips turn up
 * on their own and a long video doesn't look like a hang.
 */
export function ProductionTab({
  campaign,
  items,
  accounts,
  reload,
  busy,
  onReview,
}: {
  campaign: Campaign
  items: CampaignItem[] | null
  accounts: Account[]
  reload: () => Promise<void>
  busy: boolean
  onReview: () => void
}) {
  const toast = useToast()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [resuming, setResuming] = useState(false)
  const producing = campaign.stage === 'producing' || campaign.stage === 'adapting'
  const ready = items?.filter((i) => i.status === 'ready').length ?? 0
  const failed = items?.filter((i) => i.status === 'failed' || i.status === 'needs_media') ?? []
  const made = items?.reduce((n, i) => n + i.assets.length + i.shots.filter((s) => s.clip).length, 0) ?? 0

  const resume = async () => {
    setResuming(true)
    try {
      await api(`/campaigns/${campaign.id}/resume`, { method: 'POST' })
      toast('Picking up where it stopped.')
      await reload()
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t resume production.', 'error')
    } finally {
      setResuming(false)
    }
  }

  if (!items) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[180px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[260px] rounded-xl" />
      </div>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>
            {ready} of {items.length} ready
          </Label>
          <span className="font-mono text-[10.5px] text-dim">
            {made} {made === 1 ? 'file' : 'files'} made
          </span>
        </div>

        {items.map((item, i) => (
          <ItemCard key={item.id} item={item} index={i} campaign={campaign} accounts={accounts} onAsset={setAsset} onChanged={reload} />
        ))}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20">
        <Panel
          title="Production"
          sub={producing ? 'The team is working from the approved plan.' : 'Everything the plan asked for is made.'}
        >
          {producing ? (
            <p className="flex items-center gap-2 text-[12.5px] text-accent-soft">
              <LoaderCircle className="size-3.5 animate-spin" />
              {campaign.stage === 'adapting' ? 'Adapting each post to its account…' : 'Writing captions and making the media…'}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] text-ok">
              <Check className="size-4" strokeWidth={2} />
              Finished. {items.length} {items.length === 1 ? 'post' : 'posts'} to look at.
            </p>
          )}

          {failed.length > 0 && (
            <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-warn">
              <CircleAlert className="size-3.5 shrink-0 translate-y-px" strokeWidth={2} />
              {failed.length} {failed.length === 1 ? 'post' : 'posts'} didn’t finish. Resume to try the missing pieces again, or review what is done and drop the rest.
            </p>
          )}

          <div className="mt-4 space-y-2">
            {campaign.stage === 'content_review' && (
              <Btn variant="primary" icon={ArrowRight} onClick={onReview} className="w-full">
                Review the content
              </Btn>
            )}
            {(failed.length > 0 || (producing && !busy)) && (
              <Btn icon={RotateCcw} onClick={resume} loading={resuming} className="w-full">
                Resume production
              </Btn>
            )}
          </div>
        </Panel>

        <Panel title="The team">
          <AgentTimeline steps={campaign.steps} working={producing ? 'Working…' : null} />
        </Panel>
      </div>

      <AssetModal asset={asset} onClose={() => setAsset(null)} />
    </div>
  )
}

function ItemCard({
  item,
  index,
  campaign,
  accounts,
  onAsset,
  onChanged,
}: {
  item: CampaignItem
  index: number
  campaign: Campaign
  accounts: Account[]
  onAsset: (a: Asset) => void
  onChanged: () => Promise<void>
}) {
  const toast = useToast()
  const [redoing, setRedoing] = useState<number | null>(null)
  const Icon = FORMAT_ICON[item.format]
  const state = ITEM_STATE[item.status]
  const working = item.status === 'producing' || item.generating > 0
  const voices = item.variants.length

  const redoShot = async (n: number) => {
    setRedoing(n)
    try {
      await api(`/campaigns/${campaign.id}/items/${item.id}/shots/${n}`, { method: 'POST', body: {} })
      await onChanged()
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t make that shot again.', 'error')
    } finally {
      setRedoing(null)
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease, delay: Math.min(index, 10) * 0.04 }}
      className={cn('relative overflow-hidden rounded-xl border bg-panel p-4 md:p-5', working ? 'border-accent/40' : 'border-line')}
    >
      {working && (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-soft to-transparent"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
        />
      )}

      <header className="flex items-start gap-3">
        <span className="font-mono text-[11px] tabular-nums text-dim">{String(index + 1).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium tracking-[-0.01em]">{item.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-dim">
            <span className="inline-flex items-center gap-1">
              <Icon className="size-3.5" strokeWidth={1.75} />
              {FORMAT_LABEL[item.format]}
            </span>
            {item.pillar && <span>· {item.pillar}</span>}
            {voices > 0 && (
              <span>
                · {voices} {voices === 1 ? 'version' : 'versions'}
              </span>
            )}
          </p>
        </div>
        <Pill tone={state.tone}>
          {working && <LoaderCircle className="size-3 animate-spin" />}
          {working && item.generating > 0 ? `${state.label} · ${item.generating}` : state.label}
        </Pill>
      </header>

      {item.caption ? (
        <p className="mt-4 whitespace-pre-wrap text-[12.5px] leading-snug text-muted [overflow-wrap:anywhere]">{item.caption}</p>
      ) : item.format !== 'text' ? (
        <div className="mt-4 space-y-2" aria-hidden>
          {[88, 64].map((w) => (
            <div key={w} className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : null}

      {item.error && <p className="mt-3 font-mono text-[11px] leading-snug text-fail">{item.error}</p>}

      {item.assets.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.assets.map((a) => (
            <button key={a.id} type="button" onClick={() => onAsset(a)} className="group/thumb w-[104px] shrink-0 text-left" title={a.name ?? 'Open'}>
              <MediaThumb asset={a} className="aspect-[4/5] w-full rounded-lg transition-opacity group-hover/thumb:opacity-80" />
            </button>
          ))}
        </div>
      )}

      {item.shots.length > 0 && (
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {item.shots.map((s) => {
            const shot = SHOT_STATE[s.status]
            const preview = s.clip ?? s.still
            return (
              <li key={s.n} className={cn('overflow-hidden rounded-lg border', s.status === 'failed' ? 'border-fail/40' : 'border-line')}>
                {preview ? (
                  <button type="button" onClick={() => onAsset(preview)} className="block w-full" title={`Shot ${s.n + 1}`}>
                    <MediaThumb asset={preview} className="aspect-video w-full" />
                  </button>
                ) : (
                  <div className="skeleton aspect-video w-full" aria-hidden />
                )}
                <div className="px-3 py-2 text-[11.5px]">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
                    <Clapperboard className="size-3" strokeWidth={1.75} />
                    Shot {s.n + 1} · {s.duration} s · {s.camera}
                  </span>
                  <span className="mt-1 block leading-snug text-muted">{s.description}</span>
                  <span className="mt-2 flex items-center justify-between gap-2">
                    <Pill tone={shot.tone}>
                      {(s.status === 'still' || s.status === 'moving') && <LoaderCircle className="size-3 animate-spin" />}
                      {shot.label}
                    </Pill>
                    {(s.status === 'done' || s.status === 'failed') && (
                      <Btn size="sm" variant="subtle" icon={RotateCcw} loading={redoing === s.n} onClick={() => redoShot(s.n)} aria-label={`Make shot ${s.n + 1} again`} />
                    )}
                  </span>
                  {s.error && <span className="mt-1 block font-mono text-[10px] leading-snug text-fail">{s.error}</span>}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <AccountChips ids={item.account_ids} accounts={accounts} className="mt-4" />
    </motion.article>
  )
}
