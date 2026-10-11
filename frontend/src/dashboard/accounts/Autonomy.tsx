import { useCallback, useEffect, useState } from 'react'
import { Eye, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api, ApiError, type Account, type AccountAutonomy, type AutonomyAction, type PreviewItem } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Modal, Segmented, Select } from '../ui'

const RULEABLE: { value: AutonomyAction; label: string }[] = [
  { value: 'profile.apply_ai_change', label: 'Apply AI profile changes' },
  { value: 'comment.send_reply', label: 'Send comment replies' },
  { value: 'repost.schedule', label: 'Schedule adapted reposts' },
]

/**
 * Autonomy for one account. Mode A: a person approves every action. Mode B: rules the
 * operator approved let matching actions run on their own; anything else waits in the Inbox.
 * The matrix shows what each mode does, and the preview what would happen right now.
 */
export function Autonomy({ account, onClose }: { account: Account; onClose: () => void }) {
  const toast = useToast()
  const [data, setData] = useState<AccountAutonomy | null>(null)
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)

  const load = useCallback(
    () =>
      api<AccountAutonomy>(`/accounts/${account.id}/autonomy`)
        .then(setData)
        .catch((e) => toast(e instanceof Error ? e.message : 'Couldn’t load autonomy.', 'error')),
    [account.id, toast],
  )
  useEffect(() => void load(), [load])

  const setMode = async (autonomy: Account['autonomy']) => {
    try {
      await api(`/accounts/${account.id}`, { method: 'PATCH', body: { autonomy } })
      setPreview(null)
      await load()
      toast(autonomy === 'rules' ? 'Mode B: rules you approve run on their own.' : 'Mode A: everything waits for you.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t change the mode.', 'error')
    }
  }

  return (
    <Modal open onClose={onClose} title={`Autonomy · @${account.handle}`} className="max-w-2xl">
      {!data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-10 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <Label>Mode</Label>
            <Segmented
              id={`autonomy-${account.id}`}
              label="Mode"
              className="mt-2 w-fit"
              value={data.mode}
              onChange={(v) => setMode(v)}
              options={[
                { value: 'approve_all' as const, label: 'Mode A · approve everything' },
                { value: 'rules' as const, label: 'Mode B · approved rules' },
              ]}
            />
            <p className="mt-1.5 text-[11.5px] text-dim">
              {data.mode === 'rules'
                ? 'Actions that match a rule below run on their own; anything else waits in your Inbox.'
                : 'The AI prepares everything; every action waits for a person.'}
            </p>
          </div>

          {/* The action matrix: what runs automatically in each mode, and what happens now. */}
          <section>
            <Label>Action matrix</Label>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[520px] text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[9.5px] uppercase tracking-[0.12em] text-dim">
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Mode A</th>
                    <th className="px-3 py-2 font-medium">Mode B</th>
                    <th className="px-3 py-2 font-medium">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.map((row) => (
                    <tr key={row.action} className="border-b border-line/60 last:border-0" title={row.detail}>
                      <td className="px-3 py-2.5 font-medium">{row.label}</td>
                      <td className="px-3 py-2.5 text-dim">Asks</td>
                      <td className="px-3 py-2.5 text-muted">{row.action === 'publish.approved_post' ? 'Account switch' : 'Covered rule'}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px]',
                            row.now === 'runs' ? 'border-ok/25 text-ok' : 'border-line-2 text-muted',
                          )}
                        >
                          <span className={cn('size-1.5 rounded-full', row.now === 'runs' ? 'bg-ok' : 'bg-draft')} />
                          {row.now === 'runs' ? 'Runs' : 'Asks'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <Rules data={data} account={account} onChanged={() => { setPreview(null); load() }} />

          <section>
            <div className="flex items-center justify-between">
              <Label>Policy preview</Label>
              <Btn
                size="sm"
                icon={Eye}
                onClick={async () => {
                  try {
                    setPreview((await api<{ items: PreviewItem[] }>(`/accounts/${account.id}/autonomy/preview`)).items)
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Couldn’t preview.', 'error')
                  }
                }}
              >
                Preview now
              </Btn>
            </div>
            <p className="mt-1 text-[11.5px] text-dim">What the current mode and rules would do with the things actually waiting.</p>
            {preview && (
              <ul className="mt-2 space-y-1.5">
                {preview.length === 0 && <li className="text-[12px] text-dim/70">Nothing is waiting right now.</li>}
                {preview.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[12px]">
                    <span className="min-w-0 truncate">{p.label}</span>
                    <span className={cn('shrink-0 font-mono text-[10.5px]', p.verdict.includes('own') ? 'text-ok' : 'text-warn')}>{p.verdict}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

function Rules({ data, account, onChanged }: { data: AccountAutonomy; account: Account; onChanged: () => void }) {
  const toast = useToast()
  const [action, setAction] = useState<AutonomyAction>('comment.send_reply')
  const [allow, setAllow] = useState(true)
  const [maxPerDay, setMaxPerDay] = useState('')
  const [saving, setSaving] = useState(false)

  const add = async () => {
    setSaving(true)
    try {
      await api(`/accounts/${account.id}/autonomy/rules`, {
        method: 'POST',
        body: { action, allow, conditions: maxPerDay ? { max_per_day: Number(maxPerDay) } : null },
      })
      setMaxPerDay('')
      onChanged()
      toast('Rule added.')
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t add the rule.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await api(`/accounts/${account.id}/autonomy/rules/${id}`, { method: 'DELETE' })
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t remove it.', 'error')
    }
  }

  return (
    <section>
      <Label>Your rules</Label>
      <ul className="mt-2 space-y-1.5">
        {data.rules.length === 0 && <li className="text-[12px] text-dim/70">No rules yet: in mode B everything still asks.</li>}
        {data.rules.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12px]">
            <ShieldCheck className={cn('size-3.5 shrink-0', r.allow ? 'text-ok' : 'text-fail')} strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">
              {r.label}
              {r.conditions?.max_per_day ? ` · up to ${r.conditions.max_per_day}/day` : ''}
            </span>
            <span className={cn('font-mono text-[10px]', r.allow ? 'text-ok' : 'text-fail')}>{r.allow ? 'ALLOW' : 'DENY'}</span>
            <button
              type="button"
              onClick={() => remove(r.id)}
              aria-label="Remove rule"
              className="shrink-0 text-dim opacity-0 transition-opacity hover:text-fail focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Select value={action} onChange={(e) => setAction(e.target.value as AutonomyAction)} className="min-w-52" fieldClassName={cn(inputClass, 'h-8 text-[12px]')}>
          {RULEABLE.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select value={allow ? '1' : '0'} onChange={(e) => setAllow(e.target.value === '1')} className="w-24" fieldClassName={cn(inputClass, 'h-8 text-[12px]')}>
          <option value="1">Allow</option>
          <option value="0">Deny</option>
        </Select>
        <input
          type="number"
          min={1}
          max={100}
          value={maxPerDay}
          onChange={(e) => setMaxPerDay(e.target.value)}
          placeholder="Max/day"
          className={cn(inputClass, 'h-8 w-24 text-[12px]')}
        />
        <Btn size="sm" icon={Plus} onClick={add} loading={saving}>
          Add rule
        </Btn>
      </div>
    </section>
  )
}
