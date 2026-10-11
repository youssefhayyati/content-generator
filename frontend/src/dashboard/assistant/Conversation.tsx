import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, AudioLines, AudioWaveform, BadgeCheck, CalendarCheck, Check, CheckCheck, ChevronRight, CircleAlert, FileText, Headphones, ImageOff, ListChecks, LoaderCircle, Mic, MicOff, Paperclip, Pencil, Play, Repeat2, Square, Volume2, VolumeX, Workflow, X } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { Btn, Toggle } from '../ui'
import { ConversationBar, ConversationList } from './Conversations'
import { JobsBar } from './Jobs'
import { PhoneCard, PhoneLiveBar } from './PhoneProof'
import { VoicePicker } from './Voices'
import type { VoiceState } from './link'
import { useAssistant, useAssistantLog, useVoiceState, type Approval, type LogItem, type Mode } from './store'

const WORDS: Record<VoiceState, [string, string]> = {
  disconnected: ['Offline', 'Reconnecting to the assistant…'],
  connected: ['Tap to talk', 'Or type below.'],
  listening: ['Listening', 'Go ahead. Talk over it any time.'],
  hearing: ['Hearing you', 'Pause when you’re done.'],
  thinking: ['Working on it', 'Say “stop” or press ■ to cut in.'],
  speaking: ['Speaking', 'Talk over it to interrupt.'],
}

const IDEAS = [
  'Make an Instagram post for our new Fig & Cedar candle, launching Friday',
  'What do we have scheduled this week?',
  'Turn our latest Instagram post into an X post',
]
/** For a conversation opened on a campaign. */
const CAMPAIGN_IDEAS = ['Make every caption shorter and warmer', 'Put the campaign’s name on the first slide of each post', 'Which of these posts still need my approval?']

