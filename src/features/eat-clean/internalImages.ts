/**
 * Images shipped with Aura. These are the only images the customer-facing
 * Eat Clean reference catalog should use; supplier pages are data sources,
 * never image hosts.
 */
export interface EatCleanInternalImage {
  readonly id: string
  readonly label: string
  readonly path: string
  readonly description: string
}

export const EAT_CLEAN_INTERNAL_IMAGES: readonly EatCleanInternalImage[] = [
  {
    id: 'hero-bowl',
    label: 'Bowl Eat Clean',
    path: '/images/eat-clean/hero-bowl.webp',
    description: 'Bowl cân bằng với rau củ và tinh bột chậm.',
  },
  {
    id: 'chicken-pepper',
    label: 'Ức gà rau củ',
    path: '/images/eat-clean/chicken-pepper.webp',
    description: 'Ức gà áp chảo cùng rau củ nhiều màu.',
  },
  {
    id: 'salmon-vegetables',
    label: 'Cá hồi rau củ',
    path: '/images/eat-clean/salmon-vegetables.webp',
    description: 'Cá hồi và rau củ nướng cho bữa ít tinh bột.',
  },
  {
    id: 'beef-egg-salad',
    label: 'Bò và salad',
    path: '/images/eat-clean/beef-egg-salad.webp',
    description: 'Đạm nạc, trứng và salad tươi.',
  },
] as const

const INTERNAL_IMAGE_PREFIX = '/images/eat-clean/'

export function isInternalEatCleanImage(value?: string): boolean {
  return Boolean(value && value.startsWith(INTERNAL_IMAGE_PREFIX))
}

export function defaultEatCleanImage(index = 0): string {
  return EAT_CLEAN_INTERNAL_IMAGES[index % EAT_CLEAN_INTERNAL_IMAGES.length]?.path ?? EAT_CLEAN_INTERNAL_IMAGES[0].path
}
