import { useState } from 'react'
import { Check } from 'lucide-react'
import { api, ApiError, type Account, type AccountSound, type SoundCatalog } from '../../lib/api'
import { useApi, useInvalidate } from '../data'
import { AccentPicker, MoodPicker, VoicePicker } from '../sound/pickers'
import { useToast } from '../toast'
import { Btn, Label } from '../ui'

/**
 * How an account sounds: the voice it speaks in, its pace, its signature music, and the accent
 * its reels wear. Voiceovers, flows and reels for the account start from here.
 */
export function AccountSoundForm({ account, onSaved }: { account: Account; onSaved?: (s: AccountSound) => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data: catalog } = useApi<SoundCatalog>('/sound')
  const [sound, setSound] = useState<AccountSound>(account.sound)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(sound) !== JSON.stringify(account.sound)

  const save = async () => {
    setSaving(true)
    try {
      const out = await api<AccountSound>(`/accounts/${account.id}/sound`, { method: 'PUT', body: sound })
      invalidate()
      onSaved?.(out)
      toast(`@${account.handle} has its sound.`)
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t save it.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!catalog) return <div className="skeleton h-64 rounded-lg" />
  if (!catalog.available) return <p className="text-[12.5px] text-dim">{catalog.reason}</p>

  return (
    <div className="space-y-6">
      <div>
        <Label>Voice</Label>
        <p className="mt-1 text-[11.5px] text-dim">Every voiceover and talking reel for @{account.handle} is read in this voice. Press play to hear one.</p>
        <VoicePicker voices={catalog.voices} value={sound.voice} onChange={(voice) => setSound((s) => ({ ...s, voice }))} className="mt-3" />
      </div>
      <label className="block">
        <span className="flex items-center justify-between">
          <Label>Pace</Label>
          <span className="font-mono text-[10.5px] text-dim">{sound.speed.toFixed(2)}×</span>
        </span>
        <input type="range" min={0.8} max={1.25} step={0.05} value={sound.speed} onChange={(e) => setSound((s) => ({ ...s, speed: Number(e.target.value) }))} className="mt-2 w-full accent-[var(--color-accent)]" />
      </label>
      <div>
        <Label>Signature music</Label>
        <p className="mt-1 text-[11.5px] text-dim">The mood its tracks are composed in: a new original each time, always recognisably its own.</p>
        <MoodPicker moods={catalog.moods} value={sound.mood} onChange={(mood) => setSound((s) => ({ ...s, mood }))} className="mt-3" />
      </div>
      <div>
        <Label>Reel accent</Label>
        <div className="mt-2">
          <AccentPicker value={sound.accent} onChange={(accent) => setSound((s) => ({ ...s, accent }))} />
        </div>
      </div>
      <div className="flex justify-end border-t border-line pt-4">
        <Btn variant="primary" icon={Check} loading={saving} disabled={!dirty} onClick={save}>
          Save the sound
        </Btn>
      </div>
    </div>
  )
}
