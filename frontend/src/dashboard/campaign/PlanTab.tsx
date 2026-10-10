import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Clapperboard, PenLine, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Account, type Campaign, type CampaignItem } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { count, fmtRelative } from '../data'
import { useToast } from '../toast'
import { Btn, FieldError, inputClass, Label, Modal, Panel, Segmented, Skeleton } from '../ui'
import { AccountChips, AgentTimeline, FORMAT_ICON, FORMAT_LABEL, Pill } from './shared'

/** Gate 6A: the agents' plan, edited and approved by a person before anything is made. */
export function PlanTab({
  campaign,
  items,
  accounts,
  onCampaign,
  onItems,
  reload,
}: {
  campaign: Campaign
  items: CampaignItem[] | null
  accounts: Account[]
  onCampaign: (c: Campaign) => void
  onItems: (i: CampaignItem[]) => void
  reload: () => Promise<void>
}) {
  const toast = useToast()
  const [editing, setEditing] = useState<CampaignItem | 'new' | null>(null)
  const [approving, setApproving] = useState(false)
  const reviewing = campaign.stage === 'plan_review'
  const planning = campaign.stage === 'planning'
  const mine = accounts.filter((a) => campaign.account_ids.includes(a.id))

  const approve = async () => {
    setApproving(true)
    try {
      onCampaign(await api<Campaign>(`/campaigns/${campaign.id}/approve-plan`, { method: 'POST' }))
      toast('Plan approved. The team is on it.')
      await reload()
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t approve the plan.', 'error')
    } finally {
      setApproving(false)
    }
  }

  const remove = async (item: CampaignItem) => {
    await api(`/campaigns/${campaign.id}/items/${item.id}`, { method: 'DELETE' })
    onItems((items ?? []).filter((i) => i.id !== item.id))
  }

  if (planning || (!campaign.plan && !items?.length)) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[132px] rounded-xl" />
          ))}
        </div>
        <Panel title="The team">
          <AgentTimeline steps={campaign.steps} working={planning ? 'Planning the campaign…' : null} />
          {!planning && <p className="text-[12.5px] text-dim">Nothing planned yet. Plan the campaign from the brief.</p>}
        </Panel>
      </div>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {campaign.plan && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="relative overflow-hidden rounded-2xl border border-line bg-panel p-6">
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--color-accent) 25%, transparent), transparent 65%)' }} />
            <Label>The big idea</Label>
            <p className="relative mt-2 max-w-[34ch] text-[clamp(1.5rem,2.6vw,2.1rem)] font-medium leading-[1.05] tracking-[-0.03em]">
              <Serif>{campaign.plan.big_idea}</Serif>
            </p>
            <div className="relative mt-5 flex flex-wrap gap-2">
              {campaign.plan.pillars.map((p) => (
                <span key={p.name} title={p.why} className="rounded-full border border-line-2 px-3 py-1 text-[12px] text-muted">
                  {p.name}
                </span>
              ))}
            </div>
          </motion.section>
        )}

        <div className="flex items-center justify-between">
          <Label>{count(items?.length ?? 0, 'post')}</Label>
          {reviewing && (
            <Btn size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Add a post
            </Btn>
          )}
        </div>

        {items?.map((item, i) => {
          const Icon = FORMAT_ICON[item.format]
          return (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease, delay: Math.min(i, 10) * 0.04 }}
              className="group rounded-xl border border-line bg-panel p-4 md:p-5"
            >
              <header className="flex items-start gap-3">
                <span className="font-mono text-[11px] tabular-nums text-dim">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium tracking-[-0.01em]">{item.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-dim">
                    <span className="inline-flex items-center gap-1">
                      <Icon className="size-3.5" strokeWidth={1.75} />
                      {FORMAT_LABEL[item.format]}
                    </span>
                    {item.pillar && <span>· {item.pillar}</span>}
                  </p>
                </div>
                {reviewing && (
                  <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <Btn size="sm" variant="subtle" icon={PenLine} onClick={() => setEditing(item)} aria-label="Edit" />
                    <Btn size="sm" variant="subtle" icon={Trash2} onClick={() => remove(item)} aria-label="Remove" />
                  </span>
                )}
              </header>
              <dl className="mt-4 grid gap-3 text-[12.5px] md:grid-cols-2">
                <div>
                  <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Says</dt>
                  <dd className="mt-1 leading-snug text-fg">{item.message}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Opens with</dt>
                  <dd className="mt-1 font-serif text-[15px] leading-snug text-fg">“{item.hook}”</dd>
                </div>
                {item.visual && (
                  <div className="md:col-span-2">
                    <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Looks like</dt>
                    <dd className="mt-1 leading-snug text-muted">{item.visual}</dd>
                  </div>
                )}
              </dl>
              {item.shots.length > 0 && (
                <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {item.shots.map((s) => (
                    <li key={s.n} className="rounded-lg border border-line px-3 py-2 text-[11.5px]">
                      <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
                        <Clapperboard className="size-3" strokeWidth={1.75} />
                        Shot {s.n + 1} · {s.duration} s · {s.camera}
                      </span>
                      <span className="mt-1 block leading-snug text-muted">{s.description}</span>
                    </li>
                  ))}
                </ol>
              )}
              <AccountChips ids={item.account_ids} accounts={accounts} className="mt-4" />
            </motion.article>
          )
        })}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20">
        <Panel title="Gate 6A" sub="Nothing is made until a person approves the plan.">
          {reviewing ? (
            <>
              <p className="text-[12.5px] leading-snug text-muted">Edit, remove or add posts. When the plan is right, approve it: the writer, media team, adapter and QA take it from there, and you approve the finished content at gate 6B.</p>
              <Btn variant="primary" icon={ShieldCheck} onClick={approve} loading={approving} disabled={!items?.length} className="mt-4 w-full">
                Approve the plan
              </Btn>
            </>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] text-ok">
              <Check className="size-4" strokeWidth={2} />
              Approved {campaign.plan_approved_at ? fmtRelative(campaign.plan_approved_at) : ''}
            </p>
          )}
        </Panel>
        <Panel title="The team">
          <AgentTimeline steps={campaign.steps} />
        </Panel>
      </div>

      <ItemForm open={editing !== null} item={editing === 'new' ? null : editing} campaign={campaign} accounts={mine} onClose={() => setEditing(null)} onSaved={reload} />
    </div>
  )
}

