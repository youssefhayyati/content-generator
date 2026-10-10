import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, AudioWaveform, CalendarCheck, Mic, MicOff, Square } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useAssistant, useVoiceState } from './store'

const WORDS = { disconnected: 'Offline', connected: 'Ready', listening: 'Listening', hearing: 'Hearing you', thinking: 'Working on it', speaking: 'Speaking' }

/**
 * The conversation carries on while you look at other pages: this shows it's still there,
 * listening or working, and takes you back.
 */
export function AssistantDock() {
  const a = useAssistant()
  const { path, navigate } = useRouter()
  const voice = useVoiceState(a.link)
  const waiting = Object.values(a.approvals).filter((x) => x.status === 'waiting').length
  const busy = voice === 'thinking' || voice === 'speaking'
  const shown = path !== '/dashboard/assistant' && a.conn === 'online' && (a.micOn || busy || waiting > 0)

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.4, ease }}
          className="fixed bottom-4 left-4 z-[110] flex items-center gap-1 rounded-full border border-line-2 bg-panel-3/95 p-1 pl-3 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)] backdrop-blur lg:left-[252px]"
        >
          <AudioWaveform className={cn('size-3.5 text-accent-soft', busy && 'animate-pulse')} strokeWidth={2} />
          <span className="px-1.5 text-[12px]">{WORDS[voice]}</span>
          {waiting > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] text-accent-soft">
              <CalendarCheck className="size-3" /> {waiting} to approve
            </span>
          )}
          {busy && (
            <button type="button" onClick={a.interrupt} aria-label="Stop the assistant" className="grid size-7 place-items-center rounded-full text-muted hover:bg-white/[0.06] hover:text-fg">
              <Square className="size-2.5" fill="currentColor" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void a.toggleMic()}
            aria-label={a.micOn ? 'Stop the microphone' : 'Start talking'}
            className={cn('grid size-7 place-items-center rounded-full transition-colors', a.micOn ? 'bg-accent text-on-accent' : 'text-muted hover:bg-white/[0.06] hover:text-fg')}
          >
            {a.micOn ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
          </button>
          <button type="button" onClick={() => navigate('/dashboard/assistant')} aria-label="Open the assistant" className="grid size-7 place-items-center rounded-full text-muted hover:bg-white/[0.06] hover:text-fg">
            <ArrowUpRight className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
