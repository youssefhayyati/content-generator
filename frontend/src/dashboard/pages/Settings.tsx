import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Check, ChevronDown, Clapperboard, Image, KeyRound, LoaderCircle, Trash2, Type } from 'lucide-react'
import { siGithub, siGoogle } from 'simple-icons'
import { PalettePicker } from '../../components/ui/PalettePicker'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type PostFormat, type Provider, type User } from '../../lib/api'
import { authApi, authErrorMessage, browserTimezone, oauthUrl } from '../../lib/auth'
import { cn } from '../../lib/cn'
import { useCursorChoice } from '../../lib/cursor'
import { useRouter } from '../../lib/router'
import { useSession } from '../../lib/session'
import { PLATFORM_ORDER, useInvalidate } from '../data'
import { useUser } from '../Shell'
import { useToast } from '../toast'
import { Btn, FieldError, inputClass, Label, Modal, PageHeader, Stagger, Toggle } from '../ui'

const FORMATS: Array<{ id: PostFormat; label: string; icon: typeof Type }> = [
  { id: 'text', label: 'Text', icon: Type },
  { id: 'image', label: 'Images', icon: Image },
  { id: 'video', label: 'Video', icon: Clapperboard },
]

const PROVIDERS: Array<{ id: Provider; name: string; path: string }> = [
  { id: 'google', name: 'Google', path: siGoogle.path },
  { id: 'github', name: 'GitHub', path: siGithub.path },
]

const errorsOf = (e: unknown) =>
  e instanceof ApiError ? Object.fromEntries(Object.keys(e.errors).map((k) => [k.split('.')[0], e.field(k) ?? e.message])) : {}

export default function Settings() {
  return (
    <div>
      <PageHeader
        title={
          <>
            Your <Serif>account.</Serif>
          </>
        }
        sub="Who you are, how you sign in, the defaults every new post starts from, and how the studio looks."
      />
      <div className="mt-10 space-y-4">
        <Stagger i={0}>
          <Profile />
        </Stagger>
        <Stagger i={1}>
          <Defaults />
        </Stagger>
        <Stagger i={2}>
          <Appearance />
        </Stagger>
        <Stagger i={3}>
          <Password />
        </Stagger>
        <Stagger i={4}>
          <SignInMethods />
        </Stagger>
        <Stagger i={5}>
          <DangerZone />
        </Stagger>
      </div>
    </div>
  )
}

