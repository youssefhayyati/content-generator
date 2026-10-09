import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Check, History, Lightbulb, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { api, ApiError, type Account, type AccountVoice, type EditorialProfile, type ProfileChange } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtRelative } from '../data'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Modal } from '../ui'
import { AccountSoundForm } from './Sound'

const FIELD_LABELS: Record<keyof EditorialProfile, string> = {
  tone: 'Tone',
  topics: 'Topics',
  style: 'Style',
  do: 'Always do',
  avoid: 'Never do',
  language: 'Language',
  hashtags: 'Hashtags',
}
const FIELDS = Object.keys(FIELD_LABELS) as (keyof EditorialProfile)[]

/**
 * An account's editorial identity and memory. The profile changes only through approved
 * changes — a person proposes, a person approves (the AI can propose too). Memory is kept in
 * three kinds: instructions, liked examples, and post history, which fills itself.
 */
export function Voice({ account, onClose }: { account: Account; onClose: () => void }) {
  const toast = useToast()
  const [voice, setVoice] = useState<AccountVoice | null>(null)
  const [tab, setTab] = useState<'profile' | 'memory' | 'sound'>('profile')

  const load = useCallback(
    () =>
      api<AccountVoice>(`/accounts/${account.id}/voice`)
        .then(setVoice)
        .catch((e) => toast(e instanceof Error ? e.message : 'Couldn’t load the voice.', 'error')),
    [account.id, toast],
  )
  useEffect(() => void load(), [load])

  const pending = voice?.changes.filter((c) => c.status === 'pending') ?? []

  return (
    <Modal open onClose={onClose} title={`Voice · @${account.handle}`} className="max-w-2xl">
      <div className="mb-4 flex gap-1.5">
        {(['profile', 'memory', 'sound'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[12px] transition-colors',
              tab === t ? 'bg-white/[0.08] text-fg' : 'text-dim hover:text-muted',
            )}
          >
            {t === 'profile' ? `Voice profile${pending.length ? ` · ${pending.length} waiting` : ''}` : t === 'memory' ? 'Memory' : 'Sound'}
          </button>
        ))}
      </div>

      {tab === 'sound' ? (
        <AccountSoundForm account={account} />
      ) : !voice ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-10 rounded-lg" />
          ))}
        </div>
      ) : tab === 'profile' ? (
        <Profile voice={voice} account={account} reload={load} />
      ) : (
        <Memory voice={voice} account={account} reload={load} />
      )}
    </Modal>
  )
}