function ItemForm({ open, item, campaign, accounts, onClose, onSaved }: { open: boolean; item: CampaignItem | null; campaign: Campaign; accounts: Account[]; onClose: () => void; onSaved: () => Promise<void> }) {
  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit the post' : 'Add a post'} className="max-w-lg">
      {open && <ItemFields key={item?.id ?? 'new'} item={item} campaign={campaign} accounts={accounts} onDone={async () => (await onSaved(), onClose())} onCancel={onClose} />}
    </Modal>
  )
}

function ItemFields({ item, campaign, accounts, onDone, onCancel }: { item: CampaignItem | null; campaign: Campaign; accounts: Account[]; onDone: () => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [format, setFormat] = useState<CampaignItem['format']>(item?.format ?? 'image')
  const [message, setMessage] = useState(item?.message ?? '')
  const [hook, setHook] = useState(item?.hook ?? '')
  const [visual, setVisual] = useState(item?.visual ?? '')
  const [ids, setIds] = useState<number[]>(item?.account_ids ?? campaign.account_ids)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      const body = { title, format, message, hook, visual, account_ids: ids }
      await api(item ? `/campaigns/${campaign.id}/items/${item.id}` : `/campaigns/${campaign.id}/items`, { method: item ? 'PATCH' : 'POST', body })
      await onDone()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k.split('.')[0], e.field(k) ?? ''])))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <Label>Title</Label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={cn(inputClass, 'mt-2')} />
        <FieldError message={errors.title} />
      </label>
      <div>
        <Label>Format</Label>
        <Segmented id="item-format" label="Format" className="mt-2 w-fit" value={format} onChange={setFormat} options={(['image', 'carousel', 'video', 'text'] as const).map((f) => ({ value: f, label: FORMAT_LABEL[f] }))} />
      </div>
      <label className="block">
        <Label>What it says</Label>
        <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className={cn(inputClass, 'mt-2 h-auto resize-none py-2')} />
      </label>
      <label className="block">
        <Label>Opening line</Label>
        <input value={hook} onChange={(e) => setHook(e.target.value)} className={cn(inputClass, 'mt-2')} />
      </label>
      {format !== 'text' && (
        <label className="block">
          <Label>What we see</Label>
          <textarea rows={2} value={visual} onChange={(e) => setVisual(e.target.value)} className={cn(inputClass, 'mt-2 h-auto resize-none py-2')} />
        </label>
      )}
      <div>
        <Label>Goes to</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {accounts.map((a) => {
            const on = ids.includes(a.id)
            return (
              <button key={a.id} type="button" aria-pressed={on} onClick={() => setIds(on ? ids.filter((x) => x !== a.id) : [...ids, a.id])} className={cn('flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px]', on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted')}>
                <PlatformIcon id={a.platform} className="size-3" />@{a.handle}
              </button>
            )
          })}
        </div>
        <FieldError message={errors.account_ids} />
      </div>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Btn variant="subtle" onClick={onCancel}>
          Cancel
        </Btn>
        <Btn variant="primary" onClick={save} loading={saving} disabled={!title.trim()}>
          {item ? 'Save' : 'Add it'}
        </Btn>
      </div>
      {!item && <Pill tone="dim">The writer writes its caption and the media team makes its media when production runs.</Pill>}
    </div>
  )
}
