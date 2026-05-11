// input: Novel workspace file descriptors and translation function
// output: User-facing writing document labels with path tooltips preserved
// pos: Shared display adapter between storage paths and writing UI labels

import type { TFunction } from 'i18next'
import {
  describeNovelWorkspaceFile,
  getNovelWorkspaceRelativePath,
  type NovelWorkspaceFile,
} from '@/lib/writing-workspace'

export function formatNovelWorkspaceFileTitle(file: NovelWorkspaceFile, t: TFunction): string {
  const descriptor = describeNovelWorkspaceFile(file)
  if (!descriptor.labelKey) return descriptor.fallbackTitle

  return String(t(descriptor.labelKey, {
    ...descriptor.labelParams,
    defaultValue: descriptor.fallbackTitle,
  }))
}

export function formatNovelWorkspacePathTitle(path: string, rootPath: string, t: TFunction): string {
  const relativePath = rootPath ? getNovelWorkspaceRelativePath(path, rootPath) : path
  const descriptor = describeNovelWorkspaceFile(relativePath)
  if (!descriptor.labelKey) return descriptor.fallbackTitle

  return String(t(descriptor.labelKey, {
    ...descriptor.labelParams,
    defaultValue: descriptor.fallbackTitle,
  }))
}
