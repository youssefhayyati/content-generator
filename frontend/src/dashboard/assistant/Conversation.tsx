import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, AudioLines, AudioWaveform, BadgeCheck, CalendarCheck, Check, ChevronRight, CircleAlert, Headphones, LoaderCircle, Mic, MicOff, Paperclip, Square, X } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Btn, Toggle } from '../ui'
import { ConversationBar, ConversationList } from './Conversations'
import { VoicePicker } from './Voices'
import type { VoiceState } from './link'
import { useAssistant, useAssistantLog, useVoiceState, type Approval, type LogItem } from './store'

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
      <VoiceBar />
      <Log />
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

const CLOSED: Record<Approval['status'], string> = {
  waiting: 'Needs your approval',
  approved: 'Scheduled',
  declined: 'Declined',
  failed: 'Couldn’t schedule',
  outdated: 'No longer current',
}
/** A campaign version (gate 6B) is approved, not scheduled. */
const VERSION: Partial<Record<Approval['status'], string>> = { approved: 'Approved', failed: 'Couldn’t approve' }

/** Nothing is booked until the person says so here. */
function Approvals() {
  const a = useAssistant()
  const list = Object.values(a.approvals).sort((x, y) => y.id - x.id)
  const shown = [...list.filter((x) => x.status === 'waiting'), ...list.filter((x) => x.status !== 'waiting').slice(0, 1)]
  if (!shown.length) return null

  return (
    <div className="space-y-2 border-t border-line px-4 py-3 md:px-5">
      <AnimatePresence initial={false}>
        {shown.map((x) => (
          <motion.div
            key={x.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease }}
            className={cn(
              'rounded-lg border px-3.5 py-3',
              x.status === 'waiting' ? 'border-accent/40 bg-accent/[0.07]' : x.status === 'approved' ? 'border-ok/25 bg-ok/[0.05]' : 'border-line bg-white/[0.02]',
            )}
          >
            <p className={cn('flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]', x.status === 'waiting' ? 'text-accent-soft' : x.status === 'approved' ? 'text-ok' : 'text-dim')}>
              {x.kind === 'version' ? <BadgeCheck className="size-3" /> : <CalendarCheck className="size-3" />}
              {(x.kind === 'version' && VERSION[x.status]) || CLOSED[x.status]}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-snug">{x.text}</p>
            {x.detail && x.status !== 'approved' && <p className="mt-1 text-[11.5px] text-dim">{x.detail}</p>}
            {x.status === 'waiting' && (
              <div className="mt-3 flex justify-end gap-2">
                <Btn size="sm" variant="subtle" onClick={() => a.decline(x)}>
                  Decline
                </Btn>
                <Btn size="sm" variant="primary" icon={Check} loading={a.booking.includes(x.id)} disabled={x.kind === 'schedule' && !x.payload} onClick={() => void a.approve(x)}>
                  Approve
                </Btn>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
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
        <label className="flex items-center gap-2 text-[11.5px] text-dim">
          <Toggle on={a.bargeIn} onChange={a.setBargeIn} label="Talk over the assistant" />
          <Headphones className="size-3.5" strokeWidth={1.75} />
          Talk over it {a.bargeIn ? '(best with headphones)' : '(the mic pauses while it speaks)'}
        </label>
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
