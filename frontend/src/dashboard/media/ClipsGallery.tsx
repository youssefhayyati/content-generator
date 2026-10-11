import { useState } from 'react'
import { motion } from 'framer-motion'
import { Clapperboard, Download, FileText, PenLine, Scissors, Search, X } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { type LinkClip } from '../../lib/api'
import { cn } from '../../lib/cn'
import { ease } from '../../lib/motion'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi } from '../data'
import { Btn, EmptyState, inputClass, Skeleton } from '../ui'

/** The Gallery's Highlights: every finished clip from the Highlights page, to watch, download or post. */
export function ClipsGallery() {
  const { navigate } = useRouter()
  const { data, error } = useApi<{ data: LinkClip[] }>('/clips', { ready: 1 })
  const [q, setQ] = useState('')
  const all = data?.data ?? null
  const needle = q.trim().toLowerCase()
  const clips = (all ?? []).filter((c) => !needle || (c.title ?? '').toLowerCase().includes(needle) || c.source_url.toLowerCase().includes(needle))

  if (error) return <p className="rounded-xl border border-line bg-panel p-8 text-center text-[13px]">{error.message}</p>

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] text-dim">{all ? `${all.length} ${all.length === 1 ? 'highlight' : 'highlights'}` : 'Loading highlights…'} · every highlight you make from a link is kept here.</p>
        <Btn size="sm" variant="subtle" icon={Scissors} onClick={() => navigate('/dashboard/clips')}>
          Make highlights
        </Btn>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" strokeWidth={1.75} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search highlights and links" aria-label="Search highlights" className={cn(inputClass, 'pl-8 pr-8')} />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {!all ? (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="No highlights yet"
          body="Paste a YouTube video or an article in Highlights. Every finished highlight lands here."
          action={<Btn variant="primary" icon={Scissors} onClick={() => navigate('/dashboard/clips')}>Make highlights</Btn>}
        />
      ) : clips.length === 0 ? (
        <EmptyState icon={Search} title="Nothing matches" body="Try another word." action={<Btn onClick={() => setQ('')}>Clear search</Btn>} />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {clips.map((c, i) => (
            <ClipTile key={c.id} clip={c} i={i} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClipTile({ clip: c, i }: { clip: LinkClip; i: number }) {
  const { navigate } = useRouter()
  const asset = c.asset!
  const SourceIcon = c.source_type === 'youtube' ? null : FileText

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease, delay: Math.min(i, 12) * 0.03 } }}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel"
    >
      <div className="relative aspect-[9/16] bg-black">
        <video src={asset.url} poster={asset.poster_url ?? undefined} controls playsInline preload="none" className="size-full object-cover" />
        <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/75 px-1.5 py-px font-mono text-[10px] text-white">
          {asset.duration ? `${Math.round(asset.duration)}s` : `${c.seconds}s`}
        </span>
        <span className="pointer-events-none absolute left-1.5 top-1.5 grid size-5 place-items-center rounded bg-black/75 text-white" title={`For ${{ tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' }[c.platform]} (${c.placement})`}>
          <PlatformIcon id={c.platform} className="size-3" />
        </span>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug">{c.title || 'Untitled highlight'}</h3>
        <a href={c.source_url} target="_blank" rel="noreferrer" title={c.source_url} className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-dim transition-colors hover:text-fg">
          {SourceIcon ? <SourceIcon className="size-3 shrink-0" /> : <PlatformIcon id="youtube" className="size-3 shrink-0" />}
          <span className="truncate">{c.source_url.replace(/^https?:\/\/(www\.)?/, '')}</span>
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
          <span className="font-mono">{fmtRelative(c.updated_at)}</span>
          {c.batch_total > 1 && <span className="font-mono">· {c.batch_index}/{c.batch_total}</span>}
        </div>
        <div className="mt-auto flex items-center gap-1 pt-3">
          <a
            href={asset.url}
            download={asset.name ?? 'highlight.mp4'}
            className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line-2 px-2.5 text-[12px] font-medium text-fg transition-colors hover:border-white/30 hover:bg-white/[0.04]"
          >
            <Download className="size-3.5" strokeWidth={1.75} /> Download
          </a>
          {c.post_id && (
            <Btn size="sm" variant="subtle" icon={PenLine} aria-label="Open draft" title="Open its draft post" onClick={() => navigate(`/dashboard/create?post=${c.post_id}`)} />
          )}
        </div>
      </div>
    </motion.article>
  )
}
