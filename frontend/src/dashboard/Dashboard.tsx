import { useEffect, useRef, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { authErrorMessage } from '../lib/auth'
import { ease } from '../lib/motion'
import { useDocumentTitle, useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import { AssistantDock } from './assistant/Dock'
import { AssistantProvider } from './assistant/store'
import { DataProvider } from './data'
import Accounts from './pages/Accounts'
import Analytics from './pages/Analytics'
import Assistant from './pages/Assistant'
import Automations from './pages/Automations'
import Calendar from './pages/Calendar'
import Campaigns from './pages/Campaigns'
import Comments from './pages/Comments'
import Create from './pages/Create'
import Flows from './pages/Flows'
import Inbox from './pages/Inbox'
import Investigations from './pages/Investigations'
import Library from './pages/Library'
import LiveWall from './pages/Live'
import Models from './pages/Models'
import Overview from './pages/Overview'
import Phones from './pages/Phones'
import Publishing from './pages/Publishing'
import Reposts from './pages/Reposts'
import Settings from './pages/Settings'
import Studio from './pages/Studio'
import { pageLabel } from './nav'
import { Shell } from './Shell'
import { Splash } from './Splash'
import { ToastProvider, useToast } from './toast'

const PAGES: Record<string, ComponentType> = {
  '/dashboard': Overview,
  '/dashboard/inbox': Inbox,
  '/dashboard/live': LiveWall,
  '/dashboard/accounts': Accounts,
  '/dashboard/assistant': Assistant,
  '/dashboard/studio': Studio,
  '/dashboard/campaigns': Campaigns,
  '/dashboard/create': Create,
  '/dashboard/library': Library,
  '/dashboard/calendar': Calendar,
  '/dashboard/automations': Automations,
  '/dashboard/flows': Flows,
  '/dashboard/analytics': Analytics,
  '/dashboard/models': Models,
  '/dashboard/phones': Phones,
  '/dashboard/publishing': Publishing,
  '/dashboard/reposts': Reposts,
  '/dashboard/comments': Comments,
  '/dashboard/investigations': Investigations,
  '/dashboard/settings': Settings,
}

/** Everything under /dashboard: sign-in guard, shared providers, and the page switcher. */
export default function Dashboard() {
  const { user, status } = useSession()
  const { path, search, navigate } = useRouter()

  useEffect(() => {
    if (status === 'ready' && !user) {
      navigate(`/login?${new URLSearchParams({ next: path + search })}`, { replace: true })
    }
  }, [status, user, path, search, navigate])

  if (!user) return <Splash />

  return (
    <DataProvider>
      <ToastProvider>
        {/* Above the pages, so a conversation with the assistant carries on from page to page. */}
        <AssistantProvider>
          <Shell>
            <Arrivals />
            <Pages />
          </Shell>
          <AssistantDock />
        </AssistantProvider>
      </ToastProvider>
    </DataProvider>
  )
}

function Pages() {
  const { path, search, navigate } = useRouter()
  const Page = PAGES[path]
  useDocumentTitle(`${pageLabel(path)} — FlowAI`)

  useEffect(() => {
    if (!Page) navigate('/dashboard', { replace: true })
  }, [Page, navigate])

  if (!Page) return null
  // The composer remounts per post, and Flows per flow, so switching between them starts clean.
  const key = path === '/dashboard/create' ? path + search : path === '/dashboard/flows' ? path + (new URLSearchParams(search).get('id') ?? '') : path

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
        transition={{ duration: 0.45, ease }}
      >
        <Page />
      </motion.div>
    </AnimatePresence>
  )
}

/** One-off messages carried in the URL by redirects from the API: confirmations, OAuth results. */
function Arrivals() {
  const { path, search, navigate } = useRouter()
  const { refresh } = useSession()
  const toast = useToast()
  // Development StrictMode runs effects twice; one URL should only ever announce itself once.
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(search)
    const verified = params.get('verified')
    const linked = params.get('linked')
    const error = params.get('error')
    if ((!verified && !linked && !error) || handled.current === search) return
    handled.current = search

    if (verified) toast('Email confirmed. You’re all set.')
    if (linked) toast(`${linked === 'github' ? 'GitHub' : 'Google'} is connected. You can use it to sign in.`)
    if (error) {
      const provider = params.get('provider')
      toast(
        error === 'oauth_taken'
          ? `That ${provider === 'github' ? 'GitHub' : 'Google'} account already belongs to another FlowAI user.`
          : (authErrorMessage(error, provider) ?? 'Something went wrong.'),
        'error',
      )
    }
    if (verified || linked) refresh().catch(() => {})

    ;['verified', 'linked', 'error', 'provider'].forEach((k) => params.delete(k))
    const rest = params.toString()
    navigate(path + (rest ? `?${rest}` : ''), { replace: true })
  }, [search, path, navigate, toast, refresh])

  return null
}
