export const NUTRITION_IMAGE_MAX_DIMENSION = 1280
export const NUTRITION_IMAGE_QUALITY = 0.82

export interface NutritionImageDimensions {
  width: number
  height: number
}

export function fitNutritionImageDimensions(
  width: number,
  height: number,
  maxDimension = NUTRITION_IMAGE_MAX_DIMENSION,
): NutritionImageDimensions {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

interface DecodedNutritionImage {
  source: CanvasImageSource
  width: number
  height: number
  cleanup: () => void
}

async function decodeWithImageBitmap(image: Blob): Promise<DecodedNutritionImage> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    cleanup: () => bitmap.close(),
  }
}

function decodeWithImageElement(image: Blob): Promise<DecodedNutritionImage> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(image)
    const element = new Image()
    element.decoding = 'async'
    element.onload = () => resolve({
      source: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    })
    element.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image decode failed'))
    }
    element.src = objectUrl
  })
}

async function decodeNutritionImage(image: Blob): Promise<DecodedNutritionImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await decodeWithImageBitmap(image)
    } catch {
      // Older Safari versions can reject ImageBitmapOptions. The image element path
      // still applies the browser's EXIF orientation handling.
    }
  }
  return decodeWithImageElement(image)
}

function encodeCanvas(canvas: HTMLCanvasElement, contentType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, contentType, quality))
}

function getOptimizedContentType(contentType: string): 'image/jpeg' | 'image/webp' {
  return contentType.toLowerCase() === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
}

/**
 * Shrinks food photos before Storage upload. Any unsupported browser API, EXIF
 * decode issue, canvas allocation failure, or encoder failure returns the original
 * image so scanning remains available.
 */
export async function optimizeNutritionImageForUpload(
  image: Blob,
  maxDimension = NUTRITION_IMAGE_MAX_DIMENSION,
  quality = NUTRITION_IMAGE_QUALITY,
): Promise<Blob> {
  if (
    typeof document === 'undefined'
    || typeof Image === 'undefined'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    return image
  }

  let decoded: DecodedNutritionImage | null = null
  try {
    decoded = await decodeNutritionImage(image)
    const target = fitNutritionImageDimensions(decoded.width, decoded.height, maxDimension)
    if (!target.width || !target.height) return image
    if (target.width === decoded.width && target.height === decoded.height) return image

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) return image

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(decoded.source, 0, 0, target.width, target.height)

    const optimized = await encodeCanvas(
      canvas,
      getOptimizedContentType(image.type),
      Math.min(1, Math.max(0.1, quality)),
    )
    if (!optimized || optimized.size <= 0) return image
    if (!['image/jpeg', 'image/webp'].includes(optimized.type.toLowerCase())) return image
    return optimized
  } catch {
    return image
  } finally {
    decoded?.cleanup()
  }
}
