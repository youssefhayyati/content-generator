import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Check, CirclePause, CirclePlay, Copy, Eye, EyeOff, KeyRound, MonitorSmartphone, Plus, RefreshCw, ScanSearch, Smartphone, Trash2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Device, type PublishingRun } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { PhoneLive } from '../phones/PhoneLive'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Segmented, Skeleton, Stagger } from '../ui'

/** /dashboard/phones: the phones that publish, their latest screens, and the automation service. */
export default function Phones() {
  const { data: devices, loading } = useApi<Device[]>('/devices')
  const { data: runs } = useApi<PublishingRun[]>('/publishing/runs')
  const [editing, setEditing] = useState<Device | 'new' | null>(null)
  const [scanning, setScanning] = useState(false)
  const [watching, setWatching] = useState<number | null>(null)
  const watched = devices?.find((d) => d.id === watching) ?? null

  // Which real phones are plugged in right now (serial → adb state); null when adb can't be asked.
  const [plugged, setPlugged] = useState<Record<string, string> | null>(null)
  const hasReal = devices?.some((d) => d.driver === 'http') ?? false
  useEffect(() => {
    if (!hasReal) return
    let alive = true
    const check = () =>
      api<Scan>('/devices/scan')
        .then((s) => alive && setPlugged(s.available ? Object.fromEntries(s.phones.map((p) => [p.serial, p.state])) : null))
        .catch(() => {})
    void check()
    const t = window.setInterval(check, 10000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [hasReal])
  const invalidate = useInvalidate()

  // While a phone is working, keep its live strip moving.
  const busy = devices?.some((d) => d.status === 'busy') ?? false
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(invalidate, 4000)
    return () => window.clearInterval(t)
  }, [busy, invalidate])

  return (
    <div>
      <PageHeader
        eyebrow="Phones"
        title={
          <>
            The phones that <Serif>post.</Serif>
          </>
        }
        sub="One job runs on a phone at a time. The built-in simulator needs nothing else; real phones are driven by the automation service below."
        actions={
          <div className="flex gap-2">
            <Btn icon={ScanSearch} onClick={() => setScanning(true)}>
              Scan for phones
            </Btn>
            <Btn variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Add a phone
            </Btn>
          </div>
        }
      />

      <Stagger i={0} className="mt-10">
        {!devices && loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[220px] rounded-xl" />
            ))}
          </div>
        ) : devices && devices.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="No phones yet"
            body="Add the simulator to see the whole publishing loop run, or register a phone the automation service drives."
            action={
              <div className="flex gap-2">
                <Btn icon={ScanSearch} onClick={() => setScanning(true)}>
                  Scan for phones
                </Btn>
                <Btn variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                  Add the first one
                </Btn>
              </div>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {devices?.map((d, i) => (
              <PhoneCard
                key={d.id}
                device={d}
                i={i}
                run={runs?.find((r) => r.id === d.booked_run_id && r.outcome === 'running')}
                onEdit={() => setEditing(d)}
                onWatch={() => setWatching(d.id)}
                connection={d.driver === 'http' && plugged ? (plugged[d.ref ?? ''] ?? 'missing') : undefined}
              />
            ))}
          </div>
        )}
      </Stagger>

      <AutomationService />

      <PhoneForm open={editing !== null} device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      <Modal open={scanning} onClose={() => setScanning(false)} title="Phones on this machine" className="max-w-lg">
        {scanning && (
          <PhoneScan
            onWatch={(id) => {
              setScanning(false)
              setWatching(id)
            }}
          />
        )}
      </Modal>
      <Modal open={watched !== null} onClose={() => setWatching(null)} title={watched ? `${watched.name} · live` : ''} className="max-w-3xl!">
        {watched && <PhoneLive device={watched} />}
      </Modal>
    </div>
  )
}

