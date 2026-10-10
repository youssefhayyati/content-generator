import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, Reorder } from 'framer-motion'
import {
  Bookmark,
  CalendarClock,
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CloudUpload,
  ExternalLink,
  Heart,
  ImagePlus,
  Megaphone,
  MessageCircle,
  Plus,
  Repeat2,
  Send,
  Share2,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fromInputs, toInputs } from '../data'
import { useUser } from '../Shell'
import { Avatar, Btn, EmptyState, inputClass, Label, Menu, Segmented } from '../ui'
import { FontPicker } from './Fonts'
import { PICTURE_DRAG, ASSET_DRAG, MediaChooser } from './MediaView'
import { TextColours } from './Palette'
import { MaskBar, MaskCanvas, MaskProvider } from './Retouch'
import { useAssistant, type Draft, type Linked, type Slide, type TextBox } from './store'
import { VideoMaker } from './VideoMaker'

const POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']
const SIZES = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
  { value: 'huge', label: 'XL' },
]
const STYLES = [
  { value: 'shadow', label: 'Shadow' },
  { value: 'outline', label: 'Outline' },
  { value: 'box', label: 'Box' },
  { value: 'plain', label: 'Plain' },
]

/** The Draft tab: the post as it will look, and everything about it within reach. */
export function DraftView() {
  const a = useAssistant()
  const d = a.current ? a.drafts[a.current] : undefined
  const list = Object.values(a.drafts).sort((x, y) => y.id - x.id)
  const [shown, setShown] = useState<Record<number, number>>({})

  // Selecting a slide (here, or by saying "slide 3") brings it up.
  useEffect(() => {
    if (a.focus.draft && a.focus.slide) setShown((s) => ({ ...s, [a.focus.draft!]: a.focus.slide! - 1 }))
  }, [a.focus])

  // Painting stays on the slide on screen: another slide, or another draft, starts it over or ends it
  const shownIndex = d ? Math.min(shown[d.id] ?? 0, Math.max(0, d.slides.length - 1)) : 0
  const { painting, paint } = a
  useEffect(() => {
    if (!painting) return
    if (!d || painting.draft !== d.id || d.slides[shownIndex]?.kind !== 'image') paint(null)
    else if (painting.slide !== shownIndex + 1) {
      paint(null)
      paint({ draft: d.id, slide: shownIndex + 1 })
    }
  }, [d, shownIndex, painting, paint])

  if (!d) {
    return (
      <div className="rounded-xl border border-line bg-panel">
        <EmptyState
          icon={Type}
          title="No draft yet"
          body="Ask for a post out loud or in the chat, and it takes shape here as you talk. Or start an empty one and build it by hand."
          action={<NewDraft />}
        />
      </div>
    )
  }

  const index = Math.min(shown[d.id] ?? 0, Math.max(0, d.slides.length - 1))
  const show = (i: number) => setShown((s) => ({ ...s, [d.id]: i }))

  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => a.setCurrent(x.id)}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-lg border py-1.5 pl-1.5 pr-3 text-left transition-colors',
              x.id === d.id ? 'border-line-2 bg-white/[0.06]' : 'border-line hover:border-line-2',
            )}
          >
            <span className="relative size-8 shrink-0 overflow-hidden rounded-md bg-white/[0.05]">
              {x.slides[0]?.kind === 'image' && <img src={x.slides[0].url} alt="" className="size-full object-cover" />}
              <PlatformIcon id={x.platform} className="absolute bottom-0.5 right-0.5 size-2.5 text-white drop-shadow" />
            </span>
            <span className="min-w-0">
              <span className="block max-w-[16ch] truncate text-[12px] font-medium">{x.title || `Draft ${x.id}`}</span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-dim">
                {a.linked[x.id] && <Megaphone className={cn('size-2.5 shrink-0', a.linked[x.id].version === x.version ? 'text-accent-soft' : 'text-warn')} />}
                {a.linked[x.id]?.handle ? `@${a.linked[x.id].handle}` : x.label} · v{x.version}
                {a.saved[x.id] && (a.saved[x.id].version === x.version ? ` · post ${a.saved[x.id].post}` : ' · unsaved')}
                {a.linked[x.id] && a.linked[x.id].version !== x.version && ' · unsaved'}
              </span>
            </span>
          </button>
        ))}
        <NewDraft compact />
      </div>

      <MaskProvider>
        <div className="grid gap-4 @2xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-xl border border-line bg-panel">
              <Preview d={d} index={index} onShow={show} />
            </div>
            <MaskBar d={d} index={index} />
            <Checks d={d} />
          </div>
          <Inspector d={d} index={index} onShow={show} />
        </div>
      </MaskProvider>
    </div>
  )
}

