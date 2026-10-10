import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react'
import { api } from '../../lib/api'
import { useInvalidate } from '../data'
import { useToast } from '../toast'
import { ASSISTANT_BASE, AssistantLink, assistantUrl, type AssistantEvent, type VoiceState } from './link'

/* ------------------------------------------------------------------ */
/* What the assistant sends (assistant/backend: studio.py, media.py, flowai.py) */
/* ------------------------------------------------------------------ */

export type TextBox = {
  id: number
  words: string
  /** Where it was drawn: x, y, width, height as fractions of the slide. */
  box: [number, number, number, number]
  position: string
  size: string
  color: string
  style: string
  box_color: string
  font: string
}
export type Slide = { url: string; kind: 'image' | 'video'; media: number | null; texts: TextBox[] }
export type Check = { key: string; status: 'pass' | 'warn' | 'fail'; label: string; detail: string }
export type Draft = {
  id: number
  version: number
  title: string
  /** "Instagram post", "X post". */
  label: string
  platform: 'instagram' | 'x'
  placement: string
  size: [number, number]
  caption: string
  /** 0: this placement shows no caption. */
  caption_limit: number
  placements: string[]
  max_slides: number
  slides: Slide[]
  check: { ok: boolean; label: string; checks: Check[] }
}
/** A draft's post in FlowAI. */
export type Saved = { draft: number; post: number; version: number; status: string; url: string; when: string }
/** A draft that is a FlowAI campaign's post: one account's version of it, or the item itself before it has versions. */
export type Linked = {
  draft: number
  campaign: number
  /** The campaign's name. */
  name: string
  item: number
  variant: number | null
  /** The post's title in the campaign. */
  title: string
  handle: string
  /** A version's: draft (waiting at gate 6B), approved, rejected. An item's: planned, ready… */
  status: string
  /** The draft's version as opened or last saved. */
  version: number
  url: string
  /** Its booked times that haven't gone out. */
  posts: Array<{ id: number; status: string; scheduled_at: string; when: string }>
}
export type Approval = {
  id: number
  draft: number
  /** schedule: a time for a post. version: a changed campaign version (gate 6B). time: a time for one. */
  kind: 'schedule' | 'version' | 'time'
  post: number | null
  campaign: number | null
  variant: number | null
  text: string
  status: 'waiting' | 'approved' | 'declined' | 'failed' | 'outdated'
  detail: string
  /** UTC; null: the queue's next free time. */
  when: string | null
  /** The post's fields, for booking it with the person's own session. */
  payload: Record<string, unknown> | null
}
/** A conversation in the list (assistant/backend/conversations.py). */
export type ConversationSummary = {
  id: string
  title: string
  created: string
  updated: string
  drafts: number
  pictures: number
  campaign: { id: number; name: string } | null
  preview: string
}
export type CurrentConversation = { id: string; title: string; kept: boolean; campaign: { id: number; name: string; stage: string } | null }
/** A numbered picture or video in the conversation. */
export type Picture = { id: number; kind: 'image' | 'video'; name: string; source: string; url: string; workflow: string; prompt: string }
export type Job = { id: number; label: string; started: number; status: string; text: string }
export type AssistantAccount = { id: number; platform: 'instagram' | 'x'; handle: string; label: string; name: string | null }
/** What the person selected on screen: "this", "it". */
export type Focus = { draft?: number; slide?: number; text?: number }

export type LogItem =
  | { id: number; kind: 'user'; text: string; partial?: boolean }
  | { id: number; kind: 'bot'; text: string; turn: number; cut?: boolean }
  | { id: number; kind: 'act'; name: string; text: string; status: 'running' | 'done' | 'failed'; why?: string }
  | { id: number; kind: 'note'; text: string; tone: 'info' | 'error' }

export type Connection = 'idle' | 'connecting' | 'online' | 'offline'
export type AssistantTab = 'draft' | 'media' | 'calendar'

