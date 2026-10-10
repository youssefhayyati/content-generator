import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useReducedMotion } from 'framer-motion'
import { useLenis } from 'lenis/react'

/*
 * A deliberately small history router. Moving between pages of the site goes through the curtain:
 *   cover   → the curtain rises over the old page
 *   reveal  → the URL and page swap underneath, then the curtain lifts off the new one
 * Pages mount at the start of `reveal`, so their entrance plays as the curtain clears.
 * Inside the app (/dashboard/…) navigation is instant; the shell animates its own content.
 */

export type Phase = 'idle' | 'cover' | 'reveal'
type NavigateOptions = { replace?: boolean }

type RouterValue = {
  path: string
  search: string
  phase: Phase
  /** Where the curtain is heading while it covers. */
  target: string | null
  navigate: (to: string, options?: NavigateOptions) => void
  /** Called by the curtain when its own animations land. */
  covered: () => void
  revealed: () => void
}

const RouterContext = createContext<RouterValue | null>(null)

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/'
const parse = (to: string) => {
  const url = new URL(to, window.location.origin)
  return { path: normalize(url.pathname), search: url.search }
}

export const isAppPath = (p: string) => p === '/dashboard' || p.startsWith('/dashboard/')

let navigations = 0
/** True until the first client-side navigation: the home preloader only plays on a cold load. */
export const isInitialRoute = () => navigations === 0

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => parse(window.location.pathname + window.location.search))
  const [phase, setPhase] = useState<Phase>('idle')
  const [target, setTarget] = useState<string | null>(null)
  const pending = useRef<{ to: string; push: boolean; replace: boolean }>({ to: '/', push: true, replace: false })
  const reduce = useReducedMotion()
  const lenis = useLenis()

  const commit = useCallback(
    (to: string, history: 'push' | 'replace' | 'none', keepScroll = false) => {
      navigations++
      if (history === 'push') window.history.pushState(null, '', to)
      if (history === 'replace') window.history.replaceState(null, '', to)
      setLocation(parse(to))
      if (!keepScroll) {
        lenis?.scrollTo(0, { immediate: true, force: true })
        window.scrollTo(0, 0)
      }
    },
    [lenis],
  )

  const navigate = useCallback(
    (to: string, options: NavigateOptions = {}) => {
      const next = parse(to)
      if (next.path === location.path && next.search === location.search) return
      if (phase !== 'idle') return

      // Same page with a new query, moves within the app, and reduced motion skip the curtain.
      const instant = reduce || next.path === location.path || (isAppPath(next.path) && isAppPath(location.path))
      if (instant) return commit(to, options.replace ? 'replace' : 'push', next.path === location.path)

      pending.current = { to, push: true, replace: !!options.replace }
      setTarget(to)
      setPhase('cover')
    },
    [location, phase, reduce, commit],
  )

  useEffect(() => {
    const onPop = () => {
      const to = window.location.pathname + window.location.search
      const next = parse(to)
      const instant =
        reduce || phase !== 'idle' || next.path === location.path || (isAppPath(next.path) && isAppPath(location.path))
      if (instant) return commit(to, 'none', next.path === location.path)
      pending.current = { to, push: false, replace: false }
      setTarget(to)
      setPhase('cover')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [reduce, phase, commit, location.path])

  const covered = useCallback(() => {
    const { to, push, replace } = pending.current
    commit(to, !push ? 'none' : replace ? 'replace' : 'push')
    setPhase('reveal')
  }, [commit])

  const revealed = useCallback(() => {
    setPhase('idle')
    setTarget(null)
  }, [])

  return (
    <RouterContext.Provider value={{ ...location, phase, target, navigate, covered, revealed }}>
      {children}
    </RouterContext.Provider>
  )
}

export function useRouter() {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used inside <Router>')
  return ctx
}

/** Read one query-string parameter of the current URL. */
export function useQueryParam(name: string) {
  const { search } = useRouter()
  return new URLSearchParams(search).get(name)
}

/**
 * Seconds a page should hold its entrance: long enough for the curtain to start lifting
 * when it arrived through one, almost nothing on a cold load.
 */
export function useEntryDelay() {
  const { phase } = useRouter()
  const [delay] = useState(() => (phase === 'reveal' ? 0.35 : 0.1))
  return delay
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}

/*
 * A home-page section ("#features") to scroll to once the home page shows. Links to sections
 * set it when they're clicked on another page (a legal page, the 404), then go home.
 */
let section: string | null = null
export const queueSection = (hash: string) => void (section = hash)
export function takeSection() {
  const s = section
  section = null
  return s
}

/** Click handler for internal paths ("/login"). Hash and external links fall through untouched. */
export function useLinkClick(href: string | undefined) {
  const { navigate } = useRouter()
  if (!href?.startsWith('/')) return undefined
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(href)
  }
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const go = useLinkClick(to)
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        onClick?.(e)
        go?.(e)
      }}
    />
  )
}