const KINDS = [
  { label: 'Instagram post', platform: 'instagram', placement: 'feed' },
  { label: 'Instagram story', platform: 'instagram', placement: 'story' },
  { label: 'Instagram reel', platform: 'instagram', placement: 'reel' },
  { label: 'X post', platform: 'x', placement: 'post' },
] as const

/** An empty draft to build by hand: a menu beside the drafts, buttons when there are none yet. */
function NewDraft({ compact }: { compact?: boolean }) {
  const a = useAssistant()
  const start = (k: (typeof KINDS)[number]) => a.action('new_draft', { platform: k.platform, placement: k.placement })
  if (!compact) {
    return (
      <div className="flex flex-wrap justify-center gap-2">
        {KINDS.map((k) => (
          <Btn key={k.label} icon={Plus} onClick={() => start(k)} disabled={a.conn !== 'online'}>
            {k.label}
          </Btn>
        ))}
      </div>
    )
  }
  return (
    <Menu
      align="left"
      items={KINDS.map((k) => ({ label: k.label, icon: Plus, onSelect: () => start(k) }))}
      trigger={({ toggle }) => (
        <Btn size="sm" variant="subtle" icon={Plus} onClick={toggle} disabled={a.conn !== 'online'}>
          New
        </Btn>
      )}
    />
  )
}

/* ------------------------------------------------------------------ */
/* The preview: the post the way the platform shows it                  */
/* ------------------------------------------------------------------ */

