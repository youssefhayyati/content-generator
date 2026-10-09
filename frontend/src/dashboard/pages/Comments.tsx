import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, MessageSquareText, Plus, SendHorizonal, Sparkles, Trash2, X } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Account, type Comment } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { Mood, StormGuard } from '../storm/StormGuard'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Skeleton, Stagger } from '../ui'

const STATUS: Record<Comment['status'], { label: string; cls: string }> = {
  new: { label: 'New', cls: 'border-white/10 text-muted' },
  drafted: { label: 'Draft to review', cls: 'border-plan/30 text-plan' },
  human: { label: 'Needs a human', cls: 'border-warn/30 text-warn' },
  sent: { label: 'Replied', cls: 'border-ok/25 text-ok' },
  ignored: { label: 'Ignored', cls: 'border-white/10 text-dim' },
}

/** /dashboard/comments: the comment inbox. AI triages; a human approves every reply. */
export default function Comments() {
  const { data: comments, loading } = useApi<Comment[]>('/comments')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [reporting, setReporting] = useState(false)
  const [tab, setTab] = useState<'waiting' | 'all'>('waiting')

  const waiting = (comments ?? []).filter((c) => c.status === 'new' || c.status === 'drafted' || c.status === 'human')
  const shown = tab === 'waiting' ? waiting : (comments ?? [])

  return (
    <div>
      <PageHeader
        eyebrow="Comments"
        title={
          <>
            The comment <Serif>inbox.</Serif>
          </>
        }
        sub="The AI triages every comment — reply, ignore, or send to a human. A human approves every reply before it goes out, unless a mode-B rule covers it. Storm Guard watches the mood."
        actions={
          <Btn variant="primary" icon={Plus} onClick={() => setReporting(true)} disabled={(accounts ?? []).length === 0}>
            Report a comment
          </Btn>
        }
      />

      <StormGuard />

      <div className="mt-8 flex gap-1.5">
        {(['waiting', 'all'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('rounded-md px-3 py-1.5 text-[12px] transition-colors', tab === t ? 'bg-white/[0.08] text-fg' : 'text-dim hover:text-muted')}
          >
            {t === 'waiting' ? `Waiting (${waiting.length})` : 'Everything'}
          </button>
        ))}
      </div>

      <Stagger i={0} className="mt-4">
        {!comments && loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title={tab === 'waiting' ? 'Nothing waiting' : 'No comments yet'}
            body={tab === 'waiting' ? 'Every comment is triaged and answered. Switch to “Everything” for the record.' : 'When comments come in, the AI triages them and drafts replies for you to approve.'}
            action={
              (accounts ?? []).length > 0 ? (
                <Btn variant="primary" icon={Plus} onClick={() => setReporting(true)}>
                  Report one
                </Btn>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {shown.map((c, i) => (
              <CommentRow key={c.id} comment={c} i={i} />
            ))}
          </ul>
        )}
      </Stagger>

      <Report open={reporting} accounts={accounts ?? []} onClose={() => setReporting(false)} />
    </div>
  )
}

