import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PlatformIcon } from '../components/ui/PlatformIcon'
import { cn } from '../lib/cn'
import { ease } from '../lib/motion'
import type { Case } from './cases'
import { Clip, FlowMap, monogram, Picture, PlanBoard, PostCard } from './pieces'

/*
 * A case's made thing at full size: the picture, the slides, the reel playing as a phone would,
 * the post, the flow or the plan. Shared by the public showcase and the studio's Showcase page.
 */

/** The made thing, as big as the screen allows. */
export function Stage({ c, version, tone = 'paper' }: { c: Case; version: number; tone?: 'paper' | 'panel' }) {
  const shot = c.shots?.[0]
  const v = c.versions?.[version]

  if (c.kind === 'reel') return <Reel c={c} version={version} />
  if (c.kind === 'carousel') return <Slides c={c} />
  if (c.kind === 'flow' && c.flow)
    return (
      <div className="flex w-full justify-center lg:h-full">
        <FlowMap flow={c.flow} fit className="max-w-[640px]" />
      </div>
    )
  if (c.kind === 'campaign' && c.plan && shot)
    return (
      <div className="no-scrollbar w-full max-w-[880px] py-2 lg:h-full lg:overflow-y-auto" data-lenis-prevent>
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Picture shot={shot} eager className="w-full rounded-[20px] object-cover md:sticky md:top-0" />
          <PlanBoard plan={c.plan} />
        </div>
      </div>
    )
  if (c.kind === 'post' && v)
    return (
      <div className="no-scrollbar flex w-full max-w-[500px] py-2 lg:max-h-full lg:overflow-y-auto" data-lenis-prevent>
        <PostCard c={c} version={v} tone={tone} className="my-auto w-full" />
      </div>
    )
  return shot ? <Picture shot={shot} eager className="h-auto max-h-full w-auto max-w-full rounded-[18px] shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)]" /> : null
}

/** A reel as a phone would play it: full bleed, the handle and caption over the bottom, a progress line on top. */
function Reel({ c, version }: { c: Case; version: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const caption = c.versions?.[version]
  useEffect(() => {
    const v = ref.current?.querySelector('video')
    if (!v) return
    let raf = 0
    const tick = () => {
      if (v.duration && bar.current) bar.current.style.transform = `scaleX(${v.currentTime / v.duration})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={ref} className="relative aspect-[9/16] h-[70svh] max-h-full max-w-full overflow-hidden rounded-[26px] border border-white/10 shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)] lg:h-full">
      <Clip c={c} size="full" className="size-full object-cover" />
      <span className="absolute inset-x-3 top-3 h-[3px] overflow-hidden rounded-full bg-white/25">
        <span ref={bar} className="block h-full origin-left scale-x-0 rounded-full bg-white" />
      </span>
      {caption && (
        <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/30 to-transparent p-4 pt-20 text-white">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <span className="grid size-7 place-items-center rounded-full bg-white text-[9px] text-black">{monogram(c.brand.name)}</span>@{c.brand.handle}
            <PlatformIcon id={caption.platform} className="ml-auto size-4 text-white/80" />
          </p>
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-[12.5px] leading-snug text-white/90">{caption.text.replace(/\n{2,}/g, '\n')}</p>
        </div>
      )}
    </div>
  )
}

function Slides({ c }: { c: Case }) {
  const shots = c.shots!
  const [at, setAt] = useState(0)
  const [dir, setDir] = useState(1)
  const go = (by: number) => {
    setDir(by)
    setAt((n) => (n + by + shots.length) % shots.length)
  }
  return (
    <div className="relative flex aspect-square max-h-full w-full max-w-[min(100%,calc(100svh-7rem))] items-center justify-center">
      <div className="relative size-full overflow-hidden rounded-[20px] shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)]">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={at}
            custom={dir}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            variants={{
              enter: (d: number) => ({ x: `${d * 100}%` }),
              center: { x: '0%' },
              exit: (d: number) => ({ x: `${d * -100}%` }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.7, ease }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={(_, info) => Math.abs(info.offset.x) > 60 && go(info.offset.x < 0 ? 1 : -1)}
          >
            <Picture shot={shots[at]} eager className="size-full object-cover" />
          </motion.div>
        </AnimatePresence>
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] text-white backdrop-blur-md">
          {at + 1} / {shots.length}
        </span>
      </div>
      <button type="button" aria-label="Previous slide" onClick={() => go(-1)} className="absolute left-2 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/75 md:-left-5">
        <ChevronLeft className="size-5" />
      </button>
      <button type="button" aria-label="Next slide" onClick={() => go(1)} className="absolute right-2 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/75 md:-right-5">
        <ChevronRight className="size-5" />
      </button>
      <span className="absolute -bottom-5 left-1/2 flex -translate-x-1/2 gap-1.5">
        {shots.map((s, j) => (
          <span key={s.src} className={cn('h-1 rounded-full bg-white transition-all duration-500', j === at ? 'w-5' : 'w-1 opacity-40')} />
        ))}
      </span>
    </div>
  )
}

