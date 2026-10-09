import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clapperboard,
  Heart,
  LoaderCircle,
  PenLine,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { PlatformIcon, PLATFORMS, type PlatformId } from '../../components/ui/PlatformIcon'
import { api, ApiError, type Account, type Asset, type Campaign, type CampaignItem, type ItemVariant } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi } from '../data'
import { AssetModal, MediaThumb } from '../media/Media'
import { useToast } from '../toast'
import { Btn, FieldError, inputClass, Label, Modal, Panel, Skeleton } from '../ui'
import { FORMAT_ICON, FORMAT_LABEL, Pill } from './shared'

type Specs = Record<PlatformId, Record<string, { label: string }>>

const CHECK_ICON = { pass: Check, warn: TriangleAlert, fail: CircleAlert }
const CHECK_TONE = { pass: 'text-ok', warn: 'text-warn', fail: 'text-fail' }

const say = (e: unknown, fallback: string) => (e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : fallback)

/**
 * Gate 6B: the finished content, one card per post. Watch the video, read each account's
 * caption, then keep it, edit it, send it back to be rewritten, or delete the post outright.
 * Nothing reaches the calendar until a person has approved it here.
 */
export function ReviewTab({
  campaign,
  items,
  accounts,
  reload,
  onItems,
  onSchedule,
}: {
  campaign: Campaign
  items: CampaignItem[] | null
  accounts: Account[]
  reload: () => Promise<void>
  onItems: (i: CampaignItem[]) => void
  onSchedule: () => void
}) {
  const toast = useToast()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const variants = (items ?? []).flatMap((i) => i.variants)
  const approved = variants.filter((v) => v.status === 'approved').length
  const waiting = variants.filter((v) => v.status === 'draft')
  const readyToApprove = waiting.filter((v) => (v.checks?.ok ?? false) && v.qa?.status !== 'fail').length

  const approveAll = async () => {
    setApprovingAll(true)
    try {
      const { approved: n } = await api<{ approved: number }>(`/campaigns/${campaign.id}/variants/approve-all`, { method: 'POST' })
      await reload()
      toast(n ? `${n} ${n === 1 ? 'version' : 'versions'} approved.` : 'Nothing passed its checks yet, so nothing was approved.', n ? 'success' : 'error')
    } catch (e) {
      toast(say(e, 'Couldn’t approve them.'), 'error')
    } finally {
      setApprovingAll(false)
    }
  }

  if (!items) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[320px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[260px] rounded-xl" />
      </div>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {/* Planned before an account was connected: the content exists, but nobody's version of it does. */}
        {items.length > 0 && variants.length === 0 ? <NoAccounts campaign={campaign} accounts={accounts} onDone={reload} /> : (
          <Label>
            {approved} of {variants.length} approved
          </Label>
        )}

        {items.map((item, i) => (
          <ItemReview
            key={item.id}
            item={item}
            index={i}
            campaign={campaign}
            accounts={accounts}
            onAsset={setAsset}
            onChanged={reload}
            onDeleted={() => onItems(items.filter((x) => x.id !== item.id))}
          />
        ))}

        {items.length === 0 && <p className="rounded-xl border border-line bg-panel p-6 text-center text-[13px] text-dim">Every post was deleted. Plan the campaign again to make more.</p>}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20">
        <Panel title="Gate 6B" sub="Nothing is scheduled until a person approves it.">
          {waiting.length > 0 ? (
            <>
              <p className="text-[12.5px] leading-snug text-muted">
                {waiting.length} {waiting.length === 1 ? 'version is' : 'versions are'} waiting on you.
                {readyToApprove > 0
                  ? ` ${readyToApprove} ${readyToApprove === 1 ? 'passes' : 'pass'} every check and can go in one click.`
                  : ' None of them pass their checks yet — edit or send back the ones with problems.'}
              </p>
              <Btn variant="primary" icon={ShieldCheck} onClick={approveAll} loading={approvingAll} disabled={!readyToApprove} className="mt-4 w-full">
                Approve the {readyToApprove} that pass
              </Btn>
            </>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] text-ok">
              <Check className="size-4" strokeWidth={2} />
              Everything is approved.
            </p>
          )}

          <Btn variant={waiting.length ? 'ghost' : 'primary'} icon={ArrowRight} onClick={onSchedule} disabled={!approved} className="mt-2 w-full">
            Pick the posting times
          </Btn>
          {!approved && <p className="mt-2 text-[11.5px] text-dim">Approve at least one version to put it on the calendar.</p>}
        </Panel>

        <Panel title="How it works">
          <ul className="space-y-2 text-[12px] leading-snug text-muted">
            <li>
              <span className="text-fg">Approve</span> keeps it as written.
            </li>
            <li>
              <span className="text-fg">Edit</span> is your own wording, checked again as you save.
            </li>
            <li>
              <span className="text-fg">Send back</span> has the adapter rewrite it to fix what your note says.
            </li>
            <li>
              <span className="text-fg">More like this</span> is remembered, so the account’s next captions sound like it.
            </li>
          </ul>
        </Panel>
      </div>

      <AssetModal asset={asset} onClose={() => setAsset(null)} />
    </div>
  )
}

