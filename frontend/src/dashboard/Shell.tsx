import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  CornerDownLeft,
  LogOut,
  Mail,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useLenis } from 'lenis/react'
import { LogoMark } from '../components/ui/Logo'
import { api, type Page, type Post, type User } from '../lib/api'
import { authApi } from '../lib/auth'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import { firstName, fmtRelative, postState, titleOf, useApi, type Overview } from './data'
import { NAV, NAV_GROUPS, pageLabel, SETTINGS, type NavItem } from './nav'
import { useToast } from './toast'
import { Avatar, Kbd, Menu, Platforms, StateBadge } from './ui'

export { pageLabel }

/* ------------------------------------------------------------------ */
/* Shared overview data: sidebar counts and the Overview page read one fetch */
/* ------------------------------------------------------------------ */

const OverviewContext = createContext<{ data: Overview | null; loading: boolean }>({ data: null, loading: true })
export const useOverview = () => useContext(OverviewContext)

/** The signed-in user. The shell only renders once there is one. */
export function useUser(): User {
  const { user } = useSession()
  if (!user) throw new Error('useUser needs a signed-in user')
  return user
}

export const workspaceName = (user: User) => user.preferences.studio?.trim() || `${firstName(user.name)}’s studio`

/** Small UI choices that should survive a reload. Private windows may refuse storage; that's fine. */
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* not saved, still works */
  }
}

/* ------------------------------------------------------------------ */

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser()
  const overview = useApi<Overview>('/overview')
  const { path, navigate } = useRouter()
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const [rail, setRail] = useState(() => remembered('flowai.sidebar.rail', false))

  useEffect(() => remember('flowai.sidebar.rail', rail), [rail])

  // ⌘K / Ctrl+K opens the palette; N starts a post and [ folds the sidebar when you're not typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
        return
      }
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        navigate('/dashboard/create')
      } else if (e.key === '[') {
        e.preventDefault()
        setRail((r) => !r)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  useEffect(() => setDrawer(false), [path])

  return (
    <OverviewContext.Provider value={{ data: overview.data, loading: overview.loading }}>
      {/* --sidebar-w lets anything pinned to the viewport (bottom bars) clear the sidebar. */}
      <div className="min-h-dvh bg-ink text-fg" style={{ '--sidebar-w': rail ? '64px' : '248px' } as CSSProperties}>
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-w)] overflow-hidden border-r border-line bg-panel transition-[width] duration-300 ease-expo lg:block">
          <Sidebar overview={overview.data} rail={rail} />
        </aside>

        <AnimatePresence>
          {drawer && (
            <>
              <motion.div
                className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDrawer(false)}
              />
              <motion.aside
                className="fixed inset-y-0 left-0 z-50 w-[272px] border-r border-line bg-panel lg:hidden"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.5, ease }}
                data-lenis-prevent
              >
                <Sidebar overview={overview.data} onClose={() => setDrawer(false)} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="transition-[padding] duration-300 ease-expo lg:pl-[var(--sidebar-w)]">
          <TopBar onMenu={() => setDrawer(true)} onSearch={() => setPalette(true)} rail={rail} onRail={() => setRail((r) => !r)} />
          {!user.email_verified && <VerifyBanner email={user.email} />}
          <main className="mx-auto w-full max-w-[1680px] px-4 pb-24 pt-8 md:px-6 md:pt-10">{children}</main>
        </div>

        <CommandPalette open={palette} onClose={() => setPalette(false)} />
      </div>
    </OverviewContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                              */
/* ------------------------------------------------------------------ */

