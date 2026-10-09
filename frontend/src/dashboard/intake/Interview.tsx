import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, ArrowUp, Copy, Download, FastForward, ImagePlus, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, apiStream, ApiError, type Campaign } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useInvalidate } from '../data'
import { useUser } from '../Shell'
import { useToast } from '../toast'
import { Btn, Modal, PageHeader } from '../ui'
import { BriefPanel } from './BriefPanel'
import { briefText, copyText, downloadPackage, PHOTO_TYPES, shrinkPhoto } from './files'
import { KitMarkdown } from './KitMarkdown'

function messageFor(e: unknown) {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again.'
  if (e.status === 429) return 'That’s a lot in a short time. Give it a minute, then try again.'
  if (e.status === 422) return Object.values(e.errors)[0]?.[0] ?? e.message
  return e.message
}

const valuesOf = (c: Campaign) => new Map(c.brief.flatMap((g) => g.fields.map((f) => [f.key, f.value] as const)))

type Kit = { text: string; state: 'writing' | 'stopped' | 'failed'; error?: string }
/** What the person just said, shown while the server works on it. */
type Outgoing = { text: string; photos?: string[] }

/**
 * One campaign's intake: the brief on the left, the interview on the right. Every step goes to
 * the API, which saves it before asking Claude, so a reload or a failed turn loses nothing.
 *
 * `onNext` is the hand-off once the interview is done: the strategist gives the brief to the
 * writer and takes you to the plan, instead of leaving a finished brief sitting there with
 * nothing to click.
 */
