import { useQueryParam } from '../../lib/router'
import { LabBrief, LabHome } from '../lab/Home'
import { LabView } from '../lab/LabView'

/**
 * /dashboard/studio, Creative Lab: every project is a canvas of nodes (lab/LabView). A project starts
 * with a few questions about the campaign (?brief=, its interview), from a campaign, or blank, and
 * the assistant can do all of it from the home page.
 */
export default function Studio() {
  const project = useQueryParam('project')
  const node = useQueryParam('node')
  const brief = useQueryParam('brief')
  if (project) return <LabView key={project} id={Number(project)} node={node} />
  if (brief) return <LabBrief key={brief} id={Number(brief)} />
  return <LabHome />
}