function Preview({ d, index, onShow }: { d: Draft; index: number; onShow: (i: number) => void }) {
  const a = useAssistant()
  const user = useUser()
  const account = a.accounts.find((x) => x.platform === d.platform)
  const handle = account?.handle ?? user.email.split('@')[0]

  if (d.platform === 'x') {
    return (
      <div className="flex gap-3 p-4">
        <Avatar user={user} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px]">
            <span className="truncate font-semibold">{account?.name || user.name}</span>
            <span className="truncate text-dim">@{handle} · now</span>
          </p>
          <Caption d={d} className="mt-1 text-[13.5px] leading-snug" empty="No text yet" />
          {d.slides.length > 0 && (
            <div className={cn('mt-3 grid gap-0.5 overflow-hidden rounded-2xl border border-line', d.slides.length > 1 && 'grid-cols-2')}>
              {d.slides.map((_, i) => (
                <SlideFrame key={i} d={d} i={i} />
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-between pr-6 text-dim">
            <MessageCircle className="size-4" strokeWidth={1.5} />
            <Repeat2 className="size-4" strokeWidth={1.5} />
            <Heart className="size-4" strokeWidth={1.5} />
            <ChartNoAxesColumn className="size-4" strokeWidth={1.5} />
            <Share2 className="size-4" strokeWidth={1.5} />
          </div>
        </div>
      </div>
    )
  }

  const story = d.placement === 'story'
  const carousel = <Carousel d={d} index={index} onShow={onShow} bars={story} />
  if (story) {
    return (
      <div className="relative">
        {carousel}
        <div className="pointer-events-none absolute inset-x-0 top-5 flex items-center gap-2 px-3 text-[12px] font-semibold text-white drop-shadow">
          <Avatar user={user} className="size-6" /> {handle}
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-center gap-2.5 p-3">
        <Avatar user={user} className="size-7 ring-2 ring-[#e87ba4]/60 ring-offset-2 ring-offset-panel" />
        <span className="text-[12.5px] font-semibold">{handle}</span>
        <span className="ml-auto font-mono text-[10px] text-dim">{d.label}</span>
      </div>
      {carousel}
      {d.slides.length > 1 && (
        <div className="flex justify-center gap-1 pt-2.5">
          {d.slides.map((_, i) => (
            <span key={i} className={cn('size-1.5 rounded-full transition-colors', i === index ? 'bg-accent-soft' : 'bg-white/20')} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3.5 px-3 pt-2.5 text-fg">
        <Heart className="size-[18px]" strokeWidth={1.5} />
        <MessageCircle className="size-[18px]" strokeWidth={1.5} />
        <Send className="size-[18px]" strokeWidth={1.5} />
        <Bookmark className="ml-auto size-[18px]" strokeWidth={1.5} />
      </div>
      <div className="px-3 pb-4 pt-2 text-[12.5px] leading-snug">
        {d.caption_limit ? (
          <>
            <span className="font-semibold">{handle}</span> <Caption d={d} className="inline" empty="No caption yet" />
          </>
        ) : (
          <span className="text-dim">This placement shows no caption.</span>
        )}
      </div>
    </div>
  )
}

/** The caption, with anything past the platform's limit marked. */
function Caption({ d, className, empty }: { d: Draft; className?: string; empty: string }) {
  if (!d.caption.trim()) return <span className={cn('text-dim', className)}>{empty}</span>
  const chars = [...d.caption]
  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {chars.slice(0, d.caption_limit).join('')}
      {chars.length > d.caption_limit && <mark className="rounded-[2px] bg-fail/25 text-fg">{chars.slice(d.caption_limit).join('')}</mark>}
    </span>
  )
}

function Carousel({ d, index, onShow, bars }: { d: Draft; index: number; onShow: (i: number) => void; bars?: boolean }) {
  const n = d.slides.length
  return (
    <div className="relative">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={`${index}-${n}`} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} exit={{ opacity: 0.4 }} transition={{ duration: 0.2 }}>
          <SlideFrame d={d} i={index} />
        </motion.div>
      </AnimatePresence>
      {bars && n > 0 && (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex gap-1">
          {d.slides.map((_, i) => (
            <span key={i} className={cn('h-0.5 flex-1 rounded-full', i <= index ? 'bg-white' : 'bg-white/35')} />
          ))}
        </div>
      )}
      {n > 1 && (
        <>
          <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">
            {index + 1}/{n}
          </span>
          {index > 0 && (
            <button type="button" aria-label="Previous slide" onClick={() => onShow(index - 1)} className="absolute left-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink shadow">
              <ChevronLeft className="size-4" />
            </button>
          )}
          {index < n - 1 && (
            <button type="button" aria-label="Next slide" onClick={() => onShow(index + 1)} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink shadow">
              <ChevronRight className="size-4" />
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One slide as drawn, with a box over each text: click to select it ("make this gold"),
 * double-click to rewrite it. Pictures dropped here go on this slide.
 */
function SlideFrame({ d, i }: { d: Draft; i: number }) {
  const a = useAssistant()
  const slide: Slide | undefined = d.slides[i]
  const [editing, setEditing] = useState<number | null>(null)
  const [over, setOver] = useState(false)
  const [sound, setSound] = useState(false)
  const picked = a.focus.draft === d.id && a.focus.slide === i + 1 && !a.focus.text
  const painting = a.painting?.draft === d.id && a.painting.slide === i + 1 && slide?.kind === 'image'

  const onDrop = (e: DragEvent) => {
    setOver(false)
    const picture = e.dataTransfer.getData(PICTURE_DRAG)
    const asset = e.dataTransfer.getData(ASSET_DRAG)
    if (!picture && !asset) return
    e.preventDefault()
    if (picture) a.action('place', { draft: d.id, media: Number(picture), slide: slide ? i + 1 : undefined })
    else a.action('use_assets', { assets: [Number(asset)], draft: d.id })
  }

  return (
    <div
      className={cn('relative w-full overflow-hidden bg-[#1c1c1c] transition-shadow', picked && 'shadow-[inset_0_0_0_2px_var(--color-accent-soft)]', over && 'shadow-[inset_0_0_0_2px_var(--color-accent)]')}
      style={{ aspectRatio: `${d.size[0]} / ${d.size[1]}` }}
      onClick={() => a.select(picked ? { draft: d.id } : { draft: d.id, slide: i + 1 })}
      onDragOver={(e) => {
        if (![PICTURE_DRAG, ASSET_DRAG].some((t) => e.dataTransfer.types.includes(t))) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {slide?.kind === 'video' ? (
        <>
          <video src={slide.url} muted={!sound} autoPlay loop playsInline className="size-full object-cover" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSound((on) => !on)
            }}
            aria-label={sound ? 'Mute the video' : 'Play the video with sound'}
            title={sound ? 'Mute' : 'Sound on'}
            className="absolute bottom-2.5 right-2.5 z-10 grid size-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
        </>
      ) : slide ? (
        <img src={slide.url} alt={`Slide ${i + 1}`} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="grid size-full place-items-center p-6 text-center">
          <span className="text-[12px] text-dim">
            <ImagePlus className="mx-auto mb-2 size-5" strokeWidth={1.5} />
            No picture yet. Drop one here, or ask for one.
          </span>
        </div>
      )}
      {slide?.texts.map((t) => {
        const on = a.focus.draft === d.id && a.focus.text === t.id
        const [x, y, w, h] = t.box
        return (
          <button
            key={t.id}
            type="button"
            title={`Text ${t.id}: click to select, double-click to rewrite`}
            onClick={(e) => {
              e.stopPropagation()
              a.select(on ? { draft: d.id, slide: i + 1 } : { draft: d.id, slide: i + 1, text: t.id })
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              a.select({ draft: d.id, slide: i + 1, text: t.id })
              setEditing(t.id)
            }}
            className={cn(
              'group absolute rounded-[3px] border transition-colors',
              on ? 'border-accent-soft bg-accent/10' : 'border-transparent hover:border-dashed hover:border-white/70',
            )}
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          >
            <span className={cn('absolute -top-5 left-0 rounded bg-accent px-1.5 py-px font-mono text-[9.5px] text-on-accent transition-opacity', on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
              Text {t.id}
            </span>
          </button>
        )
      })}
      {editing !== null && slide && <InlineText d={d} t={slide.texts.find((t) => t.id === editing)} onDone={() => setEditing(null)} />}
      {painting && <MaskCanvas key={`${d.id}-${i}`} d={d} />}
    </div>
  )
}

/** Rewrite a text right on the slide. */
function InlineText({ d, t, onDone }: { d: Draft; t: TextBox | undefined; onDone: () => void }) {
  const a = useAssistant()
  const [words, setWords] = useState(t?.words ?? '')
  if (!t) return null
  const [x, y, w] = t.box
  const commit = () => {
    if (words.trim() && words.trim() !== t.words) a.action('edit_text', { draft: d.id, text: t.id, words: words.trim() })
    onDone()
  }
  return (
    <div className="absolute z-10" style={{ left: `${Math.max(2, x * 100)}%`, top: `${y * 100}%`, width: `${Math.min(96, Math.max(w * 100, 50))}%` }} onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        rows={2}
        value={words}
        onChange={(e) => setWords(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') onDone()
        }}
        className="w-full resize-none rounded-md border border-accent-soft bg-ink/90 px-2 py-1.5 text-[13px] font-medium text-fg shadow-xl outline-none backdrop-blur"
      />
    </div>
  )
}

function Checks({ d }: { d: Draft }) {
  const problems = (d.check.checks ?? []).filter((c) => c.status !== 'pass')
  return (
    <ul className="mx-auto w-full max-w-[400px] space-y-1.5">
      {problems.length === 0 ? (
        <li className="flex items-center gap-2 text-[12px] text-ok">
          <CircleCheck className="size-3.5" strokeWidth={1.75} />
          Fits {d.check.label}
          {d.caption_limit > 0 && <span className="font-mono text-[10.5px] text-dim">· caption {[...d.caption].length}/{d.caption_limit}</span>}
        </li>
      ) : (
        problems.map((c) => (
          <li key={c.key + c.detail} className={cn('flex items-start gap-2 text-[12px] leading-snug', c.status === 'fail' ? 'text-fail' : 'text-warn')}>
            {c.status === 'fail' ? <CircleAlert className="mt-px size-3.5 shrink-0" /> : <TriangleAlert className="mt-px size-3.5 shrink-0" />}
            <span>
              <span className="font-medium">{c.label}:</span> {c.detail}
            </span>
          </li>
        ))
      )}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* The inspector: change anything by hand; the assistant is told       */
/* ------------------------------------------------------------------ */

function Inspector({ d, index, onShow }: { d: Draft; index: number; onShow: (i: number) => void }) {
  const a = useAssistant()
  const { navigate } = useRouter()
  const saved = a.saved[d.id]
  const linked = a.linked[d.id]
  const fresh = linked ? linked.version === d.version : saved && saved.version === d.version
  const failing = (d.check.checks ?? []).some((c) => c.status === 'fail')
  const slide = d.slides[index]

  return (
    <div className="min-w-0 space-y-4">
      {linked && <CampaignLink d={d} l={linked} />}
      <Section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Committed
              key={`title-${d.id}`}
              value={d.title}
              placeholder={`Draft ${d.id}`}
              onCommit={(title) => a.action('edit', { draft: d.id, title })}
              className="w-full bg-transparent text-[18px] font-medium tracking-[-0.02em] outline-none placeholder:text-dim"
            />
            <p className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-dim">
              <PlatformIcon id={d.platform} className="size-3 shrink-0 text-fg" />
              <span className="min-w-0 truncate">
                Draft {d.id} · {d.label} · {d.size.join('×')} · v{d.version}
              </span>
            </p>
          </div>
          {d.placements.length > 1 && (
            <Segmented
              id={`placement-${d.id}`}
              label="Placement"
              value={d.placement}
              onChange={(placement) => a.action('edit', { draft: d.id, placement })}
              options={d.placements.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn size="sm" icon={Undo2} disabled={d.version < 2} onClick={() => a.action('undo', { draft: d.id })}>
            Undo
          </Btn>
          {!fresh && (
            <Btn size="sm" variant="primary" icon={CloudUpload} disabled={!a.accounts.length || failing} onClick={() => a.action('save', { draft: d.id })}>
              {linked ? 'Save to the campaign' : saved ? 'Save changes' : 'Save to FlowAI'}
            </Btn>
          )}
          <SchedulePicker d={d} linked={linked} disabled={!a.accounts.length || failing || (!!linked && (!linked.variant || !fresh || linked.status !== 'approved'))} />
          {saved && (
            <Btn size="sm" variant="subtle" icon={ExternalLink} onClick={() => navigate(`/dashboard/create?post=${saved.post}`)}>
              Composer
            </Btn>
          )}
          {saved && (
            <span className={cn('ml-auto rounded-full border px-2 py-0.5 text-[10.5px] font-medium', fresh ? 'border-ok/25 text-ok' : 'border-warn/30 text-warn')}>
              {fresh ? `Post ${saved.post} · ${saved.status}${saved.when ? ` · ${saved.when}` : ''}` : `Post ${saved.post} · unsaved changes`}
            </span>
          )}
        </div>
        {!a.accounts.length && <p className="mt-2 text-[11.5px] text-dim">Add an Instagram or X account under Accounts to save drafts to FlowAI.</p>}
      </Section>

      {d.caption_limit > 0 && (
        <Section title={d.platform === 'x' ? 'Post text' : 'Caption'}>
          <CaptionEditor key={`caption-${d.id}-${d.version}`} d={d} />
        </Section>
      )}

      {d.video && (
        <Section title="Video with voice">
          <VideoMaker d={d} />
        </Section>
      )}

      <Section title="Slides" aside={<span className="font-mono text-[10.5px] text-dim">{d.slides.length}/{d.max_slides} · drag to reorder</span>}>
        {/* Remounted when the panels above change shape, so the thumbnails don't fly in from where they were. */}
        <SlideStrip key={`${d.id}-${d.placement}`} d={d} index={index} onShow={onShow} />
      </Section>

      <Section title={slide ? `Texts on slide ${index + 1}` : 'Texts'}>
        <Texts d={d} index={index} />
      </Section>

      {!d.video && d.slides.length > 0 && (
        <Section title="Video with voice" aside={<span className="font-mono text-[10.5px] text-dim">{d.videos.length ? `${d.videos.length} made` : 'for reels and stories'}</span>}>
          <VideoMaker d={d} />
        </Section>
      )}
    </div>
  )
}

const VERSION_STATUS: Record<string, { label: string; tone: string }> = {
  approved: { label: 'Approved', tone: 'border-ok/25 text-ok' },
  draft: { label: 'Waiting for approval', tone: 'border-accent/35 text-accent-soft' },
  rejected: { label: 'Sent back for a rewrite', tone: 'border-warn/30 text-warn' },
}

/** A draft that is a campaign's post: which one, where it stands at gate 6B, and its booked times. */
function CampaignLink({ d, l }: { d: Draft; l: Linked }) {
  const { navigate } = useRouter()
  const status = l.variant ? (VERSION_STATUS[l.status] ?? { label: l.status, tone: 'border-line text-muted' }) : { label: 'No account versions yet', tone: 'border-line text-muted' }
  const unsaved = l.version !== d.version

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/25 bg-accent/[0.05] px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/12 text-accent-soft">
        <Megaphone className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium">
          {l.name} <span className="text-dim">·</span> “{l.title}”{l.handle && <span className="text-muted"> for @{l.handle}</span>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-dim">
          <span className={cn('rounded-full border px-1.5 py-px', unsaved ? 'border-warn/30 text-warn' : status.tone)}>{unsaved ? 'Changed here, not saved yet' : status.label}</span>
          {l.posts.length > 0 ? <span>Booked {l.posts.map((p) => p.when).join(' · ')}</span> : l.variant && <span>No time booked</span>}
        </p>
      </div>
      <Btn size="sm" variant="subtle" icon={ExternalLink} onClick={() => navigate(`/dashboard/campaigns?id=${l.campaign}&tab=${l.variant ? 'review' : 'plan'}`)}>
        Campaign
      </Btn>
    </div>
  )
}

function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      {title && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <Label>{title}</Label>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/** An input that sends its value when you leave it or press Enter, and only if it changed. */
function Committed({ value, onCommit, className, placeholder }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => text.trim() !== value.trim() && onCommit(text.trim())
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(value)
          e.currentTarget.blur()
        }
      }}
      className={className}
    />
  )
}

function CaptionEditor({ d }: { d: Draft }) {
  const a = useAssistant()
  const [text, setText] = useState(d.caption)
  const dirty = text !== d.caption
  const used = [...text].length
  const apply = () => dirty && a.action('edit', { draft: d.id, caption: text })

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apply()
        }}
        rows={5}
        placeholder="Write it yourself, or ask the assistant."
        className={cn(inputClass, 'h-auto resize-y py-2.5 leading-relaxed')}
      />
      <div className="mt-2 flex items-center gap-3">
        <span className={cn('font-mono text-[10.5px]', used > d.caption_limit ? 'text-fail' : 'text-dim')}>
          {used}/{d.caption_limit}
        </span>
        <AnimatePresence>
          {dirty && (
            <motion.div initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="ml-auto flex gap-2">
              <Btn size="sm" variant="subtle" onClick={() => setText(d.caption)}>
                Discard
              </Btn>
              <Btn size="sm" variant="primary" onClick={apply}>
                Apply <span className="font-mono text-[10px] opacity-60">⌘↵</span>
              </Btn>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Slides in order: drag to reorder, × to drop one, + to add a picture. */
function SlideStrip({ d, index, onShow }: { d: Draft; index: number; onShow: (i: number) => void }) {
  const a = useAssistant()
  // Keys are the slide's place before this drag; the order sent back is in those numbers.
  const [order, setOrder] = useState(() => d.slides.map((_, i) => i + 1))
  const [choosing, setChoosing] = useState(false)
  useEffect(() => setOrder(d.slides.map((_, i) => i + 1)), [d.version, d.slides])

  const commit = () => {
    if (order.some((n, i) => n !== i + 1)) a.action('arrange', { draft: d.id, order })
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <Reorder.Group axis="x" values={order} onReorder={setOrder} className="flex flex-wrap gap-2">
        {order.map((n, i) => {
          const s = d.slides[n - 1]
          if (!s) return null
          return (
            <Reorder.Item key={n} value={n} onDragEnd={commit} className="group relative cursor-grab active:cursor-grabbing" whileDrag={{ scale: 1.06, zIndex: 10 }}>
              <button
                type="button"
                onClick={() => {
                  onShow(n - 1)
                  a.select({ draft: d.id, slide: n })
                }}
                className={cn('relative block h-20 overflow-hidden rounded-md bg-[#1c1c1c] ring-offset-2 ring-offset-panel transition-shadow', index === n - 1 ? 'ring-2 ring-accent-soft' : 'hover:ring-2 hover:ring-line-2')}
                style={{ aspectRatio: `${d.size[0]} / ${d.size[1]}` }}
              >
                {s.kind === 'video' ? <video src={s.url} muted className="size-full object-cover" /> : <img src={s.url} alt="" draggable={false} className="size-full object-cover" />}
                <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 font-mono text-[9.5px] text-white">{i + 1}</span>
              </button>
              {d.slides.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove slide ${i + 1}`}
                  onClick={() => a.action('arrange', { draft: d.id, order: d.slides.map((_, k) => k + 1).filter((k) => k !== n) })}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line-2 bg-panel-3 text-dim opacity-0 transition-opacity hover:text-fail group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </Reorder.Item>
          )
        })}
      </Reorder.Group>
      {d.slides.length < d.max_slides && (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="grid h-20 place-items-center rounded-md border border-dashed border-line-2 text-dim transition-colors hover:border-accent-soft/60 hover:text-accent-soft"
          style={{ aspectRatio: `${d.size[0]} / ${d.size[1]}` }}
          aria-label="Add a slide"
        >
          <Plus className="size-4" />
        </button>
      )}
      <MediaChooser
        open={choosing}
        onClose={() => setChoosing(false)}
        title={`Add a slide to draft ${d.id}`}
        onPicture={(id) => a.action('place', { draft: d.id, media: id })}
        onAsset={(id) => a.action('use_assets', { assets: [id], draft: d.id })}
      />
    </div>
  )
}

function Texts({ d, index }: { d: Draft; index: number }) {
  const a = useAssistant()
  const slide = d.slides[index]
  const [adding, setAdding] = useState('')
  const selected = slide?.texts.find((t) => a.focus.draft === d.id && a.focus.text === t.id)
  const isVideo = slide?.kind === 'video'

  return (
    <div className="space-y-3">
      {slide?.texts.length ? (
        <div className="flex flex-wrap gap-1.5">
          {slide.texts.map((t) => {
            const on = selected?.id === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => a.select(on ? { draft: d.id, slide: index + 1 } : { draft: d.id, slide: index + 1, text: t.id })}
                className={cn('max-w-full truncate rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors', on ? 'border-accent-soft/60 bg-accent/10 text-fg' : 'border-line text-muted hover:border-line-2 hover:text-fg')}
              >
                <span className="mr-1.5 font-mono text-[10px] text-dim">{t.id}</span>
                {t.words}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-[12px] text-dim">{d.video ? `The words on this video come from draft ${d.video.from}: change them there, then make it again.` : isVideo ? 'Texts can’t be drawn on videos yet: use the caption.' : 'No texts on this slide.'}</p>
      )}

      <AnimatePresence mode="wait">{selected && <TextEditor key={selected.id} d={d} t={selected} palette={slide?.palette ?? []} />}</AnimatePresence>

      {!isVideo && slide && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!adding.trim()) return
            a.action('add_text', { draft: d.id, slide: index + 1, words: adding.trim() })
            setAdding('')
          }}
        >
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a text to this slide" className={cn(inputClass, 'h-8 text-[12.5px]')} />
          <Btn size="sm" type="submit" icon={Type} disabled={!adding.trim()} className="h-8">
            Add
          </Btn>
        </form>
      )}
    </div>
  )
}

/** Every look a text can have, one click each. */
function TextEditor({ d, t, palette }: { d: Draft; t: TextBox; palette: string[] }) {
  const a = useAssistant()
  const set = (fields: Record<string, string>) => a.action('edit_text', { draft: d.id, text: t.id, ...fields })

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease }}
      className="overflow-hidden"
    >
      <div className="space-y-3.5 rounded-lg border border-line-2 bg-white/[0.02] p-3.5">
        <div className="flex gap-2">
          <Committed key={t.words} value={t.words} onCommit={(words) => words && set({ words })} className={cn(inputClass, 'h-8 text-[12.5px]')} />
          <Btn size="sm" variant="danger" icon={Trash2} className="h-8" onClick={() => a.action('remove_text', { draft: d.id, text: t.id })} aria-label="Remove this text" />
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3.5">
          <div>
            <Label className="mb-1.5">Position</Label>
            <div className="grid w-[78px] grid-cols-3 gap-1">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  title={p}
                  onClick={() => set({ position: p })}
                  className={cn('grid aspect-square place-items-center rounded-[4px] border transition-colors', t.position === p ? 'border-accent-soft bg-accent/30' : 'border-line hover:border-line-2')}
                >
                  <span className={cn('size-1 rounded-full', t.position === p ? 'bg-fg' : 'bg-white/30')} />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5">Size</Label>
              <Segmented id={`size-${t.id}`} label="Size" value={SIZES.some((s) => s.value === t.size) ? t.size : 'large'} onChange={(size) => set({ size })} options={SIZES} />
            </div>
            <div>
              <Label className="mb-1.5">Style</Label>
              <Segmented id={`style-${t.id}`} label="Style" value={t.style} onChange={(style) => set({ style })} options={STYLES} />
            </div>
          </div>
        </div>
        <FontPicker t={t} onChange={set} />
        <TextColours t={t} palette={palette} onChange={set} />
      </div>
    </motion.div>
  )
}

/** Pick a time and it's booked: picking it yourself is the approval. Or let the queue choose. */
function SchedulePicker({ d, linked, disabled }: { d: Draft; linked?: Linked; disabled: boolean }) {
  const a = useAssistant()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const soon = new Date(Date.now() + 86_400_000)
  soon.setMinutes(0, 0, 0)
  const [date, setDate] = useState(toInputs(soon.toISOString()).date)
  const [time, setTime] = useState('09:00')
  const at = fromInputs(date, time)
  const past = !at || Date.parse(at) <= Date.now()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Btn
        size="sm"
        icon={CalendarClock}
        disabled={disabled}
        title={linked && disabled ? 'Campaign posts get a time once their version is saved and approved' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {linked ? 'Book a time' : 'Schedule'}
      </Btn>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease }}
            className="absolute left-0 top-9 z-30 w-[260px] rounded-lg border border-line-2 bg-panel-3 p-3 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)]"
          >
            <Label>Publish draft {d.id} on</Label>
            <div className="mt-2 grid grid-cols-[1fr_92px] gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputClass, 'h-8 px-2 text-[12px]')} />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(inputClass, 'h-8 px-2 text-[12px]')} />
            </div>
            <p className="mt-2 text-[11px] leading-snug text-dim">
              {linked ? `Another time for “${linked.title}”, next to the campaign’s own.` : 'It’s saved first if needed, then booked for this time.'}
            </p>
            <div className="mt-3 flex justify-between gap-2">
              {linked ? (
                <span />
              ) : (
                <Btn
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    setOpen(false)
                    a.schedule(d.id, 'queue')
                  }}
                >
                  Next free slot
                </Btn>
              )}
              <Btn
                size="sm"
                variant="primary"
                disabled={past}
                onClick={() => {
                  setOpen(false)
                  if (at) a.schedule(d.id, new Date(at))
                }}
              >
                Book it
              </Btn>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
