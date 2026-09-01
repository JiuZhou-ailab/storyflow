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

  it('uses locale-aware match count plurals', () => {
    const i18n = setupI18n()

    i18n.changeLanguage('en')
    expect(i18n.t('globalSearch.matchCount', { count: 1 })).toBe('1 match')
    expect(i18n.t('globalSearch.matchCount', { count: 2 })).toBe('2 matches')

    i18n.changeLanguage('pl')
    expect(i18n.t('globalSearch.matchCount', { count: 1 })).toBe('1 dopasowanie')
    expect(i18n.t('globalSearch.matchCount', { count: 2 })).toBe('2 dopasowania')
    expect(i18n.t('globalSearch.matchCount', { count: 5 })).toBe('5 dopasowań')
  })
})
