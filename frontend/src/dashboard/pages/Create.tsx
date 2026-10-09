import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, Check, Clapperboard, Copy, FileText, Image, ListPlus, Send, Trash2, Type } from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type Account, type Asset, type Page, type Post, type PostFormat } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import {
  addDays,
  CHAR_LIMIT,
  fmtDateTime,
  fmtRelative,
  fromInputs,
  PLATFORM_ORDER,
  postState,
  toInputs,
  useApi,
  useInvalidate,
} from '../data'
import { ChecksPanel, Destination, MediaStrip } from '../composer/Parts'
import { PostPreview } from '../PostPreview'
import { useOverview, useUser } from '../Shell'
import { useToast } from '../toast'
import { Writer } from '../Writer'
import { Btn, FieldError, inputClass, Modal, PageHeader, Panel, Segmented, Skeleton, StateBadge, Stagger } from '../ui'

type When = 'draft' | 'queue' | 'pick' | 'published'

const FORMATS: Array<{ value: PostFormat; label: ReactNode }> = [
  { value: 'text', label: <><Type className="size-3.5" strokeWidth={1.75} /> Text</> },
  { value: 'image', label: <><Image className="size-3.5" strokeWidth={1.75} /> Image</> },
  { value: 'video', label: <><Clapperboard className="size-3.5" strokeWidth={1.75} /> Video</> },
]

const ACTION: Record<When, { label: string; icon: typeof Send }> = {
  draft: { label: 'Save draft', icon: FileText },
  queue: { label: 'Add to queue', icon: ListPlus },
  pick: { label: 'Schedule', icon: CalendarClock },
  published: { label: 'Mark as published', icon: Check },
}

const WHEN: Array<{ value: When; label: string; icon: typeof Send }> = [
  { value: 'draft', label: 'Draft', icon: FileText },
  { value: 'queue', label: 'Queue', icon: ListPlus },
  { value: 'pick', label: 'Schedule', icon: CalendarClock },
  { value: 'published', label: 'Posted', icon: Check },
]

const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

const count = (s: string) => [...s].length