type State = {
  conn: Connection
  conversation: CurrentConversation | null
  conversations: ConversationSummary[]
  /** Conversations are kept for this person (FlowAI said who they are). */
  kept: boolean
  /** Asked for another conversation; it isn't on screen yet. */
  switching: boolean
  log: LogItem[]
  seq: number
  /** The bot message still being written, and its turn. */
  open: { id: number; turn: number } | null
  drafts: Record<number, Draft>
  current: number | null
  saved: Record<number, Saved>
  linked: Record<number, Linked>
  approvals: Record<number, Approval>
  pictures: Picture[]
  jobs: Record<number, Job>
  accounts: AssistantAccount[]
  flowaiError: string
  focus: Focus
  tab: AssistantTab
}

const EMPTY_SESSION = {
  drafts: {},
  current: null,
  saved: {},
  linked: {},
  approvals: {},
  pictures: [],
  jobs: {},
  focus: {},
} satisfies Partial<State>

const INITIAL: State = {
  conn: 'idle',
  conversation: null,
  conversations: [],
  kept: false,
  switching: false,
  log: [],
  seq: 0,
  open: null,
  accounts: [],
  flowaiError: '',
  tab: 'draft',
  ...EMPTY_SESSION,
}

type Action =
  | { type: 'event'; msg: AssistantEvent }
  | { type: 'conn'; conn: Connection }
  | { type: 'note'; text: string; tone?: 'info' | 'error' }
  | { type: 'lost' }
  | { type: 'switching' }
  | { type: 'focus'; focus: Focus }
  | { type: 'current'; id: number }
  | { type: 'tab'; tab: AssistantTab }
  | { type: 'job-expired'; id: number }

type Unnumbered<T> = T extends unknown ? Omit<T, 'id'> : never
const push = (s: State, item: Unnumbered<LogItem>): State => ({ ...s, seq: s.seq + 1, log: [...s.log, { ...item, id: s.seq + 1 }] })

/** What a tool call does, in the words a person would use. */
export function describe(name: string, a: Record<string, unknown>): string {
  switch (name) {
    case 'load_skill':
      return `Reading the ${String(a.name ?? '').replaceAll('-', ' ')} playbook`
    case 'create_draft':
      return a.platform === 'x' ? 'Starting an X post' : `Starting an Instagram ${a.placement ?? 'post'}`
    case 'update_draft':
      return a.caption != null ? 'Writing the caption' : a.media ? 'Changing the pictures' : 'Updating the draft'
    case 'add_text':
      return `Adding “${a.text}”`
    case 'edit_text':
      return a.text ? `Changing text ${a.text_id} to “${a.text}”` : `Restyling text ${a.text_id}`
    case 'remove_text':
      return `Removing text ${a.text_id}`
    case 'undo_draft':
      return 'Undoing the last change'
    case 'show_draft':
      return 'Showing the draft'
    case 'generate_media':
      return a.draft != null ? (/edit/.test(String(a.workflow ?? '')) ? 'Editing the picture' : 'Making the picture') : 'Making a picture'
    case 'save_draft':
      return 'Saving to FlowAI'
    case 'schedule_post':
      return 'Asking you to approve the time'
    case 'find_posts':
      return 'Looking through your posts'
    case 'open_post':
      return `Opening post ${a.post}`
    case 'find_campaigns':
      return 'Looking through your campaigns'
    case 'open_campaign':
      return `Opening campaign ${a.campaign}`
    case 'find_assets':
      return 'Looking through the gallery'
    case 'use_assets':
      return 'Bringing in pictures from the gallery'
    case 'get_current_time':
      return 'Checking the time'
    default:
      return name.replaceAll('_', ' ')
  }
}

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'conn':
      return { ...s, conn: a.conn }
    case 'note':
      return push(s, { kind: 'note', text: a.text, tone: a.tone ?? 'info' })
    case 'lost':
      // The conversation is kept on the assistant's side: reconnecting brings it back as it was.
      return push({ ...s, conn: 'offline', open: null, switching: false }, { kind: 'note', text: s.kept ? 'Connection lost. Reconnecting…' : 'Connection lost. This conversation wasn’t kept.', tone: 'error' })
    case 'switching':
      return { ...s, switching: true }
    case 'focus':
      return { ...s, focus: a.focus }
    case 'current':
      return { ...s, current: a.id }
    case 'tab':
      return { ...s, tab: a.tab }
    case 'job-expired': {
      const jobs = { ...s.jobs }
      delete jobs[a.id]
      return { ...s, jobs }
    }
    case 'event':
      return onEvent(s, a.msg)
  }
}