export function Interview({
  initial,
  embedded = false,
  onChange,
  onNext,
  nextBusy = false,
}: {
  initial: Campaign
  embedded?: boolean
  onChange?: (c: Campaign) => void
  onNext?: () => void
  nextBusy?: boolean
}) {
  const user = useUser()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { navigate } = useRouter()

  const [campaign, setCampaign] = useState(initial)
  const current = useRef(initial)
  const [fresh, setFresh] = useState({ keys: new Set<string>(), stamp: 0 })
  const [busy, setBusy] = useState<string | null>(null)
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kit, setKit] = useState<Kit | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragging, setDragging] = useState(false)
  const kitAbort = useRef<AbortController | null>(null)
  const kitStopped = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // Leaving the page stops a kit that's being written.
  useEffect(() => () => kitAbort.current?.abort(), [])

  const id = campaign.id
  const writingKit = kit?.state === 'writing'
  const locked = !!busy || writingKit
  const room = campaign.max_photos - campaign.photos.length

  /** Take the server's state, and highlight whatever it newly filled in. */
  const update = (next: Campaign) => {
    const before = valuesOf(current.current)
    const keys = new Set([...valuesOf(next)].filter(([k, v]) => v && v !== before.get(k)).map(([k]) => k))
    if (keys.size) setFresh({ keys, stamp: Date.now() })
    current.current = next
    setCampaign(next)
    onChange?.(next)
  }

  /** Run a step of the interview. On failure, re-read what the server kept and say what went wrong. */
  const step = async (label: string, said: Outgoing | null, request: () => Promise<Campaign>) => {
    if (locked) return
    setBusy(label)
    setOutgoing(said)
    setError(null)
    try {
      update(await request())
    } catch (e) {
      setError(messageFor(e))
      await api<Campaign>(`/campaigns/${id}`).then(update).catch(() => {})
    } finally {
      setOutgoing(null)
      setBusy(null)
      input.current?.focus({ preventScroll: true })
    }
  }

  const send = (text: string) => {
    const t = text.trim()
    if (!t || campaign.complete) return
    setDraft('')
    step('Thinking…', { text: t }, () => api<Campaign>(`/campaigns/${id}/turn`, { method: 'POST', body: { text: t } }))
  }
  const retry = () => step('Thinking…', null, () => api<Campaign>(`/campaigns/${id}/turn`, { method: 'POST', body: {} }))
  const finishNow = () =>
    step(campaign.mode === 'ai' ? 'Filling in the rest…' : 'Wrapping up…', null, () =>
      api<Campaign>(`/campaigns/${id}/turn`, { method: 'POST', body: { finish: true } }),
    )
  const deeper = () =>
    step('Thinking…', { text: 'Answer more questions' }, () => api<Campaign>(`/campaigns/${id}/deeper`, { method: 'POST' }))

  const addPhotos = async (list: File[]) => {
    if (locked) return
    const images = list.filter((f) => PHOTO_TYPES.includes(f.type))
    if (!images.length) return setError('Use JPG, PNG, WebP or GIF photos.')
    if (room <= 0) return setError(`You’ve reached ${campaign.max_photos} photos. Remove one to add another.`)
    if (images.length > room) toast(`Only the first ${room} photos were added (up to ${campaign.max_photos}).`)

    const chosen = images.slice(0, room)
    const previews = chosen.map((f) => URL.createObjectURL(f))
    const n = chosen.length
    await step('Looking at your photos…', { text: `Shared ${n} ${n === 1 ? 'photo' : 'photos'}`, photos: previews }, async () => {
      const form = new FormData()
      for (const file of await Promise.all(chosen.map(shrinkPhoto))) form.append('photos[]', file)
      return api<Campaign>(`/campaigns/${id}/photos`, { method: 'POST', body: form })
    })
    previews.forEach((u) => URL.revokeObjectURL(u))
  }

  const removePhoto = async (photo: number) => {
    setBusy('Removing the photo…')
    try {
      update(await api<Campaign>(`/campaigns/${id}/photos/${photo}`, { method: 'DELETE' }))
    } catch (e) {
      toast(messageFor(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const createKit = async () => {
    if (locked) return
    const abort = new AbortController()
    kitAbort.current = abort
    kitStopped.current = false
    setError(null)
    setKit({ text: '', state: 'writing' })

    let out = ''
    let done = false
    let failure: string | null = null
    try {
      await apiStream(
        `/campaigns/${id}/kit`,
        {},
        ({ event, data }) => {
          if (event === 'delta') {
            out += (data as { text: string }).text
            setKit({ text: out, state: 'writing' })
          } else if (event === 'done') {
            done = true
          } else if (event === 'error') {
            failure = (data as { message: string }).message
          }
        },
        abort.signal,
      )
      if (!done) throw new ApiError(0, failure ?? 'The connection dropped before the kit was finished. Try again.')
      update(await api<Campaign>(`/campaigns/${id}`))
      setKit(null)
      invalidate()
      toast('Your content kit is ready.')
    } catch (e) {
      setKit(kitStopped.current ? { text: out, state: 'stopped' } : { text: out, state: 'failed', error: messageFor(e) })
    } finally {
      kitAbort.current = null
    }
  }

  const stopKit = () => {
    kitStopped.current = true
    kitAbort.current?.abort()
  }

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text)
    toast(ok ? `${what} copied.` : 'Couldn’t copy. Select the text instead.', ok ? 'success' : 'error')
  }

  const download = async () => {
    try {
      await downloadPackage(campaign)
    } catch {
      toast('Couldn’t put the package together. Try again.', 'error')
    }
  }

  const remove = async () => {
    try {
      await api(`/campaigns/${id}`, { method: 'DELETE' })
      invalidate()
      toast('Campaign deleted.')
      navigate('/dashboard/campaigns')
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  const aiReason = campaign.ai_available
    ? null
    : !user.email_verified
      ? 'Confirm your email address to have AI run the interview and write the content kit.'
      : 'AI isn’t switched on yet, so the standard questions run the interview.'

  return (
    <div>
      {!embedded && (
        <PageHeader
          eyebrow="Campaigns"
          title={
            campaign.title ? (
              <span className="block max-w-[22ch] truncate">{campaign.title}</span>
            ) : (
              <>
                New <Serif>campaign.</Serif>
              </>
            )
          }
          actions={
            <>
              <Btn variant="subtle" icon={ArrowLeft} onClick={() => navigate('/dashboard/campaigns')} aria-label="All campaigns">
                <span className="hidden xl:inline">All campaigns</span>
              </Btn>
              <Btn icon={Copy} onClick={() => copy(briefText(campaign), 'Brief')}>
                Copy brief
              </Btn>
              <Btn icon={Download} onClick={download}>
                Download
              </Btn>
              <Btn variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label="Delete campaign" />
            </>
          }
        />
      )}

      {/* On wide screens both columns fill the window below the header, so the composer is always in view. */}
      <div className={cn('grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]', embedded ? 'mt-0' : 'mt-6')}>
        <div className={cn('no-scrollbar lg:min-h-[520px] lg:overflow-y-auto lg:rounded-xl', embedded ? 'lg:h-[calc(100dvh-20rem)]' : 'lg:h-[calc(100dvh-13.5rem)]')} data-lenis-prevent>
          <BriefPanel campaign={campaign} fresh={fresh} onRemovePhoto={removePhoto} removing={locked} />
        </div>

        <section
          aria-label="Interview"
          onDragOver={(e: DragEvent) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addPhotos([...e.dataTransfer.files])
          }}
          className={cn(
            'relative flex h-[72dvh] min-h-[440px] min-w-0 flex-col overflow-hidden rounded-xl border bg-panel transition-colors duration-300 lg:min-h-[520px]',
            embedded ? 'lg:h-[calc(100dvh-20rem)]' : 'lg:h-[calc(100dvh-13.5rem)]',
            dragging ? 'border-accent/60' : 'border-line',
          )}
        >
          <ChatHeader campaign={campaign} reason={aiReason} canFinish={!campaign.complete && campaign.asked >= 2 && !locked} onFinish={finishNow} />

          <Log campaign={campaign} outgoing={outgoing} busy={busy} follow={kit?.text}>
            {/* Under the last message: what can happen next. */}
            {!busy && error && (
              <Note tone="error">
                {error}
                {campaign.awaiting_reply && <Chip onClick={retry} icon={RotateCcw}>Try again</Chip>}
              </Note>
            )}
            {!busy && !error && campaign.awaiting_reply && (
              <Note>
                Your last answer is still waiting for a reply.
                <Chip onClick={retry} icon={RotateCcw}>Try again</Chip>
              </Note>
            )}
            {!busy && !campaign.complete && !campaign.awaiting_reply && campaign.prompt && (
              <Chips>
                {campaign.prompt.photos && room > 0 && (
                  <Btn variant="primary" size="sm" icon={ImagePlus} onClick={() => fileInput.current?.click()}>
                    Add photos
                  </Btn>
                )}
                {campaign.prompt.options.map((o) => (
                  <Chip key={o} onClick={() => send(o)}>
                    {o}
                  </Chip>
                ))}
              </Chips>
            )}

            {/* A saved kit follows the finished interview; while it's reopened, the new questions come first. */}
            {(kit || (campaign.kit && campaign.complete)) && (
              <KitPanel
                text={kit ? kit.text : (campaign.kit ?? '')}
                state={kit?.state ?? 'saved'}
                error={kit?.error}
                canWrite={campaign.ai_available && !busy}
                onStop={stopKit}
                onCopy={(t) => copy(t, 'Content kit')}
                onAgain={createKit}
              />
            )}

            {campaign.complete && !busy && !kit && (
              <Chips>
                {campaign.ai_available && !campaign.kit && (
                  <Btn variant="primary" size="sm" icon={Sparkles} onClick={createKit}>
                    Write my content kit
                  </Btn>
                )}
                {onNext && (
                  <Btn variant={campaign.kit ? 'primary' : 'ghost'} size="sm" icon={ArrowRight} onClick={onNext} loading={nextBusy}>
                    Make the content
                  </Btn>
                )}
                {campaign.ai_available && campaign.brief.some((g) => g.fields.some((f) => f.suggested)) && (
                  <Chip onClick={deeper}>Answer more questions</Chip>
                )}
                {!campaign.ai_available && !campaign.kit && (
                  <span className="text-[12px] text-dim">{aiReason?.replace(/, so .*$/, '.')} The content kit needs it.</span>
                )}
              </Chips>
            )}
          </Log>

          <Composer
            inputRef={input}
            value={draft}
            onChange={(v) => {
              setDraft(v)
              setError(null)
            }}
            onSend={() => send(draft)}
            onAttach={() => fileInput.current?.click()}
            disabled={locked || campaign.complete}
            canAttach={!locked && room > 0}
            placeholder={campaign.complete ? 'The interview is finished. You can still add photos.' : 'Type your answer…'}
          />
          <input
            ref={fileInput}
            type="file"
            accept={PHOTO_TYPES.join(',')}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              addPhotos(files)
            }}
          />

          <AnimatePresence>
            {dragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/70 backdrop-blur-sm"
              >
                <p className="flex items-center gap-2 text-[13px] text-fg">
                  <ImagePlus className="size-4 text-accent-soft" strokeWidth={1.75} />
                  Drop photos to share them
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this campaign?">
        <p className="text-[13px] leading-snug text-muted">
          The brief, the interview, the photos and the content kit go with it. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="subtle" onClick={() => setConfirmDelete(false)}>
            Keep it
          </Btn>
          <Btn variant="danger" icon={Trash2} onClick={remove}>
            Delete campaign
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pieces                                                               */
/* ------------------------------------------------------------------ */

function ChatHeader({
  campaign,
  reason,
  canFinish,
  onFinish,
}: {
  campaign: Campaign
  reason: string | null
  canFinish: boolean
  onFinish: () => void
}) {
  const progress = campaign.complete
    ? 'Interview finished'
    : `Question ${Math.min(campaign.asked, campaign.max_questions)} of about ${campaign.max_questions}`

  return (
    <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 md:px-5">
      <p className="flex items-center gap-2 text-[13px] font-medium">
        <span className={cn('size-1.5 rounded-full', campaign.complete ? 'bg-ok' : 'bg-accent-soft')} />
        {campaign.depth === 'quick' ? 'Quick interview' : 'Full interview'}
      </p>
      <span className="font-mono text-[10.5px] text-dim">{progress}</span>
      {campaign.mode === 'script' && (
        <span title={reason ?? undefined} className="rounded-full border border-line-2 px-2 py-0.5 font-mono text-[10px] text-muted">
          Standard questions
        </span>
      )}
      {canFinish && (
        <Btn variant="subtle" size="sm" icon={FastForward} onClick={onFinish} className="ml-auto" title="Stop here; AI suggests the rest">
          Finish now
        </Btn>
      )}
    </header>
  )
}

/** The scrolling chat. Sticks to the bottom as things arrive, unless you've scrolled up to read. */
function Log({
  campaign,
  outgoing,
  busy,
  follow,
  children,
}: {
  campaign: Campaign
  outgoing: Outgoing | null
  busy: string | null
  /** More content to keep in view as it streams (the kit). */
  follow?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // Messages already there on load don't animate in; new ones do.
  const [seen] = useState(campaign.messages.length)
  const photos = new Map(campaign.photos.map((p) => [p.id, p.url]))

  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [campaign.messages.length, outgoing, busy, follow, campaign.complete, campaign.kit])

  return (
    <div
      ref={ref}
      data-lenis-prevent
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      // Children keep their height: the log scrolls, it never squeezes (the kit panel clips its overflow, so it would).
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 md:px-5 [&>*]:shrink-0"
      aria-live="polite"
    >
      {campaign.messages.map((m, i) => (
        <Message
          key={i}
          who={m.who}
          text={m.text}
          photos={m.photos?.map((p) => photos.get(p)).filter((u): u is string => !!u)}
          animate={i >= seen}
        />
      ))}
      {outgoing && <Message who="client" text={outgoing.text} photos={outgoing.photos} animate />}
      {busy && <Typing label={busy} />}
      {children}
    </div>
  )
}

function Message({ who, text, photos, animate }: { who: 'agency' | 'client' | 'note'; text: string; photos?: string[]; animate: boolean }) {
  if (who === 'note') return <Note>{text}</Note>
  const client = who === 'client'
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 10, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease }}
      className={cn(
        'max-w-[min(84%,560px)] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-snug [overflow-wrap:anywhere]',
        client
          ? 'origin-bottom-right self-end rounded-br-md bg-accent text-on-accent'
          : 'origin-bottom-left self-start rounded-bl-md border border-line bg-white/[0.04] text-fg',
      )}
    >
      {!client && <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Strategist</span>}
      {text}
      {photos && photos.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1.5">
          {photos.map((src) => (
            <img key={src} src={src} alt="Shared photo" className="size-14 rounded-md object-cover" />
          ))}
        </span>
      )}
    </motion.div>
  )
}

