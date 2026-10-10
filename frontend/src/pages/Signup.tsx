import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { ArrowLeft, Clapperboard, Image, Type, type LucideIcon } from 'lucide-react'
import { useLenis } from 'lenis/react'
import { AuthHeading, AuthLayout, AuthLink, EntryContext, Enter } from '../components/auth/AuthLayout'
import { AuthVisual } from '../components/auth/AuthVisual'
import { Checkbox, Divider, DrawnTick, Field } from '../components/auth/Field'
import { FormAlert, type Alert } from '../components/auth/FormAlert'
import { PasswordStrength } from '../components/auth/PasswordStrength'
import { PipelineScene } from '../components/auth/PipelineScene'
import { SocialAuth } from '../components/auth/SocialAuth'
import { SubmitButton, type SubmitStatus } from '../components/auth/SubmitButton'
import { SuccessMark } from '../components/auth/SuccessMark'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../components/ui/PlatformIcon'
import { Serif } from '../components/ui/Reveal'
import { ApiError, type PostFormat } from '../lib/api'
import { authApi, isEmail } from '../lib/auth'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useDocumentTitle, useEntryDelay, useRouter } from '../lib/router'
import { useRedirectIfSignedIn, useSession } from '../lib/session'

const ORDER: PlatformId[] = ['instagram', 'tiktok', 'x', 'linkedin', 'facebook', 'youtube', 'pinterest']
const FORMATS: Array<{ id: PostFormat; label: string; icon: LucideIcon }> = [
  { id: 'text', label: 'Text', icon: Type },
  { id: 'image', label: 'Images', icon: Image },
  { id: 'video', label: 'Video', icon: Clapperboard },
]
// Errors on these fields belong to the first step; the server reports them all at once.
const ACCOUNT_FIELDS = ['name', 'email', 'password'] as const

const slide: Variants = {
  enter: (dir: number) => ({ x: dir * 48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -48, opacity: 0 }),
}

