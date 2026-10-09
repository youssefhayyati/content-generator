import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, AudioLines, Clapperboard, Copy, Dices, Ear, FileText, LoaderCircle, Mic, Music2, PenLine, Sparkles, Wand2 } from 'lucide-react'
import { api, ApiError, type Account, type Asset, type AssetWords, type Generation, type ModelInfo, type SoundCatalog } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useApi, useInvalidate } from '../data'
import { Dropzone, MediaPicker, MediaThumb, useMediaUpload } from '../media/Media'
import { GenerationCard, useGenerations } from '../studio/parts'
import { messageFor, retryGeneration } from '../studio/run'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Panel, Segmented, Skeleton } from '../ui'
import { Dictate } from './Dictate'
import { MoodPicker, VoicePicker } from './pickers'
import { Player } from './Player'

type Mode = 'voice' | 'music' | 'listen'

/**
 * The Sound tab: a voiceover from a script (typed, dictated or written for you), an original
 * track in a mood, or a recording listened to and turned into words, then posts.
 */
export function SoundStudio({ models }: { models: ModelInfo[] }) {
  const { search, navigate } = useRouter()
  const params = new URLSearchParams(search)
  const [mode, setMode] = useState<Mode>((params.get('mode') as Mode) || 'voice')
  const { data: catalog } = useApi<SoundCatalog>('/sound')
  const { data: accounts } = useApi<Account[]>('/accounts')

  const pick = (m: Mode) => {
    setMode(m)
    navigate(`/dashboard/studio?tab=sound${m === 'voice' ? '' : `&mode=${m}`}`, { replace: true })
  }

  if (!catalog) return <Skeleton className="h-[480px] rounded-xl" />
  if (!catalog.available)
    return (
      <EmptyState
        icon={AudioLines}
        title="FlowAI Sound isn’t running"
        body={`${catalog.reason ?? ''} It makes the voices, the music and the transcripts, right here on your server.`}
      />
    )

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[440px_minmax(0,1fr)]">
      <Panel
        title={{ voice: 'Voiceover', music: 'Music', listen: 'Listen' }[mode]}
        sub={{ voice: 'Natural voices in seven languages, every word timed for captions.', music: 'An original track for every post: yours, licence-free, never the same twice.', listen: 'A podcast, a voice memo, a video: its words, timed, then posts.' }[mode]}
        className="lg:sticky lg:top-20"
      >
        <Segmented
          id="sound-mode"
          label="Make"
          value={mode}
          onChange={pick}
          options={[
            { value: 'voice', label: <><Mic className="size-3.5" /> Voice</> },
            { value: 'music', label: <><Music2 className="size-3.5" /> Music</> },
            { value: 'listen', label: <><Ear className="size-3.5" /> Listen</> },
          ]}
          className="mb-5 w-fit"
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={mode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
            {mode === 'voice' && <VoiceForm catalog={catalog} accounts={accounts ?? []} />}
            {mode === 'music' && <MusicForm catalog={catalog} accounts={accounts ?? []} />}
            {mode === 'listen' && <ListenForm accounts={accounts ?? []} initial={params.get('asset') ? Number(params.get('asset')) : null} />}
          </motion.div>
        </AnimatePresence>
      </Panel>

      {mode === 'listen' ? <ListenHint /> : <Feed models={models} kinds={mode === 'voice' ? 'voice' : 'music'} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Voice                                                               */
/* ------------------------------------------------------------------ */

function AccountSelect({ accounts, value, onChange, none = 'No account' }: { accounts: Account[]; value: number | null; onChange: (a: Account | null) => void; none?: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(accounts.find((a) => a.id === Number(e.target.value)) ?? null)} className={cn(inputClass, 'mt-2')}>
      <option value="">{none}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  )
}

function VoiceForm({ catalog, accounts }: { catalog: SoundCatalog; accounts: Account[] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [account, setAccount] = useState<Account | null>(null)
  const [voice, setVoice] = useState<string>(catalog.voices[0]?.id ?? 'af_heart')
  const [speed, setSpeed] = useState(1)
  const [script, setScript] = useState('')
  const [brief, setBrief] = useState('')
  const [seconds, setSeconds] = useState(30)
  const [writing, setWriting] = useState(false)
  const [briefing, setBriefing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const words = script.trim() ? script.trim().split(/\s+/).length : 0

  const chooseAccount = (a: Account | null) => {
    setAccount(a)
    if (a) {
      setVoice(a.sound.voice)
      setSpeed(a.sound.speed)
    }
  }

  const write = async () => {
    if (brief.trim().length < 4) return setError('Say what the voiceover is about.')
    setWriting(true)
    setError(null)
    try {
      const out = await api<{ script: string; title: string }>('/sound/script', { method: 'POST', body: { brief, seconds, account_id: account?.id, language: catalog.voices.find((v) => v.id === voice)?.language } })
      setScript(out.script)
      setBriefing(false)
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setWriting(false)
    }
  }

  const go = async () => {
    if (!script.trim()) return setError('Write what the voice should say, or have it written for you.')
    setBusy(true)
    setError(null)
    try {
      await api('/generations', { method: 'POST', body: { kind: 'voice', prompt: script.trim(), params: { voice, speed }, account_id: account?.id } })
      invalidate()
      toast('Recording. It shows up on the right in a few seconds.')
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <label className="block">
        <Label>For</Label>
        <AccountSelect accounts={accounts} value={account?.id ?? null} onChange={chooseAccount} none="No account: pick a voice below" />
      </label>

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>Script</Label>
          <span className="flex items-center gap-1.5">
            <Dictate onText={(t) => setScript((s) => (s.trim() ? `${s.trim()} ${t}` : t))} />
            <Btn size="sm" variant="subtle" icon={Wand2} onClick={() => setBriefing((b) => !b)}>
              Write it for me
            </Btn>
          </span>
        </div>
        <AnimatePresence initial={false}>
          {briefing && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
              <div className="mt-2 space-y-2 rounded-lg border border-accent-soft/25 bg-accent/[0.05] p-3">
                <input value={brief} onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && write()} placeholder="Why our candles burn for fifty hours" className={inputClass} autoFocus />
                <div className="flex items-center justify-between gap-2">
                  <Segmented id="script-len" label="Length" value={seconds} onChange={setSeconds} options={[15, 30, 60].map((v) => ({ value: v, label: `${v} s` }))} />
                  <Btn size="sm" variant="primary" icon={Sparkles} loading={writing} onClick={write}>
                    Write
                  </Btn>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <textarea
          value={script}
          onChange={(e) => {
            setScript(e.target.value)
            setError(null)
          }}
          rows={6}
          placeholder="Most candles burn for twenty hours. Ours burn for fifty. The difference is time…"
          className={cn(inputClass, 'mt-2 h-auto resize-y py-2.5 leading-relaxed')}
        />
        <p className="mt-1 text-right font-mono text-[10px] text-dim">
          {words} words · about {Math.max(1, Math.round(words / 3 / speed))} s
        </p>
      </div>

      <div>
        <Label>Voice</Label>
        <VoicePicker voices={catalog.voices} value={voice} onChange={setVoice} className="mt-2" />
      </div>

      <label className="block">
        <span className="flex items-center justify-between">
          <Label>Pace</Label>
          <span className="font-mono text-[10.5px] text-dim">{speed.toFixed(2)}×</span>
        </span>
        <input type="range" min={0.8} max={1.3} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
      </label>

      <FieldError message={error} />
      <Btn variant="primary" icon={AudioLines} onClick={go} loading={busy} className="w-full">
        Read it aloud
      </Btn>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Music                                                               */
/* ------------------------------------------------------------------ */

function MusicForm({ catalog, accounts }: { catalog: SoundCatalog; accounts: Account[] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [mood, setMood] = useState(catalog.moods[0]?.id ?? 'golden-hour')
  const [seconds, setSeconds] = useState(30)
  const [energy, setEnergy] = useState(0.6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signature = accounts.filter((a) => a.sound.mood === mood)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const label = catalog.moods.find((m) => m.id === mood)?.label ?? mood
      await api('/generations', { method: 'POST', body: { kind: 'music', prompt: label, params: { mood, seconds, energy } } })
      invalidate()
      toast('Composing. A couple of seconds.')
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Label>Mood</Label>
        <MoodPicker moods={catalog.moods} value={mood} onChange={setMood} className="mt-2" />
        {signature.length > 0 && <p className="mt-2 text-[11px] text-dim">The signature sound of {signature.map((a) => `@${a.handle}`).join(', ')}.</p>}
      </div>
      <div>
        <Label>Length</Label>
        <Segmented id="music-len" label="Length" value={seconds} onChange={setSeconds} options={[15, 30, 60, 90].map((v) => ({ value: v, label: `${v} s` }))} className="mt-2 w-fit" />
      </div>
      <label className="block">
        <span className="flex items-center justify-between">
          <Label>Energy</Label>
          <span className="font-mono text-[10.5px] text-dim">{energy < 0.35 ? 'Calm' : energy < 0.7 ? 'Easy' : 'Lively'}</span>
        </span>
        <input type="range" min={0} max={1} step={0.05} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
      </label>
      <FieldError message={error} />
      <Btn variant="primary" icon={Music2} onClick={go} loading={busy} className="w-full">
        Compose
      </Btn>
      <p className="text-[11px] leading-snug text-dim">Every track is written and played here, from scratch: no samples, no library, nothing to license. Same mood, new track, every time.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The voiceovers and tracks made so far                               */
/* ------------------------------------------------------------------ */

function Feed({ models, kinds }: { models: ModelInfo[]; kinds: 'voice' | 'music' }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data: feed, loading } = useGenerations({ kinds })

  const again = async (g: Generation) => {
    try {
      const { seed: _seed, ...params } = g.params as Record<string, string | number>
      await api('/generations', { method: 'POST', body: { kind: 'music', prompt: g.prompt, params } })
      invalidate()
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  if (!feed && loading) return <Skeleton className="h-[200px] rounded-xl" />
  if (feed && !feed.length)
    return (
      <EmptyState
        icon={kinds === 'voice' ? Mic : Music2}
        title={kinds === 'voice' ? 'No voiceovers yet' : 'No music yet'}
        body={kinds === 'voice' ? 'Write a script, pick a voice, and it reads it, every word timed for captions.' : 'Pick a mood and compose: a new, original track every time.'}
      />
    )
  return (
    <div className="space-y-3">
      {feed?.map((g) => (
        <GenerationCard
          key={g.id}
          generation={g}
          models={models}
          onRetry={async (x, change) => {
            await retryGeneration(x, change)
            invalidate()
          }}
          actions={
            g.status === 'succeeded' && g.outputs[0] ? (
              <>
                <Btn size="sm" variant="subtle" icon={Clapperboard} onClick={() => navigate(`/dashboard/studio?tab=reels&${g.kind === 'music' ? 'music' : 'audio'}=${g.outputs[0].id}`)}>
                  Make a reel
                </Btn>
                {g.kind === 'music' && (
                  <Btn size="sm" variant="subtle" icon={Dices} onClick={() => again(g)}>
                    Another take
                  </Btn>
                )}
              </>
            ) : null
          }
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Listen                                                              */
/* ------------------------------------------------------------------ */

function ListenForm({ accounts, initial }: { accounts: Account[]; initial: number | null }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { navigate } = useRouter()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  const [words, setWords] = useState<AssetWords | null>(null)
  const [account, setAccount] = useState<Account | null>(accounts[0] ?? null)
  const [count, setCount] = useState(4)
  const [making, setMaking] = useState(false)
  const [made, setMade] = useState<Array<{ id: number; title: string; body: string; quote: string }>>([])
  const { upload, progress } = useMediaUpload((added) => added[0] && choose(added[0]))

  // Opened from the library with a sound already chosen.
  useEffect(() => {
    if (!initial) return
    api<{ data: Asset[] }>('/assets', { query: { ids: String(initial) } }).then((r) => r.data[0] && choose(r.data[0])).catch(() => {})
    // Once, for the asset in the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  useEffect(() => {
    if (!account && accounts[0]) setAccount(accounts[0])
  }, [accounts, account])

  // While it's listening, ask now and then how it's going.
  useEffect(() => {
    if (!asset || words?.status !== 'running') return
    const t = window.setTimeout(() => refresh(asset), 2500)
    return () => window.clearTimeout(t)
  })

  function refresh(a: Asset) {
    api<AssetWords>(`/assets/${a.id}/words`).then(setWords).catch(() => {})
  }

  function choose(a: Asset) {
    setAsset(a)
    setMade([])
    setWords(null)
    refresh(a)
  }

  const listen = async () => {
    if (!asset) return
    try {
      await api(`/assets/${asset.id}/transcribe`, { method: 'POST' })
      setWords((w) => ({ ...(w ?? { words: [], text: null, segments: [], language: null, error: null }), status: 'running' }))
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  const posts = async () => {
    if (!asset || !account) return
    setMaking(true)
    try {
      const out = await api<{ posts: typeof made }>(`/assets/${asset.id}/posts`, { method: 'POST', body: { account_id: account.id, count } })
      setMade(out.posts)
      invalidate()
      toast(`${out.posts.length} drafts in the Library, waiting for you to look.`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t write the posts.', 'error')
    } finally {
      setMaking(false)
    }
  }

  return (
    <div className="space-y-4">
      {!asset ? (
        <>
          <Dropzone onFiles={upload} progress={progress} compact />
          <Btn variant="subtle" size="sm" onClick={() => setPicking(true)}>
            Or pick from the library
          </Btn>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {asset.kind === 'video' ? <MediaThumb asset={asset} className="size-12" /> : null}
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{asset.name}</p>
            <Btn size="sm" variant="subtle" onClick={() => setAsset(null)}>
              Change
            </Btn>
          </div>
          {asset.kind === 'audio' && <Player asset={{ ...asset, sound: { ...(asset.sound ?? { type: 'audio' }), timed: words?.status === 'done' } }} key={`${asset.id}-${words?.status}`} />}
        </div>
      )}
      <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => a[0] && choose(a[0])} max={1} kinds={['audio', 'video']} title="Pick a sound or a video" />

      {asset && words?.status !== 'done' && (
        <Btn variant="primary" icon={words?.status === 'running' ? undefined : Ear} loading={words?.status === 'running'} onClick={listen} className="w-full">
          {words?.status === 'running' ? 'Listening…' : words?.status === 'failed' ? 'Try listening again' : 'Listen to it'}
        </Btn>
      )}
      {words?.status === 'failed' && <p className="text-[12px] text-fail">{words.error}</p>}

      {words?.status === 'done' && (
        <div className="space-y-4">
          <div className="max-h-[220px] overflow-y-auto rounded-lg border border-line bg-white/[0.02] p-3 font-serif text-[16px] italic leading-relaxed" data-lenis-prevent>
            {words.text}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Btn size="sm" variant="subtle" icon={Copy} onClick={() => navigator.clipboard?.writeText(words.text ?? '').then(() => toast('Copied.'))}>
              Copy
            </Btn>
            {asset?.kind === 'audio' && (
              <Btn size="sm" variant="subtle" icon={Clapperboard} onClick={() => navigate(`/dashboard/studio?tab=reels&audio=${asset.id}`)}>
                Make a reel
              </Btn>
            )}
          </div>
          <div className="rounded-lg border border-accent-soft/25 bg-accent/[0.04] p-3">
            <p className="flex items-center gap-2 text-[13px] font-medium">
              <FileText className="size-4 text-accent-soft" /> Turn it into posts
            </p>
            <p className="mt-0.5 text-[11.5px] text-dim">The moments worth sharing, one post each, in the account’s voice. Drafts only: you schedule them.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[180px] flex-1">
                <AccountSelect accounts={accounts} value={account?.id ?? null} onChange={setAccount} none="Pick an account" />
              </div>
              <Segmented id="post-count" label="How many" value={count} onChange={setCount} options={[2, 4, 6].map((v) => ({ value: v, label: String(v) }))} className="mt-2" />
              <Btn variant="primary" size="sm" icon={PenLine} loading={making} disabled={!account} onClick={posts} className="mt-2">
                Write
              </Btn>
            </div>
            <AnimatePresence>
              {made.length > 0 && (
                <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 space-y-1.5">
                  {made.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => navigate(`/dashboard/create?post=${p.id}`)} className="group w-full rounded-md border border-line bg-panel px-3 py-2 text-left hover:border-line-2">
                        <span className="flex items-center justify-between gap-2 text-[12.5px] font-medium">
                          {p.title}
                          <ArrowRight className="size-3.5 text-dim transition-transform group-hover:translate-x-0.5" />
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[11.5px] text-dim">{p.body}</span>
                      </button>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
      {words?.status === 'running' && (
        <p className="flex items-center gap-2 text-[12px] text-dim">
          <LoaderCircle className="size-3.5 animate-spin" /> About a third of its length. You can leave; it carries on.
        </p>
      )}
    </div>
  )
}

function ListenHint() {
  return (
    <div className="rounded-xl border border-line bg-panel p-6">
      <p className="font-serif text-[22px] italic leading-snug">One recording, a week of posts.</p>
      <p className="mt-2 max-w-[52ch] text-[13px] leading-snug text-dim">
        Drop in a podcast episode, a talk, a voice memo from a walk, or a video. It’s listened to on this server — nothing leaves it — and every word comes back with its timing. Then the moments worth sharing become drafts in the account’s voice, and any of it becomes a reel with captions that follow the speech.
      </p>
    </div>
  )
}
