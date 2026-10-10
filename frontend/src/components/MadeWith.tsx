import { ArrowUpRight } from 'lucide-react'
import { useLinkClick } from '../lib/router'
import { CASES, KIND_LABEL, type Case } from '../showcase/cases'
import { Clip, FlowMap, Picture, PostCard } from '../showcase/pieces'
import { Button } from './ui/Button'
import { VelocityMarquee } from './ui/Marquee'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

/**
 * Proof, after the promises: a strip of things FlowAI actually made, drifting with the scroll.
 * Each piece opens its case on the showcase page.
 */
export function MadeWith() {
  return (
    <section id="showcase" className="relative overflow-hidden py-28 md:py-40">
      <div className="container-x">
        <SectionLabel index="13">Showcase</SectionLabel>
        <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:items-end">
          <LineReveal
            className="text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em] lg:col-span-8"
            lines={['Made with', <Serif>FlowAI.</Serif>]}
          />
          <Reveal className="lg:col-span-4">
            <p className="max-w-[38ch] text-[16px] leading-relaxed text-muted">
              Posts, pictures, reels, a flow and a launch plan, each from a single brief. Open one to see how it was made, then make your own from it.
            </p>
            <Button href="/showcase" arrow className="mt-7">
              Open the showcase
            </Button>
          </Reveal>
        </div>
      </div>

      <VelocityMarquee speed={-1.4} className="mt-14 md:mt-20">
        {CASES.map((c) => (
          <Tile key={c.id} c={c} />
        ))}
      </VelocityMarquee>
    </section>
  )
}

function Tile({ c }: { c: Case }) {
  const href = `/showcase?case=${c.id}`
  const onClick = useLinkClick(href)
  const shot = c.shots?.[0]
  const frame = 'relative mx-2 block h-[300px] shrink-0 overflow-hidden rounded-[20px] border border-line md:mx-2.5 md:h-[380px]'

  let body
  if (c.video) body = <Clip c={c} className="aspect-[9/16] h-full w-auto object-cover" />
  else if (c.kind === 'flow' && c.flow)
    body = (
      <span className="flex h-full w-[200px] items-center bg-panel px-3 md:w-[256px]">
        <FlowMap flow={c.flow} compact />
      </span>
    )
  else if (c.kind === 'post' && !shot && c.versions)
    body = (
      <span className="flex h-full w-[290px] items-start bg-card px-4 pt-5 md:w-[340px]" style={{ background: 'radial-gradient(110% 80% at 100% 0%, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 65%), var(--color-card)' }}>
        <PostCard c={c} version={c.versions[0]} clamp withShot={false} />
      </span>
    )
  else if (shot)
    body = (
      <Picture
        shot={shot}
        size="sm"
        className={c.kind === 'carousel' || c.kind === 'campaign' ? 'aspect-square h-full w-auto object-cover' : 'h-full w-auto object-cover'}
      />
    )
  else return null

  return (
    <a href={href} onClick={onClick} className={`group ${frame}`} aria-label={`${c.title}, for ${c.brand.name}`}>
      <span className="block h-full transition-transform duration-1000 ease-expo group-hover:scale-[1.035]">{body}</span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-linear-to-t from-black/75 to-transparent p-3.5 pt-12 text-white">
        <span className="min-w-0">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/60">
            {KIND_LABEL[c.kind]} · {c.brand.name}
          </span>
          <span className="mt-0.5 block truncate text-[14px] font-medium">{c.title}</span>
        </span>
        <ArrowUpRight className="size-4 shrink-0 opacity-0 transition-[opacity,rotate] duration-500 ease-expo group-hover:rotate-45 group-hover:opacity-100" />
      </span>
    </a>
  )
}
