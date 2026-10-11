import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AudioLines, Bot, Hand, Pencil, Plus, ShieldCheck, Smartphone, Trash2, UsersRound } from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Account, type Device } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { count, PLATFORM_ORDER, useApi, useInvalidate } from '../data'
import { Autonomy } from '../accounts/Autonomy'
import { Voice } from '../accounts/Voice'
import { useUser } from '../Shell'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Segmented, Skeleton, Stagger, Toggle } from '../ui'

/** /dashboard/accounts: where the studio publishes, and how much it may do on its own. */
export default function Accounts() {
  const { data: accounts, loading } = useApi<Account[]>('/accounts')
  const { data: devices } = useApi<Device[]>('/devices')
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [voiceFor, setVoiceFor] = useState<Account | null>(null)
  const [autonomyFor, setAutonomyFor] = useState<Account | null>(null)

  return (
    <div>
      <PageHeader
        title={
          <>
            Where you <Serif>publish.</Serif>
          </>
        }
        sub="Each account lives on one platform. Give it a voice, and link it to a phone to publish automatically."
        actions={
          <Btn variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            Add account
          </Btn>
        }
      />

      <Stagger i={0} className="mt-10">
        {!accounts && loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[188px] rounded-xl" />
            ))}
          </div>
        ) : accounts && accounts.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="No accounts yet"
            body="Add the accounts you post to. Campaigns write a version for each one, in its own voice."
            action={
              <Btn variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                Add the first one
              </Btn>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {accounts?.map((a, i) => (
              <AccountCard key={a.id} account={a} i={i} onOpen={() => setEditing(a)} onVoice={() => setVoiceFor(a)} onAutonomy={() => setAutonomyFor(a)} />
            ))}
          </div>
        )}
      </Stagger>

      <AccountForm open={editing !== null} account={editing === 'new' ? null : editing} devices={devices ?? []} onClose={() => setEditing(null)} />
      {voiceFor && <Voice account={voiceFor} onClose={() => setVoiceFor(null)} />}
      {autonomyFor && <Autonomy account={autonomyFor} onClose={() => setAutonomyFor(null)} />}
    </div>
  )
}

/** Asks first, then deletes the account; true when it's gone. */
function useRemoveAccount() {
  const toast = useToast()
  const invalidate = useInvalidate()
  return async (account: Account) => {
    if (!window.confirm(`Delete @${account.handle}? Its posts stay in the library.`)) return false
    try {
      await api(`/accounts/${account.id}`, { method: 'DELETE' })
      invalidate()
      toast(`@${account.handle} removed. Its posts stay in the library.`)
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t remove it.', 'error')
      return false
    }
  }
}

const iconBtn = 'grid size-8 shrink-0 place-items-center rounded-md border border-line-2 text-muted transition-colors hover:border-accent-soft/60 hover:text-fg'

function AccountCard({ account: a, i, onOpen, onVoice, onAutonomy }: { account: Account; i: number; onOpen: () => void; onVoice: () => void; onAutonomy: () => void }) {
  const { navigate } = useRouter()
  const removeAccount = useRemoveAccount()
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: Math.min(i, 8) * 0.04 }}
      className="group flex min-w-0 flex-col rounded-xl border border-line bg-panel transition-colors duration-300 hover:border-line-2"
    >
      <div className="flex items-start gap-3 p-4">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03] text-fg">
            <PlatformIcon id={a.platform} className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium tracking-[-0.01em]">@{a.handle}</span>
            <span className="block truncate text-[12px] text-dim">
              {a.name ? `${a.name} · ` : ''}
              {PLATFORMS[a.platform].name}
            </span>
          </span>
          {a.posts_count !== undefined && <span className="font-mono text-[10.5px] text-dim">{count(a.posts_count, 'post')}</span>}
        </button>
        <button
          type="button"
          onClick={onVoice}
          title="Voice profile and memory"
          aria-label={`Voice profile and memory for @${a.handle}`}
          className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 text-muted transition-colors hover:border-accent-soft/60 hover:text-fg"
        >
          <AudioLines className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onAutonomy}
          title="Autonomy: modes and rules"
          aria-label={`Autonomy for @${a.handle}`}
          className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 text-muted transition-colors hover:border-accent-soft/60 hover:text-fg"
        >
          <ShieldCheck className="size-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" onClick={onOpen} title="Edit account" aria-label={`Edit @${a.handle}`} className={iconBtn}>
          <Pencil className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void removeAccount(a)}
          title="Delete account"
          aria-label={`Delete @${a.handle}`}
          className={cn(iconBtn, 'hover:border-fail/60 hover:text-fail')}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <dl className="mt-auto grid grid-cols-3 border-t border-line text-[11.5px]">
        <Fact label="Phone">
          {a.device ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn('size-1.5 shrink-0 rounded-full', a.device.status === 'idle' ? 'bg-ok' : a.device.status === 'busy' ? 'bg-accent-soft' : 'bg-warn')} />
              <span className="truncate">{a.device.name}</span>
            </span>
          ) : (
            <span className="text-dim">None</span>
          )}
        </Fact>
        <Fact label="Publishing">
          {a.automation ? (
            <span className="flex items-center gap-1.5 text-accent-soft">
              <Bot className="size-3" strokeWidth={2} />
              Automated
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted">
              <Hand className="size-3" strokeWidth={2} />
              By hand
            </span>
          )}
        </Fact>
        <Fact label="Autonomy">
          <span title={a.autonomy === 'rules' ? 'Approved rules run on their own' : 'Every action waits for approval'}>{a.autonomy === 'rules' ? 'Mode B' : 'Mode A'}</span>
        </Fact>
      </dl>
      {!a.device && a.automation && (
        <button
          type="button"
          onClick={() => navigate('/dashboard/phones')}
          className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-left text-[11.5px] text-warn hover:text-fg"
        >
          <Smartphone className="size-3.5" strokeWidth={1.75} />
          Automated, but no phone linked: nothing can publish yet.
        </button>
      )}
    </motion.article>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-r border-line px-4 py-3 last:border-r-0">
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">{label}</dt>
      <dd className="mt-1 truncate text-fg">{children}</dd>
    </div>
  )
}

