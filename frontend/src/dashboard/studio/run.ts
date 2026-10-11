import { api, apiStream, ApiError, type Generation } from '../../lib/api'

export function messageFor(e: unknown) {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again.'
  if (e.status === 403) return 'Confirm your email address to use AI generation.'
  if (e.status === 429) return 'That’s a lot in a short time. Give it a minute.'
  if (e.status === 422) return Object.values(e.errors)[0]?.[0] ?? e.message
  return e.message
}

/**
 * Write text with a model, streamed. Calls back with the text so far; resolves with the
 * generation's id (kept whether it worked or not), or throws with a message to show.
 */
export async function runText(body: { prompt: string; model?: string | null; project_id?: number | null; retry_of?: number | null }, onText?: (text: string) => void, signal?: AbortSignal) {
  let id: number | null = null
  let out = ''
  let failure: string | null = null
  let done = false
  await apiStream(
    '/generations/text',
    body,
    ({ event, data }) => {
      const d = data as { id?: number; text?: string; message?: string }
      if (event === 'start') id = d.id ?? null
      else if (event === 'delta') onText?.((out += d.text ?? ''))
      else if (event === 'done') done = true
      else if (event === 'error') failure = d.message ?? 'The model stopped.'
    },
    signal,
  )
  if (!done) throw new ApiError(0, failure ?? 'The connection dropped before it finished. Try again.')
  return id
}

export const runMedia = (body: { kind: 'image' | 'video'; model?: string | null; prompt: string; params?: Record<string, unknown>; input_asset_ids?: number[]; project_id?: number | null }) =>
  api<Generation>('/generations', { method: 'POST', body })

/** Retry a generation: as it was, on another model, or with an edited prompt. */
export async function retryGeneration(g: Generation, change: { model?: string; prompt?: string }) {
  if (g.kind === 'text') {
    await runText({ prompt: change.prompt ?? g.prompt, model: change.model ?? g.model, project_id: g.project_id, retry_of: g.id })
    return
  }
  await api<Generation>(`/generations/${g.id}/retry`, { method: 'POST', body: change })
}