/** Left: what the section is. Right: the form. */
function Section({ title, body, children, footer, danger }: { title: string; body: ReactNode; children: ReactNode; footer?: ReactNode; danger?: boolean }) {
  return (
    <section className={cn('grid grid-cols-1 gap-5 rounded-xl border bg-panel p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-10 md:p-6', danger ? 'border-fail/25' : 'border-line')}>
      <div>
        <h2 className="text-[14px] font-medium">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-dim">{body}</p>
      </div>
      <div className="min-w-0">
        {children}
        {footer && <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">{footer}</div>}
      </div>
    </section>
  )
}

function FieldRow({ label, children, error }: { label: string; children: ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <Label className="mb-1.5">{label}</Label>
      {children}
      <FieldError message={error} />
    </label>
  )
}

/* ------------------------------------------------------------------ */

function Profile() {
  const user = useUser()
  const { setUser } = useSession()
  const toast = useToast()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [timezone, setTimezone] = useState(user.timezone ?? browserTimezone())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [resent, setResent] = useState(false)
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), [])

  const dirty = name !== user.name || email !== user.email || timezone !== (user.timezone ?? browserTimezone())

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const updated = await api<User>('/user', { method: 'PATCH', body: { name, email, timezone } })
      setUser(updated)
      toast(updated.email !== user.email ? `Saved. We sent a confirmation link to ${updated.email}.` : 'Profile saved.')
    } catch (err) {
      setErrors(errorsOf(err))
      if (!(err instanceof ApiError && err.status === 422)) toast(err instanceof Error ? err.message : 'Couldn’t save.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const resend = async () => {
    await authApi.resendVerification().catch(() => {})
    setResent(true)
  }

  return (
    <form onSubmit={save}>
      <Section
        title="Profile"
        body="Your name shows on post previews. Queue times are worked out in your timezone."
        footer={
          <Btn type="submit" variant="primary" loading={saving} disabled={!dirty}>
            Save profile
          </Btn>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Name" error={errors.name}>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" />
          </FieldRow>
          <FieldRow label="Email" error={errors.email}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputClass} autoComplete="email" />
          </FieldRow>
        </div>
        <p className="mt-2 flex items-center gap-2 text-[11.5px]">
          {user.email_verified ? (
            <span className="flex items-center gap-1.5 text-ok">
              <Check className="size-3" strokeWidth={2.5} /> Confirmed
            </span>
          ) : (
            <>
              <span className="text-warn">Not confirmed yet.</span>
              <button type="button" onClick={resend} disabled={resent} className="text-accent-soft hover:underline disabled:text-dim disabled:no-underline">
                {resent ? 'Link sent' : 'Resend the link'}
              </button>
            </>
          )}
        </p>
        <div className="mt-4">
          <FieldRow label="Timezone" error={errors.timezone}>
            <span className="relative block">
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={cn(inputClass, 'appearance-none pr-9')}>
                {zones.map((z) => (
                  <option key={z} value={z} className="bg-panel-3">
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
            </span>
          </FieldRow>
          {timezone !== browserTimezone() && (
            <button type="button" onClick={() => setTimezone(browserTimezone())} className="mt-1.5 text-[11.5px] text-accent-soft hover:underline">
              Use my browser’s timezone ({browserTimezone()})
            </button>
          )}
        </div>
      </Section>
    </form>
  )
}

/* ------------------------------------------------------------------ */

function Defaults() {
  const user = useUser()
  const { setUser } = useSession()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [platforms, setPlatforms] = useState<PlatformId[]>(user.preferences.platforms)
  const [formats, setFormats] = useState<PostFormat[]>(user.preferences.formats)
  const [saving, setSaving] = useState(false)

  const dirty =
    [...platforms].sort().join() !== [...user.preferences.platforms].sort().join() ||
    [...formats].sort().join() !== [...user.preferences.formats].sort().join()

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const save = async () => {
    setSaving(true)
    try {
      const ordered = PLATFORM_ORDER.filter((p) => platforms.includes(p))
      setUser(await api<User>('/user', { method: 'PATCH', body: { preferences: { platforms: ordered, formats } } }))
      invalidate()
      toast('Defaults saved. New posts start from these.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Defaults"
      body="Every new post starts on these platforms and in your first format. You can always change them per post."
      footer={
        <Btn variant="primary" loading={saving} disabled={!dirty} onClick={save}>
          Save defaults
        </Btn>
      }
    >
      <Label className="mb-2">Platforms</Label>
      <div className="flex flex-wrap gap-2">
        {PLATFORM_ORDER.map((id) => {
          const on = platforms.includes(id)
          return (
            <motion.button
              key={id}
              type="button"
              aria-pressed={on}
              whileTap={{ scale: 0.95 }}
              onClick={() => setPlatforms((l) => toggle(l, id))}
              className={cn(
                'flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] transition-colors duration-300',
                on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
              )}
            >
              <PlatformIcon id={id} className="size-3.5" />
              {PLATFORMS[id].name}
            </motion.button>
          )
        })}
      </div>
      <Label className="mb-2 mt-5">Formats</Label>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(({ id, label, icon: Icon }) => {
          const on = formats.includes(id)
          return (
            <motion.button
              key={id}
              type="button"
              aria-pressed={on}
              whileTap={{ scale: 0.95 }}
              onClick={() => setFormats((l) => toggle(l, id))}
              className={cn(
                'flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] transition-colors duration-300',
                on ? 'border-accent/70 bg-accent/15 text-fg' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {label}
            </motion.button>
          )
        })}
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */

function Appearance() {
  const [cursor, setCursor] = useCursorChoice()
  return (
    <Section title="Appearance" body="The palette and the cursor, for the studio and the site. Both change right away and are remembered on this device.">
      <PalettePicker />
      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5">
        <div>
          <p className="text-[13px] font-medium">Custom cursor</p>
          <p className="text-[11.5px] text-dim">A crisper pointer in the palette's colour, here and on the site. Turn it off to use your system cursor.</p>
        </div>
        <Toggle on={cursor} onChange={setCursor} label="Custom cursor" />
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */

function Password() {
  const user = useUser()
  const { refresh } = useSession()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) {
      setErrors({ password: 'The two new passwords don’t match.' })
      return
    }
    setSaving(true)
    setErrors({})
    try {
      await api('/user/password', {
        method: 'PUT',
        body: { current_password: user.has_password ? current : undefined, password: next, password_confirmation: confirm },
      })
      setCurrent('')
      setNext('')
      setConfirm('')
      await refresh()
      toast(user.has_password ? 'Password changed.' : 'Password set. You can sign in with your email now too.')
    } catch (err) {
      setErrors(errorsOf(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save}>
      <Section
        title={user.has_password ? 'Password' : 'Set a password'}
        body={
          user.has_password
            ? 'Use at least 8 characters. Your other devices stay signed in.'
            : 'You sign in with Google or GitHub today. Add a password to sign in with your email too.'
        }
        footer={
          <Btn type="submit" variant="primary" icon={KeyRound} loading={saving} disabled={!next}>
            {user.has_password ? 'Change password' : 'Set password'}
          </Btn>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {user.has_password && (
            <div className="sm:col-span-2">
              <FieldRow label="Current password" error={errors.current_password}>
                <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} autoComplete="current-password" />
              </FieldRow>
            </div>
          )}
          <FieldRow label="New password" error={errors.password}>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} autoComplete="new-password" />
          </FieldRow>
          <FieldRow label="Repeat it">
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} autoComplete="new-password" />
          </FieldRow>
        </div>
      </Section>
    </form>
  )
}

/* ------------------------------------------------------------------ */

function SignInMethods() {
  const user = useUser()
  const { setUser } = useSession()
  const toast = useToast()
  const [ready, setReady] = useState<Record<Provider, boolean> | null>(null)
  const [busy, setBusy] = useState<Provider | null>(null)

  useEffect(() => {
    authApi.providers().then(setReady).catch(() => setReady(null))
  }, [])

  const connect = (id: Provider) => {
    if (ready && !ready[id]) {
      toast(authErrorMessage('oauth_unconfigured', id)!, 'error')
      return
    }
    setBusy(id)
    window.location.assign(oauthUrl(id))
  }

  const disconnect = async (id: Provider) => {
    setBusy(id)
    try {
      setUser(await api<User>(`/user/social/${id}`, { method: 'DELETE' }))
      toast(`${id === 'github' ? 'GitHub' : 'Google'} disconnected.`)
    } catch (e) {
      toast(e instanceof ApiError ? (e.field('provider') ?? e.message) : 'Couldn’t disconnect.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Sign-in methods" body="Connect an account to sign in with one click. You need at least one way back in.">
      <ul className="divide-y divide-line rounded-lg border border-line">
        <li className="flex items-center gap-3 px-4 py-3">
          <span className="grid size-9 place-items-center rounded-lg border border-line-2 text-fg">
            <KeyRound className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px]">Email and password</p>
            <p className="truncate text-[11.5px] text-dim">{user.has_password ? user.email : 'No password set yet'}</p>
          </div>
          {user.has_password && <span className="font-mono text-[10.5px] text-ok">Active</span>}
        </li>
        {PROVIDERS.map((p) => {
          const linked = user.providers.includes(p.id)
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cn('grid size-9 place-items-center rounded-lg border transition-colors', linked ? 'border-line-2 text-fg' : 'border-line text-dim')}>
                <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                  <path d={p.path} />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">{p.name}</p>
                <p className="text-[11.5px] text-dim">{linked ? 'Connected' : ready && !ready[p.id] ? 'Not available on this server yet' : 'Not connected'}</p>
              </div>
              <button
                type="button"
                // Nothing to connect to until the server has this provider's credentials.
                disabled={busy !== null || (!linked && !!ready && !ready[p.id])}
                onClick={() => (linked ? disconnect(p.id) : connect(p.id))}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-40',
                  linked ? 'border-line text-muted hover:border-fail/40 hover:text-fail' : 'border-white/25 text-fg hover:bg-white/5',
                )}
              >
                {busy === p.id && <LoaderCircle className="size-3.5 animate-spin" />}
                {linked ? 'Disconnect' : 'Connect'}
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/* ------------------------------------------------------------------ */

function DangerZone() {
  const user = useUser()
  const { setUser } = useSession()
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const remove = async (e: FormEvent) => {
    e.preventDefault()
    setDeleting(true)
    setError(null)
    try {
      await api('/user', { method: 'DELETE', body: user.has_password ? { password } : {} })
      setOpen(false)
      navigate('/')
      setUser(null)
    } catch (err) {
      setError(err instanceof ApiError ? (err.field('password') ?? err.message) : 'Couldn’t delete the account.')
      setDeleting(false)
    }
  }

  return (
    <Section danger title="Delete account" body="Removes your account, every post and your posting times. This can’t be undone.">
      <div className="flex justify-end">
        <Btn variant="danger" icon={Trash2} onClick={() => setOpen(true)}>
          Delete my account
        </Btn>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete your account?">
        <form onSubmit={remove}>
          <p className="text-[13px] leading-snug text-muted">
            Everything in <span className="text-fg">{user.email}</span>’s studio goes with it: posts, schedule and settings.
          </p>
          {user.has_password && (
            <div className="mt-4">
              <FieldRow label="Your password, to confirm" error={error}>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoFocus autoComplete="current-password" />
              </FieldRow>
            </div>
          )}
          {!user.has_password && <FieldError message={error} />}
          <div className="mt-5 flex justify-end gap-2">
            <Btn onClick={() => setOpen(false)}>Keep my account</Btn>
            <Btn type="submit" variant="danger" icon={Trash2} loading={deleting} disabled={user.has_password && !password}>
              Delete forever
            </Btn>
          </div>
        </form>
      </Modal>
    </Section>
  )
}