function Profile({ voice, account, reload }: { voice: AccountVoice; account: Account; reload: () => void }) {
  const toast = useToast()
  const [edits, setEdits] = useState<EditorialProfile>({})
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (label: string, fn: () => Promise<unknown>, then: string) => {
    setBusy(label)
    try {
      await fn()
      await reload()
      if (then) toast(then)
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Something went wrong.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const propose = (field: keyof EditorialProfile) => {
    const to = (edits[field] ?? '').trim()
    if (!to) return
    setEdits((e) => ({ ...e, [field]: '' }))
    return run(
      field,
      () => api(`/accounts/${account.id}/profile/changes`, { method: 'POST', body: { field, to } }),
      'Proposed. It applies when you approve it below.',
    )
  }

  const suggest = () =>
    run('suggest', () => api(`/accounts/${account.id}/profile/suggest`, { method: 'POST' }), 'The AI read the memory and proposed changes.')

  const pending = voice.changes.filter((c) => c.status === 'pending')
  const decided = voice.changes.filter((c) => c.status !== 'pending').slice(0, 5)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] leading-snug text-dim">
          Every generation for @{account.handle} reads this profile. Changes — yours or the AI’s — wait for approval below.
        </p>
        <Btn size="sm" icon={Sparkles} onClick={suggest} loading={busy === 'suggest'}>
          Suggest with AI
        </Btn>
      </div>

      {pending.length > 0 && (
        <section>
          <Label>Waiting for approval</Label>
          <ul className="mt-2 space-y-2">
            {pending.map((c) => (
              <ChangeRow key={c.id} change={c} onDecide={(approve) => run(`change-${c.id}`, () => api(`/accounts/${account.id}/profile/changes/${c.id}`, { method: 'POST', body: { approve } }), approve ? 'Approved — the profile changed.' : 'Rejected.')} busy={busy === `change-${c.id}`} />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        {FIELDS.map((f) => (
          <div key={f} className="rounded-lg border border-line px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label>{FIELD_LABELS[f]}</Label>
              {voice.profile[f] && <span className="max-w-[65%] truncate text-[11.5px] text-muted" title={voice.profile[f]}>{voice.profile[f]}</span>}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={edits[f] ?? ''}
                onChange={(e) => setEdits((x) => ({ ...x, [f]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && propose(f)}
                placeholder={voice.profile[f] ? 'Propose a change…' : `Set the ${FIELD_LABELS[f].toLowerCase()}…`}
                className={cn(inputClass, 'h-8 text-[12px]')}
              />
              <Btn size="sm" onClick={() => propose(f)} loading={busy === f} disabled={!(edits[f] ?? '').trim()}>
                Propose
              </Btn>
            </div>
          </div>
        ))}
      </section>

      {decided.length > 0 && (
        <section>
          <Label>Recent decisions</Label>
          <ul className="mt-2 space-y-1">
            {decided.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[11.5px] text-dim">
                {c.status === 'approved' ? <Check className="size-3 text-ok" strokeWidth={2.5} /> : <X className="size-3 text-fail" strokeWidth={2.5} />}
                <span className="truncate">
                  {FIELD_LABELS[c.field]} {c.status === 'approved' ? 'changed' : 'kept'} {c.decided_at ? fmtRelative(c.decided_at) : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ChangeRow({ change: c, onDecide, busy }: { change: ProfileChange; onDecide: (approve: boolean) => void; busy: boolean }) {
  return (
    <li className="rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-dim">{FIELD_LABELS[c.field]}</span>
        <span className={cn('rounded-full border px-1.5 py-px text-[10px]', c.source === 'ai' ? 'border-accent/30 text-accent-soft' : 'border-line-2 text-muted')}>
          {c.source === 'ai' ? 'AI' : 'you'}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-snug">
        {c.from && <span className="text-dim line-through">{c.from} → </span>}
        {c.to ?? <em className="text-dim">remove</em>}
      </p>
      {c.reason && <p className="mt-1 text-[11.5px] leading-snug text-dim">{c.reason}</p>}
      <div className="mt-2 flex gap-1.5">
        <Btn size="sm" variant="primary" icon={Check} onClick={() => onDecide(true)} loading={busy}>
          Approve
        </Btn>
        <Btn size="sm" variant="subtle" icon={X} onClick={() => onDecide(false)} disabled={busy}>
          Reject
        </Btn>
      </div>
    </li>
  )
}

const KINDS = [
  { id: 'instruction' as const, label: 'Instructions', icon: Lightbulb, hint: '“Always mention the Lyon atelier.” Rules every generation follows.', add: true },
  { id: 'example' as const, label: 'Liked examples', icon: BookOpen, hint: 'Posts the account loved. The AI writes more like these.', add: true },
  { id: 'history' as const, label: 'Post history', icon: History, hint: 'Fills itself from what was published and how it was received.', add: false },
]

function Memory({ voice, account, reload }: { voice: AccountVoice; account: Account; reload: () => void }) {
  const toast = useToast()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const remember = async (kind: 'instruction' | 'example') => {
    const content = (drafts[kind] ?? '').trim()
    if (!content) return
    setBusy(kind)
    try {
      await api(`/accounts/${account.id}/memory`, { method: 'POST', body: { kind, content } })
      setDrafts((d) => ({ ...d, [kind]: '' }))
      await reload()
      toast('Remembered. It reaches every generation from now on.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save it.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const forget = async (id: number) => {
    try {
      await api(`/accounts/${account.id}/memory/${id}`, { method: 'DELETE' })
      await reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t remove it.', 'error')
    }
  }

  return (
    <div className="space-y-5">
      {KINDS.map((k) => {
        const items = voice.memory[k.id] ?? []
        return (
          <section key={k.id}>
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
              <k.icon className="size-3.5 text-dim" strokeWidth={1.75} />
              {k.label}
              <span className="font-mono text-[10px] text-dim">{items.length}</span>
            </p>
            <p className="mt-0.5 text-[11.5px] text-dim">{k.hint}</p>
            <ul className="mt-2 space-y-1.5">
              {items.map((m) => (
                <li key={m.id} className="group flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px] leading-snug">
                  <span className="min-w-0 flex-1">{m.content}</span>
                  <button
                    type="button"
                    onClick={() => forget(m.id)}
                    aria-label="Forget this"
                    className="mt-0.5 shrink-0 text-dim opacity-0 transition-opacity hover:text-fail focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
              {items.length === 0 && <li className="text-[12px] text-dim/70">Nothing yet.</li>}
            </ul>
            {k.add && (
              <div className="mt-2 flex gap-1.5">
                <input
                  value={drafts[k.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && remember(k.id as 'instruction' | 'example')}
                  placeholder={k.id === 'instruction' ? 'Add an instruction…' : 'Paste a liked post…'}
                  className={cn(inputClass, 'h-8 text-[12px]')}
                />
                <Btn size="sm" icon={Plus} onClick={() => remember(k.id as 'instruction' | 'example')} loading={busy === k.id} disabled={!(drafts[k.id] ?? '').trim()}>
                  Add
                </Btn>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
