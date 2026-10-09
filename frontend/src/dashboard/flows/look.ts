import {
  AudioLines,
  Bell,
  Clapperboard,
  BookmarkPlus,
  CalendarClock,
  CalendarPlus,
  CircleX,
  CloudLightning,
  GitBranch,
  Gauge,
  History,
  Hourglass,
  Music2,
  MessageCircle,
  MessageSquareReply,
  MousePointerClick,
  OctagonPause,
  PenLine,
  RefreshCw,
  Repeat,
  Reply,
  Rss,
  Send,
  Snowflake,
  UserCheck,
  Webhook,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { Account, FlowCatalog, FlowEdge, FlowGraph, FlowGroup, FlowNode, FlowPort } from '../../lib/api'

/** A node card's size on the board. The API lays flows out top to bottom, on a 300 × 150 grid. */
export const NODE_W = 236
export const NODE_H = 74
export const ROW = 150
export const COLUMN = 300

/**
 * One hue per kind of step, so a flow reads at a glance: when (amber), AI (violet), logic
 * (cyan), you (rose), do (green). The chrome stays monochrome; the flow brings the colour.
 */
export const GROUP_HUE: Record<FlowGroup, string> = {
  trigger: '#f5b04c',
  ai: '#b49cff',
  logic: '#6ee7f2',
  human: '#ff8fa3',
  action: '#5ee39a',
}

export const ICON: Record<string, LucideIcon> = {
  'trigger.manual': MousePointerClick,
  'trigger.schedule': CalendarClock,
  'trigger.rss': Rss,
  'trigger.post_published': Send,
  'trigger.post_failed': CircleX,
  'trigger.comment': MessageCircle,
  'trigger.storm': CloudLightning,
  'ai.write': PenLine,
  'ai.rewrite': RefreshCw,
  'ai.score': Gauge,
  'ai.reply': MessageSquareReply,
  'ai.narrate': AudioLines,
  'ai.compose': Music2,
  'action.reel': Clapperboard,
  'logic.if': GitBranch,
  'logic.wait': Hourglass,
  'logic.evergreen': History,
  'human.approve': UserCheck,
  'action.post': CalendarPlus,
  'action.reply': Reply,
  'action.reschedule': Repeat,
  'action.hold': Snowflake,
  'action.pause_all': OctagonPause,
  'action.remember': BookmarkPlus,
  'action.notify': Bell,
  'action.webhook': Webhook,
}

export const iconOf = (type: string) => ICON[type] ?? Workflow
export const groupOf = (type: string): FlowGroup => (type.split('.')[0] as FlowGroup) ?? 'action'
export const hueOf = (type: string) => GROUP_HUE[groupOf(type)] ?? GROUP_HUE.action

/** Where along a node's bottom edge each port sits: the middle, or a third in from each side. */
export function portX(ports: FlowPort[], port: FlowPort) {
  if (ports.length < 2) return NODE_W / 2
  return ports.indexOf(port) === 0 ? NODE_W * 0.3 : NODE_W * 0.7
}

export const PORT_TONE: Record<FlowPort, string> = {
  next: 'var(--color-accent-soft)',
  yes: '#5ee39a',
  approved: '#5ee39a',
  no: '#ff8fa3',
  rejected: '#ff8fa3',
}

/** A gentle S down from a port to an input: the line that joins two steps. */
export function curve(x1: number, y1: number, x2: number, y2: number) {
  const dy = Math.max(36, Math.abs(y2 - y1) * 0.5)
  return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`
}

/** Where a line leaves a node through a port. */
export const portAt = (n: FlowNode, ports: FlowPort[], port: FlowPort) => ({ x: n.x + portX(ports, port), y: n.y + NODE_H })

export function edgePath(graph: FlowGraph, e: FlowEdge, ports: (type: string) => FlowPort[]) {
  const a = graph.nodes.find((n) => n.id === e.from)
  const b = graph.nodes.find((n) => n.id === e.to)
  if (!a || !b) return null
  const p = portAt(a, ports(a.type), e.port)
  return curve(p.x, p.y, b.x + NODE_W / 2, b.y)
}

const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const OPS: Record<string, string> = { gte: '≥', lte: '≤', eq: '=', contains: 'contains', not_contains: 'doesn’t contain', empty: 'is empty' }

const clip = (s: unknown, n = 44) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

const host = (url: unknown) => {
  try {
    return new URL(String(url)).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** One line under a node's name: what it's set to do. */
export function summaryOf(node: FlowNode, accounts: Account[] | null | undefined): string {
  const c = node.config ?? {}
  const handle = (fallback = 'Any account') => {
    const a = accounts?.find((x) => x.id === Number(c.account_id))
    return a ? `@${a.handle}` : fallback
  }
  switch (node.type) {
    case 'trigger.manual':
      return 'Only when you press Run'
    case 'trigger.schedule':
      return c.every === 'hour'
        ? `Every hour at :${String(c.at ?? '09:00').slice(3)}`
        : c.every === 'week'
          ? `Every ${WEEKDAYS[Number(c.weekday ?? 1)]} at ${c.at}`
          : `Every ${c.every === 'weekdays' ? 'weekday' : 'day'} at ${c.at}`
    case 'trigger.rss':
      return host(c.url) || 'No feed yet'
    case 'trigger.post_published':
    case 'trigger.post_failed':
    case 'trigger.comment':
    case 'trigger.storm':
      return handle()
    case 'ai.write':
      return c.brief ? clip(c.brief) : 'No brief yet'
    case 'ai.rewrite':
      return clip(c.how) || 'Rewrite'
    case 'ai.score':
      return clip(c.question) || 'Score 0–100'
    case 'ai.reply':
      return clip(c.guidance) || 'A short, warm reply'
    case 'ai.narrate':
      // Kokoro ids read as lang_name (af_heart → Heart); VoiceStudio ids are opaque (vs:…).
      return `${!c.voice ? 'The account’s voice' : String(c.voice).startsWith('vs:') ? 'VoiceStudio voice' : (String(c.voice).split('_')[1]?.replace(/^./, (x) => x.toUpperCase()) ?? String(c.voice))} · ${clip(c.text, 24) || '{{draft}}'}`
    case 'ai.compose':
      return `${c.mood === 'account' || !c.mood ? 'The account’s mood' : String(c.mood).replace('-', ' ')} · ${c.seconds} s`
    case 'action.reel':
      return `${String(c.style ?? 'bold').replace(/^./, (x) => x.toUpperCase())} · ${c.background === 'none' ? 'gradient' : 'the post’s picture'}`
    case 'logic.if':
      return c.op === 'empty' ? `${clip(c.value, 22)} is empty` : `${clip(c.value, 18)} ${OPS[String(c.op)] ?? c.op} ${clip(c.compare, 14)}`
    case 'logic.wait':
      return `${c.amount} ${Number(c.amount) === 1 ? String(c.unit).replace(/s$/, '') : c.unit}`
    case 'logic.evergreen':
      return `Older than ${c.older_than_days} days · ${handle()}`
    case 'human.approve':
      return clip(c.ask) || 'Go ahead?'
    case 'action.post':
      return `${handle('Trigger’s account')} · ${c.when === 'draft' ? 'as a draft' : c.when === 'in_hours' ? `in ${c.hours} h` : 'next free slot'}`
    case 'action.reply':
      return clip(c.body) || 'The drafted reply'
    case 'action.reschedule':
      return 'Next free queue slot'
    case 'action.hold':
      return handle('Trigger’s account')
    case 'action.pause_all':
      return 'Every phone stops'
    case 'action.remember':
      return `${c.kind === 'instruction' ? 'As an instruction' : 'As a liked example'} · ${handle('Trigger’s account')}`
    case 'action.notify':
      return clip(c.message) || 'A note in your Inbox'
    case 'action.webhook':
      return host(c.url) || 'No URL yet'
    default:
      return ''
  }
}

/** The variables a node can use: everything the steps before it leave behind. */
export function variablesFor(graph: FlowGraph, nodeId: string, catalog: FlowCatalog): string[] {
  const seen = new Set<string>()
  const out = new Set<string>()
  const walk = (id: string) => {
    for (const e of graph.edges.filter((x) => x.to === id)) {
      if (seen.has(e.from)) continue
      seen.add(e.from)
      const from = graph.nodes.find((n) => n.id === e.from)
      catalog.nodes[from?.type ?? '']?.produces.forEach((v) => out.add(v))
      walk(e.from)
    }
  }
  walk(nodeId)
  return [...out]
}

/** The steps in the order a run meets them: the trigger, then breadth first along the lines. */
export function ordered(graph: FlowGraph): Array<{ node: FlowNode; port: FlowPort | null; depth: number }> {
  const trigger = graph.nodes.find((n) => n.type.startsWith('trigger.'))
  if (!trigger) return []
  const out: Array<{ node: FlowNode; port: FlowPort | null; depth: number }> = [{ node: trigger, port: null, depth: 0 }]
  const seen = new Set([trigger.id])
  for (let i = 0; i < out.length; i++) {
    for (const e of graph.edges.filter((x) => x.from === out[i].node.id)) {
      const to = graph.nodes.find((n) => n.id === e.to)
      if (to && !seen.has(to.id)) {
        seen.add(to.id)
        out.push({ node: to, port: e.port, depth: out[i].depth + 1 })
      }
    }
  }
  return out
}

export const uid = () => Math.random().toString(36).slice(2, 8)
