import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AtSign, Clapperboard, FolderOpen, ImagePlus, LoaderCircle, MessageSquarePlus, Plus, Sparkles, Upload, Wand2 } from 'lucide-react'
import type { Asset, Page } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useApi } from '../data'
import { fmtShape, MediaThumb } from '../media/Media'
import { Btn, EmptyState, Label, Modal, Segmented, Skeleton } from '../ui'
import { useAssistant, type Picture } from './store'

/** Drag types: a numbered picture from the conversation, or a file from the FlowAI gallery. */
export const PICTURE_DRAG = 'application/x-assistant-picture'
export const ASSET_DRAG = 'application/x-flowai-asset'

type Kind = 'all' | 'image' | 'video' | 'generated'
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'generated', label: 'AI' },
]

function useGallery(kind: Kind) {
  return useApi<Page<Asset>>('/assets', kind === 'generated' ? { source: 'generated' } : kind === 'all' ? undefined : { kind })
}

const SOURCE: Record<string, string> = { generated: 'Made here', upload: 'Attached', flowai: 'From the gallery' }

/** The Media tab: what the conversation has made or been shown, and the FlowAI gallery. */
export function MediaView() {
  const a = useAssistant()
  const [open, setOpen] = useState<Picture | null>(null)
  const [asset, setAsset] = useState<Asset | null>(null)
  const pictures = [...a.pictures].reverse()
  const jobs = Object.values(a.jobs)

  return (
    <div className="space-y-4">
      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((j) => (
            <JobRow key={j.id} label={j.label} started={j.started} failed={j.status === 'failed' ? j.text : null} />
          ))}
        </div>
      )}

      <section className="rounded-xl border border-line bg-panel p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[13.5px] font-medium">In this conversation</h2>
            <p className="mt-0.5 text-[11.5px] text-dim">Numbered so you can say “picture 3”. Drag one onto a slide.</p>
          </div>
          <span className="font-mono text-[10.5px] text-dim">{pictures.length}</span>
        </div>
        <Attach onFiles={(files) => void a.upload(files)} />
        {pictures.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {pictures.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease, delay: Math.min(i, 12) * 0.02 }}>
                <button type="button" draggable onDragStart={(e) => e.dataTransfer.setData(PICTURE_DRAG, String(p.id))} onClick={() => setOpen(p)} className="group block w-full text-left">
                  <PictureTile p={p} className="ring-accent-soft/60 transition-[box-shadow] duration-300 group-hover:ring-2" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-panel p-4 md:p-5">
        <Gallery onOpen={setAsset} />
      </section>

      <PictureModal p={open} onClose={() => setOpen(null)} />
      <AssetModal asset={asset} onClose={() => setAsset(null)} />
    </div>
  )
}

/** Show the assistant a file: it gets the next number. */
function Attach({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      }}
      className={cn('flex items-center gap-3 rounded-lg border border-dashed px-3.5 py-2.5 transition-colors', over ? 'border-accent-soft/70 bg-accent/[0.06]' : 'border-line-2')}
    >
      <Upload className="size-4 shrink-0 text-dim" strokeWidth={1.75} />
      <p className="min-w-0 flex-1 text-[12px] text-muted">
        Drop pictures or videos to show the assistant <span className="text-dim">· up to 10 MB each</span>
      </p>
      <Btn size="sm" onClick={() => input.current?.click()}>
        Browse
      </Btn>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="image/*,video/*"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          onFiles(files)
        }}
      />
    </div>
  )
}

function JobRow({ label, started, failed }: { label: string; started: number; failed: string | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.round((Date.now() - started) / 1000)
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('relative flex items-center gap-3 overflow-hidden rounded-lg border px-3.5 py-2.5 text-[12.5px]', failed ? 'border-fail/30 text-fail' : 'border-accent/30 text-fg')}
    >
      {!failed && <span className="skeleton pointer-events-none absolute inset-0 opacity-40" />}
      {failed ? <Sparkles className="relative size-3.5" /> : <LoaderCircle className="relative size-3.5 animate-spin text-accent-soft" />}
      <span className="relative">{failed ? `Couldn’t make it: ${failed}` : label}</span>
      {!failed && <span className="relative ml-auto font-mono text-[10.5px] text-dim">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>}
    </motion.div>
  )
}

function PictureTile({ p, className }: { p: Picture; className?: string }) {
  return (
    <span className={cn('relative block aspect-square overflow-hidden rounded-md bg-white/[0.04]', className)}>
      {p.kind === 'video' ? <video src={p.url} muted loop autoPlay playsInline className="size-full object-cover" /> : <img src={p.url} alt={p.prompt || p.name} loading="lazy" draggable={false} className="size-full object-cover" />}
      <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white backdrop-blur">#{p.id}</span>
      {p.source === 'generated' && (
        <span className="absolute right-1 top-1 grid size-5 place-items-center rounded bg-black/60 text-accent-soft backdrop-blur" title="Made by the assistant">
          <Sparkles className="size-3" strokeWidth={2} />
        </span>
      )}
    </span>
  )
}