/**
 * The campaign was planned before an account was connected, so the content got made but the
 * adapter had nobody to write it for. Connect one and it writes the captions now.
 */
function NoAccounts({ campaign, accounts, onDone }: { campaign: Campaign; accounts: Account[]; onDone: () => Promise<void> }) {
  const toast = useToast()
  const { navigate } = useRouter()
  const [busy, setBusy] = useState(false)
  const picked = accounts.filter((a) => campaign.account_ids.includes(a.id))
  const usable = picked.length ? picked : accounts

  const write = async () => {
    setBusy(true)
    try {
      if (!campaign.account_ids.length) {
        await api(`/campaigns/${campaign.id}`, { method: 'PATCH', body: { account_ids: usable.map((a) => a.id) } })
      }
      await api(`/campaigns/${campaign.id}/resume`, { method: 'POST' })
      await onDone()
      toast('Writing each account’s version now.')
    } catch (e) {
      toast(say(e, 'Couldn’t write the captions.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="The content is made" sub="It was planned before an account was connected, so there are no captions to approve yet.">
      {usable.length ? (
        <>
          <p className="text-[12.5px] leading-snug text-muted">
            Writing for {usable.map((a) => `@${a.handle}`).join(', ')}. Each account gets its own version, in its own voice.
          </p>
          <Btn variant="primary" icon={PenLine} onClick={write} loading={busy} className="mt-4">
            Write the captions
          </Btn>
        </>
      ) : (
        <>
          <p className="text-[12.5px] leading-snug text-muted">Connect the account this goes to, and the adapter writes a version for it.</p>
          <Btn variant="primary" icon={ArrowRight} onClick={() => navigate('/dashboard/accounts')} className="mt-4">
            Add an account
          </Btn>
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* One post                                                             */
/* ------------------------------------------------------------------ */

function ItemReview({
  item,
  index,
  campaign,
  accounts,
  onAsset,
  onChanged,
  onDeleted,
}: {
  item: CampaignItem
  index: number
  campaign: Campaign
  accounts: Account[]
  onAsset: (a: Asset) => void
  onChanged: () => Promise<void>
  onDeleted: () => void
}) {
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [redoing, setRedoing] = useState<number | null>(null)
  const Icon = FORMAT_ICON[item.format]
  const clips = item.shots.map((s) => s.clip).filter((a): a is Asset => !!a)
  const videos = [...item.assets.filter((a) => a.kind === 'video'), ...clips]
  const images = item.assets.filter((a) => a.kind === 'image')

  const remove = async () => {
    setDeleting(true)
    try {
      await api(`/campaigns/${campaign.id}/items/${item.id}`, { method: 'DELETE' })
      onDeleted()
      toast(`“${item.title}” deleted.`)
    } catch (e) {
      toast(say(e, 'Couldn’t delete it.'), 'error')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const redoShot = async (n: number) => {
    setRedoing(n)
    try {
      await api(`/campaigns/${campaign.id}/items/${item.id}/shots/${n}`, { method: 'POST', body: {} })
      await onChanged()
      toast('Making that shot again.')
    } catch (e) {
      toast(say(e, 'Couldn’t make that shot again.'), 'error')
    } finally {
      setRedoing(null)
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease, delay: Math.min(index, 8) * 0.04 }}
      className="overflow-hidden rounded-xl border border-line bg-panel"
    >
      <header className="flex items-start gap-3 border-b border-line p-4 md:px-5">
        <span className="font-mono text-[11px] tabular-nums text-dim">{String(index + 1).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium tracking-[-0.01em]">{item.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-dim">
            <span className="inline-flex items-center gap-1">
              <Icon className="size-3.5" strokeWidth={1.75} />
              {FORMAT_LABEL[item.format]}
            </span>
            {item.pillar && <span>· {item.pillar}</span>}
            {item.generating > 0 && (
              <span className="inline-flex items-center gap-1 text-accent-soft">
                <LoaderCircle className="size-3 animate-spin" />
                {item.generating} still being made
              </span>
            )}
          </p>
        </div>
        <Btn variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label={`Delete “${item.title}”`} />
      </header>

      {/* The media, big enough to judge: video plays here rather than in a thumbnail. */}
      {(videos.length > 0 || images.length > 0) && (
        <div className="border-b border-line p-4 md:px-5">
          {videos.length > 0 && (
            <div className={cn('grid gap-3', videos.length > 1 && 'sm:grid-cols-2')}>
              {videos.map((v) => (
                <video
                  key={v.id}
                  src={v.url}
                  poster={v.poster_url ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-[420px] w-full rounded-lg bg-black object-contain"
                />
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className={cn('flex flex-wrap gap-2', videos.length > 0 && 'mt-3')}>
              {images.map((a) => (
                <button key={a.id} type="button" onClick={() => onAsset(a)} className="group/thumb w-[120px] shrink-0" title={a.name ?? 'Open'}>
                  <MediaThumb asset={a} className="aspect-[4/5] w-full rounded-lg transition-opacity group-hover/thumb:opacity-80" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shot by shot, so a video can be fixed a piece at a time instead of all over again. */}
      {item.shots.length > 0 && (
        <details className="group border-b border-line">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-[12px] text-muted hover:text-fg md:px-5">
            <Clapperboard className="size-3.5" strokeWidth={1.75} />
            {item.shots.length} shots
            <span className="ml-auto font-mono text-[10px] text-dim group-open:hidden">Show</span>
            <span className="ml-auto hidden font-mono text-[10px] text-dim group-open:inline">Hide</span>
          </summary>
          <ol className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3 md:px-5">
            {item.shots.map((s) => (
              <li key={s.n} className={cn('rounded-lg border px-3 py-2 text-[11.5px]', s.status === 'failed' ? 'border-fail/40' : 'border-line')}>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
                  Shot {s.n + 1} · {s.duration} s · {s.camera}
                </span>
                <span className="mt-1 block leading-snug text-muted">{s.description}</span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  {s.error ? <span className="font-mono text-[10px] text-fail">{s.error}</span> : <span className="font-mono text-[10px] text-dim">{s.status}</span>}
                  <Btn size="sm" variant="subtle" icon={RotateCcw} loading={redoing === s.n} onClick={() => redoShot(s.n)} aria-label={`Make shot ${s.n + 1} again`} />
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="divide-y divide-line">
        {item.variants.map((v) => (
          <VariantRow key={v.id} variant={v} item={item} campaign={campaign} onChanged={onChanged} />
        ))}
        {item.variants.length === 0 && (
          <p className="p-4 text-[12.5px] text-dim md:px-5">
            No account versions yet. {accounts.length ? 'Resume production to have the adapter write them.' : 'Add the accounts you post to first.'}
          </p>
        )}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete “${item.title}”?`}>
        <p className="text-[13px] leading-snug text-muted">
          The post goes, along with every account version of it{videos.length > 0 ? ' and the video made for it' : item.assets.length > 0 ? ' and the media made for it' : ''}. The rest of the campaign is untouched. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="subtle" onClick={() => setConfirmDelete(false)}>
            Keep it
          </Btn>
          <Btn variant="danger" icon={Trash2} loading={deleting} onClick={remove}>
            Delete the post
          </Btn>
        </div>
      </Modal>
    </motion.article>
  )
}

/* ------------------------------------------------------------------ */
/* One account's version                                                */
/* ------------------------------------------------------------------ */

function VariantRow({ variant, item, campaign, onChanged }: { variant: ItemVariant; item: CampaignItem; campaign: Campaign; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const { data: specs } = useApi<Specs>('/platform-specs')
  const [editing, setEditing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [caption, setCaption] = useState(variant.caption ?? '')
  const [placement, setPlacement] = useState(variant.placement ?? '')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const placements = specs?.[variant.account.platform] ?? {}
  const approved = variant.status === 'approved'
  const rejected = variant.status === 'rejected'
  const problems = (variant.checks?.checks ?? []).filter((c) => c.status !== 'pass')
  const blocked = !(variant.checks?.ok ?? false)

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await onChanged()
      if (done) toast(done)
      return true
    } catch (e) {
      setError(say(e, 'That didn’t work. Try again.'))
      return false
    } finally {
      setBusy(null)
    }
  }

  const approve = () => run('Approving…', () => api(`/campaigns/${campaign.id}/variants/${variant.id}/approve`, { method: 'POST' }))

  const save = async () => {
    const ok = await run('Saving…', () =>
      api(`/campaigns/${campaign.id}/variants/${variant.id}`, { method: 'PATCH', body: { caption, placement: placement || null } }),
    )
    if (ok) setEditing(false)
  }

  const reject = async () => {
    const ok = await run('Sending it back…', () => api(`/campaigns/${campaign.id}/variants/${variant.id}/reject`, { method: 'POST', body: { feedback } }), 'Sent back. The adapter is rewriting it.')
    if (ok) {
      setRejecting(false)
      setFeedback('')
    }
  }

  const like = () => run('Noting…', () => api(`/campaigns/${campaign.id}/variants/${variant.id}/like`, { method: 'POST' }), 'Noted. The account’s next captions will sound more like this.')

  return (
    <div className={cn('p-4 md:px-5', approved && 'bg-ok/[0.04]')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <PlatformIcon id={variant.account.platform} className="size-3.5" />@{variant.account.handle}
        </span>
        {placements[variant.placement ?? ''] && (
          <span className="font-mono text-[10px] text-dim">
            {PLATFORMS[variant.account.platform].name} {placements[variant.placement ?? ''].label.toLowerCase()}
          </span>
        )}
        {variant.mode === 'adapted' && <Pill tone="dim">Rewritten for this account</Pill>}
        {variant.checks?.moved_from && <Pill tone="warn">Moved from {variant.checks.moved_from}</Pill>}
        {variant.qa && variant.qa.status !== 'pass' && <Pill tone={variant.qa.status === 'fail' ? 'fail' : 'warn'}>QA {variant.qa.status}</Pill>}
        {variant.qa?.edited && <Pill tone="dim">QA tidied it</Pill>}
        <span className="ml-auto">
          {approved ? (
            <Pill tone="ok">
              <Check className="size-3" strokeWidth={2.5} />
              Approved {variant.approved_at ? fmtRelative(variant.approved_at) : ''}
            </Pill>
          ) : rejected ? (
            <Pill tone="warn">
              <LoaderCircle className="size-3 animate-spin" />
              Being rewritten
            </Pill>
          ) : (
            <Pill tone={blocked ? 'fail' : 'accent'}>{blocked ? 'Needs work' : 'Waiting on you'}</Pill>
          )}
        </span>
      </div>

      {editing ? (
        <div className="mt-3">
          <label className="block">
            <Label>Caption</Label>
            <textarea
              rows={6}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className={cn(inputClass, 'mt-2 h-auto resize-y py-2 leading-snug')}
              aria-label={`Caption for @${variant.account.handle}`}
            />
          </label>
          {Object.keys(placements).length > 1 && (
            <label className="mt-3 block">
              <Label>Posted as</Label>
              <select value={placement} onChange={(e) => setPlacement(e.target.value)} className={cn(inputClass, 'mt-2 [color-scheme:dark]')}>
                {Object.entries(placements).map(([id, p]) => (
                  <option key={id} value={id}>
                    {PLATFORMS[variant.account.platform].name} {p.label.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Btn
              variant="subtle"
              onClick={() => {
                setEditing(false)
                setCaption(variant.caption ?? '')
                setPlacement(variant.placement ?? '')
                setError(null)
              }}
            >
              Cancel
            </Btn>
            <Btn variant="primary" icon={Check} loading={busy === 'Saving…'} onClick={save} disabled={!caption.trim()}>
              Save the caption
            </Btn>
          </div>
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-snug text-fg [overflow-wrap:anywhere]">{variant.caption || <span className="text-dim">No caption yet.</span>}</p>
      )}

      {!editing && problems.length > 0 && (
        <ul className="mt-3 space-y-1">
          {problems.map((c) => {
            const CheckIcon = CHECK_ICON[c.status]
            return (
              <li key={c.key} className="flex gap-2 text-[11.5px] leading-snug text-muted">
                <CheckIcon className={cn('mt-px size-3 shrink-0', CHECK_TONE[c.status])} strokeWidth={2} />
                <span>{c.detail}</span>
              </li>
            )
          })}
        </ul>
      )}

      {!editing && variant.qa && variant.qa.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {variant.qa.issues.map((issue, i) => (
            <li key={i} className="flex gap-2 text-[11.5px] leading-snug text-muted">
              <ShieldCheck className="mt-px size-3 shrink-0 text-warn" strokeWidth={2} />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}

      {rejected && variant.feedback && <p className="mt-2 text-[11.5px] leading-snug text-dim">Your note: “{variant.feedback}”</p>}

      {rejecting && (
        <div className="mt-3 rounded-lg border border-line-2 p-3">
          <label className="block">
            <Label>What’s wrong with it?</Label>
            <textarea
              rows={2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Too salesy, and the price is wrong — it’s £24."
              className={cn(inputClass, 'mt-2 h-auto resize-none py-2 leading-snug')}
            />
          </label>
          <p className="mt-2 text-[11px] text-dim">The adapter rewrites it to fix exactly this, and it comes back here for approval.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Btn variant="subtle" onClick={() => setRejecting(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" icon={Undo2} loading={busy === 'Sending it back…'} onClick={reject} disabled={!feedback.trim()}>
              Send it back
            </Btn>
          </div>
        </div>
      )}

      {!editing && !rejecting && !approved && !rejected && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn variant="primary" size="sm" icon={Check} loading={busy === 'Approving…'} onClick={approve} disabled={blocked} title={blocked ? 'It has to pass the platform check first.' : undefined}>
            Approve
          </Btn>
          <Btn size="sm" icon={PenLine} onClick={() => setEditing(true)}>
            Edit
          </Btn>
          <Btn size="sm" variant="subtle" icon={Undo2} onClick={() => setRejecting(true)}>
            Send back
          </Btn>
          <Btn size="sm" variant="subtle" icon={Heart} loading={busy === 'Noting…'} onClick={like} aria-label="More like this" title="More like this" />
          {item.generating > 0 && <span className="text-[11px] text-dim">Media is still being made, so the checks may change.</span>}
        </div>
      )}

      {!editing && approved && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn size="sm" icon={PenLine} onClick={() => setEditing(true)}>
            Edit it anyway
          </Btn>
          {variant.posts.length > 0 && (
            <span className="text-[11px] text-dim">
              {variant.posts.length === 1 ? 'Scheduled once' : `Scheduled ${variant.posts.length} times`}
            </span>
          )}
        </div>
      )}

      <FieldError message={error} />
    </div>
  )
}
