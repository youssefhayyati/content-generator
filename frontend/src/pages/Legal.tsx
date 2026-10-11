import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Footer } from '../components/Footer'
import { Navbar } from '../components/Navbar'
import { LineReveal, Serif } from '../components/ui/Reveal'
import { cn } from '../lib/cn'
import { ease } from '../lib/motion'
import { ReadyContext, useArrival } from '../lib/ready'
import { Link, useDocumentTitle } from '../lib/router'
import { DOCS, UPDATED, type Doc } from './legal/docs'

const pad = (n: number) => String(n).padStart(2, '0')

/** Which section is being read: the last one whose top has passed a third of the way down the screen. */
function useReading(doc: Doc) {
  const [id, setId] = useState(doc.sections[0].id)
  useEffect(() => {
    const els = doc.sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el)
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setId(hit.target.id)
      },
      { rootMargin: '-30% 0px -60% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [doc])
  return id
}

/** One legal document: a big title, the other documents one click away, numbered sections and a contents rail that follows along. */
function LegalPage({ doc }: { doc: Doc }) {
  useDocumentTitle(`${doc.title.join(' ').replace(/\.$/, '')} — FlowAI`)
  const ready = useArrival()
  const reading = useReading(doc)

  return (
    <ReadyContext.Provider value={ready}>
      <div className="relative overflow-x-clip">
        <Navbar />
        <main className="container-x pb-24 pt-32 md:pb-32 md:pt-44">
          <header className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <motion.p
                className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
                initial={{ opacity: 0, y: 12 }}
                animate={ready ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 0.8, ease }}
              >
                <span className="text-fg">(Legal)</span>
                <span className="h-px w-8 bg-current opacity-40" />
                <span>Updated {UPDATED}</span>
              </motion.p>
              <LineReveal
                as="h1"
                play={ready}
                className="mt-8 text-[clamp(3rem,8vw,8.5rem)] font-medium leading-[0.88] tracking-[-0.055em]"
                lines={[doc.title[0], <Serif>{doc.title[1]}</Serif>]}
              />
            </div>
            <motion.div
              className="lg:col-span-4"
              initial={{ opacity: 0, y: 16 }}
              animate={ready ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.9, ease, delay: 0.25 }}
            >
              <p className="max-w-[42ch] text-[16px] leading-relaxed text-muted">{doc.lead}</p>
              <nav aria-label="Legal documents" className="mt-6 flex flex-wrap gap-1.5">
                {Object.values(DOCS).map((d) => (
                  <Link
                    key={d.id}
                    to={d.path}
                    aria-current={d.id === doc.id ? 'page' : undefined}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-[13px] transition-colors duration-300',
                      d.id === doc.id ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
                    )}
                  >
                    {d.label}
                  </Link>
                ))}
              </nav>
            </motion.div>
          </header>

          <div className="mt-16 grid gap-12 border-t border-line pt-12 md:mt-24 md:pt-16 lg:grid-cols-12">
            <aside className="hidden lg:col-span-3 lg:block">
              <ol className="sticky top-28 space-y-0.5" aria-label="Contents">
                {doc.sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={cn(
                        'flex items-center gap-3 py-1.5 text-[13.5px] transition-colors duration-300',
                        reading === s.id ? 'text-fg' : 'text-dim hover:text-muted',
                      )}
                    >
                      <span className="w-5 font-mono text-[10.5px] tabular-nums">{pad(i + 1)}</span>
                      {s.title}
                      <span className={cn('h-px bg-accent transition-[width] duration-500 ease-expo', reading === s.id ? 'w-6' : 'w-0')} />
                    </a>
                  </li>
                ))}
              </ol>
            </aside>

            <article className="min-w-0 lg:col-span-8 lg:col-start-5 xl:col-span-7 xl:col-start-5">
              {doc.sections.map((s, i) => (
                <section
                  key={s.id}
                  id={s.id}
                  className="scroll-mt-28 border-b border-line py-10 first:pt-0 last:border-b-0 md:grid md:grid-cols-[4rem_minmax(0,1fr)] md:gap-6"
                >
                  <span className="font-mono text-[11px] tabular-nums text-dim md:pt-2.5">{pad(i + 1)}</span>
                  <div>
                    <h2 className="mt-2 text-[clamp(1.4rem,2.2vw,1.85rem)] font-medium leading-tight tracking-[-0.03em] md:mt-0">{s.title}</h2>
                    <div className="mt-4 space-y-4 text-[15.5px] leading-[26px] text-muted [&>ul>li]:relative [&>ul>li]:pl-5 [&>ul>li]:before:absolute [&>ul>li]:before:left-0 [&>ul>li]:before:top-[13px] [&>ul>li]:before:h-px [&>ul>li]:before:w-2.5 [&>ul>li]:before:bg-accent [&>ul>li]:before:content-[''] [&>ul]:space-y-2.5">
                      {s.body}
                    </div>
                  </div>
                </section>
              ))}
            </article>
          </div>
        </main>
        <Footer />
      </div>
    </ReadyContext.Provider>
  )
}

export const Privacy = () => <LegalPage doc={DOCS.privacy} />
export const Terms = () => <LegalPage doc={DOCS.terms} />
export const Cookies = () => <LegalPage doc={DOCS.cookies} />