const toggle = <T,>(set: Set<T>, v: T) => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export default function Signup() {
  useDocumentTitle('Sign up — FlowAI')
  useRedirectIfSignedIn()
  const entry = useEntryDelay()
  const { navigate } = useRouter()
  const { setUser } = useSession()
  const lenis = useLenis()

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  // The first step waits for the curtain; later steps come in straight away.
  const [moved, setMoved] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [platforms, setPlatforms] = useState<Set<PlatformId>>(() => new Set(['instagram', 'linkedin']))
  const [formats, setFormats] = useState<Set<PostFormat>>(() => new Set<PostFormat>(['text', 'image']))
  const [terms, setTerms] = useState(false)

  const [tried, setTried] = useState([false, false])
  const [shake, setShake] = useState(0)
  const [status, setStatus] = useState<SubmitStatus>('idle')
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [alert, setAlert] = useState<Alert | null>(null)

  const errors = {
    name: !name.trim() ? 'Tell us what to call you.' : null,
    email: !email.trim() ? 'Enter your email address.' : !isEmail(email) ? 'That doesn’t look like an email address.' : null,
    password: password.length < 8 ? 'Use at least 8 characters.' : null,
    platforms: platforms.size === 0 ? 'Pick at least one. You can add more later.' : null,
    terms: !terms ? 'Please accept the terms to continue.' : null,
  }
  const shown = (key: keyof typeof errors, onStep: number) => serverErrors[key] ?? (tried[onStep] ? errors[key] : null)

  // Typing into a field clears whatever the server last said about it.
  const edit = (key: string, set: (v: string) => void) => (v: string) => {
    set(v)
    setServerErrors(({ [key]: _, ...rest }) => rest)
  }

  const go = (to: number) => {
    setMoved(true)
    setDir(to > step ? 1 : -1)
    setStep(to)
    lenis?.scrollTo(0, { duration: 0.9 })
  }

  const fail = (onStep: number) => {
    setTried((t) => t.map((v, i) => (i === onStep ? true : v)))
    setShake((s) => s + 1)
  }

  const submitAccount = (e: FormEvent) => {
    e.preventDefault()
    if (errors.name || errors.email || errors.password) return fail(0)
    go(1)
  }

  const submitWorkspace = async (e: FormEvent) => {
    e.preventDefault()
    if (status !== 'idle') return
    if (errors.platforms || errors.terms) return fail(1)

    setStatus('loading')
    try {
      const user = await authApi.register({
        name,
        email,
        password,
        platforms: [...platforms],
        formats: [...formats],
        terms,
      })
      setUser(user)
      setStatus('success')
      window.setTimeout(() => go(2), 700)
    } catch (err) {
      setStatus('idle')
      if (!(err instanceof ApiError) || err.status !== 422) {
        setAlert({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' })
        return
      }
      const found = Object.fromEntries(
        Object.keys(err.errors).map((k) => [k.split('.')[0], err.field(k) ?? err.message]),
      )
      setServerErrors(found)
      setShake((s) => s + 1)
      // Most likely the email is taken: send them back to where they can fix it.
      if (ACCOUNT_FIELDS.some((k) => found[k])) go(0)
    }
  }

  return (
    <AuthLayout
      visual={
        <AuthVisual
          headline={['One workflow for your', <Serif>entire content pipeline.</Serif>]}
          caption="Fig. 02 — One brief, three platforms, zero copy-paste."
        >
          <PipelineScene startAfter={entry + 1.4} />
        </AuthVisual>
      }
    >
      <AnimatePresence initial={false}>
        {step < 2 && (
          <motion.div
            key="progress"
            className="overflow-hidden"
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.5, ease }}
          >
            <Enter i={0} className="flex items-center gap-4 pb-10 font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
              <span className="tabular-nums text-fg">Step 0{step + 1}</span>
              <span className="flex flex-1 gap-1.5">
                {[0, 1].map((i) => (
                  <span key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <motion.span
                      className="absolute inset-0 origin-left rounded-full bg-fg"
                      initial={false}
                      animate={{ scaleX: step >= i ? 1 : 0 }}
                      transition={{ duration: 0.8, ease }}
                    />
                  </span>
                ))}
              </span>
              <span>02</span>
            </Enter>
          </motion.div>
        )}
      </AnimatePresence>

      <EntryContext.Provider value={moved ? 0.12 : entry}>
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease }}
          >
            {step === 0 && (
              <>
                <AuthHeading
                  index="02"
                  eyebrow="Sign up"
                  lines={['Create your', <Serif>workspace.</Serif>]}
                  sub="Free to start. No credit card required."
                />
                <FormAlert alert={alert} onClose={() => setAlert(null)} className="mt-8" />
                <Enter i={4} className="mt-10">
                  <SocialAuth onUnavailable={(text) => setAlert({ tone: 'error', text })} />
                </Enter>
                <Enter i={5} className="my-7">
                  <Divider delay={0.5}>or with email</Divider>
                </Enter>
                <form onSubmit={submitAccount} noValidate>
                  <Enter i={6}>
                    <Field
                      label="Your name"
                      name="name"
                      autoComplete="name"
                      value={name}
                      onChange={edit('name', setName)}
                      error={shown('name', 0)}
                      valid={!!name.trim()}
                      shake={shake}
                    />
                  </Enter>
                  <Enter i={7} className="mt-2">
                    <Field
                      label="Work email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={edit('email', setEmail)}
                      error={shown('email', 0)}
                      valid={isEmail(email) && !serverErrors.email}
                      shake={shake}
                    />
                  </Enter>
                  <Enter i={8} className="mt-2">
                    <Field
                      label="Password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={edit('password', setPassword)}
                      error={shown('password', 0)}
                      shake={shake}
                    />
                    <PasswordStrength password={password} />
                  </Enter>
                  <Enter i={9} className="mt-8">
                    <SubmitButton status="idle">
                      Continue
                    </SubmitButton>
                  </Enter>
                </form>
                <Enter i={10} className="mt-8 text-[14px] text-muted">
                  Already have an account? <AuthLink to="/login">Log in</AuthLink>
                </Enter>
              </>
            )}

            {step === 1 && (
              <form onSubmit={submitWorkspace} noValidate>
                <AuthHeading
                  index="02"
                  eyebrow="Your channels"
                  lines={['Where do you', <Serif>publish?</Serif>]}
                  sub="We’ll shape every draft for these first. Change it any time."
                />

                <Enter i={4} className="mt-9">
                  <p className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
                    Platforms
                    <span className="tabular-nums text-muted">{platforms.size} selected</span>
                  </p>
                </Enter>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ORDER.map((id, i) => {
                    const on = platforms.has(id)
                    return (
                      <Enter key={id} i={5 + i * 0.5}>
                        <motion.button
                          type="button"
                          aria-pressed={on}
                          onClick={() => setPlatforms((s) => toggle(s, id))}
                          whileTap={{ scale: 0.95 }}
                          className={cn(
                            'flex h-11 items-center rounded-full border pl-3.5 pr-4 text-[13.5px] transition-[background-color,border-color,color] duration-300',
                            on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
                          )}
                        >
                          <PlatformIcon id={id} className="size-4" />
                          <span className="ml-2.5">{PLATFORMS[id].name}</span>
                          {/* The tick slides the pill open when selected, and folds away again when not. */}
                          <span
                            className={cn(
                              'grid shrink-0 place-items-center overflow-hidden rounded-full bg-ink text-fg transition-[width,margin,opacity] duration-500 ease-expo',
                              on ? 'ml-2 h-4 w-4 opacity-100' : 'ml-0 h-4 w-0 opacity-0',
                            )}
                          >
                            <DrawnTick on={on} className="size-2.5 shrink-0" delay={0.15} />
                          </span>
                        </motion.button>
                      </Enter>
                    )
                  })}
                </div>
                <ErrorLine message={shown('platforms', 1)} />

                <Enter i={9} className="mt-8">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">What you make</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {FORMATS.map(({ id, label, icon: Icon }) => {
                      const on = formats.has(id)
                      return (
                        <motion.button
                          key={id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setFormats((s) => toggle(s, id))}
                          whileTap={{ scale: 0.95 }}
                          className={cn(
                            'flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] transition-[background-color,border-color,color] duration-300',
                            on ? 'border-accent/70 bg-accent/15 text-fg' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
                          )}
                        >
                          <Icon className="size-3.5" strokeWidth={1.75} />
                          {label}
                        </motion.button>
                      )
                    })}
                  </div>
                </Enter>

                <Enter i={10} className="mt-8">
                  <Checkbox checked={terms} onChange={setTerms} error={!!shown('terms', 1)}>
                    I agree to the{' '}
                    <a href="/terms" target="_blank" rel="noreferrer" className="text-fg underline decoration-line-2 underline-offset-2 hover:decoration-current">
                      Terms
                    </a>{' '}
                    and{' '}
                    <a href="/privacy" target="_blank" rel="noreferrer" className="text-fg underline decoration-line-2 underline-offset-2 hover:decoration-current">
                      Privacy Policy
                    </a>
                    .
                  </Checkbox>
                  <ErrorLine message={shown('terms', 1)} />
                </Enter>

                <Enter i={11} className="mt-8 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => go(0)}
                    aria-label="Back to account details"
                    className="group grid size-14 shrink-0 place-items-center rounded-full border border-line-2 transition-colors duration-300 hover:border-fg"
                  >
                    <ArrowLeft className="size-4 transition-transform duration-500 ease-expo group-hover:-translate-x-0.5" strokeWidth={1.75} />
                  </button>
                  <SubmitButton status={status} loading="Setting up" success="Ready">
                    Create workspace
                  </SubmitButton>
                </Enter>
              </form>
            )}

            {step === 2 && (
              <Done
                name={name}
                email={email}
                platforms={[...platforms]}
                formats={FORMATS.filter((f) => formats.has(f.id)).map((f) => f.label)}
                onContinue={() => navigate('/dashboard')}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </EntryContext.Provider>
    </AuthLayout>
  )
}

