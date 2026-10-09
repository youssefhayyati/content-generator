import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AudioLines, Check, Clapperboard, Ear, Film, ImagePlus, Play, Sparkles, Trash2, Upload } from 'lucide-react'
import { api, ApiError, uploadFiles, type Asset, type Page } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { Player } from '../sound/Player'
import { useToast } from '../toast'
import { Btn, EmptyState, Modal, Segmented, Skeleton } from '../ui'

export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-flac']
const UPLOADABLE = [...MEDIA_TYPES, ...AUDIO_TYPES]

export const fmtBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

export const fmtSeconds = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return m ? `${m}:${String(r).padStart(2, '0')}` : `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
}

/** "1080 × 1350 · 4:5" */
export function fmtShape(a: Pick<Asset, 'width' | 'height'>) {
  if (!a.width || !a.height) return 'Size unknown'
  const r = a.width / a.height
  const named = ([[9 / 16, '9:16'], [4 / 5, '4:5'], [1, '1:1'], [16 / 9, '16:9'], [1.91, '1.91:1'], [2 / 3, '2:3']] as const).find(([v]) => Math.abs(v - r) < 0.02)
  return `${a.width} × ${a.height}${named ? ` · ${named[1]}` : ''}`
}

/** A square tile: the image, or a video's poster with its length. */
export function MediaThumb({ asset, className, children }: { asset: Asset; className?: string; children?: ReactNode }) {
  return (
    <span className={cn('relative block aspect-square overflow-hidden rounded-md bg-white/[0.04]', className)}>
      {asset.poster_url ? (
        <img src={asset.poster_url} alt={asset.name ?? ''} loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-dim">
          {asset.kind === 'audio' ? <AudioLines className="size-5" strokeWidth={1.5} /> : <Film className="size-5" strokeWidth={1.5} />}
        </span>
      )}
      {(asset.kind === 'video' || asset.kind === 'audio') && (
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9.5px] text-white backdrop-blur">
          {asset.kind === 'audio' ? <AudioLines className="size-2.5" /> : <Play className="size-2.5" fill="currentColor" />}
          {asset.duration ? fmtSeconds(asset.duration) : asset.kind === 'audio' ? 'Sound' : 'Video'}
        </span>
      )}
      {asset.source === 'generated' && (
        <span className="absolute right-1 top-1 grid size-5 place-items-center rounded bg-black/60 text-accent-soft backdrop-blur" title="Generated with AI">
          <Sparkles className="size-3" strokeWidth={2} />
        </span>
      )}
      {children}
    </span>
  )
}

/** Upload files to the library, with progress. Calls back with what landed. */
export function useMediaUpload(onDone?: (assets: Asset[]) => void) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [progress, setProgress] = useState<number | null>(null)

  const upload = async (list: File[]) => {
    const files = list.filter((f) => UPLOADABLE.includes(f.type))
    if (!files.length) return toast('Use JPG, PNG, WebP or GIF images; MP4, MOV or WebM videos; or MP3, M4A, WAV, OGG or FLAC audio.', 'error')
    setProgress(0)
    try {
      const assets = await uploadFiles<Asset[]>('/assets', files, setProgress)
      invalidate()
      onDone?.(assets)
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'The upload didn’t go through.', 'error')
    } finally {
      setProgress(null)
    }
  }

  return { upload, progress, uploading: progress !== null }
}

/** Drop files here, or click to browse. */
export function Dropzone({ onFiles, progress, compact }: { onFiles: (files: File[]) => void; progress: number | null; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const uploading = progress !== null

  return (
    <div
      onDragOver={(e: DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!uploading) onFiles([...e.dataTransfer.files])
      }}
      className={cn(
        'relative overflow-hidden rounded-xl border border-dashed transition-colors duration-300',
        over ? 'border-accent-soft/70 bg-accent/[0.06]' : 'border-line-2 bg-white/[0.015]',
        compact ? 'px-4 py-3' : 'px-6 py-7',
      )}
    >
      <div className={cn('flex items-center gap-4', compact ? 'flex-row' : 'flex-col text-center sm:flex-row sm:text-left')}>
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-2 text-muted">
          <Upload className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{uploading ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : 'Drop images, videos or sound here'}</p>
          <p className="text-[11.5px] text-dim">JPG, PNG, WebP, GIF · MP4, MOV, WebM · MP3, M4A, WAV · up to 200 MB each</p>
        </div>
        <Btn icon={ImagePlus} onClick={() => input.current?.click()} disabled={uploading}>
          Browse
        </Btn>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={UPLOADABLE.join(',')}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          onFiles(files)
        }}
      />
      {uploading && (
        <motion.span
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: progress ?? 0 }}
          transition={{ duration: 0.2 }}
        />
      )}
    </div>
  )
}

type Kind = 'all' | 'image' | 'video' | 'audio' | 'generated'
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Sound' },
  { value: 'generated', label: 'AI' },
]

function useLibrary(kind: Kind) {
  return useApi<Page<Asset>>('/assets', kind === 'generated' ? { source: 'generated' } : kind === 'all' ? undefined : { kind })
}

/** The Library's media view: upload, browse, look closer, delete. */
export function MediaLibrary() {
  const [kind, setKind] = useState<Kind>('all')
  const { data, loading } = useLibrary(kind)
  const { upload, progress } = useMediaUpload()
  const [open, setOpen] = useState<Asset | null>(null)

  return (
    <div className="space-y-4">
      <Dropzone onFiles={upload} progress={progress} />
      <div className="flex items-center justify-between gap-3">
        <Segmented id="media-kind" label="Kind" options={KINDS} value={kind} onChange={setKind} />
        {data && <span className="font-mono text-[10.5px] text-dim">{data.meta.total} files</span>}
      </div>
      {!data && loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : data && data.data.length === 0 ? (
        <EmptyState icon={ImagePlus} title="No media yet" body="Upload photos and videos, or generate them in the Studio. Posts and campaigns use them from here." />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {data?.data.map((a, i) => (
            <motion.button
              key={a.id}
              type="button"
              onClick={() => setOpen(a)}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease, delay: Math.min(i, 18) * 0.02 }}
              className="group text-left"
            >
              <MediaThumb asset={a} className="ring-accent-soft/60 transition-[box-shadow] duration-300 group-hover:ring-2" />
              <span className="mt-1 block truncate text-[11px] text-dim">{a.name ?? fmtShape(a)}</span>
            </motion.button>
          ))}
        </div>
      )}
      <AssetModal asset={open} onClose={() => setOpen(null)} />
    </div>
  )
}

/** One file up close: play it, see its measurements, delete it. */
export function AssetModal({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    if (!asset) return
    setDeleting(true)
    try {
      await api(`/assets/${asset.id}`, { method: 'DELETE' })
      invalidate()
      toast('Deleted from the library.')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete it.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal open={!!asset} onClose={onClose} title={asset?.name ?? 'Media'} className="max-w-2xl">
      {asset && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
          {asset.kind === 'audio' ? (
            <div className="rounded-lg border border-line bg-panel-2 p-4">
              <Player asset={asset} />
              <SoundActions asset={asset} onClose={onClose} />
            </div>
          ) : (
            <div className="grid max-h-[60vh] place-items-center overflow-hidden rounded-lg bg-black">
              {asset.kind === 'video' ? (
                <video src={asset.url} poster={asset.poster_url ?? undefined} controls playsInline className="max-h-[60vh] w-full" />
              ) : (
                <img src={asset.url} alt={asset.name ?? ''} className="max-h-[60vh] w-full object-contain" />
              )}
            </div>
          )}
          <div className="flex flex-col">
            <dl className="space-y-2.5 text-[12.5px]">
              {(
                [
                  ...(asset.kind === 'audio' ? [] : [['Shape', fmtShape(asset)]]),
                  ...(asset.kind !== 'image' ? [['Length', asset.duration ? fmtSeconds(asset.duration) : 'Unknown']] : []),
                  ...(asset.sound?.voice_name ? [['Voice', `${asset.sound.voice_name} · ${asset.sound.lang?.toUpperCase() ?? ''}`]] : []),
                  ...(asset.sound?.label ? [['Music', `${asset.sound.label} · ${asset.sound.key ?? ''} · ${Math.round(asset.sound.bpm ?? 0)} bpm`]] : []),
                  ['Size', fmtBytes(asset.size)],
                  ['Type', asset.mime],
                  ['From', { upload: 'Uploaded', generated: 'Generated with AI', screenshot: 'Phone screenshot', intake: 'Campaign intake' }[asset.source]],
                  ['Added', fmtRelative(asset.created_at)],
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">{k}</dt>
                  <dd className="mt-0.5 text-fg">{v}</dd>
                </div>
              ))}
            </dl>
            <Btn variant="danger" icon={Trash2} onClick={remove} loading={deleting} className="mt-auto self-start">
              Delete
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** What to do with a sound: make a reel of it, or have it listened to (and then turned into posts). */
function SoundActions({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { navigate } = useRouter()
  const go = (to: string) => {
    onClose()
    navigate(to)
  }
  return (
    <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
      <Btn size="sm" icon={Clapperboard} onClick={() => go(`/dashboard/studio?tab=reels&${asset.sound?.type === 'music' ? 'music' : 'audio'}=${asset.id}`)}>
        Make a reel
      </Btn>
      {asset.sound?.type !== 'music' && (
        <Btn size="sm" variant="subtle" icon={Ear} onClick={() => go(`/dashboard/studio?tab=sound&mode=listen&asset=${asset.id}`)}>
          {asset.sound?.timed ? 'Transcript & posts' : 'Listen to it'}
        </Btn>
      )}
    </div>
  )
}

/**
 * Choose media for a post: from the library, or upload new. Selection order is the order
 * the media appears in the post.
 */
export function MediaPicker({
  open,
  onClose,
  onPick,
  initial = [],
  max = 10,
  kinds = ['image', 'video'],
  title = 'Add media',
}: {
  open: boolean
  onClose: () => void
  onPick: (assets: Asset[]) => void
  initial?: Asset[]
  max?: number
  /** What may be picked: posts take pictures and video; reels also take sound. */
  kinds?: Array<Asset['kind']>
  title?: string
}) {
  const [kind, setKind] = useState<Kind>(kinds.length === 1 ? kinds[0] : 'all')
  const { data: raw } = useLibrary(kind)
  const data = raw ? { ...raw, data: raw.data.filter((a) => kinds.includes(a.kind)) } : raw
  const options = KINDS.filter((k) => k.value === 'all' || k.value === 'generated' || kinds.includes(k.value as Asset['kind']))
  const [picked, setPicked] = useState<Asset[]>(initial)
  const { upload, progress } = useMediaUpload((added) => setPicked((p) => [...p, ...added.filter((a) => kinds.includes(a.kind))].slice(0, max)))

  // Each time it opens, start from what the post already has.
  useEffect(() => {
    if (open) setPicked(initial)
    // `initial` is a new array on every render; only opening should reset.
  }, [open])

  const toggle = (a: Asset) =>
    setPicked((p) => (p.some((x) => x.id === a.id) ? p.filter((x) => x.id !== a.id) : p.length >= max ? p : [...p, a]))

  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-3xl">
      <div className="space-y-4">
        <Dropzone onFiles={upload} progress={progress} compact />
        {options.length > 2 && <Segmented id="picker-kind" label="Kind" options={options} value={kind} onChange={setKind} />}
        <div className="no-scrollbar grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5" data-lenis-prevent>
          {data?.data.map((a) => {
            const n = picked.findIndex((x) => x.id === a.id)
            return (
              <button key={a.id} type="button" onClick={() => toggle(a)} aria-pressed={n >= 0} className="text-left">
                <MediaThumb asset={a} className={cn('transition-[box-shadow] duration-200', n >= 0 ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-line-2')}>
                  <AnimatePresence>
                    {n >= 0 && (
                      <motion.span
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-accent font-mono text-[10px] font-medium text-on-accent"
                      >
                        {n + 1}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </MediaThumb>
              </button>
            )
          })}
          {data && !data.data.length && <p className="col-span-full py-8 text-center text-[12.5px] text-dim">Nothing here yet. Upload above.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-line pt-4">
          <span className="text-[12px] text-dim">
            {picked.length} of up to {max} chosen{picked.length > 1 ? ', in this order' : ''}
          </span>
          <div className="flex gap-2">
            <Btn variant="subtle" onClick={onClose}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              icon={Check}
              onClick={() => {
                onPick(picked)
                onClose()
              }}
            >
              Use {picked.length || ''} {picked.length === 1 ? 'file' : 'files'}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}
