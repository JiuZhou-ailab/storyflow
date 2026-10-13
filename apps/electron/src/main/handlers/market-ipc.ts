// input: Skills and MCP market clients, the signed-in auth service, and a fetch implementation
// output: Catalog list, detail, download, and publish IPC
// pos: Main-process market boundary so renderer tokens never leave the shell

import { ipcMain } from 'electron'
import type { SkillMarketPublishInput } from '@craft-agent/shared/skills/marketplace'
import { MCP_MARKET_IPC_CHANNELS, SKILLS_MARKET_IPC_CHANNELS } from '../../shared/types'
import type { ClientAuthService } from '../client-auth'
import {
  downloadSkillFromMarket,
  getSkillDetailFromMarket,
  publishSkillToMarket,
} from '../skills-market-client'
import { listMcpServersFromMarket } from '../mcp-market-client'

type MarketFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface MarketIpcDeps {
  catalog: { load(): Promise<unknown>; invalidate(): void }
  authService: ClientAuthService
  getToken: () => Promise<string | undefined>
  fetchImpl: MarketFetch
}

export function registerMarketIpc(deps: MarketIpcDeps): void {
  const { catalog, authService, getToken, fetchImpl } = deps
  ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.LIST, () => catalog.load())
  ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.DETAIL, async (_event, skillSlug: string) => {
    return getSkillDetailFromMarket(skillSlug, {
      token: await getToken(),
      fetchImpl,
    })
  })
  ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.DOWNLOAD, async (_event, input) => {
    return downloadSkillFromMarket(input, {
      token: await getToken(),
      fetchImpl,
    })
  })
  ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.PUBLISH, async (_event, input: SkillMarketPublishInput) => {
    const user = authService.getState().user
    if (!user) throw new Error('Sign in before publishing a Skill')
    const token = await authService.issueSkillsMarketAccessToken()
    const result = await publishSkillToMarket(input, {
      author: { name: user.name ?? user.email ?? user.userId },
      token,
      fetchImpl,
    })
    catalog.invalidate()
    return result
  })
  ipcMain.handle(MCP_MARKET_IPC_CHANNELS.LIST, async (_event, search: string) => {
    return listMcpServersFromMarket(typeof search === 'string' ? search : '', {
      fetchImpl,
    })
  })
}