function ErrorLine({ message }: { message: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          role="alert"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease }}
          className="overflow-hidden font-mono text-[11px] text-fail"
        >
          <span className="block pt-2.5">{message}</span>
        </motion.p>
      )}
    </AnimatePresence>
  )
}

function Done({
  name,
  email,
  platforms,
  formats,
  onContinue,
}: {
  name: string
  email: string
  platforms: PlatformId[]
  formats: string[]
  onContinue: () => void
}) {
  // A provider sign-up skips the name and email fields, so both can be empty here.
  const first = name.trim().split(/\s+/)[0]
  const rows = [
    { label: 'Workspace', value: <span className="truncate">{first ? `${first}’s studio` : 'Your studio'}</span> },
    {
      label: 'Channels',
      value: (
        <span className="flex items-center gap-2">
          {platforms.map((p, i) => (
            <motion.span
              key={p}
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.9 + i * 0.06 }}
            >
              <PlatformIcon id={p} className="size-3.5" />
            </motion.span>
          ))}
        </span>
      ),
    },
    { label: 'Formats', value: formats.length ? formats.join(' · ') : 'Decide later' },
  ]

  return (
    <div>
      <SuccessMark />
      <div className="mt-8">
        <AuthHeading
          index="✓"
          eyebrow="Workspace ready"
          lines={['You’re', <Serif>in.</Serif>]}
          sub={
            email ? (
              <>
                We sent a confirmation link to <span className="text-fg">{email}</span>. Your workspace is ready while you wait.
              </>
            ) : (
              'Your workspace is ready. Time to make something.'
            )
          }
        />
      </div>

      <ul className="mt-9 border-t border-line">
        {rows.map((r, i) => (
          <li key={r.label} className="relative overflow-hidden">
            <Enter i={4 + i} className="flex items-center justify-between gap-6 py-3.5 text-[14px]">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">{r.label}</span>
              <span className="flex min-w-0 text-fg">{r.value}</span>
            </Enter>
            <motion.span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-px origin-left bg-line"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, ease, delay: 0.4 + i * 0.08 }}
            />
          </li>
        ))}
      </ul>

      <Enter i={8} className="mt-9">
        <SubmitButton type="button" status="idle" onClick={onContinue}>
          Continue to FlowAI
        </SubmitButton>
      </Enter>
    </div>
  )
}
