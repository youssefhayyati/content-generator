import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Check, ChevronDown, Sparkles, Square, Undo2 } from 'lucide-react'
import type { PlatformId } from '../components/ui/PlatformIcon'
import { apiStream, ApiError, type AiOptions, type PostFormat } from '../lib/api'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { Dictate } from './sound/Dictate'
import { useApi } from './data'
import { ModelPicker } from './studio/parts'
import { useUser } from './Shell'
import { FieldError, Menu, Skeleton } from './ui'

/** Mirrors App\Services\Ai\PostPrompt::TONES on the API. */
const TONES = ['professional', 'friendly', 'bold', 'playful'] as const
type Tone = (typeof TONES)[number]

/** One-click briefs once there's a draft to work on. */
const REWRITES = ['Make it shorter', 'Stronger opening line', 'Add a call to action', 'Tighten the wording']

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

function messageFor(e: unknown) {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again.'
  if (e.status === 403) return 'Confirm your email address to use AI writing.'
  if (e.status === 429) return 'That’s a lot of writing in a short time. Give it a minute.'
  if (e.status === 422) return e.field('brief') ?? e.field('platforms') ?? e.message
  return e.message
}

type Props = {
  body: string
  onBody: (body: string) => void
  format: PostFormat
  platforms: PlatformId[]
  /** True while text is streaming into the body, so the editor can hold still. */
  onWriting: (writing: boolean) => void
}

/**
 * Asks Claude for the post: a fresh one from a brief when the editor is empty, or a rewrite
 * of what's there. The text streams straight into the editor, and the result can be undone.
 */
