import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { Button } from './ui/Button'
import { FlowField } from './ui/FlowField'
import { LineReveal, Reveal, Serif } from './ui/Reveal'

export function FinalCTA() {
  const sectionRef = useRef<HTMLElement>(null)
  const targetRef = useRef<HTMLSpanElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  // The hero fanned one idea out to everywhere; here everything comes back to one button.
  const arrived = useInView(sectionRef, { once: true, margin: '0px 0px -35% 0px' })

  return (
    <section
      id="start"
      ref={sectionRef}
      className="relative isolate flex min-h-[92vh] items-center overflow-hidden border-t border-line py-32"
    >
      <FlowField
        mode="focus"
        focusRef={targetRef}
        quietRef={copyRef}
        play={arrived}
        spread={0.42}
        rise={0.2}
        strands={140}
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
      />
      {/* A horizon of light, breathing slowly. */}
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-[60%] -z-20 h-[90vh] w-[140vw] -translate-x-1/2 rounded-[50%] md:w-[110vw]"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklab, var(--color-accent) 30%, transparent), color-mix(in oklab, var(--color-accent-2) 10%, transparent) 45%, transparent 75%)',
        }}
        animate={{ scale: [1, 1.07, 1], opacity: [0.6, 0.85, 0.6] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-20 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(ellipse 60% 55% at 50% 45%, #000 20%, transparent 75%)',
        }}
      />

      <div className="container-x text-center">
        <Reveal y={12}>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">(14) — Start</p>
        </Reveal>
        <div className="relative">
          <span data-thread="point" data-dir="0.15,1" aria-hidden className="absolute right-[6%] top-0 size-px" />
          <LineReveal
            className="mx-auto mt-8 max-w-[14ch] text-[clamp(3rem,9vw,9.5rem)] font-medium leading-[0.88] tracking-[-0.055em]"
            lines={['Stop creating', <>content <Serif data-thread="scribble" data-from="right">manually.</Serif></>]}
          />
        </div>
        <div ref={copyRef} className="mx-auto max-w-md">
          <Reveal delay={0.2} className="mt-10 text-lg leading-snug text-muted md:text-xl">
            Build your workflow once and let AI handle the repetitive work.
          </Reveal>
        </div>
        <Reveal delay={0.3} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <span ref={targetRef} data-thread="end" className="inline-flex">
            <Button href="/signup" size="lg" arrow>
              Start Creating Free
            </Button>
          </span>
          {/* Frosted, so the threads pass behind it rather than through its label. */}
          <span className="inline-flex rounded-full bg-ink/55 backdrop-blur-md">
            <Button href="#product" size="lg" variant="ghost">
              Explore the Platform
            </Button>
          </span>
        </Reveal>
        <Reveal delay={0.35}>
          <p className="mt-5 font-mono text-[11px] text-dim">No credit card required.</p>
        </Reveal>
      </div>
    </section>
  )
}
