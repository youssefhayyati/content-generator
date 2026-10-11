import type { PlatformId } from '../components/ui/PlatformIcon'
import type { Case } from './cases'
import { LAB_EXAMPLES } from './lab-examples'

/*
 * What each Creative Lab template makes, shown by an example made with it: the template's own nodes,
 * run in FlowAI for a demo brand (the brands of the rest of the showcase), on the GPU pod's models
 * (Z-Image Turbo, FLUX.2 Klein, Wan 2.2, VoiceStudio, LatentSync, ACE-Step) with Kimi K3 writing.
 * The pictures, clips, voices and words are what came out. Where a template needs Higgsfield, which
 * wasn't connected, the example says what stood in for it, or shows a clip Higgsfield made before.
 */

export type LabMedia = {
  kind: 'image' | 'video' | 'audio'
  /** Full size. */
  src: string
  /** A picture's small size, for cards. */
  sm?: string
  /** A clip's first frame. */
  poster?: string
  w: number
  h: number
  /** Its average colour, holding the space while it loads. */
  tone: string
  alt: string
  seconds?: number
  /** A voice or music on it: the sheet offers to turn the sound on. */
  sound?: boolean
}

/**
 * How the result is best seen:
 *   picture   one picture, as posted
 *   carousel  slides
 *   reel      a vertical clip, as a phone plays it (with what it was made from, small, in the corner)
 *   panes     two or three side by side: two models, before and after a dub, the original and the restyle…
 *   compare   before and after, a slider between them (your photo, then edited)
 *   grid      several pictures at once (ads, a character in three scenes)
 *   post      words first, with a picture
 *   recording a recording heard, and the post written from it
 *   pack      several pieces from one brief
 */
export type LabLook = 'picture' | 'carousel' | 'reel' | 'panes' | 'compare' | 'grid' | 'post' | 'recording' | 'pack'

export type LabPane = { m: LabMedia; label: string }

export type LabExample = {
  /** The template's key. */
  key: string
  look: LabLook
  brand: Case['brand']
  platform: PlatformId
  /** What went in, in a sentence: the brief's offer, or what the template was handed. */
  given: string
  /** What it was made from, shown small beside the result (a portrait, a picture, a photo). */
  from?: LabMedia
  /** The result, in order. */
  made: LabMedia[]
  /** For panes, compare and grid: each one with what it is. */
  panes?: LabPane[]
  /** What it wrote: the headline, the caption, the lines, the post. */
  words: Array<{ label: string; text: string }>
  /** How this example was made, step by step, with the model of each. */
  steps: Array<{ did: string; model: string }>
  /** What to know about this example (what stood in for a tool that wasn't connected). */
  note?: string
}

export { LAB_EXAMPLES }

export const exampleFor = (key: string): LabExample | null => LAB_EXAMPLES[key] ?? null

/** The picture a template's card opens on: its result's first picture, or a clip's first frame. */
export function coverOf(ex: LabExample): LabMedia | null {
  const m = ex.panes?.[ex.look === 'compare' ? 1 : 0]?.m ?? ex.made[0]
  return m ?? null
}