/** One of the conversation's pictures up close, and what to do with it. */
function PictureModal({ p, onClose }: { p: Picture | null; onClose: () => void }) {
  const a = useAssistant()
  const d = a.current ? a.drafts[a.current] : undefined
  const ask = (text: string) => {
    onClose()
    a.link.ensureAudio()
    void a.say(text)
  }
  return (
    <Modal open={!!p} onClose={onClose} title={p ? `Picture ${p.id}` : ''} className="max-w-2xl">
      {p && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="grid max-h-[60vh] place-items-center overflow-hidden rounded-lg bg-black">
            {p.kind === 'video' ? <video src={p.url} controls autoPlay loop playsInline className="max-h-[60vh] w-full" /> : <img src={p.url} alt={p.prompt || p.name} className="max-h-[60vh] w-full object-contain" />}
          </div>
          <div className="flex flex-col gap-4">
            <dl className="space-y-2.5 text-[12.5px]">
              <div>
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">From</dt>
                <dd className="mt-0.5">{SOURCE[p.source] ?? p.source}</dd>
              </div>
              {p.prompt && (
                <div>
                  <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Prompt</dt>
                  <dd className="mt-0.5 line-clamp-6 text-muted">{p.prompt}</dd>
                </div>
              )}
            </dl>
            <div className="mt-auto flex flex-col gap-1.5">
              {d && (
                <Btn size="sm" variant="primary" icon={Plus} onClick={() => (a.action('place', { draft: d.id, media: p.id }), onClose())}>
                  Add to draft {d.id}
                </Btn>
              )}
              <Btn size="sm" icon={MessageSquarePlus} onClick={() => ask(`Make an Instagram post with picture ${p.id}`)}>
                Make a post with it
              </Btn>
              {a.generation && p.kind === 'image' && (
                <>
                  <Btn size="sm" icon={Clapperboard} onClick={() => ask(`Animate picture ${p.id} into a short video`)}>
                    Animate it
                  </Btn>
                  <Btn
                    size="sm"
                    icon={Wand2}
                    onClick={() => {
                      onClose()
                      a.setInput(`Edit picture ${p.id}: `)
                      a.inputRef.current?.focus()
                    }}
                  >
                    Edit it…
                  </Btn>
                </>
              )}
              <Btn
                size="sm"
                variant="subtle"
                icon={AtSign}
                onClick={() => {
                  onClose()
                  a.setInput(`${a.input.trim()} picture ${p.id} `.trimStart())
                  a.inputRef.current?.focus()
                }}
              >
                Mention it in the chat
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Gallery({ onOpen, onPick }: { onOpen?: (asset: Asset) => void; onPick?: (asset: Asset) => void }) {
  const [kind, setKind] = useState<Kind>('all')
  const { data, loading } = useGallery(kind)
  const assets = data?.data.filter((x) => x.kind === 'image' || x.kind === 'video') ?? []

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13.5px] font-medium">Your gallery</h2>
          <p className="mt-0.5 text-[11.5px] text-dim">Everything in FlowAI. Drag onto a slide, or open one to bring it in.</p>
        </div>
        <Segmented id="assistant-gallery" label="Kind" options={KINDS} value={kind} onChange={setKind} />
      </div>
      {!data && loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Nothing here yet" body="Pictures and videos saved to FlowAI show up here." className="py-8" />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {assets.map((x) => (
            <button
              key={x.id}
              type="button"
              draggable
              onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG, String(x.id))}
              onClick={() => (onPick ?? onOpen)?.(x)}
              className="group text-left"
            >
              <MediaThumb asset={x} className="ring-accent-soft/60 transition-[box-shadow] duration-300 group-hover:ring-2" />
              <span className="mt-1 block truncate text-[11px] text-dim">{x.name ?? fmtShape(x)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function AssetModal({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const a = useAssistant()
  const d = a.current ? a.drafts[a.current] : undefined
  return (
    <Modal open={!!asset} onClose={onClose} title={asset?.name ?? 'From the gallery'} className="max-w-2xl">
      {asset && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="grid max-h-[60vh] place-items-center overflow-hidden rounded-lg bg-black">
            {asset.kind === 'video' ? (
              <video src={asset.url} poster={asset.poster_url ?? undefined} controls playsInline className="max-h-[60vh] w-full" />
            ) : (
              <img src={asset.url} alt={asset.name ?? ''} className="max-h-[60vh] w-full object-contain" />
            )}
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <Label>Shape</Label>
              <p className="mt-0.5 text-[12.5px]">{fmtShape(asset)}</p>
            </div>
            <div className="mt-auto flex flex-col gap-1.5">
              {d && (
                <Btn size="sm" variant="primary" icon={Plus} onClick={() => (a.action('use_assets', { assets: [asset.id], draft: d.id }), onClose())}>
                  Add to draft {d.id}
                </Btn>
              )}
              <Btn size="sm" icon={ImagePlus} onClick={() => (a.action('use_assets', { assets: [asset.id] }), onClose())}>
                Bring into the conversation
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Choose a picture for a slide: one from the conversation, or from the gallery. */
export function MediaChooser({
  open,
  onClose,
  title,
  onPicture,
  onAsset,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  onPicture: (id: number) => void
  onAsset: (id: number) => void
}) {
  const a = useAssistant()
  const pictures = [...a.pictures].reverse()
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-3xl">
      <div className="no-scrollbar max-h-[64vh] space-y-6 overflow-y-auto" data-lenis-prevent>
        {pictures.length > 0 && (
          <div>
            <Label className="mb-2">In this conversation</Label>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {pictures.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onPicture(p.id)
                    onClose()
                  }}
                  className="group"
                >
                  <PictureTile p={p} className="transition-[box-shadow] group-hover:ring-2 group-hover:ring-accent-soft/60" />
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <Gallery
            onPick={(x) => {
              onAsset(x.id)
              onClose()
            }}
          />
        </div>
      </div>
    </Modal>
  )
}
