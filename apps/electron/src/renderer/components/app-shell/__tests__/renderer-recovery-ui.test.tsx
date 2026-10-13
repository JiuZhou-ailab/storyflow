import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectFolderRow } from '../ActivityRailRows'

it('renders a retryable list error instead of an empty session list', () => {
  const props = {
    workspace: { id: 'a', slug: 'a', name: 'A', rootPath: '/tmp/a', createdAt: 0 },
    active: false, hasUnread: false, disabled: false, expandable: true, expanded: true,
    sessions: [], onRetrySessions() {},
  }
  const failed = renderToStaticMarkup(<ProjectFolderRow {...props} sessionsFailed />)
  expect(failed).toContain('role="alert"')
  expect(failed).toContain('sessions.load.failed')
  expect(failed).toContain('common.retry')
  const retrying = renderToStaticMarkup(<ProjectFolderRow {...props} sessionsFailed loadingSessions />)
  expect(retrying).toContain('disabled=""')
  const empty = renderToStaticMarkup(<ProjectFolderRow {...props} />)
  expect(empty).not.toContain('role="alert"')
})