type ScannedPhone = {
  serial: string
  state: 'device' | 'unauthorized' | 'offline' | string
  name: string
  android: string | null
  device_id: number | null
}

type Scan = { available: boolean; error: string | null; phones: ScannedPhone[] }

/** Asks the adb server which phones are plugged in, and registers the new ones in one click. */
function PhoneScan({ onWatch }: { onWatch: (deviceId: number) => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [scan, setScan] = useState<Scan | null>(null)
  const [scanning, setScanning] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)

  const run = async () => {
    setScanning(true)
    try {
      setScan(await api<Scan>('/devices/scan'))
    } catch (e) {
      setScan({ available: false, error: e instanceof Error ? e.message : 'The scan failed.', phones: [] })
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    void run()
  }, [])

  const add = async (p: ScannedPhone) => {
    setAdding(p.serial)
    try {
      const d = await api<Device>('/devices', { method: 'POST', body: { name: p.name, driver: 'http', ref: p.serial } })
      setScan((s) => s && { ...s, phones: s.phones.map((x) => (x.serial === p.serial ? { ...x, device_id: d.id } : x)) })
      invalidate()
      toast(`“${p.name}” added.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t add the phone.', 'error')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="space-y-4">
      {!scan ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : !scan.available ? (
        <p className="rounded-lg border border-fail/30 bg-fail/[0.06] px-3 py-2.5 text-[12.5px] leading-snug">{scan.error}</p>
      ) : scan.phones.length === 0 ? (
        <p className="rounded-lg border border-line px-3 py-2.5 text-[12.5px] leading-snug text-dim">
          No phone found. Plug one in by USB with USB debugging on (Settings → Developer options), or pair one over Wi-Fi with{' '}
          <span className="font-mono text-[11.5px]">adb connect IP:PORT</span>, then scan again.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {scan.phones.map((p) => (
            <li key={p.serial} className="flex items-center gap-3 px-3 py-2.5">
              <Smartphone className="size-4 shrink-0 text-dim" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{p.name}</p>
                <p className="truncate font-mono text-[10.5px] text-dim">
                  {p.serial}
                  {p.android ? ` · Android ${p.android}` : ''}
                </p>
                {p.state === 'unauthorized' && <p className="mt-0.5 text-[11.5px] text-warn">Allow USB debugging on the phone's screen, then scan again.</p>}
                {p.state === 'offline' && <p className="mt-0.5 text-[11.5px] text-warn">Offline: unplug and replug it, then scan again.</p>}
              </div>
              {p.device_id ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="flex items-center gap-1 font-mono text-[10.5px] text-ok">
                    <Check className="size-3" strokeWidth={2} />
                    Added
                  </span>
                  {p.state === 'device' && (
                    <Btn size="sm" variant="subtle" icon={MonitorSmartphone} onClick={() => onWatch(p.device_id!)}>
                      Live
                    </Btn>
                  )}
                </div>
              ) : (
                <Btn size="sm" variant="primary" icon={Plus} loading={adding === p.serial} disabled={p.state !== 'device' || adding !== null} onClick={() => add(p)}>
                  Add
                </Btn>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11.5px] text-dim">
        Added phones are driven by the automation service: run it with <span className="font-mono text-[11px]">DEVICE_REF=&lt;serial&gt; DRIVER=adb</span>.
      </p>

      <div className="flex justify-end border-t border-line pt-4">
        <Btn icon={RefreshCw} loading={scanning} onClick={run}>
          Scan again
        </Btn>
      </div>
    </div>
  )
}

const STATUS: Record<string, { dot: string; label: string }> = {
  idle: { dot: 'bg-ok', label: 'Idle' },
  busy: { dot: 'bg-accent-soft animate-pulse', label: 'Working' },
  paused: { dot: 'bg-warn', label: 'Paused' },
  offline: { dot: 'bg-draft', label: 'Offline' },
  error: { dot: 'bg-fail', label: 'Error' },
}

/**
 * `connection` is what adb says about a real phone right now: device (plugged in and ready),
 * unauthorized, offline, or missing; undefined when unknown (a simulator, or no adb server).
 */
function PhoneCard({
  device: d,
  i,
  run,
  onEdit,
  onWatch,
  connection,
}: {
  device: Device
  i: number
  run?: PublishingRun
  onEdit: () => void
  onWatch: () => void
  connection?: string
}) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [acting, setActing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const busy = d.booked_run_id !== null
  // A running or paused phone says so first; otherwise an unplugged one says that.
  const status =
    d.status !== 'busy' && d.status !== 'paused' && connection && connection !== 'device'
      ? { dot: 'bg-fail', label: connection === 'unauthorized' ? 'Allow USB debugging' : connection === 'offline' ? 'Not answering' : 'Not connected' }
      : (STATUS[d.status] ?? STATUS.offline)

  const remove = async () => {
    setDeleting(true)
    try {
      await api(`/devices/${d.id}`, { method: 'DELETE' })
      invalidate()
      toast(`“${d.name}” removed.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t remove it.', 'error')
      setDeleting(false)
      setConfirming(false)
    }
  }

  const togglePause = async () => {
    setActing(true)
    try {
      await api(`/devices/${d.id}/${d.paused ? 'resume' : 'pause'}`, { method: 'POST' })
      invalidate()
      toast(d.paused ? `“${d.name}” is back in the rotation.` : `“${d.name}” paused. The run on it still finishes.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t reach the phone.', 'error')
    } finally {
      setActing(false)
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: Math.min(i, 8) * 0.04 }}
      className="flex min-w-0 flex-col rounded-xl border border-line bg-panel transition-colors duration-300 hover:border-line-2"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03] text-fg">
          <Smartphone className="size-4.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onEdit} className="block max-w-full truncate text-left text-[14px] font-medium tracking-[-0.01em] hover:underline">
            {d.name}
          </button>
          <p className="truncate text-[12px] text-dim">
            {d.driver === 'simulator' ? `Simulator · ${d.profile}` : `Automation service · ${d.ref ?? 'no device ID'}`}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-dim">
          <span className={cn('size-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          aria-label={`Delete “${d.name}”`}
          title={busy ? 'It’s running a job. Stop it first.' : 'Delete this phone'}
          className="-mr-1.5 -mt-1 grid size-7 shrink-0 place-items-center rounded-md text-dim hover:bg-fail/10 hover:text-fail disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dim"
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {run && (
        <div className="mx-4 mb-3 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2.5">
          <p className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-soft">
            <Bot className="size-3" strokeWidth={2} />
            Publishing now
          </p>
          <p className="mt-1 truncate text-[12.5px]">{run.goal}</p>
          <p className="mt-0.5 text-[11px] text-dim">
            {run.totals.steps} steps · started {run.started_at ? fmtRelative(run.started_at) : '—'}
          </p>
        </div>
      )}

      {d.screenshot_url && (
        <a href={d.screenshot_url} target="_blank" rel="noreferrer" className="mx-4 mb-3 block overflow-hidden rounded-lg border border-line" title="The phone's latest screen">
          <img src={d.screenshot_url} alt={`${d.name}'s latest screen`} className="max-h-44 w-full object-cover object-top" loading="lazy" />
        </a>
      )}

      {confirming && (
        <div className="mt-auto border-t border-fail/25 bg-fail/[0.05] px-4 py-3">
          <p className="text-[12px] leading-snug text-muted">
            Delete “{d.name}”?{' '}
            {d.accounts.length > 0
              ? `${d.accounts.map((a) => `@${a.handle}`).join(', ')} will have no phone to post from until you link another. `
              : ''}
            Past runs keep their records.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Btn size="sm" variant="subtle" onClick={() => setConfirming(false)} disabled={deleting}>
              Keep
            </Btn>
            <Btn size="sm" variant="danger" icon={Trash2} loading={deleting} onClick={remove}>
              Delete
            </Btn>
          </div>
        </div>
      )}

      <div className={cn('flex items-center justify-between border-t border-line px-4 py-2.5', !confirming && 'mt-auto')}>
        <span className="truncate font-mono text-[10.5px] text-dim">
          {d.accounts.length > 0 ? d.accounts.map((a) => `@${a.handle}`).join(', ') : 'No accounts'}
          {d.last_seen_at ? ` · seen ${fmtRelative(d.last_seen_at)}` : ''}
        </span>
        <div className="flex shrink-0 gap-1.5">
          {d.driver === 'http' && (
            <Btn size="sm" variant="subtle" icon={MonitorSmartphone} onClick={onWatch}>
              Live
            </Btn>
          )}
          <Btn size="sm" variant={d.paused ? 'ghost' : 'subtle'} icon={d.paused ? CirclePlay : CirclePause} loading={acting} onClick={togglePause}>
            {d.paused ? 'Resume' : 'Pause'}
          </Btn>
        </div>
      </div>
    </motion.article>
  )
}

/** The card the Python dev needs: the token, and where its loop points. */
function AutomationService() {
  const toast = useToast()
  const [token, setToken] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    api<{ token: string }>('/publishing/agent-token')
      .then((r) => setToken(r.token))
      .catch(() => {})
  }, [])

  const copy = async () => {
    if (!token) return
    await navigator.clipboard?.writeText(token)
    toast('Token copied.')
  }

  const rotate = async () => {
    setRotating(true)
    try {
      const r = await api<{ token: string }>('/publishing/agent-token/rotate', { method: 'POST' })
      setToken(r.token)
      setShown(true)
      toast('Token rotated. Update the automation service — the old one is dead.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t rotate the token.', 'error')
    } finally {
      setRotating(false)
    }
  }

  const endpoints = [
    ['GET', '/api/agent/next-job?device_ref=…'],
    ['POST', '/api/agent/runs/{run}/steps'],
    ['POST', '/api/agent/runs/{run}/screenshot'],
    ['POST', '/api/agent/runs/{run}/finish'],
    ['GET', '/api/agent/assets/{id}/file'],
  ] as const

  return (
    <Stagger i={1} className="mt-12">
      <section className="rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-[14px] font-medium">
            <KeyRound className="size-4 text-dim" strokeWidth={1.75} />
            The automation service
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-snug text-dim">
            The assistant drives real phones against this API: it asks for the next job on its phone, reports steps and
            screenshots as it goes, and finishes — with proof, a failure, or honestly uncertain. Every call is signed with
            this token as <span className="font-mono text-[11px]">Authorization: Bearer …</span>: put it in the
            assistant’s <span className="font-mono text-[11px]">FLOWAI_AGENT_TOKEN</span>, and give the phone the device ID
            the phone service uses (the team phone is <span className="font-mono text-[11px]">heracles-phone</span>).
          </p>
        </div>
        <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
          <div>
            <Label>Agent token</Label>
            <div className="mt-2 flex items-center gap-2">
              <code className="h-9 flex-1 truncate rounded-md border border-line-2 bg-white/[0.02] px-3 font-mono text-[12px] leading-9 text-muted">
                {token ? (shown ? token : '•'.repeat(12) + token.slice(-6)) : '…'}
              </code>
              <Btn size="sm" icon={shown ? EyeOff : Eye} onClick={() => setShown((s) => !s)} disabled={!token}>
                {shown ? 'Hide' : 'Show'}
              </Btn>
              <Btn size="sm" icon={Copy} onClick={copy} disabled={!token}>
                Copy
              </Btn>
              <Btn size="sm" icon={RefreshCw} onClick={rotate} loading={rotating}>
                Rotate
              </Btn>
            </div>
            <p className="mt-2 text-[11.5px] text-dim">One token per studio. Rotating it cuts the old service off immediately.</p>
          </div>
          <div>
            <Label>The loop</Label>
            <ul className="mt-2 space-y-1">
              {endpoints.map(([method, path]) => (
                <li key={path} className="flex items-baseline gap-2 font-mono text-[11.5px]">
                  <span className={cn('w-9 shrink-0', method === 'GET' ? 'text-ok' : 'text-plan')}>{method}</span>
                  <span className="truncate text-muted">{path}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-dim">
              204 means no job. Named targets only (R6); every run has a step budget and a hard timeout (R7), both in the job payload.
            </p>
          </div>
        </div>
      </section>
    </Stagger>
  )
}

function PhoneForm({ open, device, onClose }: { open: boolean; device: Device | null; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={device ? device.name : 'Add a phone'} className="max-w-lg">
      {open && <PhoneFields key={device?.id ?? 'new'} device={device} onDone={onClose} />}
    </Modal>
  )
}

function PhoneFields({ device, onDone }: { device: Device | null; onDone: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [name, setName] = useState(device?.name ?? '')
  const [driver, setDriver] = useState<Device['driver']>(device?.driver ?? 'simulator')
  const [ref, setRef] = useState(device?.ref ?? '')
  const [profile, setProfile] = useState<Device['profile']>(device?.profile ?? 'reliable')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      await api(device ? `/devices/${device.id}` : '/devices', {
        method: device ? 'PATCH' : 'POST',
        body: { name, driver, ref: driver === 'http' ? ref || null : null, profile },
      })
      invalidate()
      toast(device ? 'Phone saved.' : `“${name}” added.`)
      onDone()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k, e.field(k) ?? e.message])))
      else toast(e instanceof Error ? e.message : 'Couldn’t save the phone.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!device) return
    try {
      await api(`/devices/${device.id}`, { method: 'DELETE' })
      invalidate()
      toast(`“${device.name}” removed.`)
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t remove it.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <Label>Name</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio phone" className={cn(inputClass, 'mt-2')} />
        <FieldError message={errors.name} />
      </label>

      <div>
        <Label>Driver</Label>
        <Segmented
          id="driver"
          label="Driver"
          className="mt-2 w-fit"
          value={driver}
          onChange={setDriver}
          options={[
            { value: 'simulator' as const, label: 'Built-in simulator' },
            { value: 'http' as const, label: 'Automation service' },
          ]}
        />
        <p className="mt-1.5 text-[11.5px] text-dim">
          {driver === 'simulator'
            ? 'Runs in-process on the queue worker: the whole loop works with no hardware and no external service.'
            : 'The Python automation service drives this phone through the agent API below.'}
        </p>
      </div>

      {driver === 'http' && (
        <label className="block">
          <Label>Device ID on the phone-control service</Label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="phone-1" className={cn(inputClass, 'mt-2')} />
          <FieldError message={errors.ref} />
        </label>
      )}

      {driver === 'simulator' && (
        <div>
          <Label>How it behaves</Label>
          <Segmented
            id="profile"
            label="Profile"
            className="mt-2 w-fit"
            value={profile}
            onChange={setProfile}
            options={[
              { value: 'reliable' as const, label: 'Reliable' },
              { value: 'flaky' as const, label: 'Flaky' },
              { value: 'broken' as const, label: 'Broken' },
            ]}
          />
          <p className="mt-1.5 text-[11.5px] text-dim">
            {profile === 'reliable' && 'Posts and proves it, every time.'}
            {profile === 'flaky' && 'Mostly works; sometimes the screen proves nothing, so the run ends honestly unconfirmed.'}
            {profile === 'broken' && 'Can’t even open the app: every run fails, waits, and tries again (R3).'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line pt-4">
        {device ? (
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
          <Btn variant="primary" onClick={save} loading={saving} disabled={!name.trim()}>
            {device ? 'Save' : 'Add phone'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
