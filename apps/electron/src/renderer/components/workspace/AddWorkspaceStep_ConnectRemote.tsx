// input: Existing remote project identity, replacement credentials, and reconnect callback
// output: Form for restoring an existing remote project connection
// pos: Recovery-only surface; normal project creation is local-folder-only

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, CheckCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspacePrimaryButton, AddWorkspaceSecondaryButton } from "./primitives"

interface AddWorkspaceStep_ConnectRemoteProps {
  onBack: () => void
  isCreating: boolean
  initialUrl?: string
  initialToken?: string
  reconnectWorkspace: { id: string; name: string; remoteWorkspaceId: string }
  onUpdate: (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => Promise<void>
  className?: string
  embedded?: boolean
}

/** Restore an existing remote project's connection. */
export function AddWorkspaceStep_ConnectRemote({
  onBack,
  isCreating,
  initialUrl,
  initialToken,
  reconnectWorkspace,
  onUpdate,
  className,
  embedded = false,
}: AddWorkspaceStep_ConnectRemoteProps) {
  const { t } = useTranslation()
  const [serverUrl, setServerUrl] = useState(initialUrl ?? '')
  const [token, setToken] = useState(initialToken ?? '')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [serverVersion, setServerVersion] = useState<string | null>(null)

  const resetTestResult = () => {
    setTestState('idle')
    setTestError(null)
    setServerVersion(null)
  }

  const handleTestConnection = useCallback(async () => {
    if (!serverUrl || !token) return
    setTestState('testing')
    setTestError(null)
    try {
      const result = await window.electronAPI.testRemoteConnection(serverUrl, token)
      console.log('[ConnectRemote] testRemoteConnection result:', JSON.stringify(result, null, 2))
      if (result.ok) {
        setTestState('ok')
        setServerVersion(result.serverVersion ?? null)
      } else {
        setTestState('error')
        setTestError(result.error || 'Connection failed')
      }
    } catch (err) {
      setTestState('error')
      setTestError(err instanceof Error ? err.message : 'Connection failed')
    }
  }, [serverUrl, token])

  const handleReconnect = useCallback(async () => {
    if (!serverUrl || !token || testState !== 'ok') return
    try {
      await onUpdate(reconnectWorkspace.id, {
        url: serverUrl,
        token,
        remoteWorkspaceId: reconnectWorkspace.remoteWorkspaceId,
      })
    } catch (err) {
      setTestState('error')
      setTestError(err instanceof Error ? err.message : 'Failed to reconnect workspace')
    }
  }, [onUpdate, reconnectWorkspace, serverUrl, testState, token])

  return (
    <AddWorkspaceContainer embedded={embedded} className={className}>
      {!embedded ? (
        <>
          <button
            onClick={onBack}
            disabled={isCreating}
            className={cn(
              "self-start flex items-center gap-1 text-sm text-muted-foreground",
              "hover:text-foreground transition-colors mb-4",
              isCreating && "opacity-50 cursor-not-allowed"
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <AddWorkspaceStepHeader
            title={t("workspace.reconnect", { name: reconnectWorkspace.name })}
            description="Update the server URL or token to restore the connection."
          />
        </>
      ) : null}

      <div className={cn("w-full space-y-5", embedded ? "mt-0" : "mt-6")}>
        {/* Server URL */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Server URL
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={serverUrl}
              onChange={(e) => {
                setServerUrl(e.target.value)
                resetTestResult()
              }}
              placeholder="ws://192.168.1.100:9100"
              disabled={isCreating}
              autoFocus
              className="border-0 bg-transparent shadow-none font-mono text-sm"
            />
          </div>
        </div>

        {/* Token */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Token
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                resetTestResult()
              }}
              placeholder={t("workspace.serverAuthToken")}
              disabled={isCreating}
              className="border-0 bg-transparent shadow-none"
            />
          </div>
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-3">
          <AddWorkspaceSecondaryButton
            onClick={handleTestConnection}
            disabled={!serverUrl || !token || testState === 'testing' || isCreating}
          >
            {testState === 'testing' ? 'Testing...' : 'Test Connection'}
          </AddWorkspaceSecondaryButton>
          {testState === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle className="h-3.5 w-3.5" />
              Connected{serverVersion ? ` — v${serverVersion}` : ''}
            </span>
          )}
          {testState === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" />
              {testError || 'Failed'}
            </span>
          )}
        </div>

        {/* Old server warning */}
        {testState === 'ok' && !serverVersion && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-700 dark:text-yellow-400">
            <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{t("workspace.olderServerWarning")}</span>
          </div>
        )}

        <AddWorkspacePrimaryButton
          onClick={handleReconnect}
          disabled={testState !== 'ok' || isCreating}
          loading={isCreating}
          loadingText="Reconnecting..."
        >
          Reconnect
        </AddWorkspacePrimaryButton>
      </div>
    </AddWorkspaceContainer>
  )
}
