import { useEffect, useRef, useState } from 'react'
import { useLenis } from 'lenis/react'
import { ReadyContext } from '../lib/ready'
import { AIGeneration } from '../components/AIGeneration'
import { Analytics } from '../components/Analytics'
import { Automations } from '../components/Automations'
import { Calendar } from '../components/Calendar'
import { ContentAdaptation } from '../components/ContentAdaptation'
import { ContentTypes } from '../components/ContentTypes'
import { Features } from '../components/Features'
import { FinalCTA } from '../components/FinalCTA'
import { Footer } from '../components/Footer'
import { Hero } from '../components/Hero'
import { MadeWith } from '../components/MadeWith'
import { MultiPlatform } from '../components/MultiPlatform'
import { Navbar } from '../components/Navbar'
import { Problem } from '../components/Problem'
import { ProductShowcase } from '../components/ProductShowcase'
import { Security } from '../components/Security'
import { SocialProof } from '../components/SocialProof'
import { UseCases } from '../components/UseCases'
import { Workflow } from '../components/Workflow'
import { PaperChapter } from '../components/ui/Plate'
import { Preloader } from '../components/ui/Preloader'
import { Thread } from '../components/ui/Thread'
import { isInitialRoute, takeSection, useDocumentTitle, useEntryDelay } from '../lib/router'

export default function Home() {
  useDocumentTitle('FlowAI — Create once. Publish everywhere.')
  // The preloader is for a cold load only. Arriving from another page, the curtain
  // already did that job, so the hero starts as soon as it begins to lift.
  const [preload] = useState(isInitialRoute)
  const entry = useEntryDelay()
  const [ready, setReady] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const lenis = useLenis()

  useEffect(() => {
    if (preload) return
    const t = window.setTimeout(() => setReady(true), entry * 1000)
    return () => window.clearTimeout(t)
  }, [preload, entry])

  // Hold the page still until the preloader has lifted.
  useEffect(() => {
    if (!lenis) return
    if (ready) lenis.start()
    else lenis.stop()
  }, [lenis, ready])

  // Arrived from a section link on another page: jump straight to that section.
  useEffect(() => {
    if (!lenis || !ready) return
    const s = takeSection()
    if (s) lenis.scrollTo(s, { offset: -80, immediate: true, force: true })
  }, [lenis, ready])

  return (
    <ReadyContext.Provider value={ready}>
      {preload && <Preloader onDone={() => setReady(true)} />}
      <div ref={rootRef} className="relative overflow-x-clip">
        <Thread rootRef={rootRef} />
        <Navbar />
        <main>
          <Hero />
          <SocialProof />
          <Problem />
          <ProductShowcase />
          <AIGeneration />
          <ContentTypes />
          <Workflow />
          <MultiPlatform />
          <ContentAdaptation />
          <Calendar />
          <Automations />
          <PaperChapter>
            <Analytics />
            <Features />
          </PaperChapter>
          <UseCases />
          <MadeWith />
          <Security />
          <FinalCTA />
        </main>
        <Footer />
      </div>
    </ReadyContext.Provider>
  )
}
