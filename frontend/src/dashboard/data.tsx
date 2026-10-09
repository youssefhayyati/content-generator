import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { PlatformId } from '../components/ui/PlatformIcon'
import { api, ApiError, type Post } from '../lib/api'

/* ------------------------------------------------------------------ */
/* Fetching                                                             */
/* ------------------------------------------------------------------ */

/** Bumped after every write, so every view on screen refetches and the numbers agree. */
const VersionContext = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} })

export function DataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return <VersionContext.Provider value={{ version, bump }}>{children}</VersionContext.Provider>
}

export const useInvalidate = () => useContext(VersionContext).bump
export const useVersion = () => useContext(VersionContext).version

/** `value`, but only once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}

type Query = Record<string, string | number | boolean | null | undefined>

/**
 * GET with loading and error state. While a refetch is in flight the previous data
 * stays on screen (`loading` flips, `data` doesn't blank), so nothing jumps.
 */
export function useApi<T>(path: string | null, query?: Query) {
  const { version } = useContext(VersionContext)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(!!path)
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setLoading(true)
    api<T>(path, { query })
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e : new ApiError(0, String(e))))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // `key` stands in for path + query.
  }, [key, version])

  return { data, error, loading, setData }
}

/* ------------------------------------------------------------------ */
/* Shapes of the aggregate endpoints                                    */
/* ------------------------------------------------------------------ */

export type Overview = {
  counts: { draft: number; scheduled: number; published: number; publishing: number; failed: number; total: number }
  /** Things waiting on a person (the Inbox). */
  inbox: number
  publishing_paused: boolean
  due: number
  upcoming: Post[]
  drafts: Post[]
  week: Array<{ date: string; count: number }>
  platforms: Partial<Record<PlatformId, number>>
  next_slot: string | null
  /** Flows working, runs waiting on you, accounts Storm Guard froze. */
  automation: { flows_on: number; runs_today: number; waiting_on_you: number; frozen: Array<{ id: number; handle: string; platform: PlatformId }> }
}

export type QueueState = {
  timezone: string
  slots: Array<{ id: number; weekday: number; time: string }>
  upcoming: Array<{ at: string; post: { id: number; title: string; platforms: PlatformId[] } | null }>
  next_free: string | null
}

export type Analytics = {
  range: number
  days: Array<{ date: string; created: number; scheduled: number; published: number }>
  totals: Record<'created' | 'scheduled' | 'published', { now: number; before: number }> & { drafts: number }
  platforms: Partial<Record<PlatformId, number>>
  formats: Partial<Record<'text' | 'image' | 'video', number>>
  /** [weekday 0 = Monday][hour 0–23] */
  heatmap: number[][]
}

/* ------------------------------------------------------------------ */
/* Posts                                                                */
/* ------------------------------------------------------------------ */

export const PLATFORM_ORDER: PlatformId[] = ['instagram', 'tiktok', 'x', 'linkedin', 'facebook', 'youtube', 'pinterest']

/** Mirrors App\Enums\Platform::characterLimit() on the API. */
export const CHAR_LIMIT: Record<PlatformId, number> = {
  x: 280,
  pinterest: 500,
  instagram: 2200,
  tiktok: 2200,
  linkedin: 3000,
  youtube: 5000,
  facebook: 63206,
}

/** What a post is right now. "Due" is scheduled for a time that has already passed. */
export type PostState = 'draft' | 'scheduled' | 'due' | 'publishing' | 'submitted' | 'published' | 'failed'

export function postState(post: Post, now = Date.now()): PostState {
  if (post.status === 'scheduled' && post.scheduled_at && Date.parse(post.scheduled_at) < now) return 'due'
  return post.status
}

export const STATE: Record<PostState, { label: string; dot: string; text: string; ring: string; tone: string }> = {
  draft: { label: 'Draft', dot: 'bg-draft', text: 'text-muted', ring: 'border-white/10', tone: 'border-l-draft bg-white/[0.03] border-dashed' },
  scheduled: { label: 'Scheduled', dot: 'bg-plan', text: 'text-plan', ring: 'border-plan/30', tone: 'border-l-plan bg-plan/[0.08]' },
  due: { label: 'Due', dot: 'bg-warn', text: 'text-warn', ring: 'border-warn/30', tone: 'border-l-warn bg-warn/[0.08]' },
  publishing: { label: 'Publishing', dot: 'bg-accent-soft animate-pulse', text: 'text-accent-soft', ring: 'border-accent/30', tone: 'border-l-accent-soft bg-accent/[0.08]' },
  submitted: { label: 'Unconfirmed', dot: 'bg-warn', text: 'text-warn', ring: 'border-warn/30', tone: 'border-l-warn bg-warn/[0.06] border-dashed' },
  published: { label: 'Published', dot: 'bg-ok', text: 'text-ok', ring: 'border-ok/25', tone: 'border-l-ok bg-ok/[0.06]' },
  failed: { label: 'Failed', dot: 'bg-fail', text: 'text-fail', ring: 'border-fail/30', tone: 'border-l-fail bg-fail/[0.08]' },
}

/**
 * Move a post between states from a list or the calendar. The API validates whole posts,
 * so the rest of it goes along unchanged.
 */
export function setPostStatus(post: Post, status: Post['status']) {
  return api<Post>(`/posts/${post.id}`, {
    method: 'PUT',
    body: {
      title: post.title,
      body: post.body,
      format: post.format,
      platforms: post.platforms,
      status,
      scheduled_at: status === 'draft' ? null : post.scheduled_at,
    },
  })
}

/** A post's display title: its own, or the first words of the body. */
export const titleOf = (post: Pick<Post, 'title' | 'body'>) =>
  post.title?.trim() || post.body.trim().split(/\s+/).slice(0, 8).join(' ') + (post.body.trim().split(/\s+/).length > 8 ? '…' : '')

/* ------------------------------------------------------------------ */
/* Time (always shown in the browser's own timezone)                    */
/* ------------------------------------------------------------------ */

const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayOnly = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

export const fmtDateTime = (iso: string) => dayTime.format(new Date(iso))
export const fmtTime = (iso: string | Date) => timeOnly.format(typeof iso === 'string' ? new Date(iso) : iso)
export const fmtDay = (d: string | Date) => dayOnly.format(typeof d === 'string' ? new Date(d) : d)
export const fmtLongDay = (d: Date) => longDay.format(d)

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "in 3 hours", "yesterday", "in 2 weeks". */
export function fmtRelative(iso: string, now = Date.now()) {
  const diff = (Date.parse(iso) - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return diff >= 0 ? 'in a moment' : 'just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 14) return rtf.format(Math.round(diff / 86400), 'day')
  return rtf.format(Math.round(diff / (86400 * 7)), 'week')
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO → the values a <input type="date"> and <input type="time"> want, in local time. */
export function toInputs(iso: string) {
  const d = new Date(iso)
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

export function fromInputs(date: string, time: string) {
  if (!date || !time) return null
  const d = new Date(`${date}T${time}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Monday 00:00 local of the week containing `d`. */
export function startOfWeek(d: Date) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

export const addDays = (d: Date, n: number) => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
