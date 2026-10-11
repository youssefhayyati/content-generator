import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, Copy, ExternalLink, GitBranch, History, LoaderCircle, Pin, PinOff, Play, Scissors, ShieldCheck, Square, Trash2, X } from 'lucide-react'
import { api, ApiError, type Asset, type LabCatalog, type LabMoment, type LabNode, type LabPayload, type LabPlan, type LabSource, type LabValue } from '../../lib/api'
import { cn } from '../../lib/cn'
import { Link } from '../../lib/router'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { AssetModal, MediaThumb } from '../media/Media'
import { Player } from '../sound/Player'
import { useToast } from '../toast'
import { Btn, Label, inputClass } from '../ui'
import { FieldEditor, shown, type FieldContext } from './fields'
import { costLine, fmtSeconds, hueOf, iconOf } from './look'
import { newNodeId, type Lab, type LabHistoryRun } from './useLab'

/**
 * The selected node, in full: its name, how it stands and what running it takes, its settings,
 * what it made (large), its versions, and branching or removing it.
 */
export function Inspector({ lab, catalog, nodeId, onClose, onSelect }: { lab: Lab; catalog: LabCatalog; nodeId: string; onClose: () => void; onSelect: (id: string) => void }) {
  const toast = useToast()
  const data = lab.data as LabPayload
  const node = data.canvas.nodes.find((n) => n.id === nodeId)
  const kind = node ? catalog.nodes[node.type] : undefined
  const state = data.nodes[nodeId]
  const [label, setLabel] = useState(node?.label ?? '')
  const [plan, setPlan] = useState<LabPlan | null>(null)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [extra, setExtra] = useState<Record<number, Asset>>({})
  useEffect(() => setLabel(node?.label ?? ''), [nodeId, node?.label])

  const assets = useMemo(() => ({ ...data.assets, ...extra }), [data.assets, extra])

  // What flows in: the moments (for Cut), the picture (for Paint), the account's platform (for Post).
  const ctx: FieldContext | null = useMemo(() => {
    if (!node) return null
    const into = (port: string) => data.canvas.edges.filter((e) => e.to === node.id && e.in === port).map((e) => data.nodes[e.from]?.outputs?.[e.out]).filter(Boolean) as LabValue[]
    const moments = into('moments')[0]?.moments ?? null
    const img = into('image')[0]?.assets?.[0]
    const account = catalog.accounts.find((a) => a.id === Number(node.params?.account_id))
    return {
      catalog,
      node,
      assets,
      moments,
      image: img ? assets[img] ?? null : null,
      platform: account?.platform ?? null,
      remember: (list: Asset[]) => setExtra((e) => ({ ...e, ...Object.fromEntries(list.map((a) => [a.id, a])) })),
    }
  }, [node, data, catalog, assets])

  // What running it takes (the nodes before it that have to run too), for slow or paid nodes.
  useEffect(() => {
    setPlan(null)
    if (!state || state.policy === 'none' || state.policy === 'post') return
    if (!['ready', 'stale', 'failed', 'missing', 'done'].includes(state.status)) return
    let cancelled = false
    lab.plan(nodeId).then((p) => !cancelled && setPlan(p)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [nodeId, state?.status, state?.policy, lab])

  if (!node || !kind || !ctx) return null
  const hue = hueOf(kind)
  const Icon = iconOf(node.type)
  const params = { ...Object.fromEntries(kind.fields.map((f) => [f.key, f.default])), ...(node.params ?? {}) }
  const connected = (port: string) => data.canvas.edges.some((e) => e.to === node.id && e.in === port)
  const running = state?.status === 'running' || state?.status === 'queued'
  const fields = kind.fields.filter((f) => shown(f, params, connected))
  const before = plan?.nodes.filter((n) => n.id !== nodeId) ?? []

  const runIt = async () => {
    if (await lab.run(nodeId)) toast(before.length ? `Running it, with the ${before.length} before it.` : `${kind.label}: running.`)
  }

  return (
    <aside className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-line p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px]" style={{ background: `color-mix(in oklab, ${hue} 15%, transparent)`, color: hue }}>
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <input
            className="w-full bg-transparent text-[14px] font-medium outline-none placeholder:text-fg"
            value={label}
            placeholder={kind.label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== (node.label ?? '') && void lab.ops([{ op: 'label', id: node.id, label }])}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Name"
          />
          <p className="mt-0.5 text-[11.5px] leading-snug text-dim">{kind.detail}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-dim hover:text-fg">
          <X className="size-4" />
        </button>
      </div>

      <div data-scroll className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4" data-lenis-prevent>
        {/* How it stands, and running it */}
        {state && state.policy !== 'none' && state.policy !== 'post' && (
          <section className="space-y-2.5 rounded-lg border border-line bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">
                {state.policy === 'auto' && data.canvas.auto && (state.versions ?? 0) > 0 ? 'Updates by itself when what it uses changes (Keep up to date is on)' : 'Runs when you press Run'}
              </span>
            </div>
            {running ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-[12.5px]">
                  <LoaderCircle className="size-3.5 animate-spin text-accent-soft" />
                  {state.active?.stage || (state.status === 'queued' ? 'Waiting its turn' : 'Running')}
                  {state.active?.share != null && <span className="font-mono text-[11px] text-dim">{Math.round(state.active.share * 100)}%</span>}
                </p>
                {state.active?.waiting_for && <p className="text-[11px] text-dim">After: {state.active.waiting_for.join(', ')}</p>}
                <Btn size="sm" variant="danger" icon={Square} onClick={() => void lab.stop(nodeId)}>
                  Stop
                </Btn>
              </div>
            ) : (
              <div className="space-y-2">
                {state.estimate && (
                  <p className="text-[11.5px] text-dim">
                    {state.estimate.model ? `${state.estimate.model}, ` : ''}
                    {costLine(plan ?? state.estimate)}
                    {before.length > 0 && ` (with the ${before.length} node${before.length > 1 ? 's' : ''} before it: ${before.map((b) => b.label).join(', ')})`}
                  </p>
                )}
                {!!plan?.blocked?.length && <p className="text-[11.5px] text-warn">{plan.blocked.join(' ')}</p>}
                <Btn size="sm" variant={state.status === 'done' ? 'ghost' : 'primary'} icon={Play} onClick={() => void runIt()} disabled={!!plan?.blocked?.length}>
                  {state.status === 'done' ? 'Run again' : before.length ? `${state.run_label} (and ${before.length} before)` : state.run_label}
                </Btn>
              </div>
            )}
            {state.status === 'failed' && state.failed?.error && (
              <p className="flex gap-1.5 text-[12px] leading-snug text-fail">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {state.failed.error}
              </p>
            )}
            {state.status === 'stale' && <p className="text-[11.5px] text-warn">Out of date: what it uses changed since it ran{state.pinned ? ' (a pinned version is showing)' : ''}.</p>}
            {state.status === 'missing' && !!state.missing?.length && <p className="text-[11.5px] text-dim">{state.missing.join(' ')}</p>}
          </section>
        )}

        {node.type === 'source.youtube' && <YoutubePanel lab={lab} node={node} source={state?.source ?? null} />}

        {/* Settings */}
        {fields.length > 0 && (
          <section className="space-y-3.5">
            {fields.map((f) => (
              <FieldEditor key={f.key} field={f} ctx={ctx} value={node.params?.[f.key] ?? f.default} onChange={(v, now) => lab.setParams(node.id, { [f.key]: v }, now)} />
            ))}
          </section>
        )}

        {node.type === 'finish.post' && <PostPanel lab={lab} node={node} />}

        {/* What it made */}
        <Outputs lab={lab} node={node} catalog={catalog} assets={assets} onAsset={setAsset} onSelect={onSelect} />

        {state && state.policy !== 'none' && (state.versions ?? 0) > 0 && <Versions lab={lab} node={node} pinned={node.pin && !node.soft ? node.pin : null} currentId={state.current?.id ?? null} />}
      </div>

      <div className="flex items-center gap-2 border-t border-line p-3">
        {kind.run !== 'none' && kind.run !== 'post' && (
          <Btn size="sm" icon={GitBranch} onClick={() => void lab.ops([{ op: 'branch', id: node.id }]).then((r) => {
            const root = r?.results?.[0]?.root as string | undefined
            if (root) {
              onSelect(root)
              toast('Branch made: change it to try another option. The original stays as it is.')
            }
          })}>
            Branch
          </Btn>
        )}
        <Btn size="sm" variant="subtle" icon={Trash2} className="ml-auto" onClick={() => {
          void lab.ops([{ op: 'remove', id: node.id }])
          onClose()
        }}>
          Remove
        </Btn>
      </div>
      <AssetModal asset={asset} onClose={() => setAsset(null)} />
    </aside>
  )
}