function AccountForm({ open, account, devices, onClose }: { open: boolean; account: Account | null; devices: Device[]; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={account ? `@${account.handle}` : 'Add an account'} className="max-w-lg">
      {/* Remount per account so the fields start from it. */}
      {open && <AccountFields key={account?.id ?? 'new'} account={account} devices={devices} onDone={onClose} />}
    </Modal>
  )
}

function AccountFields({ account, devices, onDone }: { account: Account | null; devices: Device[]; onDone: () => void }) {
  const user = useUser()
  const toast = useToast()
  const invalidate = useInvalidate()
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), [])
  const [platform, setPlatform] = useState<PlatformId>(account?.platform ?? 'instagram')
  const [handle, setHandle] = useState(account?.handle ?? '')
  const [name, setName] = useState(account?.name ?? '')
  const [timezone, setTimezone] = useState(account?.timezone ?? '')
  const [deviceId, setDeviceId] = useState<number | null>(account?.device_id ?? null)
  const [automation, setAutomation] = useState(account?.automation ?? false)
  const [autonomy, setAutonomy] = useState<Account['autonomy']>(account?.autonomy ?? 'approve_all')
  const [gap, setGap] = useState(account?.min_gap_minutes ?? 60)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setErrors({})
    const body = { platform, handle, name: name || null, timezone: timezone || null, device_id: deviceId, automation, autonomy, min_gap_minutes: gap }
    try {
      await api(account ? `/accounts/${account.id}` : '/accounts', { method: account ? 'PATCH' : 'POST', body })
      invalidate()
      toast(account ? 'Account saved.' : `@${handle.replace(/^@/, '')} added.`)
      onDone()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k, e.field(k) ?? e.message])))
      else toast(e instanceof Error ? e.message : 'Couldn’t save the account.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeAccount = useRemoveAccount()
  const remove = async () => {
    if (account && (await removeAccount(account))) onDone()
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Platform</Label>
        <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
          {PLATFORM_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              disabled={!!account}
              aria-pressed={platform === id}
              title={PLATFORMS[id].name}
              onClick={() => setPlatform(id)}
              className={cn(
                'grid h-10 place-items-center rounded-md border transition-colors disabled:cursor-not-allowed',
                platform === id ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:text-fg disabled:opacity-30',
              )}
            >
              <PlatformIcon id={id} className="size-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <Label>Handle</Label>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@maisoncire" className={cn(inputClass, 'mt-2')} />
          <FieldError message={errors.handle} />
        </label>
        <label className="block">
          <Label>Name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maison Cire" className={cn(inputClass, 'mt-2')} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <Label>Timezone</Label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={cn(inputClass, 'mt-2')}>
            <option value="">Yours ({user.timezone ?? 'UTC'})</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>Phone</Label>
          <select value={deviceId ?? ''} onChange={(e) => setDeviceId(e.target.value ? Number(e.target.value) : null)} className={cn(inputClass, 'mt-2')}>
            <option value="">None</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.driver === 'simulator' ? ' (simulator)' : ''}
              </option>
            ))}
          </select>
          <FieldError message={errors.device_id} />
        </label>
      </div>

      <div className="rounded-lg border border-line p-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">Publish automatically</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-dim">
              Approved posts go out from the linked phone at their time, and stay unconfirmed until there’s proof they’re live.
              Platforms may count automated posting from a phone against their terms: use it on test accounts, or ones you’re
              allowed to automate.
            </p>
          </div>
          <Toggle on={automation} onChange={setAutomation} label="Publish automatically" />
        </div>
        {automation && (
          <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            At least
            <input
              type="number"
              min={10}
              max={1440}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className={cn(inputClass, 'h-8 w-20 text-center')}
            />
            minutes between automated posts on this account.
          </label>
        )}
        <FieldError message={errors.min_gap_minutes} />
      </div>

      <div>
        <Label>Autonomy</Label>
        <Segmented
          id="autonomy"
          label="Autonomy"
          className="mt-2 w-fit"
          value={autonomy}
          onChange={setAutonomy}
          options={[
            { value: 'approve_all', label: 'Mode A · approve everything' },
            { value: 'rules', label: 'Mode B · approved rules' },
          ]}
        />
        <p className="mt-1.5 text-[11.5px] text-dim">
          {autonomy === 'rules'
            ? 'Actions that match a rule you approved run on their own; anything else waits in your Inbox.'
            : 'The AI prepares everything; every action waits for a person.'}
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-4">
        {account ? (
          <Btn variant="danger" icon={Trash2} onClick={remove}>
            Remove
          </Btn>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Btn variant="subtle" onClick={onDone}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} loading={saving} disabled={!handle.trim()}>
            {account ? 'Save' : 'Add account'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