export function Writer({ body, onBody, format, platforms, onWriting }: Props) {
  const user = useUser()
  const { data: options, error: optionsError } = useApi<AiOptions>('/ai')
  const [brief, setBrief] = useState('')
  const [tone, setTone] = useState<Tone | null>(null)
  const [model, setModel] = useState<string | null>(null)
  // The body as it was when the current request started; null when nothing is running.
  const [job, setJob] = useState<{ before: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const stopped = useRef(false)

  // Leaving the page cancels a request in flight.
  useEffect(() => () => controller.current?.abort(), [])

  // Undo is offered only while the body still holds exactly what was generated.
  useEffect(() => {
    if (undo && body !== undo.after) setUndo(null)
  }, [body, undo])

  if (optionsError) return null
  if (!options) return <Skeleton className="h-[124px] rounded-xl" />

  const writing = job !== null
  const rewrite = (job ? job.before : body).trim() !== ''
  const models = options.models
  const activeModel = models.find((m) => m.id === model && m.available) ?? models.find((m) => m.id === options.default) ?? models.find((m) => m.available)
  const blocked = !options.enabled
    ? 'AI writing isn’t switched on yet. Write the post yourself for now.'
    : !user.email_verified
      ? 'Confirm your email address to use AI writing. The link is in your inbox.'
      : null

  const run = async (text: string) => {
    if (writing || blocked) return
    if (!text.trim()) {
      setError(rewrite ? 'Say how the draft should change.' : 'Say what the post should be about.')
      return
    }
    if (!platforms.length) {
      setError('Pick at least one platform first, so the post fits it.')
      return
    }

    const before = body
    const abort = new AbortController()
    controller.current = abort
    stopped.current = false
    setJob({ before })
    setError(null)
    setUndo(null)
    onWriting(true)
    onBody('')

    let out = ''
    let done = false
    let failure: string | null = null
    try {
      await apiStream(
        '/ai/write',
        { brief: text, draft: before.trim() ? before : null, format, platforms, tone, model: activeModel?.id },
        ({ event, data }) => {
          if (event === 'delta') {
            out += (data as { text: string }).text
            onBody(out.trimStart())
          } else if (event === 'done') {
            done = true
          } else if (event === 'error') {
            failure = (data as { message: string }).message
          }
        },
        abort.signal,
      )
      if (!done) throw new ApiError(0, failure ?? 'The connection dropped before the post was finished. Try again.')

      const result = out.trim()
      onBody(result)
      setUndo({ before, after: result })
      setBrief('')
    } catch (e) {
      // Stop keeps what was written so far; a failure puts the old text back.
      const partial = out.trim()
      if (stopped.current && partial) {
        onBody(partial)
        setUndo({ before, after: partial })
      } else {
        onBody(before)
        if (!abort.signal.aborted) setError(messageFor(e))
      }
    } finally {
      controller.current = null
      setJob(null)
      onWriting(false)
    }
  }

  const stop = () => {
    stopped.current = true
    controller.current?.abort()
  }

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl border bg-panel transition-colors duration-500',
        writing ? 'border-accent/40' : 'border-line',
      )}
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

      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3.5 md:px-5">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <Sparkles className={cn('size-3.5 text-accent-soft', writing && 'animate-pulse')} strokeWidth={1.75} />
          {writing ? (rewrite ? 'Rewriting…' : 'Writing…') : rewrite ? 'Rewrite with AI' : 'Write with AI'}
        </p>
        <div className="flex items-center gap-1.5">
          <Picker
            label="Tone"
            value={tone ? capitalize(tone) : 'Any'}
            disabled={writing || !!blocked}
            items={[null, ...TONES].map((t) => ({
              label: t ? capitalize(t) : 'Any',
              selected: t === tone,
              onSelect: () => setTone(t),
            }))}
          />
          {activeModel && !blocked && (
            <ModelPicker models={models} kind="text" value={activeModel.id} onChange={setModel} align="right" size="sm" className={cn('w-[210px]', writing && 'pointer-events-none opacity-60')} />
          )}
        </div>
      </header>

      <div className="px-4 pb-3.5 pt-3 md:px-5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(brief)
          }}
          className={cn(
            'flex items-end gap-2 rounded-lg border border-line-2 bg-white/[0.02] py-1.5 pl-3 pr-1.5 transition-[border-color,box-shadow] duration-300',
            'focus-within:border-accent-soft/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)]',
            blocked && 'opacity-60',
          )}
        >
          <BriefInput
            value={brief}
            onChange={(v) => {
              setBrief(v)
              setError(null)
            }}
            onSubmit={() => run(brief)}
            disabled={writing || !!blocked}
            placeholder={
              rewrite
                ? 'How should it change? Shorter, warmer, a question at the end…'
                : 'What’s the post about? A launch, a tip, a story from this week…'
            }
          />
          {!writing && !blocked && <Dictate iconOnly label="Say the brief" onText={(t) => setBrief((b) => (b.trim() ? `${b.trim()} ${t}` : t))} className="h-8 border-transparent px-2" />}
          {writing ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop writing"
              className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 text-fg transition-colors hover:bg-white/[0.06]"
            >
              <Square className="size-3" fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!!blocked}
              aria-label={rewrite ? 'Rewrite the post' : 'Write the post'}
              className="grid size-8 shrink-0 place-items-center rounded-md bg-fg text-ink transition-[background-color,box-shadow] duration-300 hover:bg-white hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_20%,transparent)] disabled:cursor-not-allowed disabled:bg-fg/50"
            >
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          )}
        </form>
        <FieldError message={error} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={blocked ? 'blocked' : writing ? 'writing' : rewrite ? 'rewrite' : 'write'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease }}
            className="mt-2.5 flex min-h-7 flex-wrap items-center gap-1.5 text-[11.5px] text-dim"
          >
            {blocked ? (
              <span>{blocked}</span>
            ) : writing ? (
              <span className="font-mono text-[10.5px]">{activeModel?.label} is writing. Stop keeps what’s there so far.</span>
            ) : (
              <>
                {rewrite ? (
                  REWRITES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => run(r)}
                      className="h-7 rounded-full border border-line px-2.5 text-muted transition-colors hover:border-line-2 hover:text-fg"
                    >
                      {r}
                    </button>
                  ))
                ) : (
                  <span className="font-mono text-[10.5px]">Enter to write · Shift + Enter for a new line</span>
                )}
                {undo && (
                  <button
                    type="button"
                    onClick={() => {
                      onBody(undo.before)
                      setUndo(null)
                    }}
                    title={undo.before.trim() ? 'Put back the version from before' : 'Clear what was written'}
                    className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-muted transition-colors hover:bg-white/[0.05] hover:text-fg"
                  >
                    <Undo2 className="size-3.5" strokeWidth={1.75} />
                    Undo
                  </button>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}

/** One to five lines; Enter sends, Shift + Enter breaks the line. */
function BriefInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled: boolean
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      maxLength={2000}
      disabled={disabled}
      placeholder={placeholder}
      aria-label="Brief for the AI"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onSubmit()
        }
      }}
      className="block min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-snug outline-none placeholder:text-dim disabled:cursor-not-allowed"
    />
  )
}

function Picker({
  label,
  value,
  items,
  disabled,
}: {
  label: string
  value: string
  items: Array<{ label: string; selected: boolean; onSelect: () => void }>
  disabled: boolean
}) {
  return (
    <Menu
      items={items.map((item) => ({
        label: item.label,
        onSelect: item.onSelect,
        hint: item.selected ? <Check className="size-3.5 text-accent-soft" strokeWidth={2} /> : undefined,
      }))}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[11.5px] text-fg transition-colors hover:border-line-2 disabled:cursor-default disabled:hover:border-line"
        >
          <span className="text-dim">{label}</span>
          {value}
          {!disabled && <ChevronDown className={cn('size-3 text-dim transition-transform', open && 'rotate-180')} />}
        </button>
      )}
    />
  )
}
