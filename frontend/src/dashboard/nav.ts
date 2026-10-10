import {
  AudioWaveform,
  CalendarClock,
  CalendarDays,
  Cpu,
  ChartColumn,
  Flame,
  GalleryVerticalEnd,
  FolderOpen,
  Inbox,
  LayoutGrid,
  Megaphone,
  MessageSquareText,
  PenLine,
  RadioTower,
  Repeat2,
  SearchCheck,
  Send,
  Settings,
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
}

export type NavGroup = { label: string | null; items: NavItem[] }

export const SETTINGS: NavItem = { path: '/dashboard/settings', label: 'Settings', icon: Settings }

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
      { path: '/dashboard/studio', label: 'Creative Lab', icon: Wand2 },
      { path: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
      { path: '/dashboard/create', label: 'Composer', icon: PenLine },
      { path: '/dashboard/reposts', label: 'Reposts', icon: Repeat2 },
      { path: '/dashboard/showcase', label: 'Showcase', icon: GalleryVerticalEnd },
    ],
  },
  {
    label: 'Plan',
    items: [
      { path: '/dashboard/inspire', label: 'Inspire', icon: Flame },
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

export const pageLabel = (path: string) => NAV.find((n) => n.path === path)?.label ?? 'Overview'