/** What was said and done, as the conversation's history comes back from the assistant. */
type HistoryItem = { kind: 'user' | 'bot'; text: string } | { kind: 'act'; name: string; arguments: Record<string, unknown>; status: 'done' | 'failed'; why?: string }

const fromHistory = (h: HistoryItem): Unnumbered<LogItem> =>
  h.kind === 'act' ? { kind: 'act', name: h.name, text: describe(h.name, h.arguments ?? {}), status: h.status, why: h.why } : h.kind === 'bot' ? { kind: 'bot', text: h.text, turn: -1 } : { kind: 'user', text: h.text }

/** Another conversation on screen, whole: everything starts over from it. */
function opened(s: State, m: AssistantEvent): State {
  const list = <T,>(key: string) => (m[key] as T[] | undefined) ?? []
  let next: State = {
    ...s,
    ...EMPTY_SESSION,
    conversation: { id: String(m.id), title: String(m.title ?? ''), kept: !!m.kept, campaign: (m.campaign as CurrentConversation['campaign']) ?? null },
    switching: false,
    open: null,
    log: [],
    tab: list('drafts').length ? 'draft' : s.tab,
  }
  for (const h of list<HistoryItem>('history')) next = push(next, fromHistory(h))
  const events = [...list<AssistantEvent>('media'), ...list<AssistantEvent>('jobs'), ...list<AssistantEvent>('drafts'), ...list<AssistantEvent>('saved'), ...list<AssistantEvent>('linked'), ...list<AssistantEvent>('approvals')]
  for (const e of events) next = onEvent(next, { ...e, replay: true })
  return next
}