function Sidebar({ overview, rail = false, onClose }: { overview: Overview | null; rail?: boolean; onClose?: () => void }) {
  const user = useUser()
  const { path, navigate } = useRouter()
  const { signOut } = useSession()
  const [folded, setFolded] = useState<string[]>(() => remembered('flowai.sidebar.folded', []))
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)

  useEffect(() => remember('flowai.sidebar.folded', folded), [folded])
  useEffect(() => setTip(null), [rail, path])

  const logOut = async () => {
    // Head for the door first, so the guard doesn't add a ?next= back to here.
    navigate('/login')
    await signOut()
  }

  const go = (to: string) => (e: ReactMouseEvent) => {
    e.preventDefault()
    navigate(to)
  }

  // On the rail the labels are hidden, so each icon names itself on hover.
  const tipProps = (label: string) =>
    rail
      ? {
          onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect()
            setTip({ label, top: r.top + r.height / 2 })
          },
          onMouseLeave: () => setTip(null),
        }
      : {}

  const fade = cn('whitespace-nowrap transition-opacity duration-200', rail && 'pointer-events-none opacity-0')

  const item = (n: NavItem) => {
    const active = path === n.path
    const Icon = n.icon
    const count = overview && n.count ? n.count(overview) : 0
    const live = overview && n.live ? n.live(overview) : false
    return (
      <a
        key={n.path}
        href={n.path}
        onClick={go(n.path)}
        aria-current={active ? 'page' : undefined}
        {...tipProps(n.label)}
        className={cn(
          'group flex h-7 items-center gap-2.5 rounded-md pl-3 pr-2 text-[13px] transition-[width,background-color,color] duration-300 ease-expo',
          rail ? 'w-10' : 'w-full',
          active ? 'bg-white/[0.08] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg',
        )}
      >
        <span className="relative shrink-0">
          <Icon className={cn('size-4 transition-colors', active ? 'text-fg' : 'text-dim group-hover:text-muted')} strokeWidth={1.75} />
          {rail && n.urgent && count > 0 && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent ring-2 ring-panel" />}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', fade)}>{n.label}</span>
        <span className={cn('flex shrink-0 items-center gap-2', fade)}>
          {live && <span className="status-beat size-1.5 rounded-full bg-ok" aria-label="Posting now" />}
          {count > 0 &&
            (n.urgent ? (
              <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1.5 text-[10.5px] font-medium tabular-nums text-on-accent">
                {count}
              </span>
            ) : (
              <span className="text-[11px] tabular-nums text-dim">{count}</span>
            ))}
        </span>
      </a>
    )
  }

  return (
    <div className={cn('flex h-full flex-col', onClose ? 'w-full' : 'w-[248px]')}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <Menu
          className="min-w-0 flex-1"
          align="left"
          header={
            <div className="mb-1 flex items-center gap-2.5 border-b border-line px-2.5 pb-2.5 pt-1.5">
              <Avatar user={user} />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] text-fg">{user.name}</p>
                <p className="truncate text-[11.5px] text-dim">{user.email}</p>
              </div>
            </div>
          }
          items={[
            { label: 'Settings', icon: Settings, onSelect: () => navigate(SETTINGS.path) },
            { label: 'Back to the site', icon: ArrowLeft, onSelect: () => navigate('/') },
            { label: 'Log out', icon: LogOut, onSelect: logOut, danger: true },
          ]}
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-label={rail ? workspaceName(user) : undefined}
              {...tipProps(workspaceName(user))}
              className={cn(
                'flex min-w-0 items-center gap-2.5 rounded-md py-1.5 pl-1.5 pr-2 text-left transition-[width,background-color] duration-300 ease-expo hover:bg-white/[0.04]',
                rail ? 'w-10' : 'w-full',
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-bone text-ink">
                <LogoMark className="size-4" />
              </span>
              <span className={cn('min-w-0 flex-1', fade)}>
                <span className="block truncate text-[13px] font-medium leading-tight">{workspaceName(user)}</span>
                <span className="block truncate text-[11px] leading-tight text-dim">{user.email}</span>
              </span>
              <ChevronsUpDown className={cn('size-3.5 shrink-0 text-dim', fade)} />
            </button>
          )}
        />
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close menu" className="grid size-8 place-items-center text-dim hover:text-fg">
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="shrink-0 px-3 pb-1 pt-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard/create')}
          aria-label={rail ? 'New post' : undefined}
          {...tipProps('New post  N')}
          className={cn(
            'group flex h-8 items-center gap-2 rounded-md bg-fg px-3 text-[13px] font-medium text-ink transition-[width,background-color] duration-300 ease-expo hover:bg-white',
            rail ? 'w-10' : 'w-full',
          )}
        >
          <Plus className="size-4 shrink-0" strokeWidth={2} />
          <span className={fade}>New post</span>
          <Kbd className={cn('ml-auto border-ink/15 text-ink/45', fade)}>N</Kbd>
        </button>
      </div>

      <nav className="no-scrollbar mask-y min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2" aria-label="Workspace" data-lenis-prevent>
        {NAV_GROUPS.map((group, i) => {
          const isFolded = !rail && !!group.label && folded.includes(group.label)
          // A folded section still shows the page you're on.
          const shown = isFolded ? group.items.filter((n) => n.path === path) : group.items
          return (
            <div key={group.label ?? i}>
              {group.label && (
                <button
                  type="button"
                  disabled={rail}
                  aria-expanded={!isFolded}
                  onClick={() => setFolded((f) => (f.includes(group.label!) ? f.filter((l) => l !== group.label) : [...f, group.label!]))}
                  className="group relative mt-2 flex h-6 w-full items-center gap-1 rounded-md pl-3 pr-2 text-left text-[11.5px] font-medium text-dim transition-colors hover:text-muted"
                >
                  <span className={fade}>{group.label}</span>
                  <ChevronRight
                    className={cn(
                      'size-3 transition-[rotate,opacity] duration-200',
                      isFolded ? 'opacity-100' : 'rotate-90 opacity-0 group-hover:opacity-100',
                      rail && 'hidden',
                    )}
                  />
                  {rail && <span aria-hidden className="absolute left-[22px] h-px w-5 bg-line-2" />}
                </button>
              )}
              <AnimatePresence initial={false}>
                {shown.map((n) => (
                  <motion.div
                    key={n.path}
                    className="overflow-hidden"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease }}
                  >
                    {item(n)}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-line p-3">
        <UpNext overview={overview} rail={rail} tipProps={tipProps} />
      </div>

      <AnimatePresence>
        {rail && tip && (
          <motion.div
            key={tip.label}
            role="tooltip"
            className="pointer-events-none fixed left-[72px] z-[60] -translate-y-1/2 whitespace-pre rounded-md border border-line-2 bg-panel-3 px-2 py-1 text-[12px] text-fg shadow-[0_8px_24px_-8px_rgb(0_0_0_/_0.8)]"
            style={{ top: tip.top }}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {tip.label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * What the queue is doing, pinned under the pages: the next post out, or the one thing
 * stopping posts from going out.
 */
function UpNext({
  overview,
  rail,
  tipProps,
}: {
  overview: Overview | null
  rail: boolean
  tipProps: (label: string) => object
}) {
  const { navigate } = useRouter()
  if (!overview) return <div className={cn('skeleton rounded-lg', rail ? 'size-10' : 'h-[70px]')} />

  const frozen = overview.automation?.frozen?.length ?? 0
  const next = overview.upcoming[0]
  const s: { tone: 'ok' | 'warn' | 'idle'; label: string; title: string; meta: ReactNode; to: string } = overview.publishing_paused
    ? { tone: 'warn', label: 'Publishing paused', title: 'Scheduled posts are on hold', meta: 'Resume in Publishing', to: '/dashboard/publishing' }
    : frozen > 0
      ? { tone: 'warn', label: 'Storm Guard', title: `${frozen} account${frozen === 1 ? '' : 's'} paused`, meta: 'Review in Accounts', to: '/dashboard/accounts' }
      : overview.due > 0
        ? { tone: 'warn', label: 'Due now', title: `${overview.due} post${overview.due === 1 ? '' : 's'} to post by hand`, meta: 'Open the calendar', to: '/dashboard/calendar' }
        : next?.scheduled_at
          ? {
              tone: 'ok',
              label: 'Up next',
              title: titleOf(next),
              meta: (
                <>
                  <span className="capitalize">{fmtRelative(next.scheduled_at)}</span>
                  <Platforms ids={next.platforms} className="ml-auto gap-1 text-dim [&_svg]:size-3" />
                </>
              ),
              to: '/dashboard/calendar',
            }
          : { tone: 'idle', label: 'Queue', title: 'Nothing scheduled', meta: 'Plan your next post', to: '/dashboard/calendar' }

  const dot = { ok: 'bg-ok', warn: 'bg-warn', idle: 'bg-dim' }[s.tone]

  return (
    <a
      href={s.to}
      onClick={(e) => {
        e.preventDefault()
        navigate(s.to)
      }}
      {...tipProps(`${s.label}: ${s.title}`)}
      className={cn(
        'group relative block overflow-hidden rounded-lg border transition-[width,height,border-color,background-color] duration-300 ease-expo',
        rail ? 'size-10' : 'h-[70px] w-full',
        s.tone === 'warn' ? 'border-warn/25 bg-warn/[0.05] hover:border-warn/40' : 'border-line bg-white/[0.015] hover:border-line-2 hover:bg-white/[0.03]',
      )}
    >
      {rail ? (
        <span className="absolute inset-0 grid place-items-center">
          <Clock className="size-4 text-dim" strokeWidth={1.75} />
          <span className={cn('absolute right-[9px] top-[9px] size-1.5 rounded-full', dot)} />
        </span>
      ) : (
        <span className="block w-[222px] px-2.5 py-[9px]">
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className={cn('size-1.5 shrink-0 rounded-full', dot)} />
            <span className="font-medium text-muted">{s.label}</span>
            {s.tone === 'ok' && <span className="ml-auto tabular-nums text-dim">{overview.counts.scheduled} queued</span>}
          </span>
          <span className="mt-1 block truncate text-[12.5px] leading-snug text-fg">{s.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">{s.meta}</span>
        </span>
      )}
    </a>
  )
}

/* ------------------------------------------------------------------ */
/* Top bar                                                              */
/* ------------------------------------------------------------------ */

function TopBar({ onMenu, onSearch, rail, onRail }: { onMenu: () => void; onSearch: () => void; rail: boolean; onRail: () => void }) {
  const user = useUser()
  const { path } = useRouter()
  const label = pageLabel(path)

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink/80 px-4 backdrop-blur-xl md:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="-ml-1 grid size-8 place-items-center rounded-md text-muted hover:bg-white/[0.05] hover:text-fg lg:hidden"
      >
        <MenuIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRail}
        aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
        title={`${rail ? 'Expand' : 'Collapse'} sidebar  [`}
        className="-ml-2 hidden size-8 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.05] hover:text-fg lg:grid"
      >
        {rail ? <PanelLeftOpen className="size-4" strokeWidth={1.75} /> : <PanelLeftClose className="size-4" strokeWidth={1.75} />}
      </button>
      <LogoMark className="size-4 lg:hidden" />
      <p className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <span className="hidden truncate text-dim sm:inline">{workspaceName(user)}</span>
        <span className="hidden text-dim sm:inline">/</span>
        <span className="relative h-5 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={label}
              className="block leading-5 text-fg"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: '0%', opacity: 1 }}
              exit={{ y: '-100%', opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
      </p>

      <button
        type="button"
        onClick={onSearch}
        className="ml-auto flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-[12px] text-dim transition-colors hover:border-line-2 hover:text-muted sm:w-56"
      >
        <Search className="size-3.5" strokeWidth={1.75} />
        <span className="hidden sm:inline">Search posts & pages</span>
        <Kbd className="ml-auto hidden sm:inline">⌘K</Kbd>
      </button>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Email confirmation                                                   */
/* ------------------------------------------------------------------ */

function VerifyBanner({ email }: { email: string }) {
  const [hidden, setHidden] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const toast = useToast()

  const resend = async () => {
    setState('sending')
    try {
      await authApi.resendVerification()
      setState('sent')
    } catch (e) {
      setState('idle')
      toast(e instanceof Error ? e.message : 'Couldn’t send the link.', 'error')
    }
  }

  return (
    <AnimatePresence initial={false}>
      {!hidden && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease }}
          className="overflow-hidden border-b border-accent/20 bg-accent/[0.07]"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[12.5px] md:px-6">
            <Mail className="size-3.5 text-accent-soft" strokeWidth={1.75} />
            <p className="text-muted">
              Confirm <span className="text-fg">{email}</span> to keep your account secure.
            </p>
            <button
              type="button"
              onClick={resend}
              disabled={state !== 'idle'}
              className="font-medium text-accent-soft transition-colors hover:text-fg disabled:text-dim"
            >
              {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent. Check your inbox.' : 'Resend the link'}
            </button>
            <button type="button" onClick={() => setHidden(true)} aria-label="Dismiss" className="ml-auto text-dim hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------------ */
/* ⌘K                                                                   */
/* ------------------------------------------------------------------ */

type Result = { key: string; label: string; hint?: ReactNode; icon: LucideIcon; to: string }

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter()
  const lenis = useLenis()
  const [q, setQ] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    lenis?.stop()
    const t = window.setTimeout(() => input.current?.focus(), 30)
    return () => {
      window.clearTimeout(t)
      lenis?.start()
    }
  }, [open, lenis])

  // Search posts as you type, a beat after you stop.
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      api<Page<Post>>('/posts', { query: { q: q.trim() || undefined, per_page: 6 } })
        .then((r) => setPosts(r.data))
        .catch(() => setPosts([]))
    }, 180)
    return () => window.clearTimeout(t)
  }, [q, open])

  const needle = q.trim().toLowerCase()
  const pages: Result[] = [
    { key: 'new', label: 'New post', icon: Plus, to: '/dashboard/create', hint: <Kbd>N</Kbd> },
    ...NAV.map((n) => ({ key: n.path, label: n.label, icon: n.icon, to: n.path })),
  ].filter((r) => !needle || r.label.toLowerCase().includes(needle))
  const found: Result[] = posts.map((p) => ({
    key: `post-${p.id}`,
    label: titleOf(p),
    icon: PenLine,
    to: `/dashboard/create?post=${p.id}`,
    hint: (
      <span className="flex items-center gap-2">
        <Platforms ids={p.platforms} />
        <StateBadge state={postState(p)} />
      </span>
    ),
  }))
  const results = [...pages, ...found]

  const go = (r: Result | undefined) => {
    if (!r) return
    onClose()
    navigate(r.to)
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[active])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const row = (r: Result, i: number) => {
    const Icon = r.icon
    return (
      <button
        key={r.key}
        type="button"
        onMouseMove={() => setActive(i)}
        onClick={() => go(r)}
        className={cn(
          'relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] transition-colors',
          active === i ? 'text-fg' : 'text-muted',
        )}
      >
        {active === i && (
          <motion.span layoutId="palette-active" className="absolute inset-0 rounded-md bg-white/[0.06]" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />
        )}
        <Icon className="relative size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="relative min-w-0 flex-1 truncate">{r.label}</span>
        <span className="relative shrink-0">{active === i ? <CornerDownLeft className="size-3.5 text-dim" /> : r.hint}</span>
      </button>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-label="Search"
            data-lenis-prevent
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line-2 bg-panel-2 shadow-[0_40px_120px_-30px_rgb(0_0_0_/_0.95)]"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.3, ease }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-dim" strokeWidth={1.75} />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKey}
                placeholder="Search posts, or jump to a page…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {pages.length > 0 && <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Go to</p>}
              {pages.map((r, i) => row(r, i))}
              {found.length > 0 && <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Posts</p>}
              {found.map((r, i) => row(r, pages.length + i))}
              {results.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-dim">Nothing matches “{q}”.</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
