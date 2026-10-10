import { useState } from 'react'
import { Film, GitBranch, ImageIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAssistant, type Draft, type Version } from './store'

/*
 * A draft's versions (assistant/backend/studio.py): every change is one, and all of them stay. Going
 * back to an earlier one and changing it starts a branch from it; the versions after it stay on their
 * own branch, to come back to. Newest first; the ones the version on screen came from are its line,
 * the rest are other branches.
 */

const SHOWN = 6

function ago(at: number | null) {
  if (!at) return ''
  const s = Math.max(0, Date.now() / 1000 - at)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return new Date(at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The version on screen and the ones it came from. */
function lineOf(d: Draft) {
  const byNumber = new Map(d.versions.map((v) => [v.version, v]))
  const line = new Set<number>()
  for (let n: number | null = d.version; n != null && byNumber.has(n) && !line.has(n); n = byNumber.get(n)!.parent) line.add(n)
  return line
}

export function History({ d }: { d: Draft }) {
  const a = useAssistant()
  const [all, setAll] = useState(false)
  const line = lineOf(d)
  const newest = [...d.versions].reverse()
  const shown = all ? newest : newest.slice(0, SHOWN)

  if (d.versions.length < 2) return <p className="text-[12px] text-dim">Every change you or the assistant make is kept here, to go back to.</p>

  return (
    <div>
      <ol className="space-y-1">
        {shown.map((v) => (
          <Row
            key={v.version}
            d={d}
            v={v}
            current={v.version === d.version}
            branch={!line.has(v.version)}
            onPick={() => a.action('checkout', { draft: d.id, version: v.version })}
            disabled={a.conn !== 'online'}
          />
        ))}
      </ol>
      {newest.length > SHOWN && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-2 text-[11.5px] text-dim underline decoration-white/20 underline-offset-2 hover:text-fg">
          {all ? 'Show fewer' : `Show all ${newest.length} versions`}
        </button>
      )}
      <p className="mt-3 text-[11px] leading-snug text-dim">Pick a version to go back to it. Changing it starts a new branch; the others stay here.</p>
    </div>
  )
}

function Row({ d, v, current, branch, onPick, disabled }: { d: Draft; v: Version; current: boolean; branch: boolean; onPick: () => void; disabled: boolean }) {
  // A branch point: it wasn't changed from the version just before it
  const from = v.parent != null && v.parent !== v.version - 1 ? v.parent : null
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={current || disabled}
        aria-current={current ? 'true' : undefined}
        title={current ? 'On screen' : `Go back to version ${v.version}`}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 text-left transition-colors',
          current ? 'border-accent-soft/50 bg-accent/[0.08]' : 'border-transparent hover:border-line-2 hover:bg-white/[0.03] disabled:hover:border-transparent',
          branch && !current && 'ml-4',
        )}
      >
        <span className="relative grid h-10 shrink-0 place-items-center overflow-hidden rounded-md bg-[#1c1c1c] text-dim" style={{ aspectRatio: `${d.size[0]} / ${d.size[1]}`, maxWidth: '2.75rem' }}>
          {v.thumb?.kind === 'image' ? (
            <img src={v.thumb.url} alt="" loading="lazy" className="size-full object-cover" />
          ) : v.thumb?.kind === 'video' ? (
            <>
              <video src={v.thumb.url} muted preload="metadata" className="size-full object-cover" />
              <Film className="absolute bottom-0.5 right-0.5 size-2.5 text-white drop-shadow" />
            </>
          ) : (
            <ImageIcon className="size-3.5" strokeWidth={1.5} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[12.5px]', branch && !current ? 'text-muted' : 'text-fg')}>{v.label}</span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
            {branch && <GitBranch className="size-2.5 shrink-0" />}
            v{v.version}
            {from != null && <span>· from v{from}</span>}
            {v.at && <span>· {ago(v.at)}</span>}
          </span>
        </span>
        {current && <span className="shrink-0 rounded-full border border-accent-soft/40 px-1.5 py-px text-[10px] font-medium text-accent-soft">On screen</span>}
      </button>
    </li>
  )
}
