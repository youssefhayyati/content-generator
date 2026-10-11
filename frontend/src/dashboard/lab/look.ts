import {
  Aperture,
  AudioLines,
  BadgePercent,
  Captions,
  Clapperboard,
  Combine,
  Eraser,
  Film,
  Frame,
  Image as ImageIcon,
  Images,
  Languages,
  Megaphone,
  Mic,
  Music2,
  NotebookPen,
  Palette,
  PenLine,
  PersonStanding,
  ScanFace,
  Scissors,
  Send,
  Signpost,
  Sparkles,
  SpeakerIcon,
  SquareUserRound,
  StickyNote,
  Type,
  TypeOutline,
  UserRound,
  Video,
  Wand2,
  MonitorPlay,
  type LucideIcon,
} from 'lucide-react'
import type { LabNode, LabNodeKind, LabPortType } from '../../lib/api'

/** One hue per group, so a graph reads at a glance; the chrome stays monochrome. */
export const GROUP_HUE: Record<string, string> = {
  source: '#f5b04c',
  higgsfield: '#c6f432',
  text: '#b49cff',
  image: '#6ee7f2',
  video: '#ff8fa3',
  audio: '#5ee39a',
  people: '#fb923c',
  clip: '#f472b6',
  finish: '#ecebe6',
  util: '#8a8a8a',
}

/** What travels on a line, by colour. */
export const PORT_HUE: Record<LabPortType, string> = {
  image: '#6ee7f2',
  video: '#ff8fa3',
  audio: '#5ee39a',
  text: '#b49cff',
  brief: '#f5b04c',
  moments: '#f472b6',
  transcript: '#c4b5fd',
  source: '#ff6b6b',
  channel: '#fcd34d',
  character: '#c6f432',
  post: '#ecebe6',
}

export const ICON: Record<string, LucideIcon> = {
  'source.media': Images,
  'source.text': Type,
  'source.brief': Megaphone,
  'source.youtube': MonitorPlay,
  'text.write': PenLine,
  'text.translate': Languages,
  'image.generate': ImageIcon,
  'image.edit': Wand2,
  'image.paint': Eraser,
  'image.frame': Frame,
  'video.generate': Video,
  'video.animate': Sparkles,
  'video.slideshow': Film,
  'video.reel': Clapperboard,
  'video.cut': Scissors,
  'video.captions': Captions,
  'video.mix': SpeakerIcon,
  'video.join': Combine,
  'audio.voice': Mic,
  'audio.music': Music2,
  'audio.transcribe': AudioLines,
  'people.swap': ScanFace,
  'people.dub': Languages,
  'clip.moments': NotebookPen,
  'finish.design': TypeOutline,
  'video.cinema': Aperture,
  'people.character': UserRound,
  'image.character': SquareUserRound,
  'people.motion': PersonStanding,
  'image.ads': BadgePercent,
  'video.restyle': Palette,
  'finish.channel': Signpost,
  'finish.post': Send,
  'util.note': StickyNote,
}

export const iconOf = (type: string) => ICON[type] ?? Sparkles
export const hueOf = (kind: LabNodeKind | undefined) => GROUP_HUE[kind?.group ?? 'util'] ?? '#8a8a8a'

/* Card geometry: the ports sit in rows under the header, so lines know where they end without
   measuring anything; the preview goes under the ports and can be any height. */
export const CARD_W = 268
export const HEAD_H = 48
export const ROW_H = 24
export const NOTE_W = 240

export const portRows = (kind: LabNodeKind | undefined) => Math.max(kind?.inputs.length ?? 0, kind?.outputs.length ?? 0)

/** Where a port is on the board. */
export function portPoint(node: LabNode, kind: LabNodeKind | undefined, side: 'in' | 'out', name: string) {
  const list = side === 'in' ? kind?.inputs ?? [] : kind?.outputs ?? []
  const i = Math.max(0, list.findIndex((p) => p.name === name))
  return { x: node.x + (side === 'in' ? 0 : CARD_W), y: node.y + HEAD_H + ROW_H * i + ROW_H / 2 }
}

/** A smooth line from an output (right) to an input (left). */
export function curve(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/** Whether an output of this type can go into that input. */
export const fits = (type: LabPortType, accepts: LabPortType[]) => accepts.includes(type)

export const fmtSeconds = (s: number) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)

/** "$0.40", "<$0.01", "$0": dollars as people read them. */
export const fmtMoney = (v: number) => (v === 0 ? '$0' : v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`)

/** "about 5 min, free" / "about 20 s, $0.40" / "about 1 min, ≈ $0.01 of pod time" / "about 2 min, cost unknown" */
export function costLine(e: { seconds: number; cost: number | null; pod?: number } | undefined) {
  if (!e) return ''
  const pod = e.pod ? `≈ ${fmtMoney(e.pod)} of pod time` : null
  const cost = e.cost === null ? 'cost unknown' : e.cost === 0 ? (pod ?? 'free') : `$${e.cost.toFixed(2)}${pod ? ` + ${pod}` : ''}`
  return `about ${fmtSeconds(e.seconds)}, ${cost}`
}
