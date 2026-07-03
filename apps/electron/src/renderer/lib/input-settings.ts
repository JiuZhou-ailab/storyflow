// input: Renderer electronAPI input-setting IPC methods
// output: Small loaders for chat input settings
// pos: Shared renderer access point for input preferences used by chat UI

let pendingSendMessageKey: Promise<'enter' | 'cmd-enter' | null> | null = null

export async function loadSendMessageKeySetting(): Promise<'enter' | 'cmd-enter'> {
  pendingSendMessageKey ??= window.electronAPI.getSendMessageKey()
    .finally(() => {
      pendingSendMessageKey = null
    })

  return (await pendingSendMessageKey) ?? 'enter'
}
