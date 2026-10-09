import {
  CalendarClock,
  CalendarDays,
  Cpu,
  ChartColumn,
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
}

export type NavGroup = { label: string | null; items: NavItem[] }

/** The studio's pages, in the order the sidebar shows them. Page numbers follow this order. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { path: '/dashboard', label: 'Overview', icon: LayoutGrid },
      { path: '/dashboard/inbox', label: 'Inbox', icon: Inbox, count: (o) => o.inbox, urgent: true },
      { path: '/dashboard/live', label: 'Live', icon: RadioTower },
    ],
  },
  {
    label: 'Create',
    items: [
      { path: '/dashboard/studio', label: 'Creative Lab', icon: Wand2 },
      { path: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
      { path: '/dashboard/create', label: 'Composer', icon: PenLine },
      { path: '/dashboard/reposts', label: 'Reposts', icon: Repeat2 },
    ],
  },
  {
    label: 'Automate',
    items: [{ path: '/dashboard/flows', label: 'Flows', icon: Workflow, count: (o) => o.automation?.flows_on ?? 0 }],
  },
  {
    label: 'Engage',
    items: [{ path: '/dashboard/comments', label: 'Comments', icon: MessageSquareText }],
  },
  {
    label: 'Plan',
    items: [
      { path: '/dashboard/calendar', label: 'Calendar', icon: CalendarDays, count: (o) => o.counts.scheduled },
      { path: '/dashboard/library', label: 'Gallery', icon: FolderOpen, count: (o) => o.counts.total },
      { path: '/dashboard/automations', label: 'Automations', icon: CalendarClock },
    ],
  },
  {
    label: 'Publish',
    items: [
      { path: '/dashboard/accounts', label: 'Accounts', icon: UsersRound },
      { path: '/dashboard/phones', label: 'Phones', icon: Smartphone },
      { path: '/dashboard/publishing', label: 'Publishing', icon: Send },
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
    items: [{ path: '/dashboard/models', label: 'Models', icon: Cpu }],
  },
]

export const SETTINGS: NavItem = { path: '/dashboard/settings', label: 'Settings', icon: Settings }

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

const ALL = [...NAV, SETTINGS]

export const pageLabel = (path: string) => ALL.find((n) => n.path === path)?.label ?? 'Overview'

/** "04" for the fourth page in the sidebar: the number in each page's header. */
export const pageIndex = (path: string) => String(Math.max(1, ALL.findIndex((n) => n.path === path) + 1)).padStart(2, '0')