/** Tomorrow at 09:00 local: a sensible default when someone first picks "a time". */
const tomorrowMorning = () => {
  const d = addDays(new Date(), 1)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

export default function Create() {
  const user = useUser()
  const { search, navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data: overview } = useOverview()
  const [params] = useState(() => new URLSearchParams(search))
  const postId = params.get('post')

  const [existing, setExisting] = useState<Post | null>(null)
  const [loading, setLoading] = useState(!!postId)
  const [title, setTitle] = useState('')
  // Arriving from the Studio's "Use in a post": the text, or the media, to start from.
  const [body, setBody] = useState(() => params.get('body') ?? '')
  const [format, setFormat] = useState<PostFormat>(user.preferences.formats[0] ?? 'text')
  const [platforms, setPlatforms] = useState<PlatformId[]>(
    user.preferences.platforms.length ? user.preferences.platforms : ['linkedin'],
  )
  const [preview, setPreview] = useState<PlatformId | null>(null)
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [accountId, setAccountId] = useState<number | null>(null)
  const [media, setMedia] = useState<Asset[]>([])
  const [placement, setPlacement] = useState<string | null>(null)
  const account = accounts?.find((a) => a.id === accountId) ?? null

  useEffect(() => {
    const ids = params.get('assets')
    if (!ids || postId) return
    api<Page<Asset>>('/assets', { query: { ids } })
      .then((r) => {
        const order = ids.split(',').map(Number)
        const picked = [...r.data].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
        setMedia(picked)
        setFormat(picked.some((m) => m.kind === 'video') ? 'video' : 'image')
      })
      .catch(() => {})
  }, [params, postId])
  const [when, setWhen] = useState<When>(params.get('at') ? 'pick' : 'draft')
  const [{ date, time }, setPicked] = useState(() => toInputs(params.get('at') ?? tomorrowMorning()))
  const [saving, setSaving] = useState(false)
  const [writing, setWriting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Editing: load the post and set every control from it.
  useEffect(() => {
    if (!postId) return
    api<Post>(`/posts/${postId}`)
      .then((p) => {
        setExisting(p)
        setTitle(p.title ?? '')
        setBody(p.body)
        setFormat(p.format)
        setPlatforms(p.platforms)
        setAccountId(p.account?.id ?? null)
        setMedia(p.assets)
        setPlacement(p.placement)
        setWhen(p.status === 'published' ? 'published' : p.status === 'scheduled' ? 'pick' : 'draft')
        if (p.scheduled_at) setPicked(toInputs(p.scheduled_at))
      })
      .catch(() => {
        toast('That post doesn’t exist any more.', 'error')
        navigate('/dashboard/library', { replace: true })
      })
      .finally(() => setLoading(false))
  }, [postId, toast, navigate])

  const active = preview && platforms.includes(preview) ? preview : platforms[0]
  // The counter measures against the tightest limit among the picked platforms, and says which.
  const tightest = platforms.length ? platforms.reduce((a, b) => (CHAR_LIMIT[b] < CHAR_LIMIT[a] ? b : a)) : null
  const length = count(body)

  const togglePlatform = (id: PlatformId) => {
    setErrors(({ platforms: _, body: __, ...rest }) => rest)
    setPlatforms((list) => (list.includes(id) ? list.filter((p) => p !== id) : PLATFORM_ORDER.filter((p) => p === id || list.includes(p))))
  }

  const pickAccount = (a: Account | null) => {
    setAccountId(a?.id ?? null)
    setPlacement(null)
    if (a) setPlatforms([a.platform])
    setErrors(({ platforms: _, checks: __, ...rest }) => rest)
  }

  // The media decides the format: any video makes it a video post, images an image post.
  const changeMedia = (next: Asset[]) => {
    setMedia(next)
    setErrors(({ checks: _, ...rest }) => rest)
    if (next.some((m) => m.kind === 'video')) setFormat('video')
    else if (next.length) setFormat('image')
  }

  const changeBody = (v: string) => {
    setBody(v)
    setErrors(({ body: _, ...rest }) => rest)
  }

  const save = async () => {
    if (writing) return
    const local: Record<string, string> = {}
    if (!body.trim()) local.body = 'Write something first.'
    if (!platforms.length) local.platforms = 'Pick at least one platform.'
    if (when === 'pick' && !fromInputs(date, time)) local.scheduled_at = 'Pick a date and time.'
    if (Object.keys(local).length) {
      setErrors(local)
      return
    }

    setSaving(true)
    setErrors({})
    const payload = {
      title: title.trim() || null,
      body,
      format,
      platforms,
      status: when === 'draft' ? 'draft' : when === 'published' ? 'published' : 'scheduled',
      queue: when === 'queue',
      account_id: accountId,
      asset_ids: media.map((m) => m.id),
      placement: platforms.length === 1 ? placement : null,
      scheduled_at: when === 'pick' ? fromInputs(date, time) : when === 'published' ? (existing?.scheduled_at ?? null) : null,
    }

    try {
      const post = existing
        ? await api<Post>(`/posts/${existing.id}`, { method: 'PUT', body: payload })
        : await api<Post>('/posts', { method: 'POST', body: payload })
      invalidate()
      toast(
        when === 'draft'
          ? 'Draft saved.'
          : when === 'published'
            ? 'Marked as published.'
            : `${when === 'queue' ? 'Queued' : 'Scheduled'} for ${fmtDateTime(post.scheduled_at!)}.`,
      )
      navigate(when === 'draft' || when === 'published' ? '/dashboard/library' : '/dashboard/calendar')
    } catch (e) {
      setSaving(false)
      if (e instanceof ApiError && e.status === 422) {
        setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k.split('.')[0], e.field(k) ?? e.message])))
      } else {
        toast(e instanceof Error ? e.message : 'Couldn’t save the post.', 'error')
      }
    }
  }

  const duplicate = async () => {
    if (!existing) return
    try {
      const copy = await api<Post>(`/posts/${existing.id}/duplicate`, { method: 'POST' })
      invalidate()
      toast('Duplicated as a new draft.')
      navigate(`/dashboard/create?post=${copy.id}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t duplicate the post.', 'error')
    }
  }

  const remove = async () => {
    if (!existing) return
    try {
      await api(`/posts/${existing.id}`, { method: 'DELETE' })
      invalidate()
      toast('Post deleted.')
      navigate('/dashboard/library')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete the post.', 'error')
    }
  }

  // ⌘↵ saves from anywhere on the page.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const Action = ACTION[when]
  const problem = errors.scheduled_at ?? errors.queue ?? errors.checks ?? errors.platforms ?? errors.body

  return (
    <div>
      <PageHeader
        eyebrow="Create"
        title={
          existing ? (
            <>
              Edit <Serif>post.</Serif>
            </>
          ) : (
            <>
              New <Serif>post.</Serif>
            </>
          )
        }
        sub={existing ? `Last edited ${fmtRelative(existing.updated_at)}.` : 'Write it once, then choose where and when it goes.'}
        actions={
          existing && (
            <>
              <StateBadge state={postState(existing)} className="mr-1" />
              <Btn icon={Copy} onClick={duplicate}>
                Duplicate
              </Btn>
              <Btn variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Delete
              </Btn>
            </>
          )
        }
      />

      {loading ? (
        <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-[460px] rounded-xl" />
          <Skeleton className="h-[460px] rounded-xl" />
        </div>
      ) : (
        <div className="mt-10 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          {/* On a phone this column dissolves into the page (contents), so the bar inside it can be
              ordered after the preview; beside the preview it is a real column. */}
          <Stagger i={0} className="contents min-w-0 lg:block lg:space-y-4">
            <Writer body={body} onBody={changeBody} format={format} platforms={platforms} onWriting={setWriting} />
            <section className="rounded-xl border border-line bg-panel">
              <Destination
                accounts={accounts ?? []}
                accountId={accountId}
                onAccount={pickAccount}
                platforms={platforms}
                onToggle={togglePlatform}
                length={length}
                error={errors.platforms}
              />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled post"
                maxLength={120}
                aria-label="Title"
                className="w-full bg-transparent px-5 pt-5 text-[22px] font-medium tracking-[-0.02em] outline-none placeholder:text-dim"
              />
              <AutoGrow value={body} onChange={changeBody} readOnly={writing} />
              <div className="px-5">
                <FieldError message={errors.body} />
              </div>

              {/* What kind of post, and how much room is left, right where the words are. */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-1">
                <Segmented id="format" label="Format" options={FORMATS} value={format} onChange={setFormat} />
                {tightest && <Counter length={length} limit={CHAR_LIMIT[tightest]} platform={PLATFORMS[tightest].name} />}
              </div>

              <MediaStrip
                media={media}
                onChange={changeMedia}
                max={10}
                generate={format === 'text' ? undefined : { kind: format, hint: [title, body].filter(Boolean).join(' — ').slice(0, 400) || '' }}
              />
            </section>
            {/* When it goes and the button that sends it ride along at the bottom of the screen, so
                saving is never a scroll away. Beside the preview it closes the editor column, right
                under the writing with no gap; on a phone it goes last, so it rides past the preview. */}
            <div className="sticky bottom-3 z-30 order-last md:bottom-4 lg:order-none">
              {/* One row: when, then the button. A second, full-width line only when there's
                  something to say or set (the next slot, a date and time, a problem); on a phone
                  it sits between the two. */}
              <div className="flex flex-col gap-2.5 rounded-xl border border-line-2 bg-panel-2/95 p-2.5 shadow-[0_24px_70px_-20px_rgb(0_0_0_/_0.95)] backdrop-blur-xl md:flex-row md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2 md:bg-panel-2/85 md:p-2">
                <Segmented
                  id="when"
                  label="When to publish"
                  options={WHEN.map((w) => ({
                    value: w.value,
                    label: (
                      <>
                        <w.icon className="hidden size-3.5 sm:block" strokeWidth={1.75} />
                        {w.label}
                      </>
                    ),
                  }))}
                  value={when}
                  onChange={(w) => {
                    setWhen(w)
                    setErrors(({ scheduled_at: _, queue: __, ...rest }) => rest)
                  }}
                  className="w-full shrink-0 md:order-1 md:w-auto [&>button]:flex-1 [&>button]:justify-center md:[&>button]:flex-none"
                />
                {(when === 'pick' || when === 'queue' || problem) && (
                <div className="min-w-0 text-[12px] leading-snug text-dim md:order-3 md:basis-full md:px-0.5 md:pb-0.5">
                  {when === 'pick' ? (
                    <div className="flex items-center gap-2">
                      {/* Sized by their wrappers: inputClass is w-full, and cn doesn't merge classes. */}
                      <div className="min-w-0 flex-1 md:w-40 md:flex-none">
                        <input type="date" value={date} onChange={(e) => setPicked((p) => ({ ...p, date: e.target.value }))} aria-label="Date" className={inputClass} />
                      </div>
                      <div className="w-[136px] shrink-0">
                        <input type="time" value={time} onChange={(e) => setPicked((p) => ({ ...p, time: e.target.value }))} aria-label="Time" className={inputClass} />
                      </div>
                    </div>
                  ) : when === 'queue' ? (
                    overview?.next_slot ? (
                      <>
                        Goes out in the next free slot, <span className="text-fg">{fmtDateTime(overview.next_slot)}</span>.
                      </>
                    ) : (
                      <>
                        No posting times yet.{' '}
                        <a
                          href="/dashboard/automations"
                          onClick={(e) => {
                            e.preventDefault()
                            navigate('/dashboard/automations')
                          }}
                          className="text-accent-soft underline-offset-2 hover:underline"
                        >
                          Set them up
                        </a>
                      </>
                    )
                  ) : null}
                  {/* The field a problem belongs to may be scrolled away; say it here too. */}
                  {problem && (
                    <p role="alert" className={cn('text-fail', when !== 'draft' && when !== 'published' && 'mt-1')}>
                      {problem}
                    </p>
                  )}
                </div>
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || writing}
                  className="group relative isolate flex h-10 w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-lg bg-fg px-5 text-[13px] font-medium text-ink transition-[color,box-shadow] duration-500 hover:text-white hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_20%,transparent)] disabled:cursor-wait disabled:opacity-70 md:order-2 md:ml-auto md:w-auto"
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 -z-10 translate-y-[101%] rounded-t-[50%] bg-accent transition-[translate,border-radius] duration-700 ease-expo group-hover:translate-y-0 group-hover:rounded-t-none"
                  />
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={saving ? 'saving' : when}
                      className="flex items-center gap-2"
                      initial={{ y: 18, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -18, opacity: 0 }}
                      transition={{ duration: 0.35, ease }}
                    >
                      <Action.icon className="size-4" strokeWidth={1.75} />
                      {saving ? 'Saving…' : Action.label}
                      <kbd className="ml-1 hidden font-mono text-[10px] opacity-50 md:inline">{MOD_KEY} ↵</kbd>
                    </motion.span>
                  </AnimatePresence>
                </button>
              </div>
            </div>
          </Stagger>

          {/* Without the When panel, the preview fits beside the editor and stays in view. */}
          <div className="space-y-4 lg:sticky lg:top-20">
            <Stagger i={1}>
              <Panel
                title="Preview"
                actions={
                  platforms.length > 1 && (
                    <div className="flex rounded-md border border-line p-0.5">
                      {platforms.map((id) => (
                        <button
                          key={id}
                          type="button"
                          aria-label={`Preview on ${PLATFORMS[id].name}`}
                          aria-pressed={active === id}
                          onClick={() => setPreview(id)}
                          className={cn('relative grid size-7 place-items-center rounded-[5px] transition-colors', active === id ? 'text-fg' : 'text-dim hover:text-muted')}
                        >
                          {active === id && (
                            <motion.span layoutId="preview-tab" className="absolute inset-0 rounded-[5px] bg-white/[0.08]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                          )}
                          <PlatformIcon id={id} className="relative size-3.5" />
                        </button>
                      ))}
                    </div>
                  )
                }
                bodyClassName="p-3 pt-3"
              >
                {active ? (
                  <div className="overflow-hidden rounded-lg border border-line bg-panel-2">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={active}
                        initial={{ opacity: 0, filter: 'blur(6px)', scale: 0.98 }}
                        animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
                        exit={{ opacity: 0, filter: 'blur(4px)' }}
                        transition={{ duration: 0.35, ease }}
                      >
                        <PostPreview platform={active} title={title} body={body} format={format} user={user} assets={media} />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                ) : (
                  <p className="py-10 text-center text-[12.5px] text-dim">Pick a platform to see the preview.</p>
                )}
              </Panel>
            </Stagger>

            <Stagger i={2}>
              <ChecksPanel
                platforms={platforms}
                caption={body}
                media={media}
                placement={placement}
                onPlacement={setPlacement}
                blocking={!!account?.automation}
                error={errors.checks}
              />
            </Stagger>
          </div>
        </div>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this post?">
        <p className="text-[13px] leading-snug text-muted">It comes off your calendar and out of your library. This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(false)}>Keep it</Btn>
          <Btn variant="danger" icon={Trash2} onClick={remove}>
            Delete post
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

/** The body field grows with its content instead of scrolling inside itself. */
function AutoGrow({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(240, el.scrollHeight)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="What do you want to say?"
      aria-label="Post"
      autoFocus
      readOnly={readOnly}
      className="block w-full resize-none bg-transparent px-5 py-3 text-[15px] leading-relaxed outline-none placeholder:text-dim"
    />
  )
}

/**
 * Characters used against the tightest limit among the picked platforms, as a ring that fills
 * and turns red. Names the platform, so a 280 limit explains itself.
 */
function Counter({ length, limit, platform }: { length: number; limit: number; platform: string }) {
  const ratio = Math.min(1, length / limit)
  const over = length > limit
  const color = over ? 'var(--color-fail)' : ratio > 0.9 ? 'var(--color-warn)' : 'var(--color-accent-soft)'
  return (
    <span className="flex items-center gap-2.5 font-mono text-[11px] tabular-nums text-dim" title={`Characters, against ${platform}’s limit`}>
      <span className={over ? 'text-fail' : ratio > 0.9 ? 'text-warn' : ''}>
        {length.toLocaleString()} / {limit.toLocaleString()}
        <span className="text-dim"> · {platform}</span>
      </span>
      <svg viewBox="0 0 20 20" className="size-5 -rotate-90" aria-hidden>
        <circle cx="10" cy="10" r="8" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={2} />
        <motion.circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: ratio, stroke: color }}
          transition={{ duration: 0.3, ease }}
        />
      </svg>
    </span>
  )
}