/** Talk on the left: which conversation, the mic, what was said and done, approvals, and the composer. */
export function Conversation({ className, onImport }: { className?: string; onImport: () => void }) {
  const a = useAssistant()
  const [dropping, setDropping] = useState(false)
  const [listing, setListing] = useState(false)
  const [voicing, setVoicing] = useState(false)

  const onDrop = (e: DragEvent) => {
    setDropping(false)
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    void a.upload([...e.dataTransfer.files])
  }

  return (
    <section
      className={cn('relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel', className)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={onDrop}
    >
      <ConversationBar onList={() => setListing(true)} />
      <ModeSwitch />
      <VoiceBar />
      <Log />
      <JobsBar />
      <PhoneLiveBar />
      <Approvals />
      <Composer onVoice={() => setVoicing(true)} />
      <VoicePicker open={voicing} onClose={() => setVoicing(false)} />
      <ConversationList
        open={listing}
        onClose={() => setListing(false)}
        onImport={() => {
          setListing(false)
          onImport()
        }}
      />
      <AnimatePresence>
        {dropping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-lg border border-dashed border-accent-soft/70 bg-ink/80 text-[13px] text-accent-soft backdrop-blur-sm"
          >
            Drop to show the assistant
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function VoiceBar() {
  const a = useAssistant()
  const voice = useVoiceState(a.link)
  const ring = useRef<HTMLSpanElement>(null)
  const bars = useRef<HTMLSpanElement>(null)
  const [words, hint] = WORDS[voice]
  const busy = voice === 'thinking' || voice === 'speaking'

  // The ring and the bars follow the mic's loudness, drawn straight to the DOM.
  useEffect(() => {
    let frame = 0
    const draw = () => {
      const level = a.link.micOn ? a.link.level() : 0
      if (ring.current) ring.current.style.transform = `scale(${1 + level * 0.55})`
      if (ring.current) ring.current.style.opacity = a.link.micOn ? String(0.25 + level * 0.75) : '0'
      bars.current?.childNodes.forEach((n, i) => {
        const wave = a.link.playing ? 0.35 + 0.65 * Math.abs(Math.sin(Date.now() / 140 + i * 0.9)) : level * (0.6 + 0.4 * Math.sin(i * 1.7 + Date.now() / 90))
        ;(n as HTMLElement).style.transform = `scaleY(${Math.max(0.12, wave)})`
      })
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [a.link])

  return (
    <div className="flex items-center gap-4 border-b border-line px-4 py-4 md:px-5">
      <button
        type="button"
        onClick={() => void a.toggleMic()}
        aria-label={a.micOn ? 'Stop the microphone' : 'Start talking'}
        aria-pressed={a.micOn}
        disabled={a.conn !== 'online'}
        className={cn(
          'relative grid size-14 shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-300 disabled:opacity-40',
          a.micOn ? 'bg-accent text-on-accent' : 'border border-line-2 text-fg hover:border-white/30 hover:bg-white/[0.04]',
        )}
      >
        <span ref={ring} aria-hidden className="pointer-events-none absolute -inset-1.5 rounded-full border-2 border-accent-soft opacity-0 transition-transform duration-75" />
        {a.micOn ? <Mic className="relative size-5" strokeWidth={1.75} /> : <MicOff className="relative size-5" strokeWidth={1.5} />}
      </button>
      <div className="min-w-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={words}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.25, ease }}
            className="flex items-center gap-2 text-[14px] font-medium tracking-[-0.01em]"
          >
            {words}
            {voice === 'thinking' && <LoaderCircle className="size-3.5 animate-spin text-accent-soft" />}
          </motion.p>
        </AnimatePresence>
        <p className="mt-0.5 truncate text-[11.5px] text-dim">{a.conn === 'offline' ? 'Start it with: docker compose --profile assistant up -d' : hint}</p>
      </div>
      <span ref={bars} aria-hidden className="hidden h-7 items-center gap-[3px] sm:flex">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="h-full w-[3px] origin-center scale-y-[0.12] rounded-full bg-accent-soft/80" />
        ))}
      </span>
      {busy && (
        <button type="button" onClick={a.interrupt} aria-label="Stop the assistant" className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 text-muted hover:border-white/30 hover:text-fg">
          <Square className="size-3" fill="currentColor" />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Log() {
  const a = useAssistant()
  const log = useAssistantLog()
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow the conversation, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [log])

  return (
    <div
      ref={box}
      data-lenis-prevent
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
      className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5"
    >
      {log.length === 0 && (
        <div className="flex h-full flex-col justify-end gap-2 pb-1">
          {a.conversation?.campaign && (
            <p className="mb-2 text-[12.5px] leading-snug text-muted">
              <span className="text-fg">{a.conversation.campaign.name}</span> is open here: {Object.keys(a.linked).length || 'its'} posts as drafts. Saving one changes it in the campaign.
            </p>
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Try</p>
          {(a.conversation?.campaign ? CAMPAIGN_IDEAS : IDEAS).map((idea, i) => (
            <motion.button
              key={idea}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease, delay: 0.1 + i * 0.06 }}
              onClick={() => {
                a.link.ensureAudio()
                void a.say(idea)
              }}
              disabled={a.conn !== 'online'}
              className="rounded-lg border border-line px-3 py-2.5 text-left text-[12.5px] leading-snug text-muted transition-colors hover:border-line-2 hover:bg-white/[0.02] hover:text-fg disabled:opacity-50"
            >
              “{idea}”
            </motion.button>
          ))}
        </div>
      )}
      {log.map((item) => (
        <Line key={item.id} item={item} />
      ))}
    </div>
  )
}

function Line({ item }: { item: LogItem }) {
  const enter = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease } }
  switch (item.kind) {
    case 'user':
      return (
        <motion.p {...enter} className={cn('ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/[0.07] px-3.5 py-2 text-[13px] leading-snug', item.partial && 'text-muted italic')}>
          {item.text}
          {item.partial && <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-blink bg-current" />}
        </motion.p>
      )
    case 'bot':
      return (
        <motion.div {...enter} className="flex gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-soft">
            <AudioWaveform className="size-3" strokeWidth={2} />
          </span>
          <p className={cn('min-w-0 whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg/90', item.cut && 'opacity-55')}>
            {item.text}
            {item.cut && <span className="ml-1.5 font-mono text-[10px] text-dim">cut off</span>}
          </p>
        </motion.div>
      )
    case 'act':
      return (
        <motion.p {...enter} className={cn('flex items-start gap-2 pl-7 font-mono text-[11px] leading-snug', item.status === 'failed' ? 'text-fail' : 'text-dim')}>
          {item.status === 'running' ? (
            <LoaderCircle className="mt-px size-3 shrink-0 animate-spin text-accent-soft" />
          ) : item.status === 'done' ? (
            <Check className="mt-px size-3 shrink-0 text-ok" />
          ) : (
            <X className="mt-px size-3 shrink-0" />
          )}
          <span>
            {item.text}
            {item.why && <span className="text-fail/80"> · {item.why}</span>}
          </span>
        </motion.p>
      )
    case 'phone':
      return <PhoneCard post={item.post} text={item.text} proof={item.proof} failed={item.failed} />
    case 'note':
      return (
        <motion.p {...enter} className={cn('flex items-start justify-center gap-1.5 text-center font-mono text-[10.5px] leading-snug', item.tone === 'error' ? 'text-fail' : 'text-dim')}>
          {item.tone === 'error' && <CircleAlert className="mt-px size-3 shrink-0" />}
          {item.text}
        </motion.p>
      )
  }
}

/* ------------------------------------------------------------------ */

const REVIEW = new Set<Approval['kind']>(['schedule', 'time', 'version', 'lab_post', 'repost'])
const CLOSED: Record<Approval['status'], string> = {
  waiting: 'Needs your approval',
  changing: 'Being changed',
  approved: 'Scheduled',
  declined: 'Skipped',
  failed: 'Couldn’t schedule',
  outdated: 'No longer current',
}
/** A campaign version (gate 6B), a plan or a run is approved, not scheduled. */
const APPROVED: Partial<Record<Approval['kind'], string>> = { version: 'Approved', plan: 'Plan approved', run: 'Running' }

const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Next free time in the queue')

/**
 * What waits for the person, in order: the plan (or a run) first, then each post, one at a time, to
 * approve, skip, or change (it comes back changed, to approve again). Nothing is made or booked before.
 */
function Approvals() {
  const a = useAssistant()
  const [bulk, setBulk] = useState(false)
  /** The reviews of this round: every one asked since the queue was last empty. */
  const round = useRef(new Set<number>())
  const list = Object.values(a.approvals).sort((x, y) => x.id - y.id)
  const asks = list.filter((x) => !REVIEW.has(x.kind) && x.status === 'waiting')
  const waiting = list.filter((x) => REVIEW.has(x.kind) && x.status === 'waiting')
  const changing = list.filter((x) => x.status === 'changing')
  // This round of reviews: the ones settled since the queue was last empty are done.
  const open = [...waiting, ...changing.filter((x) => REVIEW.has(x.kind))]
  if (!open.length) round.current.clear()
  for (const x of open) round.current.add(x.id)
  const done = list.filter((x) => round.current.has(x.id) && ['approved', 'declined', 'failed'].includes(x.status)).length
  const current = waiting[0]
  const last = !asks.length && !current && !changing.length ? list.filter((x) => ['approved', 'declined', 'failed'].includes(x.status)).at(-1) : undefined
  if (!asks.length && !current && !changing.length && !last) return null

  const approveAll = async () => {
    setBulk(true)
    for (const x of waiting) await a.approve(x)
    setBulk(false)
  }

  return (
    <div className="max-h-[55%] space-y-2 overflow-y-auto border-t border-line px-4 py-3 md:px-5">
      <AnimatePresence initial={false} mode="popLayout">
        {asks.map((x) => (
          <Card key={x.id} x={x} label={x.kind === 'plan' ? 'Plan · needs your OK' : 'Run · needs your OK'}>
            <p className="mt-1.5 text-[12.5px] leading-snug">{x.text}</p>
            {!!x.items?.length && (
              <ol className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[11.5px] leading-snug text-muted">
                {x.items.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-5 shrink-0 text-right font-mono text-dim">{i + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            )}
            {(x.takes || x.cost) && <p className="mt-2 font-mono text-[10.5px] text-dim">{[x.takes, x.cost && `cost ${x.cost}`].filter(Boolean).join(' · ')}</p>}
            <Answer x={x} yes={x.kind === 'plan' ? 'Go ahead' : 'Run it'} no="Not now" />
          </Card>
        ))}
        {current && (
          <Card key={current.id} x={current} label={`Review · ${done + 1} of ${done + open.length}`}>
            {current.kind === 'repost' ? <RepostPreview x={current} /> : <Preview x={current} />}
            {current.detail && <p className="mt-2 text-[11.5px] text-accent-soft">{current.detail}</p>}
            <Answer x={current} yes="Approve" no="Skip" />
            {waiting.length > 1 && (
              <button type="button" disabled={bulk} onClick={() => void approveAll()} className="mt-2 flex w-full items-center justify-end gap-1 text-[11.5px] text-muted transition-colors hover:text-fg disabled:opacity-50">
                {bulk ? <LoaderCircle className="size-3 animate-spin" /> : <CheckCheck className="size-3.5" />} Approve all {waiting.length}
              </button>
            )}
          </Card>
        )}
        {changing.map((x) => (
          <motion.p key={`c${x.id}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[11.5px] text-muted">
            <LoaderCircle className="size-3 shrink-0 animate-spin text-accent-soft" />
            <span className="min-w-0 truncate">
              Changing {x.kind === 'plan' ? 'the plan' : x.text.replace(/^Schedule /, '')}: <span className="text-fg">{x.detail}</span>
            </span>
          </motion.p>
        ))}
        {last && (
          <Card key={last.id} x={last} label={(last.status === 'approved' && APPROVED[last.kind]) || CLOSED[last.status]}>
            <p className="mt-1.5 text-[12.5px] leading-snug">{last.text}</p>
            {last.detail && last.status !== 'approved' && <p className="mt-1 text-[11.5px] text-dim">{last.detail}</p>}
          </Card>
        )}
      </AnimatePresence>
    </div>
  )
}

// The ref is AnimatePresence's (popLayout measures the card as it leaves)
function Card({ x, label, children, ref }: { x: Approval; label: string; children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  const waiting = x.status === 'waiting'
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease }}
      className={cn('rounded-lg border px-3.5 py-3', waiting ? 'border-accent/40 bg-accent/[0.07]' : x.status === 'approved' ? 'border-ok/25 bg-ok/[0.05]' : 'border-line bg-white/[0.02]')}
    >
      <p className={cn('flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]', waiting ? 'text-accent-soft' : x.status === 'approved' ? 'text-ok' : 'text-dim')}>
        {x.kind === 'plan' ? <ListChecks className="size-3" /> : x.kind === 'run' ? <Play className="size-3" /> : x.kind === 'version' ? <BadgeCheck className="size-3" /> : x.kind === 'repost' ? <Repeat2 className="size-3" /> : <CalendarCheck className="size-3" />}
        {label}
      </p>
      {children}
    </motion.div>
  )
}

/** What a repost's Approve books: its pictures as drawn, and its caption (the credit line comes on top). */
function RepostPreview({ x }: { x: Approval }) {
  const payload = x.payload ?? {}
  const previews = (payload.previews as string[] | undefined) ?? []
  return (
    <>
      <p className="mt-1.5 text-[12.5px] leading-snug">{x.text}</p>
      <div className="mt-2 flex gap-2.5 rounded-md border border-line bg-white/[0.02] p-2">
        {previews.slice(0, 3).map((src) => (
          <img key={src} src={src} alt="" className="size-16 shrink-0 rounded object-cover" />
        ))}
        <div className="min-w-0">
          <p className="line-clamp-4 whitespace-pre-wrap text-[11.5px] leading-snug text-muted">{String(payload.caption ?? '')}</p>
          <p className="mt-1 text-[10.5px] text-dim">Credit: @{String(payload.author ?? '')} on X</p>
        </div>
      </div>
    </>
  )
}

/** The post under review: what it looks like, where and when it goes. Clicking it shows it whole. */
function Preview({ x }: { x: Approval }) {
  const a = useAssistant()
  const d = x.kind === 'lab_post' ? undefined : a.drafts[x.draft]
  const thumb = d && (d.versions.find((v) => v.version === d.version)?.thumb ?? d.versions.at(-1)?.thumb)
  const p = x.preview
  const media = x.kind === 'lab_post' ? (p?.url ? { url: p.url, kind: p.kind === 'video' ? 'video' : 'image', poster: p.poster } : null) : thumb ? { ...thumb, poster: null } : null
  const caption = x.kind === 'lab_post' ? p?.caption : d?.caption
  const what = x.kind === 'lab_post' ? p?.what : d ? `${d.label}${d.title ? ` · ${d.title}` : ''}` : `Draft ${x.draft}`
  const show = () => {
    if (x.kind === 'lab_post') window.dispatchEvent(new CustomEvent('flowai:navigate', { detail: `/dashboard/studio?project=${x.project}&node=${encodeURIComponent(String(x.node))}` }))
    else if (d) {
      a.setCurrent(d.id)
      a.setTab('draft')
      if (window.location.pathname !== '/dashboard/assistant') window.dispatchEvent(new CustomEvent('flowai:navigate', { detail: '/dashboard/assistant' }))
    }
  }
  return (
    <button type="button" onClick={show} title="Show it" className="mt-2 flex w-full gap-3 rounded-md text-left transition-colors hover:bg-white/[0.03]">
      <span className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-black/40">
        {media?.kind === 'video' ? (
          <video src={media.url} poster={media.poster ?? undefined} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : media ? (
          <img src={media.url} alt="" className="size-full object-cover" />
        ) : (
          <ImageOff className="size-4 text-dim" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{what}</span>
        <span className="mt-0.5 flex items-center gap-1 font-mono text-[10.5px] text-accent-soft">
          <CalendarCheck className="size-3" /> {x.kind === 'version' ? 'New version, for the campaign' : fmtWhen(x.when)}
        </span>
        {caption && <span className="mt-1 line-clamp-2 block text-[11.5px] leading-snug text-muted">{caption}</span>}
      </span>
    </button>
  )
}

/** Approve, say no, or say what to change. */
function Answer({ x, yes, no }: { x: Approval; yes: string; no: string }) {
  const a = useAssistant()
  const [asking, setAsking] = useState(false)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setAsking(false)
    setText('')
  }, [x.id])
  useEffect(() => {
    if (asking) input.current?.focus()
  }, [asking])
  const send = () => {
    if (!text.trim()) return
    a.change(x, text.trim())
    setAsking(false)
    setText('')
  }
  if (asking) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
            if (e.key === 'Escape') setAsking(false)
          }}
          placeholder={x.kind === 'plan' ? 'What to change in the plan…' : 'What to change…'}
          className="min-w-0 flex-1 rounded-md border border-line-2 bg-ink/60 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/60"
        />
        <Btn size="sm" variant="subtle" onClick={() => setAsking(false)}>
          Cancel
        </Btn>
        <Btn size="sm" variant="primary" icon={ArrowUp} disabled={!text.trim()} onClick={send}>
          Send
        </Btn>
      </div>
    )
  }
  return (
    <div className="mt-3 flex justify-end gap-2">
      <Btn size="sm" variant="subtle" onClick={() => a.decline(x)}>
        {no}
      </Btn>
      <Btn size="sm" variant="subtle" icon={Pencil} onClick={() => setAsking(true)}>
        Change…
      </Btn>
      <Btn size="sm" variant="primary" icon={Check} loading={a.booking.includes(x.id)} disabled={(x.kind === 'schedule' || x.kind === 'repost') && !x.payload} onClick={() => void a.approve(x)}>
        {yes}
      </Btn>
    </div>
  )
}

/**
 * How content is made in this conversation: drafts here in the chat, or a Creative Lab canvas. Until the
 * first request it shows the page's (canvas in Creative Lab); the other view is a click away.
 */
function ModeSwitch() {
  const a = useAssistant()
  const { path, navigate } = useRouter()
  const c = a.conversation
  if (!c || !a.kept) return null
  const inLab = path.startsWith('/dashboard/studio')
  const mode: Mode = c.mode ?? (inLab ? 'canvas' : 'drafts')
  const elsewhere = mode === 'canvas' ? !inLab : path !== '/dashboard/assistant'
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
      <span className="text-[11px] text-dim">Make it as</span>
      <div role="radiogroup" aria-label="How content is made" className="flex rounded-md border border-line bg-ink/40 p-0.5">
        {(['drafts', 'canvas'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={a.conn !== 'online'}
            onClick={() => mode !== m && a.setMode(m)}
            title={m === 'drafts' ? 'Posts made here, in the chat' : 'Posts built from nodes, on a Creative Lab canvas'}
            className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px] transition-colors', mode === m ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg')}
          >
            {m === 'drafts' ? <FileText className="size-3" /> : <Workflow className="size-3" />}
            {m === 'drafts' ? 'Drafts' : 'Canvas'}
          </button>
        ))}
      </div>
      {elsewhere && (
        <button
          type="button"
          onClick={() => navigate(mode === 'canvas' ? (c.project ? `/dashboard/studio?project=${c.project}` : '/dashboard/studio') : '/dashboard/assistant')}
          className="ml-auto flex items-center gap-0.5 text-[11px] text-accent-soft hover:underline"
        >
          {mode === 'canvas' ? 'Open the canvas' : 'Open the drafts'} <ChevronRight className="size-3" />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Composer({ onVoice }: { onVoice: () => void }) {
  const a = useAssistant()
  const file = useRef<HTMLInputElement>(null)
  const d = a.focus.draft ? a.drafts[a.focus.draft] : undefined
  const text = d && a.focus.text ? d.slides.flatMap((s) => s.texts).find((t) => t.id === a.focus.text) : undefined
  const selected = d && a.focus.text ? `Text ${a.focus.text}${text ? ` “${text.words}”` : ''}` : d && a.focus.slide ? `Slide ${a.focus.slide} of draft ${d.id}` : null
  // The post a request changes when it doesn't name one: the one on screen
  const onScreen = a.current ? a.drafts[a.current] : undefined

  // Grow with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const el = a.inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [a.input, a.inputRef])

  const send = () => {
    const text = a.input.trim()
    if (!text) return
    a.link.ensureAudio()
    a.setInput('')
    void a.say(text)
  }

  return (
    <div className="border-t border-line p-3">
      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease }}
            className="overflow-hidden"
          >
            <p className="mb-2 flex items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.06] px-2.5 py-1.5 text-[11.5px] text-accent-soft">
              {/* w-0: long words mustn't widen the panel (truncating doesn't stop that on its own) */}
              <span className="w-0 min-w-0 flex-1 truncate">
                Selected: {selected}. Say what to change.
              </span>
              <button type="button" aria-label="Clear the selection" onClick={() => a.select(d ? { draft: d.id } : {})} className="text-accent-soft/70 hover:text-fg">
                <X className="size-3.5" />
              </button>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      {!selected && onScreen && a.tab === 'draft' && (
        <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] text-dim">
          <span className="w-0 min-w-0 flex-1 truncate">
            Changes go to <span className="text-muted">{onScreen.title || `Draft ${onScreen.id}`}</span> · {onScreen.label}
          </span>
        </p>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-line-2 bg-white/[0.02] p-1.5 transition-[border-color,box-shadow] focus-within:border-accent-soft/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)]">
        <button type="button" onClick={() => file.current?.click()} aria-label="Attach a picture or video" className="grid size-8 shrink-0 place-items-center rounded-md text-dim hover:bg-white/[0.05] hover:text-fg">
          <Paperclip className="size-4" strokeWidth={1.75} />
        </button>
        <textarea
          ref={a.inputRef}
          rows={1}
          value={a.input}
          onChange={(e) => a.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (!files.length) return
            e.preventDefault()
            void a.upload(files)
          }}
          placeholder={a.conn === 'online' ? 'Ask for a post, a change, a time…' : 'The assistant is offline'}
          className="min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-snug text-fg outline-none placeholder:text-dim"
        />
        <button
          type="button"
          onClick={send}
          disabled={!a.input.trim() || a.conn !== 'online'}
          aria-label="Send"
          className="grid size-8 shrink-0 place-items-center rounded-md bg-fg text-ink transition-opacity disabled:opacity-25"
        >
          <ArrowUp className="size-4" strokeWidth={2} />
        </button>
        <input
          ref={file}
          type="file"
          hidden
          multiple
          accept="image/*,video/*,audio/*,.json"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            void a.upload(files)
          }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
        <label className="flex items-center gap-2 text-[11.5px] text-dim" title={a.speech ? 'Replies are read aloud' : 'Replies are only written: just chat'}>
          <Toggle on={a.speech} onChange={a.setSpeech} label="Speak the replies" />
          {a.speech ? <Volume2 className="size-3.5" strokeWidth={1.75} /> : <VolumeX className="size-3.5" strokeWidth={1.75} />}
          {a.speech ? 'Spoken replies' : 'Text only'}
        </label>
        {a.speech && (
          <label className="flex items-center gap-2 text-[11.5px] text-dim">
            <Toggle on={a.bargeIn} onChange={a.setBargeIn} label="Talk over the assistant" />
            <Headphones className="size-3.5" strokeWidth={1.75} />
            Talk over it {a.bargeIn ? '(best with headphones)' : '(the mic pauses while it speaks)'}
          </label>
        )}
        <button
          type="button"
          onClick={onVoice}
          aria-label={`Voice: ${a.voice?.name ?? 'pick one'}`}
          title="The voice it speaks in"
          className="-mx-1.5 ml-auto flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] text-dim transition-colors hover:bg-white/[0.04] hover:text-fg"
        >
          <AudioLines className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="max-w-[18ch] truncate">{a.voice?.name ?? 'Voice'}</span>
          <ChevronRight className="size-3 shrink-0" />
        </button>
      </div>
    </div>
  )
}
