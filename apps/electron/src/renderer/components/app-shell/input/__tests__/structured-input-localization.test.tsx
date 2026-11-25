import { expect, it } from 'bun:test'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { StructuredInput } from '../StructuredInput'

it.each([
  {
    language: 'zh-Hans',
    buttons: ['允许', '全部允许', '拒绝', '批准', '取消', '保存'],
    remember: '记住 15 分钟',
    installBeforeAppName: '安装 ',
    installAfterAppName: ' 需要你的 Mac 管理员批准。',
    systemPrompt: '你会看到常规的 macOS 密码或触控 ID 提示。',
    reasonLabel: '原因：',
    impactLabel: '影响：',
    credentialTitle: '需要身份验证',
    encryptionNote: '凭据以加密形式存储',
  },
  {
    language: 'en',
    buttons: ['Allow', 'Allow All', 'Deny', 'Approve', 'Cancel', 'Save'],
    remember: 'Remember for 15 min',
    installBeforeAppName: 'Installing ',
    installAfterAppName: ' needs your Mac admin approval.',
    systemPrompt: 'You’ll see your regular macOS password/Touch ID prompt.',
    reasonLabel: 'Why:',
    impactLabel: 'Impact:',
    credentialTitle: 'Authentication Required',
    encryptionNote: 'Credentials are encrypted at rest',
  },
] as const)('renders confirmation copy in $language', async ({
  language, buttons, remember, installBeforeAppName, installAfterAppName, systemPrompt,
  reasonLabel, impactLabel, credentialTitle, encryptionNote,
}) => {
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
          data: {
            appName: 'Sample <App>',
            reason: 'Install Sample',
            impact: 'Adds a local command',
            command: 'install-sample',
            rememberForMinutes: 15,
            requiresSystemPrompt: true,
          },
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
  expect(html).toContain(
    `>${installBeforeAppName}<span class="font-medium text-foreground">Sample &lt;App&gt;</span>${installAfterAppName} ${systemPrompt}<br/>`,
  )
  expect(html).toContain(`>${reasonLabel}</span> Install Sample`)
  expect(html).toContain(`>${impactLabel}</span> Adds a local command`)
  expect(html).toContain(`>${credentialTitle}</span>`)
  expect(html).toContain(`>${encryptionNote}</span>`)
})
