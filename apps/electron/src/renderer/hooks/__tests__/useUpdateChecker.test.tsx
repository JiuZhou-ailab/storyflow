// input: Update checker provider and a renderer consumer
// output: Regression coverage for the application-wide update state boundary
// pos: Guards updater subscriptions from becoming route-scoped again

import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import {
  UpdateCheckerProvider,
  useUpdateChecker,
} from '../useUpdateChecker'

const testI18n = createInstance().use(initReactI18next)
await testI18n.init({
  lng: 'zh-Hans',
  keySeparator: false,
  resources: { 'zh-Hans': { translation: {} } },
})

function UpdateConsumer() {
  const updateChecker = useUpdateChecker()
  return <span>{updateChecker.updateInfo === null ? 'connected' : 'updated'}</span>
}

describe('application update state', () => {
  it('provides one shared update controller to renderer consumers', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={testI18n}>
        <UpdateCheckerProvider>
          <UpdateConsumer />
        </UpdateCheckerProvider>
      </I18nextProvider>,
    )

    expect(html).toContain('connected')
  })
})
