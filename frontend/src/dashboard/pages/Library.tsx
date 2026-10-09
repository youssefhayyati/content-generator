import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Copy, FolderOpen, MoreHorizontal, PenLine, Plus, Search, Trash2, Undo2, X } from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { api, type Page, type Post, type PostStatus } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import {
  fmtDateTime,
  fmtRelative,
  PLATFORM_ORDER,
  postState,
  STATE,
  setPostStatus,
  titleOf,
  useDebounced,
  useInvalidate,
  useVersion,
} from '../data'
import { useOverview } from '../Shell'
import { useToast } from '../toast'
import { MediaLibrary } from '../media/Media'
import { Inspiration } from '../media/Inspiration'
import { Btn, EmptyState, Menu, Modal, PageHeader, Platforms, Segmented, Skeleton, StateBadge, Stagger, inputClass } from '../ui'

const TABS: Array<{ value: PostStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
]

const FORMAT_LABEL = { text: 'Text', image: 'Image', video: 'Video' }

export default function Library() {
  const { search, navigate } = useRouter()
  const { data: overview } = useOverview()
  const version = useVersion()
  const invalidate = useInvalidate()
  const toast = useToast()

  const [view, setView] = useState<'posts' | 'media' | 'inspiration'>(() => {
    const params = new URLSearchParams(search)
    return params.get('view') === 'media' ? 'media' : params.get('view') === 'posts' || params.has('status') ? 'posts' : 'inspiration'
  })
  const [status, setStatus] = useState<PostStatus | ''>(() => (new URLSearchParams(search).get('status') as PostStatus) ?? '')
  const [platform, setPlatform] = useState<PlatformId | ''>('')
  const [q, setQ] = useState('')
  const needle = useDebounced(q.trim(), 250)
  const [page, setPage] = useState(1)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [lastPage, setLastPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Post | null>(null)

  // A new filter starts from page one.
  useEffect(() => setPage(1), [status, platform, needle])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<Page<Post>>('/posts', { query: { status, platform, q: needle, page, per_page: 25 } })
      .then((r) => {
        if (cancelled) return
        setPosts((prev) => (page === 1 ? r.data : [...(prev ?? []), ...r.data]))
        setLastPage(r.meta.last_page)
      })
      .catch((e) => !cancelled && toast(e.message, 'error'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [status, platform, needle, page, version, toast])

  const pickStatus = (s: PostStatus | '') => {
    setStatus(s)
    navigate(`/dashboard/library${s ? `?status=${s}` : ''}`, { replace: true })
  }

  const counts: Record<string, number | undefined> = overview
    ? { '': overview.counts.total, draft: overview.counts.draft, scheduled: overview.counts.scheduled, published: overview.counts.published, failed: overview.counts.failed }
    : {}

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      invalidate()
      toast(message)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That didn’t work.', 'error')
    }
  }

  const filtered = !!(status || platform || needle)

  return (
    <div>
      <PageHeader
        eyebrow="Gallery"
        title={
          <>
            Everything you’ve <Serif>made.</Serif>
          </>
        }
        sub={view === 'media' ? 'Photos and videos: uploaded, generated, and ready to use in posts.' : 'Every draft, scheduled post and published piece, in one place.'}
        actions={
          <>
            <Segmented
              id="library-view"
              label="Show"
              options={[
                { value: 'inspiration', label: 'Inspiration' },
                { value: 'posts', label: 'Posts' },
                { value: 'media', label: 'Assets' },
              ]}
              value={view}
              onChange={(v) => {
                setView(v)
                navigate('/dashboard/library?view=' + v, { replace: true })
              }}
            />
            <Btn variant="primary" icon={Plus} onClick={() => navigate('/dashboard/create')}>
              New post
            </Btn>
          </>
        }
      />

      {view === 'inspiration' ? <Stagger i={0} className="mt-8"><Inspiration /></Stagger> : view === 'media' ? (
        <Stagger i={0} className="mt-10">
          <MediaLibrary />
        </Stagger>
      ) : (
        <>

      {/* Filters: one row, above everything they scope. */}
      <Stagger i={0} className="mt-10 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Status" className="flex rounded-md border border-line p-0.5 text-[12px]">
          {TABS.map((t) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={status === t.value}
              onClick={() => pickStatus(t.value)}
              className={cn('relative flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 transition-colors', status === t.value ? 'text-fg' : 'text-dim hover:text-muted')}
            >
              {status === t.value && (
                <motion.span layoutId="library-tab" className="absolute inset-0 rounded-[5px] bg-white/[0.08]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
              )}
              <span className="relative">{t.label}</span>
              {counts[t.value] !== undefined && <span className="relative font-mono text-[10px] text-dim">{counts[t.value]}</span>}
            </button>
          ))}
        </div>

        <Menu
          align="left"
          items={[
            { label: 'All platforms', onSelect: () => setPlatform(''), hint: platform === '' ? <Check className="size-3.5" /> : undefined },
            ...PLATFORM_ORDER.map((id) => ({
              label: PLATFORMS[id].name,
              onSelect: () => setPlatform(id),
              hint: platform === id ? <Check className="size-3.5" /> : <PlatformIcon id={id} className="size-3.5" />,
            })),
          ]}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="flex h-[34px] items-center gap-2 rounded-md border border-line px-3 text-[12px] text-muted transition-colors hover:border-line-2 hover:text-fg">
              {platform ? <PlatformIcon id={platform} className="size-3.5 text-fg" /> : null}
              {platform ? PLATFORMS[platform].name : 'All platforms'}
              <ChevronDown className="size-3 text-dim" />
            </button>
          )}
        />

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" strokeWidth={1.75} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and copy" aria-label="Search posts" className={cn(inputClass, 'pl-8 pr-8')} />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </Stagger>

      <Stagger i={1} className="mt-4">
        <section className={cn('rounded-xl border border-line bg-panel transition-opacity duration-300', loading && posts && 'opacity-60')}>
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_70px_170px_40px] gap-4 border-b border-line px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-dim md:grid">
            <span>Post</span>
            <span>Platforms</span>
            <span>Format</span>
            <span>When</span>
            <span />
          </div>

          {!posts ? (
            <div className="space-y-px">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={Search}
                title="Nothing matches"
                body="Try another status, platform or search."
                action={
                  <Btn
                    onClick={() => {
                      setQ('')
                      setPlatform('')
                      pickStatus('')
                    }}
                  >
                    Clear filters
                  </Btn>
                }
              />
            ) : (
              <EmptyState
                icon={FolderOpen}
                title="Your library is empty"
                body="Everything you write lands here: drafts, scheduled posts and what’s already out."
                action={<Btn variant="primary" icon={PenLine} onClick={() => navigate('/dashboard/create')}>Write the first one</Btn>}
              />
            )
          ) : (
            <ul className="divide-y divide-line">
              <AnimatePresence initial={false}>
                {posts.map((p, i) => {
                  const state = postState(p)
                  return (
                    <motion.li
                      key={p.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease, delay: Math.min(i, 12) * 0.03 } }}
                      exit={{ opacity: 0, height: 0, transition: { duration: 0.3 } }}
                      className="group grid grid-cols-[minmax(0,1fr)_40px] items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_110px_70px_170px_40px]"
                    >
                      <button type="button" onClick={() => navigate(`/dashboard/create?post=${p.id}`)} className="min-w-0 text-left">
                        <span className="flex items-center gap-2.5">
                          <span className={cn('size-1.5 shrink-0 rounded-full', STATE[state].dot)} />
                          <span className="truncate text-[13.5px] text-fg transition-colors group-hover:text-white">{titleOf(p)}</span>
                        </span>
                        <span className="mt-0.5 block truncate pl-4 text-[12px] text-dim">{p.body}</span>
                      </button>
                      <Platforms ids={p.platforms} className="hidden md:flex" />
                      <span className="hidden font-mono text-[11px] text-dim md:block">{FORMAT_LABEL[p.format]}</span>
                      <span className="hidden min-w-0 md:block">
                        <StateBadge state={state} />
                        <span className="mt-1 block truncate font-mono text-[10.5px] text-dim">
                          {p.status === 'published' && p.published_at
                            ? `Published ${fmtRelative(p.published_at)}`
                            : p.scheduled_at
                              ? fmtDateTime(p.scheduled_at)
                              : `Edited ${fmtRelative(p.updated_at)}`}
                        </span>
                      </span>
                      <Menu
                        items={[
                          { label: 'Edit', icon: PenLine, onSelect: () => navigate(`/dashboard/create?post=${p.id}`) },
                          { label: 'Duplicate', icon: Copy, onSelect: () => act(() => api(`/posts/${p.id}/duplicate`, { method: 'POST' }), 'Duplicated as a new draft.') },
                          ...(p.status === 'scheduled'
                            ? [{ label: 'Mark as published', icon: Check, onSelect: () => act(() => setPostStatus(p, 'published'), 'Marked as published.') }]
                            : []),
                          ...(p.status !== 'draft'
                            ? [{ label: 'Move to drafts', icon: Undo2, onSelect: () => act(() => setPostStatus(p, 'draft'), 'Moved back to drafts.') }]
                            : []),
                          { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setDeleting(p) },
                        ]}
                        trigger={({ toggle, open }) => (
                          <button
                            type="button"
                            onClick={toggle}
                            aria-label={`Actions for ${titleOf(p)}`}
                            className={cn('grid size-8 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.06] hover:text-fg', open && 'bg-white/[0.06] text-fg')}
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        )}
                      />
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </Stagger>

      {posts && page < lastPage && (
        <div className="mt-4 flex justify-center">
          <Btn loading={loading} onClick={() => setPage((n) => n + 1)}>
            Load more
          </Btn>
        </div>
      )}

        </>
      )}

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this post?">
        <p className="text-[13px] leading-snug text-muted">
          “{deleting ? titleOf(deleting) : ''}” comes off your calendar and out of your library. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setDeleting(null)}>Keep it</Btn>
          <Btn
            variant="danger"
            icon={Trash2}
            onClick={() => {
              const post = deleting
              setDeleting(null)
              if (post) act(() => api(`/posts/${post.id}`, { method: 'DELETE' }), 'Post deleted.')
            }}
          >
            Delete post
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