function onEvent(s: State, m: AssistantEvent): State {
  switch (m.type) {
    case 'conversation':
      return opened(s, m)
    case 'conversations': {
      const items = (m.items as ConversationSummary[]) ?? []
      const mine = items.find((c) => c.id === s.conversation?.id)
      return { ...s, conversations: items, kept: !!m.kept, conversation: s.conversation && mine ? { ...s.conversation, title: mine.title } : s.conversation }
    }
    case 'about': {
      const c = s.conversation
      return c && c.id === m.id ? { ...s, conversation: { ...c, title: String(m.title ?? ''), campaign: (m.campaign as CurrentConversation['campaign']) ?? null } } : s
    }
    case 'linked':
      return { ...s, linked: { ...s.linked, [Number(m.draft)]: m as unknown as Linked } }
    case 'transcript': {
      // Words as they're heard go in one line that the final transcript then settles.
      const partial = s.log.find((i) => i.kind === 'user' && i.partial)
      if (!m.final) {
        const text = String(m.text || '…')
        return partial ? { ...s, log: s.log.map((i) => (i === partial ? { ...partial, text } : i)) } : push(s, { kind: 'user', text, partial: true })
      }
      if (!partial) return m.text ? push(s, { kind: 'user', text: String(m.text) }) : s
      return { ...s, log: m.text ? s.log.map((i) => (i === partial ? { id: i.id, kind: 'user', text: String(m.text) } : i)) : s.log.filter((i) => i !== partial) }
    }
    case 'assistant_delta': {
      const turn = Number(m.turn)
      if (s.open?.turn === turn) {
        return { ...s, log: s.log.map((i) => (i.id === s.open!.id && i.kind === 'bot' ? { ...i, text: i.text + String(m.text) } : i)) }
      }
      const next = push(s, { kind: 'bot', text: String(m.text), turn })
      return { ...next, open: { id: next.seq, turn } }
    }
    case 'assistant_done':
      return { ...s, open: null }
    case 'tool_call':
      return { ...push(s, { kind: 'act', name: String(m.name), text: describe(String(m.name), (m.arguments as Record<string, unknown>) ?? {}), status: 'running' }), open: null }
    case 'tool_result': {
      const act = s.log.find((i) => i.kind === 'act' && i.status === 'running' && i.name === m.name)
      if (!act) return s
      let why: string | undefined
      try {
        why = JSON.parse(String(m.result)).error
      } catch {
        /* not JSON: fine */
      }
      return { ...s, log: s.log.map((i) => (i === act ? { ...act, status: why ? 'failed' : 'done', why } : i)) }
    }
    case 'interrupt': {
      if (!s.open) return s
      const open = s.open
      return { ...s, open: null, log: m.was_speaking ? s.log.map((i) => (i.id === open.id && i.kind === 'bot' ? { ...i, cut: true } : i)) : s.log }
    }
    case 'error':
      return push(s, { kind: 'note', text: String(m.message), tone: 'error' })
    case 'media': {
      if (m.kind !== 'image' && m.kind !== 'video') return s
      const pic: Picture = {
        id: Number(m.id),
        kind: m.kind,
        name: String(m.name ?? ''),
        source: String(m.source ?? ''),
        url: assistantUrl(String(m.url)),
        workflow: String(m.workflow ?? ''),
        prompt: String(m.prompt ?? ''),
      }
      const next = { ...s, pictures: [...s.pictures.filter((p) => p.id !== pic.id), pic] }
      return pic.source === 'upload' && !m.replay ? push(next, { kind: 'note', text: `You attached picture ${pic.id}.`, tone: 'info' }) : next
    }
    case 'media_job': {
      if (m.kind === 'install') return s
      const id = Number(m.id)
      const before = s.jobs[id]
      if (m.status === 'started') {
        const started = Date.now() - Number(m.seconds ?? 0) * 1000 // still going in a conversation just reopened
        return { ...s, jobs: { ...s.jobs, [id]: { id, label: m.makes === 'video' ? 'Making the video' : 'Making the picture', started, status: 'running', text: '' } } }
      }
      if (!before) return s
      const jobs = { ...s.jobs }
      if (m.status === 'done' || m.status === 'cancelled') delete jobs[id]
      else jobs[id] = { ...before, status: String(m.status), text: String(m.text ?? '') }
      return { ...s, jobs }
    }
    case 'draft': {
      const d = { ...(m as unknown as Draft), slides: (m as unknown as Draft).slides.map((sl) => ({ ...sl, url: assistantUrl(sl.url) })) }
      const isNew = !s.drafts[d.id]
      return { ...s, drafts: { ...s.drafts, [d.id]: d }, current: d.id, tab: isNew ? 'draft' : s.tab }
    }
    case 'saved':
      return { ...s, saved: { ...s.saved, [Number(m.draft)]: m as unknown as Saved } }
    case 'approval':
      return { ...s, approvals: { ...s.approvals, [Number(m.id)]: m as unknown as Approval } }
    case 'flowai': {
      const next = { ...s, accounts: (m.accounts as AssistantAccount[]) ?? [], flowaiError: String(m.error ?? '') }
      return m.error ? push(next, { kind: 'note', text: `FlowAI: ${m.error}`, tone: 'error' }) : next
    }
    case 'browser_task':
      return push(s, { kind: 'note', text: `Website task ${m.status}${m.text ? `: ${m.text}` : ''}`, tone: 'info' })
    default:
      return s
  }
}

