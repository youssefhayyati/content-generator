import type { PlatformId } from '../../components/ui/PlatformIcon'

/** The composer's tones (PostPrompt::TONES on the API). */
export type Tone = 'professional' | 'friendly' | 'bold' | 'playful'

export type Slot = { weekday: number; time: string }

export type RhythmId = 'light' | 'weekdays' | 'twice' | 'daily' | 'later'

/** Everything the onboarding asks, in the order it asks. */
export type Answers = {
  brand: string
  about: string
  tone: Tone
  avoid: string
  platform: PlatformId
  handle: string
  rhythm: RhythmId
  palette: string
}

const days = (list: number[], time: string) => list.map((weekday) => ({ weekday, time }))
const WEEKDAYS = [1, 2, 3, 4, 5]

export const RHYTHMS: Array<{ id: RhythmId; name: string; detail: string; slots: Slot[] }> = [
  { id: 'light', name: 'Easy start', detail: 'Monday, Wednesday and Friday at 12:00', slots: days([1, 3, 5], '12:00') },
  { id: 'weekdays', name: 'Every weekday', detail: 'Monday to Friday at 09:30', slots: days(WEEKDAYS, '09:30') },
  { id: 'twice', name: 'Morning and evening', detail: 'Weekdays at 09:00 and 17:30', slots: [...days(WEEKDAYS, '09:00'), ...days(WEEKDAYS, '17:30')] },
  { id: 'daily', name: 'Every day', detail: 'Seven days a week at 18:00', slots: days([1, 2, 3, 4, 5, 6, 7], '18:00') },
  { id: 'later', name: 'I’ll pick times later', detail: 'Posts wait until you give them a time', slots: [] },
]

/** Each tone with a line in it, so the choice is heard rather than described. */
export const TONES: Array<{ id: Tone; name: string; line: (brand: string) => string }> = [
  { id: 'friendly', name: 'Friendly', line: (b) => `Hi, we’re ${b}. We made something we think you’ll love.` },
  { id: 'professional', name: 'Professional', line: (b) => `${b}: considered work, made to last. Here’s what we’ve been building.` },
  { id: 'bold', name: 'Bold', line: (b) => `${b} is here. Forget ordinary.` },
  { id: 'playful', name: 'Playful', line: (b) => `Warning: ${b} may cause sudden joy. Scroll on at your own risk.` },
]

/** "Maison Cire" → "maisoncire": a likely handle to start from. */
export const handleFrom = (brand: string) =>
  brand
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._]+/g, '')
    .slice(0, 30)

export const monogram = (brand: string) => (brand.trim()[0] ?? '·').toUpperCase()

/** The brief behind the first post. The account's voice (tone, topics, words to avoid) travels with it. */
export function firstBrief(a: Answers, withAccount: boolean) {
  const brief = [
    `This is ${a.brand.trim()}'s very first post. Introduce ${a.brand.trim()}: ${a.about.trim()}.`,
    'Make it feel like the start of something, and end by inviting people to follow along.',
  ]
  // Without an account there is no saved voice, so the words to avoid ride in the brief.
  if (!withAccount && a.avoid.trim()) brief.push(`Avoid: ${a.avoid.trim()}.`)
  return brief.join(' ')
}

/** Written from the answers when AI can't write it: plain, honest, and still theirs. */
export function fallbackPost(a: Answers) {
  const brand = a.brand.trim()
  const about = a.about.trim().replace(/\.$/, '')
  const opening = {
    friendly: `Hi, we’re ${brand}.`,
    professional: `Introducing ${brand}.`,
    bold: `${brand} is here.`,
    playful: `Psst. ${brand} just arrived.`,
  }[a.tone]
  return `${opening} ${about.charAt(0).toUpperCase()}${about.slice(1)}.\n\nThis is where we’ll share what we make, how we make it, and what comes next. Follow along.`
}