function CommentRow({ comment: c, i }: { comment: Comment; i: number }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState<string | null>(null)
  const [reply, setReply] = useState(c.draft ?? '')
  const [editing, setEditing] = useState(false)
  const status = STATUS[c.status]

  const run = async (label: string, fn: () => Promise<unknown>, then?: string) => {
    setBusy(label)
    try {
      await fn()
      invalidate()
      if (then) toast(then)
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Something went wrong.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const send = () =>
    run('send', () => api(`/comments/${c.id}/send`, { method: 'POST', body: { reply: reply.trim() || c.draft } }), 'Reply sent.')

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.02 }}>
      <article className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03]">
            <PlatformIcon id={c.account?.platform ?? 'instagram'} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[13px] font-medium">@{c.author}</span>
              <span className="text-[11px] text-dim">on @{c.account?.handle}{c.post_ref ? ` · “${c.post_ref}”` : ''}</span>
              <span className={cn('rounded-full border px-2 py-px text-[10.5px]', status.cls)}>{status.label}</span>
              <Mood sentiment={c.sentiment} />
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-snug text-muted">{c.body}</p>
            {c.triage && <p className="mt-1.5 text-[11.5px] text-dim">AI: {c.triage.decision} — {c.triage.reason}</p>}

            {c.status === 'sent' && c.reply && (
              <p className="mt-2 rounded-lg border border-ok/20 bg-ok/[0.04] px-3 py-2 text-[12.5px] leading-snug">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ok">Replied{c.sent_at ? ` · ${fmtRelative(c.sent_at)}` : ''}</span>
                <br />
                {c.reply}
              </p>
            )}

            {(c.status === 'drafted' || c.status === 'human') && (
              <div className="mt-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
                {editing || !c.draft ? (
                  <>
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={2}
                      placeholder="Write the reply…"
                      className={cn(inputClass, 'h-auto w-full py-2 text-[12.5px] leading-snug')}
                    />
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-[12.5px] leading-snug">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Draft</span>
                    <br />
                    {c.draft}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Btn size="sm" variant="primary" icon={SendHorizonal} loading={busy === 'send'} disabled={!c.draft && !reply.trim()} onClick={send}>
                    Approve & send
                  </Btn>
                  {c.draft && !editing && (
                    <Btn size="sm" onClick={() => { setReply(c.draft ?? ''); setEditing(true) }}>
                      Edit
                    </Btn>
                  )}
                  <Btn size="sm" variant="subtle" icon={X} loading={busy === 'ignore'} onClick={() => run('ignore', () => api(`/comments/${c.id}/ignore`, { method: 'POST' }))}>
                    Ignore
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3">
          {c.status === 'new' && (
            <Btn size="sm" variant="primary" icon={Sparkles} loading={busy === 'triage'} onClick={() => run('triage', () => api(`/comments/${c.id}/triage`, { method: 'POST' }))}>
              Triage with AI
            </Btn>
          )}
          {c.status !== 'sent' && (
            <Btn size="sm" variant="subtle" icon={Trash2} loading={busy === 'delete'} onClick={() => run('delete', () => api(`/comments/${c.id}`, { method: 'DELETE' }))}>
              Delete
            </Btn>
          )}
          <span className="ml-auto font-mono text-[10.5px] text-dim">{fmtRelative(c.created_at)}</span>
        </div>
      </article>
    </motion.li>
  )
}

/** A comment lands in the inbox — the connector's job in production; by hand here. */
function Report({ open, accounts, onClose }: { open: boolean; accounts: Account[]; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [accountId, setAccountId] = useState<number | ''>('')
  const [author, setAuthor] = useState('')
  const [body, setBody] = useState('')
  const [postRef, setPostRef] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const close = () => {
    setAuthor('')
    setBody('')
    setPostRef('')
    setErrors({})
    onClose()
  }

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      await api('/comments', { method: 'POST', body: { account_id: accountId || accounts[0]?.id, author: author.replace(/^@/, ''), body, post_ref: postRef || null } })
      invalidate()
      toast('In the inbox. Triage it with AI.')
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k, e.field(k) ?? e.message])))
      else toast(e instanceof Error ? e.message : 'Couldn’t add it.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Report a comment">
      <div className="space-y-4">
        <label className="block">
          <Label>On account</Label>
          <select value={accountId || accounts[0]?.id || ''} onChange={(e) => setAccountId(Number(e.target.value))} className={cn(inputClass, 'mt-2')}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle} ({a.platform})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>Commenter</Label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="@someone" className={cn(inputClass, 'mt-2')} autoFocus />
          <FieldError message={errors.author} />
        </label>
        <label className="block">
          <Label>The comment</Label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={cn(inputClass, 'mt-2 h-auto py-2 leading-snug')} />
          <FieldError message={errors.body} />
        </label>
        <label className="block">
          <Label>On which post (optional)</Label>
          <input value={postRef} onChange={(e) => setPostRef(e.target.value)} placeholder="Evening ritual" className={cn(inputClass, 'mt-2')} />
        </label>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Btn variant="subtle" onClick={close}>
            Cancel
          </Btn>
          <Btn variant="primary" icon={Check} onClick={save} loading={saving} disabled={!author.trim() || !body.trim()}>
            Add to inbox
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
