import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  Clapperboard,
  Code,
  Image,
  Layers,
  LifeBuoy,
  Newspaper,
  ShieldCheck,
  Shuffle,
  Type,
  Users,
  WandSparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { ArtVariant } from '../ui/GenArt'

export type MenuItem = { label: string; desc: string; href: string; icon: LucideIcon }

export type Menu = {
  /** Headline in the panel's first column; the second part is set in the serif. */
  intro: [string, string]
  groups: Array<{ title: string; items: MenuItem[] }>
  feature: { tag: string; title: string; href: string; art: ArtVariant }
}

export type NavEntry = { label: string; href: string; menu?: Menu }

export const NAV: NavEntry[] = [
  {
    label: 'Product',
    href: '#product',
    menu: {
      intro: ['From first prompt', 'to published post.'],
      groups: [
        {
          title: 'Create',
          items: [
            { label: 'AI Studio', desc: 'Text, images and video from one prompt', href: '#studio', icon: WandSparkles },
            { label: 'Adaptation', desc: 'One idea, reshaped for every platform', href: '#adapt', icon: Shuffle },
          ],
        },
        {
          title: 'Ship',
          items: [
            { label: 'Calendar', desc: 'Plan and schedule in a single view', href: '#calendar', icon: CalendarDays },
            { label: 'Automations', desc: 'Workflows that run on a schedule', href: '#automations', icon: Workflow },
            { label: 'Analytics', desc: 'See what actually performs', href: '#analytics', icon: ChartColumn },
          ],
        },
      ],
      feature: { tag: 'Tour', title: 'The whole workspace, in one scroll', href: '#product', art: 'orb' },
    },
  },
  {
    label: 'Features',
    href: '#features',
    menu: {
      intro: ['One idea.', 'Every format.'],
      groups: [
        {
          title: 'Formats',
          items: [
            { label: 'Text', desc: 'Posts, captions, threads and articles', href: '#formats', icon: Type },
            { label: 'Images', desc: 'On-brand visuals in any aspect ratio', href: '#formats', icon: Image },
            { label: 'Video', desc: 'Short clips, cut for each feed', href: '#formats', icon: Clapperboard },
          ],
        },
        {
          title: 'Platform',
          items: [
            { label: 'Multi-platform', desc: 'Every network from one composer', href: '#platforms', icon: Layers },
            { label: 'Security', desc: 'Permission-based connections', href: '#security', icon: ShieldCheck },
            { label: 'Use cases', desc: 'Creators, agencies and teams', href: '#use-cases', icon: Users },
          ],
        },
      ],
      feature: { tag: 'Formats', title: 'Text, image and video from a single brief', href: '#formats', art: 'sun' },
    },
  },
  { label: 'Workflow', href: '#workflow' },
  { label: 'Showcase', href: '/showcase' },
  { label: 'Pricing', href: '#start' },
  {
    label: 'Resources',
    href: '#resources',
    menu: {
      intro: ['Learn the', 'workflow.'],
      groups: [
        {
          title: 'Learn',
          items: [
            { label: 'Documentation', desc: 'Set up your workspace step by step', href: '#resources', icon: BookOpen },
            { label: 'Guides', desc: 'Playbooks for repeatable content', href: '#resources', icon: Newspaper },
          ],
        },
        {
          title: 'Build',
          items: [
            { label: 'API', desc: 'Generate and publish from your own code', href: '#resources', icon: Code },
            { label: 'Support', desc: 'Talk to the people who built it', href: '#resources', icon: LifeBuoy },
          ],
        },
      ],
      feature: { tag: 'Guide', title: 'Build your first automation', href: '#automations', art: 'topo' },
    },
  },
]