/* ------------------------------------------------------------------ */
/* The provider: one conversation for the whole dashboard              */
/* ------------------------------------------------------------------ */

type Assistant = Omit<State, 'log' | 'seq' | 'open'> & {
  link: AssistantLink
  /** Open (or reopen) the conversation. The page calls it; it stays open across pages. */
  start: () => void
  /** A new conversation; with a campaign, that FlowAI campaign's posts in it as drafts. */
  newConversation: (campaign?: number) => void
  openConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  deleteConversation: (id: string) => void
  /** Ask for the list again (it also comes by itself after every change). */
  refreshConversations: () => void
  /** A FlowAI campaign's posts into the conversation on screen. */
  importCampaign: (campaign: number) => void
  say: (text: string) => Promise<void>
  /** A button that skips the model: undo, save, edit… (assistant/backend/session.py). */
  action: (name: string, fields?: Record<string, unknown>) => void
  select: (focus: Focus) => void
  setCurrent: (id: number) => void
  setTab: (tab: AssistantTab) => void
  toggleMic: () => Promise<void>
  interrupt: () => void
  upload: (files: File[]) => Promise<void>
  approve: (a: Approval) => Promise<void>
  decline: (a: Approval) => void
  /** Book a draft for a time the person picked themselves (or the queue's next free one): their pick is the approval. */
  schedule: (draft: number, at: Date | 'queue') => void
  /** Pictures and videos can be made (ComfyUI is connected). */
  generation: boolean
  /** Text waiting in the composer, so other parts of the page can start a sentence. */
  input: string
  setInput: (text: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  micOn: boolean
  bargeIn: boolean
  setBargeIn: (on: boolean) => void
  /** Approvals being booked right now. */
  booking: number[]
}

const LAST = 'flowai.assistant.conversation'

/** The conversation last on screen, to pick up again after a reload (the assistant checks it's this person's). */
function readConversation() {
  try {
    return window.localStorage.getItem(LAST)
  } catch {
    return null
  }
}

function writeConversation(id: string) {
  try {
    window.localStorage.setItem(LAST, id)
  } catch {
    /* private mode: it just isn't remembered */
  }
}

const AssistantContext = createContext<Assistant | null>(null)
const LogContext = createContext<LogItem[]>([])

export function useAssistant() {
  const value = useContext(AssistantContext)
  if (!value) throw new Error('useAssistant needs the AssistantProvider')
  return value
}

export const useAssistantLog = () => useContext(LogContext)

/** The assistant's voice state, re-read a few times a second. */
export function useVoiceState(link: AssistantLink): VoiceState {
  const [state, setState] = useState<VoiceState>(link.state)
  useEffect(() => {
    const t = window.setInterval(() => setState(link.state), 120)
    return () => window.clearInterval(t)
  }, [link])
  return state
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, INITIAL)
  const toast = useToast()
  const invalidate = useInvalidate()
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [micOn, setMicOn] = useState(false)
  const [bargeIn, setBargeInState] = useState(true)
  const [booking, setBooking] = useState<number[]>([])
  const [generation, setGeneration] = useState(false)
  const wanted = useRef(false)
  const connecting = useRef(false)
  /** The assistant's FlowAI session, kept for reconnects until it nearly runs out. */
  const session = useRef<{ token: string; expires: number } | null>(null)
  const retry = useRef(0)
  const retryTimer = useRef<number | undefined>(undefined)
  /** Drafts the person scheduled from the page: their approval is already given. */
  const autoApprove = useRef(new Set<number>())
  /** The conversation on screen, for messages sent from callbacks; kept so a reload picks it up again. */
  const conversation = useRef<string | null>(readConversation())
  /** Something to ask for as soon as the assistant is ready (the page opened with ?campaign=). */
  const queued = useRef<Record<string, unknown> | null>(null)
  const handlers = useRef<{ onEvent: (m: AssistantEvent) => void; onClose: () => void }>(null!)

  const link = useMemo(
    () =>
      new AssistantLink(
        (m) => handlers.current.onEvent(m),
        () => handlers.current.onClose(),
      ),
    [],
  )

  const connect = useCallback(async () => {
    if (link.open || connecting.current) return
    connecting.current = true
    window.clearTimeout(retryTimer.current)
    dispatch({ type: 'conn', conn: 'connecting' })
    try {
      // The assistant works as whoever opened it, with a token from their own session.
      if (!session.current || session.current.expires - Date.now() < 30 * 60_000) {
        session.current = await api<{ token: string; expires_at: string }>('/assistant/session', { method: 'POST' })
          .then((r) => ({ token: r.token, expires: Date.parse(r.expires_at) }))
          .catch((e) => {
            dispatch({ type: 'note', text: `FlowAI didn’t start a session for the assistant: ${e.message}`, tone: 'error' })
            return null
          })
      }
      await link.connect()
      retry.current = 0
      fetch(`${ASSISTANT_BASE}health`)
        .then((r) => r.json())
        .then((h: { comfyui?: string }) => setGeneration(!!h.comfyui?.startsWith('ok')))
        .catch(() => setGeneration(false))
    } catch {
      dispatch({ type: 'conn', conn: 'offline' })
      if (wanted.current) {
        retry.current = Math.min(retry.current + 1, 5)
        retryTimer.current = window.setTimeout(connect, 1000 * 2 ** retry.current)
      }
    } finally {
      connecting.current = false
    }
  }, [link])

  const approve = useCallback(
    async (a: Approval) => {
      if (a.kind === 'schedule' && !a.payload) return
      setBooking((b) => [...b, a.id])
      try {
        // Done with the person's own session: they are the one approving it.
        if (a.kind === 'version') await api(`/campaigns/${a.campaign}/variants/${a.variant}/approve`, { method: 'POST' })
        else if (a.kind === 'time') await api(`/campaigns/${a.campaign}/variants/${a.variant}/times`, { method: 'POST', body: { at: a.when } })
        else await api(`/posts/${a.post}`, { method: 'PUT', body: { ...a.payload, status: 'scheduled', ...(a.when ? { scheduled_at: a.when } : { queue: true }) } })
        link.send({ type: 'approve', id: a.id, done: true, conversation: conversation.current })
        invalidate()
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Couldn’t schedule it.', 'error')
      } finally {
        setBooking((b) => b.filter((id) => id !== a.id))
      }
    },
    [link, invalidate, toast],
  )

  handlers.current = {
    onEvent: (m) => {
      dispatch({ type: 'event', msg: m })
      switch (m.type) {
        case 'ready':
          dispatch({ type: 'conn', conn: 'online' })
          link.send({ type: 'hello', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, token: session.current?.token, conversation: conversation.current })
          if (queued.current) {
            dispatch({ type: 'switching' })
            link.send(queued.current)
            queued.current = null
          }
          break
        case 'conversation':
          conversation.current = String(m.id)
          autoApprove.current.clear()
          if (m.kept) writeConversation(conversation.current)
          break
        case 'saved':
          invalidate()
          break
        case 'approval': {
          const a = m as unknown as Approval
          if (a.status === 'waiting' && autoApprove.current.delete(a.draft)) void approve(a)
          if (a.status === 'approved') invalidate()
          break
        }
        case 'media_job':
          if (m.status === 'failed') window.setTimeout(() => dispatch({ type: 'job-expired', id: Number(m.id) }), 8000)
          break
      }
    },
    onClose: () => {
      setMicOn(false)
      dispatch({ type: 'lost' })
      if (wanted.current) retryTimer.current = window.setTimeout(connect, 1000)
    },
  }

  useEffect(() => () => {
    window.clearTimeout(retryTimer.current)
    wanted.current = false
    link.close()
  }, [link])

  const start = useCallback(() => {
    wanted.current = true
    void connect()
  }, [connect])

  const say = useCallback(
    async (text: string) => {
      try {
        await link.say(text)
      } catch (e) {
        dispatch({ type: 'note', text: e instanceof Error ? e.message : String(e), tone: 'error' })
      }
    },
    [link],
  )

  const action = useCallback(
    (name: string, fields: Record<string, unknown> = {}) => {
      if (!link.open) return dispatch({ type: 'note', text: 'The assistant is offline.', tone: 'error' })
      link.send({ type: 'action', name, ...fields, conversation: conversation.current })
    },
    [link],
  )

  /** Ask for another conversation; until it arrives the page shows it's switching. */
  const switchTo = useCallback(
    (msg: Record<string, unknown>) => {
      if (!link.open) {
        queued.current = msg
        return start()
      }
      dispatch({ type: 'switching' })
      link.stopPlayback()
      link.send(msg)
    },
    [link, start],
  )

  const select = useCallback(
    (focus: Focus) => {
      dispatch({ type: 'focus', focus })
      link.send({ type: 'focus', ...focus })
    },
    [link],
  )

  const toggleMic = useCallback(async () => {
    try {
      if (link.micOn) link.stopMic()
      else await link.startMic()
    } catch (e) {
      link.stopMic()
      dispatch({ type: 'note', text: `Microphone: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' })
    }
    setMicOn(link.micOn)
  }, [link])

  const value = useMemo<Assistant>(
    () => ({
      conn: state.conn,
      conversation: state.conversation,
      conversations: state.conversations,
      kept: state.kept,
      switching: state.switching,
      drafts: state.drafts,
      current: state.current,
      saved: state.saved,
      linked: state.linked,
      approvals: state.approvals,
      pictures: state.pictures,
      jobs: state.jobs,
      accounts: state.accounts,
      flowaiError: state.flowaiError,
      focus: state.focus,
      tab: state.tab,
      link,
      start,
      newConversation: (campaign) => switchTo({ type: 'new', ...(campaign ? { campaign } : {}) }),
      openConversation: (id) => id !== conversation.current && switchTo({ type: 'open', id }),
      renameConversation: (id, title) => link.send({ type: 'rename', id, title }),
      deleteConversation: (id) => {
        if (id === conversation.current) dispatch({ type: 'switching' })
        link.send({ type: 'delete', id })
      },
      refreshConversations: () => link.send({ type: 'conversations' }),
      importCampaign: (campaign) => action('open_campaign', { campaign }),
      say,
      action,
      select,
      setCurrent: (id) => {
        dispatch({ type: 'current', id })
        select({ draft: id })
      },
      setTab: (tab) => dispatch({ type: 'tab', tab }),
      toggleMic,
      interrupt: () => link.interrupt(),
      upload: async (files) => {
        for (const f of files) {
          try {
            await link.upload(f)
          } catch (e) {
            dispatch({ type: 'note', text: `Upload failed: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' })
          }
        }
      },
      approve,
      decline: (a) => link.send({ type: 'decline', id: a.id, conversation: conversation.current }),
      schedule: (draft, at) => {
        autoApprove.current.add(draft)
        action('schedule', { draft, when: at === 'queue' ? 'queue' : at.toISOString() })
      },
      generation,
      input,
      setInput,
      inputRef,
      micOn,
      bargeIn,
      setBargeIn: (on) => {
        link.bargeIn = on
        setBargeInState(on)
      },
      booking,
    }),
    [state.conn, state.conversation, state.conversations, state.kept, state.switching, state.drafts, state.current, state.saved, state.linked, state.approvals, state.pictures, state.jobs, state.accounts, state.flowaiError, state.focus, state.tab, link, start, switchTo, say, action, select, toggleMic, approve, input, micOn, bargeIn, booking, generation],
  )

  return (
    <AssistantContext.Provider value={value}>
      <LogContext.Provider value={state.log}>{children}</LogContext.Provider>
    </AssistantContext.Provider>
  )
}