/* ------------------------------------------------------------------ */

function Outputs({ lab, node, catalog, assets, onAsset, onSelect }: { lab: Lab; node: LabNode; catalog: LabCatalog; assets: Record<number, Asset>; onAsset: (a: Asset) => void; onSelect: (id: string) => void }) {
  const toast = useToast()
  const data = lab.data as LabPayload
  const state = data.nodes[node.id]
  const outs = state?.outputs ?? {}
  const values = Object.values(outs)
  const media = values.flatMap((v) => v.assets ?? []).map((id) => assets[id]).filter(Boolean)
  if (!values.some((v) => (v.assets?.length ?? 0) > 0 || v.text || v.moments?.length || v.brief)) return null

  /** A clip from a moment: Cut (that moment) → Captions → Post, joined to what feeds Find moments. */
  const clipIt = (m: LabMoment) => {
    const canvas = data.canvas
    const source = canvas.edges.find((e) => e.to === node.id && e.in === 'transcript')
    // The video the transcript came from: what feeds the Transcript node.
    const media = source ? canvas.edges.find((e) => e.to === source.from) : null
    const cut = newNodeId(canvas, catalog.nodes['video.cut'])
    const caps = newNodeId(canvas, catalog.nodes['video.captions'], [cut])
    const y = node.y + (m.n - 1) * 300
    void lab
      .ops([
        { op: 'add', node: { id: cut, type: 'video.cut', x: node.x + 340, y, params: { moment: m.n, aspect: '9:16', fit: 'speaker' }, label: `Clip ${m.n}: ${m.title}`.slice(0, 60) } },
        { op: 'add', node: { id: caps, type: 'video.captions', x: node.x + 680, y } },
        { op: 'connect', from: node.id, out: 'moments', to: cut, in: 'moments' },
        ...(media ? [{ op: 'connect', from: media.from, out: media.out, to: cut, in: 'video' }] : []),
        { op: 'connect', from: cut, out: 'video', to: caps, in: 'video' },
      ])
      .then((r) => {
        if (r) {
          onSelect(cut)
          toast(media ? `Clip ${m.n} is cutting.` : 'Connect the video to the Cut node.')
        }
      })
  }

  return (
    <section className="space-y-3">
      <Label>What it made{state?.current && state.versions && state.versions > 1 ? ` · version ${state.current.version}` : ''}</Label>
      {media.some((a) => a.kind === 'image') && (
        <div className="grid grid-cols-2 gap-1.5">
          {media.filter((a) => a.kind === 'image').map((a) => (
            <button key={a.id} type="button" onClick={() => onAsset(a)} className="text-left">
              <img src={a.url} alt={a.name ?? ''} className="w-full rounded-md bg-black/30 object-contain" />
            </button>
          ))}
        </div>
      )}
      {media.filter((a) => a.kind === 'video').map((a) => (
        <video key={a.id} src={a.url} poster={a.poster_url ?? undefined} controls playsInline className="max-h-[420px] w-full rounded-lg bg-black" />
      ))}
      {media.filter((a) => a.kind === 'audio').map((a) => (
        <Player key={a.id} asset={a} />
      ))}
      {values.filter((v) => v.type === 'text' && v.text).map((v, i) => (
        <div key={i} className="relative rounded-lg border border-line bg-white/[0.02] p-3">
          <p className="whitespace-pre-wrap pr-6 text-[12.5px] leading-relaxed">{v.text}</p>
          <button type="button" aria-label="Copy" onClick={() => void navigator.clipboard.writeText(v.text ?? '').then(() => toast('Copied.'))} className="absolute right-2 top-2 text-dim hover:text-fg">
            <Copy className="size-3.5" />
          </button>
        </div>
      ))}
      {values.flatMap((v) => v.moments ?? []).map((m) => (
        <div key={m.n} className="space-y-1.5 rounded-lg border border-line bg-white/[0.02] p-3">
          <div className="flex items-start gap-2">
            <span className="font-mono text-[11px] text-dim">{m.n}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium leading-snug">{m.title}</p>
              <p className="text-[12px] leading-snug text-muted">“{m.hook}”</p>
            </div>
            <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted">{m.score}</span>
          </div>
          <p className="text-[11.5px] leading-snug text-dim">{m.why}</p>
          <p className="line-clamp-3 text-[11.5px] italic leading-snug text-dim">{m.quote}</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-dim">
              {fmtClock(m.start)} → {fmtClock(m.end)} · {Math.round(m.duration)} s
            </span>
            <Btn size="sm" icon={Scissors} className="ml-auto" onClick={() => clipIt(m)}>
              Clip it
            </Btn>
          </div>
        </div>
      ))}
      {values.filter((v) => v.type === 'brief' && v.brief).map((v, i) => (
        <pre key={i} className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-white/[0.02] p-3 font-sans text-[11.5px] leading-snug text-muted">
          {String(v.brief?.context || 'Nothing in the brief yet.')}
        </pre>
      ))}
    </section>
  )
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** A node's runs: each version, which one flows on, and pinning one. */
function Versions({ lab, node, pinned, currentId }: { lab: Lab; node: LabNode; pinned: number | null; currentId: number | null }) {
  const [runs, setRuns] = useState<LabHistoryRun[] | null>(null)
  const [assets, setAssets] = useState<Record<number, Asset>>({})
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    lab.history(node.id).then((h) => {
      setRuns(h.runs)
      setAssets(h.assets)
    }).catch(() => setRuns([]))
  }, [open, node.id, lab, currentId])

  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[12px] text-muted hover:text-fg">
        <History className="size-3.5" /> {open ? 'Hide' : 'Show'} its versions
      </button>
      {open && (
        <div className="space-y-1.5">
          {pinned && (
            <Btn size="sm" variant="subtle" icon={PinOff} onClick={() => void lab.ops([{ op: 'pin', id: node.id, run: null }])}>
              Back to the newest
            </Btn>
          )}
          {runs?.map((r) => {
            const thumbs = Object.values(r.outputs ?? {}).flatMap((v) => v.assets ?? []).map((id) => assets[id]).filter(Boolean).slice(0, 3)
            const text = Object.values(r.outputs ?? {}).find((v) => v.text)?.text
            return (
              <div key={r.id} className={cn('flex items-center gap-2 rounded-md border p-2', r.id === currentId ? 'border-accent/40 bg-accent/[0.06]' : 'border-line')}>
                <span className="font-mono text-[10.5px] text-dim">v{r.version}</span>
                <div className="flex gap-1">
                  {thumbs.map((a) => (
                    <MediaThumb key={a.id} asset={a} className="size-8" />
                  ))}
                </div>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                  {r.status === 'succeeded' ? (text ? text.slice(0, 60) : r.by === 'auto' ? 'by itself' : r.by === 'assistant' ? 'by the assistant' : 'by you') : r.status === 'failed' ? (r.error ?? 'failed') : r.status}
                </span>
                {r.status === 'succeeded' && r.id !== currentId && (
                  <button type="button" onClick={() => void lab.ops([{ op: 'pin', id: node.id, run: r.id }])} className="text-dim hover:text-accent-soft" aria-label="Use this version" title="Use this version">
                    <Pin className="size-3.5" />
                  </button>
                )}
              </div>
            )
          })}
          {runs && !runs.length && <p className="text-[11.5px] text-dim">No versions yet.</p>}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

/** A YouTube node: the link, the video's details, and the permission recorded before anything is downloaded. */
function YoutubePanel({ lab, node, source }: { lab: Lab; node: LabNode; source: LabSource | null }) {
  const toast = useToast()
  const [url, setUrl] = useState(String(node.params?.url ?? ''))
  const [busy, setBusy] = useState(false)
  const [basis, setBasis] = useState<LabSource['basis']>(source?.basis ?? null)
  const [note, setNote] = useState(source?.permission_note ?? '')
  const [credit, setCredit] = useState(source?.credit ?? '')
  useEffect(() => setUrl(String(node.params?.url ?? '')), [node.params?.url])
  useEffect(() => {
    setBasis(source?.basis ?? null)
    setNote(source?.permission_note ?? '')
    setCredit(source?.credit ?? '')
  }, [source?.id, source?.basis])

  const inspect = async () => {
    setBusy(true)
    try {
      const s = await api<LabSource>('/lab/youtube/inspect', { method: 'POST', body: { url } })
      await lab.ops([{ op: 'set', id: node.id, params: { url, source_id: s.id } }])
      if (s.license?.toLowerCase().includes('creative commons')) setBasis('creative_commons')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That link couldn’t be read.')
    } finally {
      setBusy(false)
    }
  }

  const record = async (deny = false) => {
    if (!source) return
    setBusy(true)
    try {
      await api(`/lab/youtube/${source.id}/permission`, { method: 'POST', body: deny ? { deny: true, note } : { basis, note, credit } })
      await lab.refresh()
      toast(deny ? 'Marked as not ours to use.' : 'Permission recorded. Fetch it when you’re ready.')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That couldn’t be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[11.5px] text-muted" htmlFor={`yt-${node.id}`}>Link</label>
        <div className="flex gap-2">
          <input id={`yt-${node.id}`} className={inputClass} value={url} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void inspect()} />
          <Btn onClick={() => void inspect()} loading={busy && !source} disabled={!url.trim()}>
            Read
          </Btn>
        </div>
      </div>
      {source && (
        <div className="space-y-3 rounded-lg border border-line bg-white/[0.02] p-3">
          <div className="flex gap-3">
            {source.thumbnail && <img src={source.thumbnail} alt="" referrerPolicy="no-referrer" className="h-16 w-28 shrink-0 rounded object-cover" />}
            <div className="min-w-0 text-[12px] leading-snug">
              <p className="font-medium">{source.title}</p>
              <p className="text-muted">{source.channel}</p>
              <p className="text-dim">
                {source.duration ? fmtSeconds(source.duration) : ''}
                {source.license ? ` · ${source.license}` : ''}
              </p>
            </div>
          </div>
          {source.permission === 'allowed' ? (
            <p className="flex items-start gap-1.5 text-[12px] text-ok">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Permission recorded: {source.basis === 'own' ? 'your own video' : source.basis === 'creative_commons' ? 'Creative Commons' : `used with permission (${source.permission_note})`}.
                {source.credit && <span className="block text-dim">Every caption made from it carries: {source.credit}</span>}
              </span>
            </p>
          ) : source.permission === 'denied' ? (
            <p className="text-[12px] text-fail">Marked as not ours to use. Nothing is downloaded.</p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[12px] leading-snug">Whose video is this? Nothing is downloaded until you say.</p>
              {([['own', 'Mine: my channel'], ['permission', 'Someone else’s, and they gave permission'], ['creative_commons', 'Creative Commons (credit given)']] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-[12.5px]">
                  <input type="radio" name={`basis-${node.id}`} checked={basis === k} onChange={() => setBasis(k)} className="accent-[var(--color-accent)]" />
                  {l}
                </label>
              ))}
              {(basis === 'permission' || (basis === 'creative_commons' && !source.license)) && (
                <textarea
                  className={cn(inputClass, 'h-auto py-2 text-[12.5px]')}
                  rows={2}
                  placeholder={basis === 'permission' ? 'Who gave it, and how (an email, a DM, a contract)' : 'Where it’s stated as Creative Commons (YouTube doesn’t say): a link to the licence'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
              {basis && basis !== 'own' && <input className={cn(inputClass, 'text-[12.5px]')} placeholder="The credit line (empty: made for you)" value={credit} onChange={(e) => setCredit(e.target.value)} />}
              <div className="flex gap-2">
                <Btn size="sm" variant="primary" icon={ShieldCheck} disabled={!basis} loading={busy} onClick={() => void record()}>
                  Record permission
                </Btn>
                <Btn size="sm" variant="subtle" onClick={() => void record(true)}>
                  Not ours
                </Btn>
              </div>
            </div>
          )}
          {source.status === 'failed' && source.error && <p className="text-[11.5px] text-fail">{source.error}</p>}
        </div>
      )}
    </section>
  )
}

/** A Post node: saving or scheduling it (a person's decision), and how it went. */
function PostPanel({ lab, node }: { lab: Lab; node: LabNode }) {
  const toast = useToast()
  const data = lab.data as LabPayload
  const state = data.nodes[node.id]
  const post = state?.post
  const when = String(node.params?.when ?? 'draft')
  const [saving, setSaving] = useState(false)
  const verb = when === 'draft' ? (post ? 'Save the draft again' : 'Save as a draft') : when === 'now' ? 'Post now' : 'Approve and schedule'

  const save = async () => {
    setSaving(true)
    const ok = await lab.run(node.id)
    setSaving(false)
    if (ok) toast(when === 'draft' ? 'Saved as a draft.' : when === 'now' ? 'Sent to the phone.' : 'Approved and scheduled.')
  }

  return (
    <section className="space-y-3 rounded-lg border border-line bg-white/[0.02] p-3">
      <Btn variant={when === 'draft' ? 'ghost' : 'primary'} icon={when === 'draft' ? undefined : CalendarDays} loading={saving || state?.status === 'running' || state?.status === 'queued'} onClick={() => void save()} className="w-full">
        {verb}
      </Btn>
      {state?.status === 'failed' && state.failed?.error && <p className="text-[12px] leading-snug text-fail">{state.failed.error}</p>}
      {Object.values(state?.outputs ?? {}).flatMap((v) => v.warnings ?? []).map((w) => (
        <p key={w} className="text-[11.5px] leading-snug text-warn">{w}</p>
      ))}
      {Object.values(state?.outputs ?? {}).map((v) => v.note).filter(Boolean).map((n) => (
        <p key={n} className="text-[11.5px] leading-snug text-muted">{n}</p>
      ))}
      {post && (
        <div className="space-y-2.5 border-t border-line pt-3">
          <div className="flex items-center gap-2 text-[12.5px]">
            {post.account && <PlatformIcon id={post.account.platform} className="size-3.5" />}
            {post.account && <span>@{post.account.handle}</span>}
            <span className="ml-auto capitalize text-muted">{post.status}</span>
          </div>
          {post.scheduled_at && <p className="text-[12px] text-muted">{post.status === 'published' ? 'Was due' : 'Goes out'} {new Date(post.scheduled_at).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}{post.device ? ` from ${post.device}` : ''}</p>}
          {post.published_at && <p className="text-[12px] text-ok">Published {new Date(post.published_at).toLocaleString()}</p>}
          {post.error && <p className="text-[12px] text-fail">{post.error}</p>}
          {post.run && (
            <div className="space-y-1.5">
              <p className="text-[11.5px] text-dim">
                The phone’s run: {post.run.outcome}, {post.run.steps} steps{post.run.attempt > 1 ? `, attempt ${post.run.attempt}` : ''}
                {post.run.note ? ` · ${post.run.note}` : ''}
              </p>
              {post.run.screenshot_url && (
                <a href={post.run.screenshot_url} target="_blank" rel="noreferrer">
                  <img src={post.run.screenshot_url} alt="The screen it ended on: the proof" className="w-full rounded-md border border-line" />
                </a>
              )}
            </div>
          )}
          {post.metrics && (
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {(['views', 'likes', 'comments', 'shares', 'saves'] as const).filter((k) => post.metrics?.[k] != null).map((k) => (
                <div key={k} className="rounded-md bg-white/[0.04] py-1.5">
                  <p className="font-mono text-[13px]">{post.metrics?.[k]}</p>
                  <p className="text-[10px] text-dim">{k}</p>
                </div>
              ))}
            </div>
          )}
          {post.metrics?.latest_comments?.slice(0, 3).map((c, i) => (
            <p key={i} className="text-[11.5px] leading-snug text-muted">
              <span className="text-dim">{c.author}: </span>
              {c.text}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            {post.post_url && (
              <a href={post.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent-soft hover:underline">
                See it live <ExternalLink className="size-3" />
              </a>
            )}
            <Link to="/dashboard/calendar" className="text-[12px] text-muted hover:text-fg">
              In the calendar
            </Link>
            <Link to="/dashboard/publishing" className="text-[12px] text-muted hover:text-fg">
              Publishing runs
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}
