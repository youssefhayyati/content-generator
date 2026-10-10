import { lazy, Suspense, type ComponentType } from 'react'
import { MotionConfig, useReducedMotion } from 'framer-motion'
import { ReactLenis } from 'lenis/react'
import { useCursor } from './lib/cursor'
import { isAppPath, Router, useRouter } from './lib/router'
import { SessionProvider } from './lib/session'
import { Grain } from './components/ui/Grain'
import { PageCurtain } from './components/ui/PageCurtain'
import { Splash } from './dashboard/Splash'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import { Cookies, Privacy, Terms } from './pages/Legal'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import ResetPassword from './pages/ResetPassword'
import Showcase from './pages/Showcase'
import Signup from './pages/Signup'

// The studio is its own chunk: people reading the landing page never download it.
const Dashboard = lazy(() => import('./dashboard/Dashboard'))

const ROUTES: Record<string, ComponentType> = {
  '/': Home,
  '/login': Login,
  '/signup': Signup,
  '/showcase': Showcase,
  '/forgot-password': ForgotPassword,
  '/reset-password': ResetPassword,
  '/privacy': Privacy,
  '/terms': Terms,
  '/cookies': Cookies,
}

function Routes() {
  const { path } = useRouter()
  // One instance for the whole app, so the shell stays put while its pages change.
  if (isAppPath(path)) {
    return (
      <Suspense fallback={<Splash />}>
        <Dashboard key="app" />
      </Suspense>
    )
  }
  const Page = ROUTES[path] ?? NotFound
  return <Page key={path} />
}

/** The film grain belongs to the site, not to the tool people work in. */
function SiteChrome() {
  const { path } = useRouter()
  if (isAppPath(path)) return null
  return <Grain />
}

export default function App() {
  const reduce = useReducedMotion()
  // One cursor for the site and the studio.
  useCursor()

  return (
    <MotionConfig reducedMotion="user">
      <ReactLenis root options={{ lerp: 0.1, smoothWheel: !reduce, anchors: { offset: -80 }, allowNestedScroll: true }}>
        <Router>
          <SessionProvider>
            <SiteChrome />
            <Routes />
            <PageCurtain />
          </SessionProvider>
        </Router>
      </ReactLenis>
    </MotionConfig>
  )
}
