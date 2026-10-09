import { Fragment, useMemo, type ReactNode } from 'react'

/*
 * The content kit arrives as Markdown with a known, small shape: "## " sections, "- " bullets,
 * pipe tables and **bold**. This reads exactly that into elements (never HTML strings), and
 * copes with a half-written last line while the kit is still streaming in.
 */

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; rows: string[][] }

function parse(text: string): Block[] {
  const blocks: Block[] = []
  let list: string[] | null = null
  let table: string[][] | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trim()

    if (line.startsWith('|')) {
      list = null
      // The |---|---| row only separates the header from the body.
      if (/^\|?[\s:|-]+\|?$/.test(line)) continue
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (!table) blocks.push({ kind: 'table', rows: (table = []) })
      table.push(cells)
      continue
    }
    table = null

    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (bullet) {
      if (!list) blocks.push({ kind: 'list', items: (list = []) })
      list.push(bullet[1])
      continue
    }
    list = null

    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading) blocks.push({ kind: 'heading', text: heading[1] })
    else if (line) blocks.push({ kind: 'paragraph', text: line })
  }
  return blocks
}

/** **bold** spans; everything else is text. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <strong key={i} className="font-medium text-fg">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

export function KitMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text])
  let section = 0

  return (
    <div className="text-[13.5px] leading-relaxed text-muted">
      {blocks.map((b, i): ReactNode => {
        switch (b.kind) {
          case 'heading':
            section++
            return (
              <h3
                key={i}
                className="mb-2 mt-8 flex items-baseline gap-3 border-t border-line pt-5 text-[15px] font-medium tracking-[-0.01em] text-fg first:mt-0 first:border-t-0 first:pt-0"
              >
                <span className="font-mono text-[10.5px] tabular-nums text-accent-soft">{String(section).padStart(2, '0')}</span>
                <Inline text={b.text} />
              </h3>
            )
          case 'paragraph':
            return (
              <p key={i} className="my-1.5">
                <Inline text={b.text} />
              </p>
            )
          case 'list':
            return (
              <ul key={i} className="my-2 space-y-1.5">
                {b.items.map((item, j) => (
                  <li key={j} className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:h-px before:w-2 before:bg-dim">
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            )
          case 'table': {
            const [head, ...body] = b.rows
            return (
              <div key={i} className="my-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[520px] border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr className="bg-white/[0.03]">
                      {head.map((c, j) => (
                        <th key={j} className="border-b border-line px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-dim">
                          <Inline text={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.map((row, r) => (
                      <tr key={r} className="border-b border-line last:border-b-0">
                        {row.map((c, j) => (
                          <td key={j} className="px-3 py-2 align-top">
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        }
      })}
    </div>
  )
}
