import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, CalendarClock, Check, ExternalLink, ImagePlus, Loader2, Plus, RefreshCw, Repeat2, ShieldQuestion, Sparkles, Trash2, X } from 'lucide-react'
import { PlatformIcon, PLATFORMS } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, uploadFiles, type Account, type Asset, type Repost } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Skeleton, Stagger, Toggle, Select } from '../ui'

type Net = Repost['source_platform']

const STATUS: Record<Repost['status'], { label: string; cls: string }> = {
  fetching: { label: 'Reading…', cls: 'border-white/10 text-muted' },
  failed: { label: 'Couldn’t read', cls: 'border-fail/30 text-fail' },
  captured: { label: 'Picked', cls: 'border-white/10 text-muted' },
  adapted: { label: 'Adapted', cls: 'border-plan/30 text-plan' },
  scheduled: { label: 'Scheduled', cls: 'border-ok/25 text-ok' },
  dropped: { label: 'Dropped', cls: 'border-fail/30 text-fail' },
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
  const fetching = reposts?.some((r) => r.status === 'fetching')

  // While a post is being read in the background, check back every few seconds.
  useEffect(() => {
    if (!fetching) return
    const t = window.setInterval(() => api<Repost[]>('/reposts').then(setData).catch(() => {}), 3000)
    return () => window.clearInterval(t)
  }, [fetching, setData])

  return (
    <div>
      <PageHeader
        title={
          <>
            Between X and <Serif>Instagram.</Serif>
          </>
        }
        sub="Paste a post’s link from X or Instagram: its text, photos and video are read for you. You record whether reuse is allowed and why — then the AI rewrites it for the other network, crediting the original author, and the phone agent posts it like any other post."
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

function RepostRow({ repost: r, i }: { repost: Repost; i: number }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { navigate } = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [permitting, setPermitting] = useState(false)
  const [added, setAdded] = useState<Asset | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const status = STATUS[r.status]
  const to = (r.account?.platform ?? other(r.source_platform)) as Net
  const toName = PLATFORMS[to].name
  const media = added ? [added] : r.media
  const needsMedia = to === 'instagram' && media.length === 0

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

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.02 }}>
      <article className="rounded-xl border border-line bg-panel p-4">
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
                {r.status === 'fetching' && <Loader2 className="size-3 animate-spin" />}
                {status.label}
              </span>
              {r.attribution && r.status !== 'fetching' && r.status !== 'failed' && <span className="rounded-full border border-line-2 px-2 py-px text-[10.5px] text-muted">credited</span>}
            </div>

            {r.status === 'fetching' && <p className="mt-1.5 text-[12.5px] text-dim">Reading the post’s text, photos and video…</p>}
            {r.status === 'failed' && <p className="mt-2 rounded-lg border border-fail/20 px-2.5 py-1.5 text-[11.5px] text-fail">{r.error}</p>}
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

            {r.body && (
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
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {r.status === 'failed' && (
            <Btn size="sm" icon={RefreshCw} loading={busy === 'fetch'} onClick={() => run('fetch', () => api(`/reposts/${r.id}/fetch`, { method: 'POST' }), 'Reading it again…')}>
              Try again
            </Btn>
          )}
          {r.status === 'captured' && r.permission === 'pending' && (
            <Btn size="sm" variant="primary" icon={ShieldQuestion} onClick={() => setPermitting(true)}>
              Record permission
            </Btn>
          )}
          {r.status === 'captured' && r.permission === 'allowed' && (
            <Btn size="sm" variant="primary" icon={Sparkles} loading={busy === 'adapt'} onClick={() => run('adapt', () => api(`/reposts/${r.id}/adapt`, { method: 'POST' }), 'Adapted. Review it, then schedule it.')}>
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
              onClick={() => run('schedule', () => api(`/reposts/${r.id}/schedule`, { method: 'POST', body: added ? { asset_ids: [added.id] } : {} }), 'Scheduled. The phone agent posts it at its time.')}
            >
              Approve & schedule
            </Btn>
          )}
          {r.status === 'scheduled' && r.post_id && (
            <Btn size="sm" onClick={() => navigate(`/dashboard/create?post=${r.post_id}`)}>Open the post</Btn>
          )}
          {r.status !== 'scheduled' && r.status !== 'dropped' && (
            <Btn size="sm" variant="subtle" icon={Trash2} onClick={() => run('delete', () => api(`/reposts/${r.id}`, { method: 'DELETE' }), '')} loading={busy === 'delete'}>
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
  const toName = PLATFORMS[(r.account?.platform ?? other(r.source_platform)) as Net].name

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api(`/reposts/${r.id}/permission`, { method: 'POST', body: { decision, note, attribution } })
      invalidate()
      toast(decision === 'allowed' ? `Allowed. Now adapt it for ${toName}.` : 'Denied. It goes nowhere.')
      onClose()
    } catch (e) {
      setError(errorOf(e, 'Couldn’t record it.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`May we reuse @${r.author}’s post?`}>
      <div className="space-y-4">
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 text-[12.5px] leading-snug text-muted">{r.source_text || '(no caption)'}</p>
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
              <p className="text-[11.5px] text-dim">
                Adds “Credit: @{r.author} on {PLATFORMS[r.source_platform].name}” to the post.
              </p>
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

/** Pick a post by its link; it's read in the background, or pasted by hand when it's private. */
function Capture({ open, accounts, onClose }: { open: boolean; accounts: Account[]; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [accountId, setAccountId] = useState<number | ''>('')
  const [url, setUrl] = useState('')
  const [manual, setManual] = useState(false)
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const from = networkOf(url)
  const choices = from ? accounts.filter((a) => a.platform === other(from)) : accounts
  const target = choices.find((a) => a.id === accountId) ?? choices[0]

  const close = () => {
    setUrl('')
    setAuthor('')
    setText('')
    setManual(false)
    setErrors({})
    onClose()
  }

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      await api('/reposts', {
        method: 'POST',
        body: { account_id: target?.id, source_url: url.trim(), ...(manual ? { author: author.replace(/^@/, ''), source_text: text } : {}) },
      })
      invalidate()
      toast(manual ? 'Picked. Record whether reuse is allowed, then adapt it.' : 'Picked. Reading the post — record permission once it’s in.')
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k, e.field(k) ?? e.message])))
      else toast(e instanceof Error ? e.message : 'Couldn’t pick it.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Pick a post to repost">
      <div className="space-y-4">
        <label className="block">
          <Label>Link to the post</Label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/someone/status/…  or  https://www.instagram.com/p/…" className={cn(inputClass, 'mt-2')} autoFocus />
          <FieldError message={errors.source_url} />
          {from && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted">
              <PlatformIcon id={from} className="size-3" />
              {PLATFORMS[from].name} post
              <ArrowRight className="size-3" strokeWidth={1.75} />
              <PlatformIcon id={other(from)} className="size-3" />
              reposted on {PLATFORMS[other(from)].name}
            </p>
          )}
        </label>
        <label className="block">
          <Label>To account</Label>
          <Select value={target?.id ?? ''} onChange={(e) => setAccountId(Number(e.target.value))} fieldClassName={cn(inputClass, 'mt-2')} disabled={choices.length === 0}>
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {PLATFORMS[a.platform].name} · @{a.handle}
              </option>
            ))}
          </Select>
          <FieldError message={errors.account_id ?? (from && choices.length === 0 ? `Add an ${PLATFORMS[other(from)].name} account first.` : undefined)} />
        </label>

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
          <Btn variant="primary" onClick={save} loading={saving} disabled={!from || !target || (manual && (!author.trim() || !text.trim()))}>
            {manual ? 'Pick it' : 'Read the post'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
