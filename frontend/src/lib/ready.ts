import { createContext, useContext, useEffect, useState } from 'react'
import { useEntryDelay } from './router'

/** Flips to true once the preloader has lifted, so the hero can start its entrance. */
export const ReadyContext = createContext(false)
export const useReady = () => useContext(ReadyContext)

/** For pages without the preloader (legal pages, the 404): ready once the curtain starts to lift. */
export function useArrival() {
  const entry = useEntryDelay()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), entry * 1000)
    return () => window.clearTimeout(t)
  }, [entry])
  return ready
}
