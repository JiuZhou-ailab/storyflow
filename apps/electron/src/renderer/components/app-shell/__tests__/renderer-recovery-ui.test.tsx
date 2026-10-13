import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { ProjectFolderRow } from '../ActivityRailRows'

it('renders a retryable list error instead of an empty session list', () => {
  const i18n = createInstance()
  void i18n.init({ lng: 'test', resources: { test: { translation: {} } }, initAsync: false })
  const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
  const props = {
    workspace: { id: 'a', slug: 'a', name: 'A', rootPath: '/tmp/a', createdAt: 0 },
    active: false, hasUnread: false, disabled: false, expandable: true, expanded: true,
    sessions: [], onRetrySessions() {},
  }
  const failed = render(<ProjectFolderRow {...props} sessionsFailed />)
  expect(failed).toContain('role="alert"')
  expect(failed).toContain('sessions.load.failed')
  expect(failed).toContain('common.retry')
  const retrying = render(<ProjectFolderRow {...props} sessionsFailed loadingSessions />)
  expect(retrying).toContain('disabled=""')
  const empty = render(<ProjectFolderRow {...props} />)
  expect(empty).not.toContain('role="alert"')
})
