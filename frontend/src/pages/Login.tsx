import { useState, type FormEvent } from 'react'
import { AuthHeading, AuthLayout, AuthLink, Enter } from '../components/auth/AuthLayout'
import { AuthVisual } from '../components/auth/AuthVisual'
import { Checkbox, Divider, Field } from '../components/auth/Field'
import { FormAlert, type Alert } from '../components/auth/FormAlert'
import { QueueWall } from '../components/auth/QueueWall'
import { SocialAuth } from '../components/auth/SocialAuth'
import { SubmitButton, type SubmitStatus } from '../components/auth/SubmitButton'
import { Serif } from '../components/ui/Reveal'
import { ApiError } from '../lib/api'
import { authApi, authErrorMessage, isEmail } from '../lib/auth'
import { useDocumentTitle, useRouter } from '../lib/router'
import { nextPath, useRedirectIfSignedIn, useSession } from '../lib/session'

/** Banners for the ways people arrive here: OAuth errors, a finished reset. */
function arrivalAlert(params: URLSearchParams): Alert | null {
  if (params.get('reset')) return { tone: 'success', text: 'Password updated. Log in with your new one.' }
  const message = authErrorMessage(params.get('error'), params.get('provider'))
  return message ? { tone: 'error', text: message } : null
}

export default function Login() {
  useDocumentTitle('Log in — FlowAI')
  useRedirectIfSignedIn()
  const { navigate, search } = useRouter()
  const { setUser } = useSession()

  const [email, setEmail] = useState(() => new URLSearchParams(search).get('email') ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [shake, setShake] = useState(0)
  const [status, setStatus] = useState<SubmitStatus>('idle')
  const [serverError, setServerError] = useState<string | null>(null)
  const [alert, setAlert] = useState<Alert | null>(() => arrivalAlert(new URLSearchParams(search)))

  const errors = {
    email: !email.trim() ? 'Enter your email address.' : !isEmail(email) ? 'That doesn’t look like an email address.' : null,
    password: !password ? 'Enter your password.' : null,
  }
  // Errors only appear once someone has tried to submit, then update live.
  const shown = (key: keyof typeof errors) => (submitted ? errors[key] : null)

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v)
    setServerError(null)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (status !== 'idle') return
    setSubmitted(true)
    if (errors.email || errors.password) {
      setShake((s) => s + 1)
      return
    }

    setStatus('loading')
    setAlert(null)
    try {
      const user = await authApi.login({ email, password, remember })
      setUser(user)
      setStatus('success')
      window.setTimeout(() => navigate(nextPath(search)), 700)
    } catch (err) {
      setStatus('idle')
      if (err instanceof ApiError && (err.status === 422 || err.status === 429)) {
        setServerError(err.field('email') ?? err.message)
        setShake((s) => s + 1)
      } else {
        setAlert({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' })
      }
    }
  }

  return (
    <AuthLayout
      visual={
        <AuthVisual
          headline={['Generate. Adapt.', <Serif>Schedule. Publish.</Serif>]}
          caption="Fig. 01 — Your queue, still moving while you were away."
        >
          <QueueWall />
        </AuthVisual>
      }
    >
      <AuthHeading
        index="01"
        eyebrow="Log in"
        lines={['Welcome', <Serif>back.</Serif>]}
        sub="Pick up where your queue left off."
      />

      <FormAlert alert={alert} onClose={() => setAlert(null)} className="mt-8" />

      <Enter i={4} className="mt-10">
        <SocialAuth onUnavailable={(text) => setAlert({ tone: 'error', text })} />
      </Enter>
      <Enter i={5} className="my-7">
        <Divider delay={0.5}>or with email</Divider>
      </Enter>

      <form onSubmit={onSubmit} noValidate>
        <Enter i={6}>
          <Field
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={edit(setEmail)}
            error={shown('email') ?? serverError}
            valid={isEmail(email) && !serverError}
            shake={shake}
          />
        </Enter>
        <Enter i={7} className="mt-2">
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={edit(setPassword)}
            error={shown('password')}
            shake={shake}
          />
        </Enter>
        <Enter i={8} className="mt-6 flex items-center justify-between gap-4">
          <Checkbox checked={remember} onChange={setRemember}>
            Keep me signed in
          </Checkbox>
          <AuthLink to="/forgot-password" className="text-[13.5px] text-muted transition-colors hover:text-fg" plain>
            Forgot password?
          </AuthLink>
        </Enter>
        <Enter i={9} className="mt-8">
          <SubmitButton status={status} loading="Signing in" success="Welcome back">
            Log in
          </SubmitButton>
        </Enter>
      </form>

      <Enter i={10} className="mt-8 text-[14px] text-muted">
        New to FlowAI? <AuthLink to={`/signup${search}`}>Create an account</AuthLink>
      </Enter>
    </AuthLayout>
  )
}
