import { expect, it } from 'bun:test'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { StructuredInput } from '../StructuredInput'

it.each([
  { language: 'zh-Hans', buttons: ['允许', '全部允许', '拒绝', '批准', '取消', '保存'], remember: '记住 15 分钟' },
  { language: 'en', buttons: ['Allow', 'Allow All', 'Deny', 'Approve', 'Cancel', 'Save'], remember: 'Remember for 15 min' },
] as const)('renders confirmation actions in $language', async ({ language, buttons, remember }) => {
  const i18n = createInstance()
  await i18n.init({
    lng: language,
    resources: {
      [language]: { translation: LOCALE_REGISTRY[language].messages },
    },
  })

  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <StructuredInput
        state={{
          type: 'permission',
          data: {
            requestId: 'permission-1',
            sessionId: 'session-1',
            toolName: 'bash',
            description: '请求写入项目记忆',
            command: 'mkdir -p memory',
          },
        }}
        onResponse={() => {}}
      />
      <StructuredInput
        state={{
          type: 'admin_approval',
          data: { appName: 'Sample', reason: 'Install Sample', command: 'install-sample', rememberForMinutes: 15 },
        }}
        onResponse={() => {}}
      />
      <StructuredInput
        state={{
          type: 'credential',
          data: {
            type: 'credential',
            requestId: 'credential-1',
            sessionId: 'session-1',
            sourceSlug: 'sample',
            sourceName: 'Sample',
            mode: 'bearer',
          },
        }}
        onResponse={() => {}}
      />
    </I18nextProvider>,
  )

  for (const label of buttons) {
    expect(html).toContain(`>${label}</button>`)
  }
  expect(html).toContain(`>${remember}</label>`)
})
