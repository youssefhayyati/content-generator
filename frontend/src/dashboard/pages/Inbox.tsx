import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Check, CircleCheck, RotateCcw, SquareCheckBig, Sun, Workflow } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, type InboxItem } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { Approval } from '../flows/Runs'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Skeleton, Stagger } from '../ui'

const TONE: Record<InboxItem['tone'], { dot: string; edge: string }> = {
  fail: { dot: 'bg-fail', edge: 'before:bg-fail' },
  warn: { dot: 'bg-warn', edge: 'before:bg-warn' },
  plan: { dot: 'bg-plan', edge: 'before:bg-plan' },
  accent: { dot: 'bg-accent-soft', edge: 'before:bg-accent-soft' },
}

/** /dashboard/inbox: everything waiting on a person, oldest first. */
export default function Inbox() {
  const { data: items, loading } = useApi<InboxItem[]>('/inbox')
  const { navigate } = useRouter()
  const [confirming, setConfirming] = useState<InboxItem | null>(null)

  const recoverable = (item: InboxItem) => (item.kind === 'publish_failed' || item.kind === 'publish_unconfirmed') && item.post_id

  return (
    <div>
      <PageHeader
        eyebrow="Inbox"
        title={
          <>
            Waiting on <Serif>you.</Serif>
          </>
        }
        sub="Plans and content to approve, drafts your flows want a yes on, posts a phone couldn’t publish or prove, and anything the rules didn’t cover."
      />

      <Stagger i={0} className="mt-10">
        {!items && loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[76px] rounded-xl" />
            ))}
          </div>
        ) : items && items.length === 0 ? (
          <EmptyState icon={CircleCheck} title="All clear" body="Nothing needs you right now. Approvals and anything that goes wrong will land here." />
        ) : (
          <ul className="space-y-2">
            {items?.map((item, i) => (
              <motion.li
                key={item.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease, delay: Math.min(i, 10) * 0.03 }}
              >
                {item.kind === 'flow_approval' && item.run_id ? (
                  <FlowApproval item={item} />
                ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(item.link)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(item.link)}
                  className={cn(
                    'group relative flex w-full cursor-pointer items-center gap-4 overflow-hidden rounded-xl border border-line bg-panel py-3.5 pl-5 pr-4 text-left transition-colors hover:border-line-2 hover:bg-panel-2',
                    'before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
                    TONE[item.tone].edge,
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{item.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-dim">{item.detail}</span>
                  </span>
                  {recoverable(item) && <Recovery item={item} onConfirm={() => setConfirming(item)} />}
                  {item.kind === 'note' && item.note_id && <Dismiss noteId={item.note_id} />}
                  {item.kind === 'storm' && item.account_id && <AllClear accountId={item.account_id} />}
                  {item.at && <span className="hidden shrink-0 font-mono text-[10.5px] text-dim sm:block">{fmtRelative(item.at)}</span>}
                  <ArrowRight className="size-4 shrink-0 text-dim transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-fg" strokeWidth={1.75} />
                </div>
                )}
              </motion.li>
            ))}
          </ul>
        )}
      </Stagger>

      <ConfirmLive item={confirming} onClose={() => setConfirming(null)} />
    </div>
  )
}

/** A flow holding at "Ask me first": the draft right here, approve (or edit) or reject without leaving. */
function FlowApproval({ item }: { item: InboxItem }) {
  const { navigate } = useRouter()
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel py-3.5 pl-5 pr-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[#ff8fa3]">
      <div className="mb-3 flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#ff8fa3]">
            <Workflow className="size-3" /> A flow asks
          </span>
          <span className="mt-1 block truncate text-[13.5px] font-medium">{item.flow ?? item.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {item.at && <span className="hidden font-mono text-[10.5px] text-dim sm:block">{fmtRelative(item.at)}</span>}
          <button type="button" onClick={() => navigate(item.link)} className="flex items-center gap-1 text-[12px] text-dim transition-colors hover:text-fg">
            See the run <ArrowRight className="size-3.5" />
          </button>
        </span>
      </div>
      <Approval runId={item.run_id!} ask={item.ask ?? 'Go ahead?'} draft={item.draft} account={item.account} platform={item.platform} media={item.media} compact />
    </div>
  )
}

function Dismiss({ noteId }: { noteId: number }) {
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  return (
    <span className="shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Btn
        size="sm"
        variant="subtle"
        icon={Check}
        loading={busy}
        onClick={async () => {
          setBusy(true)
          await api(`/inbox/notes/${noteId}/dismiss`, { method: 'POST' }).catch(() => {})
          invalidate()
        }}
      >
        Got it
      </Btn>
    </span>
  )
}

/** Storm Guard froze the account; the operator looked and it's safe. */
function AllClear({ accountId }: { accountId: number }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  return (
    <span className="shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Btn
        size="sm"
        icon={Sun}
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await api(`/accounts/${accountId}/storm-guard/clear`, { method: 'POST' })
            invalidate()
            toast('All clear. Publishing on the account resumes.')
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Couldn’t clear it.', 'error')
            setBusy(false)
          }
        }}
      >
        All clear
      </Btn>
    </span>
  )
}

/** The recovery moves for a post the phones couldn't publish or prove: try again, or confirm live. */
function Recovery({ item, onConfirm }: { item: InboxItem; onConfirm: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [retrying, setRetrying] = useState(false)

  const retry = async () => {
    setRetrying(true)
    try {
      await api(`/posts/${item.post_id}/retry`, { method: 'POST' })
      invalidate()
      toast('Back on the phone. Watch the Publishing page.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t try again.', 'error')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <span className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Btn size="sm" icon={RotateCcw} loading={retrying} onClick={retry}>
        Try again
      </Btn>
      <Btn size="sm" variant="subtle" icon={SquareCheckBig} onClick={onConfirm}>
        Confirm live
      </Btn>
    </span>
  )
}

/** "I checked the account myself — it's live, here's the link." */
function ConfirmLive({ item, onClose }: { item: InboxItem | null; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const close = () => {
    setUrl('')
    setError(null)
    onClose()
  }

  const confirm = async () => {
    if (!item?.post_id) return
    setSaving(true)
    setError(null)
    try {
      await api(`/posts/${item.post_id}/confirm-live`, { method: 'POST', body: { post_url: url } })
      invalidate()
      toast('Confirmed live. The record keeps your link as proof.')
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t confirm it.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={item !== null} onClose={close} title="Confirm it went live">
      <div className="space-y-4">
        <p className="text-[12.5px] leading-snug text-dim">
          Check the account yourself. If the post is there, paste its link: it becomes the run’s evidence, and the post is
          marked published.
        </p>
        <label className="block">
          <Label>Post URL</Label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://instagram.com/p/…"
            className={cn(inputClass, 'mt-2')}
            autoFocus
          />
          <FieldError message={error} />
        </label>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Btn variant="subtle" onClick={close}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={confirm} loading={saving} disabled={!/^https?:\/\/.+/.test(url.trim())}>
            Confirm live
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
