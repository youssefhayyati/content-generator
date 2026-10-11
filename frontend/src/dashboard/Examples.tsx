import { ArrowRight, Wand2 } from 'lucide-react'
import { PlatformIcon } from '../components/ui/PlatformIcon'
import { CASES, KIND_LABEL, type Case } from '../showcase/cases'
import { Clip, Picture } from '../showcase/pieces'
import { cn } from '../lib/cn'
import { useRouter } from '../lib/router'
import { Btn, Modal } from './ui'

/**
 * The showcase inside the studio: real FlowAI output for demo brands, each one a place to start.
 * Picking one hands its brief (or prompt) to the page that opened the sheet.
 */
export function Examples({
  open,
  onClose,
  only,
  action,
  describe = (c) => c.brief,
  onUse,
}: {
  open: boolean
  onClose: () => void
  /** Which cases suit the page: those with a caption brief for the Composer, a prompt for a generator. */
  only: (c: Case) => boolean
  action: string
  /** The words each card shows: what using it will fill in. */
  describe?: (c: Case) => string
  onUse: (c: Case) => void
}) {
  const { navigate } = useRouter()
  const list = CASES.filter(only)
  return (
    <Modal open={open} onClose={onClose} title="Start from an example" wide>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-muted">
          Made with FlowAI for demo brands, from the brief on each card. Pick one to fill it in here, then change it to fit you.
        </p>
        <button
          type="button"
          onClick={() => {
            onClose()
            navigate('/dashboard/showcase')
          }}
          className="flex items-center gap-1 text-[12.5px] text-dim transition-colors hover:text-fg"
        >
          The full showcase <ArrowRight className="size-3.5" />
        </button>
      </div>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => (
          <li key={c.id} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition-colors duration-300 hover:border-line-2">
            <Thumb c={c} />
            <div className="flex flex-1 flex-col p-3.5">
              <p className="flex items-center gap-1.5 text-[11.5px] text-dim">
                <span className="truncate">{c.brand.name}</span>
                <span>·</span>
                <span>{KIND_LABEL[c.kind]}</span>
                <span className="ml-auto flex gap-1">
                  {c.versions?.map((v) => <PlatformIcon key={v.platform} id={v.platform} className="size-3" />)}
                </span>
              </p>
              <p className="mt-1 text-[13.5px] font-medium leading-snug">{c.title}</p>
              <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-snug text-muted">{describe(c)}</p>
              <Btn size="sm" variant="primary" icon={Wand2} onClick={() => onUse(c)} className="mt-3 self-start">
                {action}
              </Btn>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function Thumb({ c }: { c: Case }) {
  const shot = c.shots?.[0]
  const box = 'relative aspect-[16/10] w-full overflow-hidden bg-panel-3'
  if (c.video)
    return (
      <div className={box}>
        <Clip c={c} className="size-full object-cover" />
      </div>
    )
  if (shot)
    return (
      <div className={box}>
        <Picture shot={shot} size="sm" className={cn('size-full object-cover transition-transform duration-700 ease-expo group-hover:scale-[1.03]')} />
      </div>
    )
  const v = c.versions?.[0]
  return (
    <div className={cn(box, 'p-3.5')}>
      <p className="line-clamp-5 whitespace-pre-line text-[12px] leading-snug text-fg/80">{v?.text}</p>
      <span className="absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-panel-3 to-transparent" />
    </div>
  )
}
