import {
  AudioWaveform,
  CalendarClock,
  CalendarDays,
  Clapperboard,
  Cpu,
  ChartColumn,
  Flame,
  GalleryVerticalEnd,
  FolderOpen,
  Inbox,
  LayoutGrid,
  Megaphone,
  MessageSquareText,
  RadioTower,
  Repeat2,
  SearchCheck,
  Send,
  Settings,
  Shapes,
  Smartphone,
  UsersRound,
  Wand2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { Overview } from './data'

export type NavItem = {
  path: string
  label: string
  icon: LucideIcon
  /** A number beside the label. */
  count?: (o: Overview) => number
  /** Draw the count as something waiting on you, not just a tally. */
  urgent?: boolean
  /** A beating dot beside the label while this is true. */
  live?: (o: Overview) => boolean
  /** Other pages this entry stands for: a second view of the same place, reached by the switch in its header. */
  also?: string[]
}

export type NavGroup = { label: string | null; items: NavItem[] }

export const SETTINGS: NavItem = { path: '/dashboard/settings', label: 'Settings', icon: Settings }

/** The one-off generators (text, pictures, video, sound, reels, recipes): Creative Lab's quick tools, beside its canvas. */
export const GENERATORS = '/dashboard/generate'

/** Two views of one place, switched in the page header (PageSwitch); the sidebar shows them as one entry. */
export type View = { path: string; label: string }
export const LAB_VIEWS: View[] = [
  { path: '/dashboard/studio', label: 'Canvas' },
  { path: GENERATORS, label: 'Quick tools' },
]
export const INSPIRE_VIEWS: View[] = [
  { path: '/dashboard/inspire', label: 'Trending' },
  { path: '/dashboard/showcase', label: 'Made with FlowAI' },
]

/** The studio's pages, in the order the sidebar shows them. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { path: '/dashboard', label: 'Overview', icon: LayoutGrid },
      { path: '/dashboard/inbox', label: 'Inbox', icon: Inbox, count: (o) => o.inbox, urgent: true },
      { path: '/dashboard/comments', label: 'Comments', icon: MessageSquareText },
      { path: '/dashboard/live', label: 'Live', icon: RadioTower, live: (o) => o.counts.publishing > 0 },
    ],
  },
  {
    label: 'Create',
    items: [
      { path: '/dashboard/assistant', label: 'Assistant', icon: AudioWaveform },
      // One entry, two views: the canvas of nodes, and the one-off generators as its quick tools.
      { path: '/dashboard/studio', label: 'Creative Lab', icon: Wand2, also: [GENERATORS] },
      // Highlights from a link: not a canvas node, so its own page.
      { path: '/dashboard/clips', label: 'Highlights', icon: Clapperboard },
      { path: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
    ],
  },
  {
    label: 'Plan',
    items: [
      // What's trending, and what FlowAI has made (the showcase): both are places to start from.
      { path: '/dashboard/inspire', label: 'Inspire', icon: Flame, also: ['/dashboard/showcase'] },
      { path: '/dashboard/calendar', label: 'Calendar', icon: CalendarDays, count: (o) => o.counts.scheduled },
      { path: '/dashboard/library', label: 'Gallery', icon: FolderOpen, count: (o) => o.counts.total },
      { path: '/dashboard/automations', label: 'Automations', icon: CalendarClock },
      { path: '/dashboard/flows', label: 'Flows', icon: Workflow, count: (o) => o.automation?.flows_on ?? 0 },
    ],
  },
  {
    label: 'Publish',
    items: [
      { path: '/dashboard/publishing', label: 'Publishing', icon: Send },
      { path: '/dashboard/reposts', label: 'Reposts', icon: Repeat2 },
      { path: '/dashboard/accounts', label: 'Accounts', icon: UsersRound },
      { path: '/dashboard/phones', label: 'Phones', icon: Smartphone },
    ],
  },
  {
    label: 'Measure',
    items: [
      { path: '/dashboard/analytics', label: 'Analytics', icon: ChartColumn },
      { path: '/dashboard/investigations', label: 'Investigations', icon: SearchCheck },
    ],
  },
  {
    label: 'Setup',
    items: [{ path: '/dashboard/models', label: 'Models', icon: Cpu }, SETTINGS],
  },
]

/** Every page, Settings included. */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/** Where every "New post" goes, from anywhere: the Composer. */
export const NEW_POST = '/dashboard/create'

/** Pages with no entry of their own that still have a name: the Composer is the New post button. */
const UNLISTED: Array<Pick<NavItem, 'path' | 'label'>> = [{ path: NEW_POST, label: 'Composer' }]

/** Whether a sidebar entry is the page being shown, either itself or one of its views. */
export const covers = (n: NavItem, path: string) => n.path === path || !!n.also?.includes(path)

/** A page's second views, for the search palette: found by their own names. */
export const VIEWS: Array<View & { icon: LucideIcon }> = [
  { path: GENERATORS, label: 'Quick tools', icon: Shapes },
  { path: '/dashboard/showcase', label: 'Showcase', icon: GalleryVerticalEnd },
]

export const pageLabel = (path: string) => NAV.find((n) => covers(n, path))?.label ?? UNLISTED.find((n) => n.path === path)?.label ?? 'Overview'
