// input: Attachment bytes, a session-owned directory, its write-path validator, and platform image services
// output: Immutable original storage, derived representations, and transient model-input bytes
// pos: Provider-neutral attachment persistence beneath RPC and session boundaries

import { createHash } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { AttachmentRepresentation, StoredAttachment } from '@craft-agent/core/types'
import type { FileAttachment, StoreAttachmentResult } from '@craft-agent/shared/protocol'
import { IMAGE_LIMITS, MAX_ATTACHMENT_BYTES, validateImageForClaudeAPI } from '@craft-agent/shared/utils'
import { MarkItDown } from 'markitdown-js'
import type { ImageProcessor, Logger } from '../runtime/platform'
import { inspectImageBuffer, resizeImageForAPI } from './image-utils'

function representation(
  kind: AttachmentRepresentation['kind'],
  path: string,
  mimeType: string,
  content: Uint8Array,
  generator?: string,
): AttachmentRepresentation {
  return {
    kind,
    path,
    mimeType,
    size: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
    generator,
  }
}

export async function storeAttachmentFiles(args: {
  attachment: FileAttachment
  attachmentsDir: string
  id: string
  safeName: string
  validateWritePath: (path: string) => Promise<string>
  imageProcessor: ImageProcessor
  logger: Logger
}): Promise<StoreAttachmentResult> {
  const { attachment, attachmentsDir, id, safeName, validateWritePath, imageProcessor, logger } = args
  if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0) {
    throw new Error('Attachment size must be a positive integer')
  }
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit`)
  }
  if (attachment.base64 !== undefined && typeof attachment.base64 !== 'string') {
    throw new Error('Attachment base64 content must be a string')
  }
  if (attachment.text !== undefined && typeof attachment.text !== 'string') {
    throw new Error('Attachment text content must be a string')
  }
  if (attachment.base64 && attachment.base64.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) {
    throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit`)
  }
  if (attachment.text && Buffer.byteLength(attachment.text, 'utf8') > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit`)
  }
  const filesToCleanup: string[] = []
  const representations: AttachmentRepresentation[] = []
  const storedPath = await validateWritePath(join(attachmentsDir, `${id}_${safeName}`))

  try {
    const original: Buffer | null = attachment.base64
      ? Buffer.from(attachment.base64, 'base64')
      : attachment.text
        ? Buffer.from(attachment.text, 'utf8')
        : null
    if (!original) {
      throw new Error('Attachment has no content (neither base64 nor text)')
    }
    if (original.length !== attachment.size) {
      throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${original.length})`)
    }

    await writeFile(storedPath, original)
    filesToCleanup.push(storedPath)
    representations.push(representation('original', storedPath, attachment.mimeType, original))

    let modelInput: Buffer = original
    let modelInputMimeType = attachment.mimeType
    if (attachment.type === 'image') {
      const imageInspection = await inspectImageBuffer(original, imageProcessor)
      const imageSize = imageInspection.status === 'ok'
        ? { width: imageInspection.width, height: imageInspection.height }
        : null
      let shouldResize = false
      let targetSize: { width: number; height: number } | undefined

      if (imageInspection.status === 'processor_unavailable') {
        logger.warn('Image processing unavailable while validating attachment:', imageInspection.error?.message ?? 'unknown error')
        if (original.length > IMAGE_LIMITS.MAX_SIZE) {
          throw new Error('Image processing is unavailable, so oversized images cannot be validated or resized automatically. Please attach a smaller image.')
        }
      } else if (imageInspection.status === 'invalid_image') {
        throw new Error(imageInspection.error?.message || 'Invalid or unsupported image file')
      } else {
        const validation = validateImageForClaudeAPI(original.length, imageSize!.width, imageSize!.height)
        shouldResize = validation.needsResize ?? false
        targetSize = validation.suggestedSize

        if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
          const scale = Math.min(
            IMAGE_LIMITS.MAX_DIMENSION / imageSize!.width,
            IMAGE_LIMITS.MAX_DIMENSION / imageSize!.height,
          )
          targetSize = {
            width: Math.floor(imageSize!.width * scale),
            height: Math.floor(imageSize!.height * scale),
          }
          shouldResize = true
        } else if (!validation.valid && validation.errorCode === 'size_exceeded') {
          shouldResize = true
        } else if (!validation.valid) {
          throw new Error(validation.error)
        }
      }

      if (shouldResize) {
        const isPhoto = attachment.mimeType === 'image/jpeg'
        if (targetSize) {
          const format = isPhoto ? 'jpeg' : 'png'
          modelInput = await imageProcessor.process(original, {
            resize: targetSize,
            format,
            quality: isPhoto ? IMAGE_LIMITS.JPEG_QUALITY_HIGH : undefined,
          })
          modelInputMimeType = `image/${format}`
          if (modelInput.length > IMAGE_LIMITS.MAX_SIZE) {
            modelInput = await imageProcessor.process(modelInput, {
              format: 'jpeg',
              quality: IMAGE_LIMITS.JPEG_QUALITY_FALLBACK,
            })
            modelInputMimeType = 'image/jpeg'
            if (modelInput.length > IMAGE_LIMITS.MAX_SIZE) {
              throw new Error(`Image still too large after resize (${(modelInput.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
            }
          }
        } else {
          const resized = await resizeImageForAPI(original, { isPhoto })
          if (!resized) {
            throw new Error(`Image too large (${(original.length / 1024 / 1024).toFixed(1)}MB) and could not be compressed enough. Please use a smaller image.`)
          }
          modelInput = resized.buffer
          modelInputMimeType = `image/${resized.format}`
        }

        const modelExtension = modelInputMimeType === 'image/jpeg' ? '.jpg' : '.png'
        const modelPath = await validateWritePath(join(attachmentsDir, `${id}_model${modelExtension}`))
        await writeFile(modelPath, modelInput)
        filesToCleanup.push(modelPath)
        representations.push(representation(
          'model-input',
          modelPath,
          modelInputMimeType,
          modelInput,
          'image-processor',
        ))
        logger.info(`Image model input derived: ${original.length} -> ${modelInput.length} bytes`)
      }
    }

    let thumbnailPath: string | undefined
    let thumbnailBase64: string | undefined
    const thumbTargetPath = join(attachmentsDir, `${id}_thumb.png`)
    try {
      const thumbnail = await imageProcessor.process(storedPath, {
        resize: { width: 200, height: 200 },
        format: 'png',
      })
      const thumbPath = await validateWritePath(thumbTargetPath)
      await writeFile(thumbPath, thumbnail)
      filesToCleanup.push(thumbPath)
      thumbnailPath = thumbPath
      thumbnailBase64 = thumbnail.toString('base64')
      representations.push(representation('thumbnail', thumbPath, 'image/png', thumbnail, 'image-processor'))
    } catch (error) {
      logger.info('Thumbnail generation failed (using fallback):', error instanceof Error ? error.message : error)
    }

    let markdownPath: string | undefined
    if (attachment.type === 'office' || attachment.type === 'pdf') {
      const markdownTargetPath = join(attachmentsDir, `${id}_${safeName}.md`)
      try {
        const result = await new MarkItDown().convert(storedPath)
        if (!result?.textContent) throw new Error('Conversion returned empty result')
        const markdown = Buffer.from(result.textContent, 'utf8')
        const markdownFilePath = await validateWritePath(markdownTargetPath)
        await writeFile(markdownFilePath, markdown)
        filesToCleanup.push(markdownFilePath)
        markdownPath = markdownFilePath
        representations.push(representation('markdown', markdownFilePath, 'text/markdown', markdown, 'markitdown-js'))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Document to Markdown conversion failed:', message)
        if (attachment.type === 'office') {
          throw new Error(`Failed to convert "${attachment.name}" to readable format: ${message}`)
        }
      }
    }

    const storedAttachment: StoredAttachment = {
      id,
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: original.length,
      storedPath,
      thumbnailPath,
      thumbnailBase64,
      markdownPath,
      representations,
    }
    return {
      attachment: storedAttachment,
      modelInputBase64: modelInput === original ? undefined : modelInput.toString('base64'),
      modelInputMimeType: modelInput === original ? undefined : modelInputMimeType,
    }
  } catch (error) {
    await Promise.all(filesToCleanup.map(path => unlink(path).catch(() => {})))
    throw error
  }
}
