// input: Persisted user profile and Pi user-level AGENTS.md content
// output: Compact autosaving AI context settings sections
// pos: Renderer settings component embedded in the unified AI page

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@craft-agent/ui'
import { MAX_SYSTEM_INSTRUCTIONS_CHARS } from '@craft-agent/shared/config/system-instructions-contract'
import { SettingsSection, SettingsTextarea } from '@/components/settings'

const SAVE_DEBOUNCE_MS = 500

export function AiContextSettings() {
  const { t } = useTranslation()
  const [userProfile, setUserProfile] = useState('')
  const [systemInstructions, setSystemInstructions] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const isInitialLoadRef = useRef(true)
  const userProfileRef = useRef(userProfile)
  const systemInstructionsRef = useRef(systemInstructions)
  const lastSavedUserProfileRef = useRef<string | null>(null)
  const lastSavedSystemInstructionsRef = useRef<string | null>(null)

  useEffect(() => {
    userProfileRef.current = userProfile
  }, [userProfile])

  useEffect(() => {
    systemInstructionsRef.current = systemInstructions
  }, [systemInstructions])

  useEffect(() => {
    let cancelled = false

    void Promise.allSettled([
      window.electronAPI.readUserProfile(),
      window.electronAPI.readSystemInstructions(),
    ])
      .then(([userProfileResult, systemInstructionsResult]) => {
        if (cancelled) return

        if (userProfileResult.status === 'fulfilled') {
          setUserProfile(userProfileResult.value.content)
          lastSavedUserProfileRef.current = userProfileResult.value.content
        } else {
          lastSavedUserProfileRef.current = ''
          console.error('Failed to load user profile:', userProfileResult.reason)
        }

        if (systemInstructionsResult.status === 'fulfilled') {
          setSystemInstructions(systemInstructionsResult.value.content)
          lastSavedSystemInstructionsRef.current = systemInstructionsResult.value.content
        } else {
          lastSavedSystemInstructionsRef.current = ''
          console.error('Failed to load system instructions:', systemInstructionsResult.reason)
        }
      })
      .finally(() => {
        if (cancelled) return

        isInitialLoadRef.current = false
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return
    if (lastSavedUserProfileRef.current === userProfile) return

    const timeout = setTimeout(() => {
      void window.electronAPI.writeUserProfile(userProfile)
        .then((result) => {
          if (result.success) {
            lastSavedUserProfileRef.current = userProfile
            return
          }
          console.error('Failed to save user profile:', result.error)
        })
        .catch((error) => {
          console.error('Failed to save user profile:', error)
        })
    }, SAVE_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [isLoading, userProfile])

  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return
    if (lastSavedSystemInstructionsRef.current === systemInstructions) return

    const timeout = setTimeout(() => {
      void window.electronAPI.writeSystemInstructions(systemInstructions)
        .then((result) => {
          if (result.success) {
            lastSavedSystemInstructionsRef.current = systemInstructions
            return
          }
          console.error('Failed to save system instructions:', result.error)
        })
        .catch((error) => {
          console.error('Failed to save system instructions:', error)
        })
    }, SAVE_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [isLoading, systemInstructions])

  useEffect(() => {
    return () => {
      const currentUserProfile = userProfileRef.current
      if (!isInitialLoadRef.current && lastSavedUserProfileRef.current !== currentUserProfile) {
        void window.electronAPI.writeUserProfile(currentUserProfile).catch((error) => {
          console.error('Failed to save user profile on unmount:', error)
        })
      }

      const currentSystemInstructions = systemInstructionsRef.current
      if (!isInitialLoadRef.current && lastSavedSystemInstructionsRef.current !== currentSystemInstructions) {
        void window.electronAPI.writeSystemInstructions(currentSystemInstructions).catch((error) => {
          console.error('Failed to save system instructions on unmount:', error)
        })
      }
    }
  }, [])

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="text-lg text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      <SettingsSection
        title={t('settings.preferences.userProfile')}
        description={t('settings.preferences.userProfileDesc')}
      >
        <SettingsTextarea
          value={userProfile}
          onChange={setUserProfile}
          placeholder={t('settings.preferences.userProfilePlaceholder')}
          rows={5}
        />
      </SettingsSection>

      <SettingsSection
        title={t('settings.preferences.systemInstructions')}
        description={t('settings.preferences.systemInstructionsDesc')}
      >
        <SettingsTextarea
          value={systemInstructions}
          onChange={setSystemInstructions}
          placeholder={t('settings.preferences.systemInstructionsPlaceholder')}
          maxLength={MAX_SYSTEM_INSTRUCTIONS_CHARS}
          rows={6}
        />
      </SettingsSection>
    </>
  )
}
