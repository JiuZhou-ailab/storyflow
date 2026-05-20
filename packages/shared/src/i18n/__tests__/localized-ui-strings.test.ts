import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

describe('localized shared UI strings', () => {
  it('has Chinese labels for common fallback controls', () => {
    const i18n = setupI18n()
    i18n.changeLanguage('zh-Hans')

    expect(i18n.t('common.select')).toBe('选择...')
    expect(i18n.t('common.noResultsFound')).toBe('未找到结果')
  })

  it('has Chinese labels for app menu navigation and crash fallback', () => {
    const i18n = setupI18n()
    i18n.changeLanguage('zh-Hans')

    expect(i18n.t('menu.helpAutomations')).toBe('自动化')
    expect(i18n.t('errors.somethingWentWrong')).toBe('出错了')
    expect(i18n.t('errors.restartAppReported')).toBe('请重启应用。错误已被报告。')
  })
})
