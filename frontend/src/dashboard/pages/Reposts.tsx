import { useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarClock, Check, ExternalLink, Plus, Repeat2, ShieldQuestion, Sparkles, Trash2, X } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Account, type Repost } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Skeleton, Stagger, Toggle, Select } from '../ui'

const STATUS: Record<Repost['status'], { label: string; cls: string }> = {
  captured: { label: 'Picked', cls: 'border-white/10 text-muted' },
  adapted: { label: 'Adapted', cls: 'border-plan/30 text-plan' },
  scheduled: { label: 'Scheduled', cls: 'border-ok/25 text-ok' },
  dropped: { label: 'Dropped', cls: 'border-fail/30 text-fail' },
}

/** /dashboard/reposts: reuse X posts on Instagram — with permission recorded, and credit given. */
export default function Reposts() {
  const { data: reposts, loading } = useApi<Repost[]>('/reposts')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [capturing, setCapturing] = useState(false)
  const igAccounts = (accounts ?? []).filter((a) => a.platform === 'instagram')

  return (
    <div>
      <PageHeader
        title={
          <>
            From X to <Serif>Instagram.</Serif>
          </>
        }
        sub="Pick X posts to reuse. You record whether reuse is allowed and why — then the AI turns them into Instagram captions, always crediting the original author."
        actions={
          <Btn variant="primary" icon={Plus} onClick={() => setCapturing(true)} disabled={igAccounts.length === 0}>
            Pick an X post
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
              igAccounts.length === 0
                ? 'Reposts land on Instagram accounts. Add one on the Accounts page first.'
                : 'Pick an X post worth reusing. Permission comes first; adaptation after.'
            }
            action={
              igAccounts.length > 0 ? (
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

      <Capture open={capturing} accounts={igAccounts} onClose={() => setCapturing(false)} />
    </div>
  )
}

function RepostRow({ repost: r, i }: { repost: Repost; i: number }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { navigate } = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [permitting, setPermitting] = useState(false)
  const status = STATUS[r.status]

  const run = async (label: string, fn: () => Promise<unknown>, then: string) => {
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

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.02 }}>
      <article className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03]">
            <PlatformIcon id="x" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <a href={r.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[13px] font-medium hover:underline">
                @{r.author}
                <ExternalLink className="size-3 text-dim" strokeWidth={1.75} />
              </a>
              <span className="text-[11px] text-dim">→ @{r.account?.handle}</span>
              <span className={cn('rounded-full border px-2 py-px text-[10.5px]', status.cls)}>{status.label}</span>
              {r.attribution && <span className="rounded-full border border-line-2 px-2 py-px text-[10.5px] text-muted">credited</span>}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-snug text-muted">{r.source_text}</p>

            {r.permission !== 'pending' && r.permission_note && (
              <p className={cn('mt-2 rounded-lg border px-2.5 py-1.5 text-[11.5px]', r.permission === 'allowed' ? 'border-ok/20 text-ok' : 'border-fail/20 text-fail')}>
                Reuse {r.permission}: {r.permission_note}
              </p>
            )}

            {r.caption_with_credit && (
              <div className="mt-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Instagram caption</p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-snug">{r.caption_with_credit}</p>
                {r.hashtags.length > 0 && <p className="mt-1 text-[11.5px] text-accent-soft">{r.hashtags.map((t) => `#${t}`).join(' ')}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {r.status === 'captured' && r.permission === 'pending' && (
            <Btn size="sm" variant="primary" icon={ShieldQuestion} onClick={() => setPermitting(true)}>
              Record permission
            </Btn>
          )}
          {r.status === 'captured' && r.permission === 'allowed' && (
            <Btn size="sm" variant="primary" icon={Sparkles} loading={busy === 'adapt'} onClick={() => run('adapt', () => api(`/reposts/${r.id}/adapt`, { method: 'POST' }), 'Adapted. Review the caption, then schedule it.')}>
              Adapt for Instagram
            </Btn>
          )}
          {r.status === 'adapted' && (
            <Btn size="sm" variant="primary" icon={CalendarClock} loading={busy === 'schedule'} onClick={() => run('schedule', () => api(`/reposts/${r.id}/schedule`, { method: 'POST', body: {} }), 'Scheduled. It publishes after approval, like everything else.')}>
              Approve & schedule
            </Btn>
          )}
          {r.status === 'scheduled' && r.post_id && (
            <Btn size="sm" onClick={() => navigate(`/dashboard/create?post=${r.post_id}`)}>Open the post</Btn>
          )}
          {r.status !== 'scheduled' && r.status !== 'dropped' && (
            <Btn
              size="sm"
              variant="subtle"
              icon={Trash2}
              onClick={() => run('delete', () => api(`/reposts/${r.id}`, { method: 'DELETE' }), '')}
              loading={busy === 'delete'}
            >
              Drop
            </Btn>
          )}
          <span className="ml-auto font-mono text-[10.5px] text-dim">{fmtRelative(r.created_at)}</span>
        </div>
      </article>

      {permitting && <Permission repost={r} onClose={() => setPermitting(false)} />}
    </motion.li>
  )
}

/** The permission check: whether reuse is allowed, and why. A person's call, never the AI's. */
function Permission({ repost: r, onClose }: { repost: Repost; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [decision, setDecision] = useState<'allowed' | 'denied'>('allowed')
  const [note, setNote] = useState('')
  const [attribution, setAttribution] = useState(r.attribution)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api(`/reposts/${r.id}/permission`, { method: 'POST', body: { decision, note, attribution } })
      invalidate()
      toast(decision === 'allowed' ? 'Allowed. Now adapt it for Instagram.' : 'Denied. It goes nowhere.')
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t record it.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`May we reuse @${r.author}’s post?`}>
      <div className="space-y-4">
        <p className="whitespace-pre-wrap rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 text-[12.5px] leading-snug text-muted">{r.source_text}</p>
        <SegmentedChoice decision={decision} onChange={setDecision} />
        <label className="block">
          <Label>Why? (kept on the record)</Label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === 'allowed' ? 'e.g. Our founder’s own account; she asked us to' : 'e.g. Not ours; would need their written OK'} className={cn(inputClass, 'mt-2')} autoFocus />
          <FieldError message={error} />
        </label>
        {decision === 'allowed' && (
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium">Credit the author</p>
              <p className="text-[11.5px] text-dim">Adds “Credit: @{r.author}” to the caption.</p>
            </div>
            <Toggle on={attribution} onChange={setAttribution} label="Credit the author" />
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Btn variant="subtle" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} loading={saving} disabled={note.trim().length < 3}>
            Record
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

function SegmentedChoice({ decision, onChange }: { decision: 'allowed' | 'denied'; onChange: (d: 'allowed' | 'denied') => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {(['allowed', 'denied'] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={cn(
            'flex h-9 items-center justify-center gap-1.5 rounded-md border text-[12.5px] font-medium transition-colors',
            decision === d ? (d === 'allowed' ? 'border-ok/50 bg-ok/10 text-ok' : 'border-fail/50 bg-fail/10 text-fail') : 'border-line-2 text-muted hover:text-fg',
          )}
        >
          {d === 'allowed' ? <Check className="size-3.5" strokeWidth={2} /> : <X className="size-3.5" strokeWidth={2} />}
          {d === 'allowed' ? 'Allowed' : 'Denied'}
        </button>
      ))}
    </div>
  )
}

/** Pick an X post to reuse. */
function Capture({ open, accounts, onClose }: { open: boolean; accounts: Account[]; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [accountId, setAccountId] = useState<number | ''>('')
  const [url, setUrl] = useState('')
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const close = () => {
    setUrl('')
    setAuthor('')
    setText('')
    setErrors({})
    onClose()
  }

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      await api('/reposts', {
        method: 'POST',
        body: { account_id: accountId || accounts[0]?.id, source_url: url, author: author.replace(/^@/, ''), source_text: text },
      })
      invalidate()
      toast('Picked. Record whether reuse is allowed, then adapt it.')
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k, e.field(k) ?? e.message])))
      else toast(e instanceof Error ? e.message : 'Couldn’t pick it.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Pick an X post to reuse">
      <div className="space-y-4">
        <label className="block">
          <Label>To Instagram account</Label>
          <Select value={accountId || accounts[0]?.id || ''} onChange={(e) => setAccountId(Number(e.target.value))} fieldClassName={cn(inputClass, 'mt-2')}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label>X post URL</Label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/someone/status/…" className={cn(inputClass, 'mt-2')} autoFocus />
          <FieldError message={errors.source_url} />
        </label>
        <label className="block">
          <Label>Author (X handle)</Label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="@someone" className={cn(inputClass, 'mt-2')} />
          <FieldError message={errors.author} />
        </label>
        <label className="block">
          <Label>The post’s text</Label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Paste the X post here — the AI adapts this into the Instagram caption."
            className={cn(inputClass, 'mt-2 h-auto py-2 leading-snug')}
          />
          <FieldError message={errors.source_text} />
        </label>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Btn variant="subtle" onClick={close}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} loading={saving} disabled={!url.trim() || !author.trim() || !text.trim()}>
            Pick it
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