function Typing({ label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2.5 self-start rounded-2xl rounded-bl-md border border-line bg-white/[0.04] px-3.5 py-2.5 text-[12.5px] text-muted"
    >
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1 rounded-full bg-accent-soft"
            animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
      {label}
    </motion.div>
  )
}

function Note({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-3 gap-y-2 self-center px-2 text-center text-[12px]',
        tone === 'error' ? 'text-fail' : 'text-dim',
      )}
    >
      {children}
    </p>
  )
}

function Chips({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease, delay: 0.1 }}
      className="flex max-w-[92%] flex-wrap items-center gap-2 self-start"
    >
      {children}
    </motion.div>
  )
}

function Chip({ children, onClick, icon: Icon }: { children: ReactNode; onClick: () => void; icon?: typeof RotateCcw }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-2 px-3 text-[12px] text-fg transition-[border-color,background-color,color] duration-300 hover:border-accent-soft/70 hover:bg-accent/10"
    >
      {Icon && <Icon className="size-3.5" strokeWidth={1.75} />}
      {children}
    </button>
  )
}

function KitPanel({
  text,
  state,
  error,
  canWrite,
  onStop,
  onCopy,
  onAgain,
}: {
  text: string
  state: Kit['state'] | 'saved'
  error?: string
  canWrite: boolean
  onStop: () => void
  onCopy: (text: string) => void
  onAgain: () => void
}) {
  const writing = state === 'writing'
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease }}
      className={cn('relative mt-2 overflow-hidden rounded-xl border bg-panel-2', writing ? 'border-accent/40' : 'border-line-2')}
    >
      {writing && (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-soft to-transparent"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 md:px-5">
        <p className="flex items-center gap-2 text-[14px] font-medium">
          <Sparkles className={cn('size-3.5 text-accent-soft', writing && 'animate-pulse')} strokeWidth={1.75} />
          Content kit
        </p>
        <span className="font-mono text-[10.5px] text-dim">
          {writing ? 'Writing…' : state === 'stopped' ? 'Stopped, not saved' : state === 'failed' ? 'Not finished' : 'Saved with the campaign'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {writing ? (
            <Btn size="sm" icon={Square} onClick={onStop}>
              Stop
            </Btn>
          ) : (
            <>
              {text && (
                <Btn size="sm" icon={Copy} onClick={() => onCopy(text)}>
                  Copy kit
                </Btn>
              )}
              {canWrite && (
                <Btn size="sm" variant={state === 'saved' ? 'subtle' : 'primary'} icon={RotateCcw} onClick={onAgain}>
                  {state === 'saved' ? 'Write it again' : 'Create it again'}
                </Btn>
              )}
            </>
          )}
        </div>
      </header>
      <div className="px-4 py-5 md:px-5">
        {text ? (
          <KitMarkdown text={text} />
        ) : writing ? (
          <div className="space-y-2.5">
            <p className="text-[12.5px] text-dim">Thinking it through. This takes about a minute.</p>
            {[92, 78, 85, 60].map((w) => (
              <div key={w} className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : null}
        {error && <p className="mt-4 font-mono text-[11px] text-fail">{error}</p>}
      </div>
    </motion.section>
  )
}

/** One to five lines; Enter sends, Shift + Enter breaks the line. */
function Composer({
  inputRef,
  value,
  onChange,
  onSend,
  onAttach,
  disabled,
  canAttach,
  placeholder,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onAttach: () => void
  disabled: boolean
  canAttach: boolean
  placeholder: string
}) {
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value, inputRef])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSend()
      }}
      className="flex items-end gap-2 border-t border-line p-3"
    >
      <button
        type="button"
        onClick={onAttach}
        disabled={!canAttach}
        aria-label="Add photos"
        title="Add photos"
        className="grid size-9 shrink-0 place-items-center rounded-md border border-line-2 text-muted transition-colors hover:border-white/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ImagePlus className="size-4" strokeWidth={1.75} />
      </button>
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        maxLength={2000}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Your answer"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSend()
          }
        }}
        className="block min-h-9 min-w-0 flex-1 resize-none rounded-md border border-line-2 bg-white/[0.02] px-3 py-2 text-[13.5px] leading-snug outline-none transition-[border-color,box-shadow] duration-300 placeholder:text-dim focus:border-accent-soft/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label="Send"
        className="grid size-9 shrink-0 place-items-center rounded-md bg-fg text-ink transition-[background-color,box-shadow] duration-300 hover:bg-white hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_20%,transparent)] disabled:cursor-not-allowed disabled:bg-fg/40"
      >
        <ArrowUp className="size-4" strokeWidth={2} />
      </button>
    </form>
  )
}
