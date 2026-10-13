// input: The desktop client-auth service and Electron ipcMain
// output: Account IPC for sign-in, sign-up, email verification, Feishu, and sign-out
// pos: Main-process auth boundary; state broadcast stays with the shell that owns the windows

import { ipcMain } from 'electron'
import { CLIENT_AUTH_IPC_CHANNELS } from '../../shared/types'
import type { ClientAuthService } from '../client-auth'

export function registerClientAuthIpc(authService: ClientAuthService): void {
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.GET_STATE, () => authService.getState())
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_IN, async (_event, input: unknown) => {
    const record = input && typeof input === 'object'
      ? input as Record<string, unknown>
      : {}
    return authService.signIn({
      identifier: typeof record.identifier === 'string' ? record.identifier : '',
      password: typeof record.password === 'string' ? record.password : '',
    })
  })
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_UP, async (_event, input: unknown) => {
    const record = input && typeof input === 'object'
      ? input as Record<string, unknown>
      : {}
    return authService.signUp({
      identifier: typeof record.identifier === 'string' ? record.identifier : '',
      password: typeof record.password === 'string' ? record.password : '',
      name: typeof record.name === 'string' ? record.name : undefined,
    })
  })
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.VERIFY_EMAIL, async (_event, input: unknown) => {
    const record = input && typeof input === 'object'
      ? input as Record<string, unknown>
      : {}
    await authService.verifyEmailOtp({
      email: typeof record.email === 'string' ? record.email : '',
      otp: typeof record.otp === 'string' ? record.otp : '',
    })
  })
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.RESEND_VERIFICATION_EMAIL, async (_event, input: unknown) => {
    const record = input && typeof input === 'object'
      ? input as Record<string, unknown>
      : {}
    await authService.sendEmailVerificationOtp({
      email: typeof record.email === 'string' ? record.email : '',
    })
  })
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_IN_WITH_FEISHU, () => authService.signInWithFeishu())
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.CANCEL_FEISHU_SIGN_IN, () => {
    authService.cancelFeishuSignIn()
  })
  ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_OUT, () => authService.signOut())
}
