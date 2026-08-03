import type { LucideIcon } from 'lucide-react'
import {
  Apple,
  Beef,
  CakeSlice,
  Candy,
  Carrot,
  CookingPot,
  CupSoda,
  Dessert,
  Droplet,
  Egg,
  Fish,
  IceCreamBowl,
  Leaf,
  Milk,
  Nut,
  Package,
  Pizza,
  Salad,
  Shell,
  Soup,
  Utensils,
  Wheat,
} from 'lucide-react'
import '../styles-nutrition-visuals.css'

export type NutritionGroupKind = 'dish' | 'food'
export type NutritionGroupTone = 'green' | 'amber' | 'terracotta' | 'rose' | 'blue' | 'violet' | 'neutral'

interface NutritionGroupVisual {
  Icon: LucideIcon
  tone: NutritionGroupTone
  label: string
}

const FOOD_GROUP_VISUALS: Record<string, NutritionGroupVisual> = {
  'dầu, mỡ, bơ': { Icon: Droplet, tone: 'amber', label: 'Nhóm dầu, mỡ và bơ' },
  'đồ hộp': { Icon: Package, tone: 'neutral', label: 'Nhóm đồ hộp' },
  'đồ ngọt (đường, bánh, mứt, kẹo)': { Icon: Candy, tone: 'rose', label: 'Nhóm đồ ngọt' },
  'gia vị, nước chấm': { Icon: Soup, tone: 'terracotta', label: 'Nhóm gia vị và nước chấm' },
  'hạt, quả giàu đạm, béo và sản phẩm chế biến': { Icon: Nut, tone: 'amber', label: 'Nhóm hạt giàu đạm và chất béo' },
  'khoai củ và sản phẩm chế biến': { Icon: Carrot, tone: 'terracotta', label: 'Nhóm khoai củ' },
  'ngũ cốc và sản phẩm chế biến': { Icon: Wheat, tone: 'amber', label: 'Nhóm ngũ cốc' },
  'nước giải khát': { Icon: CupSoda, tone: 'blue', label: 'Nhóm nước giải khát' },
  'quả chín': { Icon: Apple, tone: 'rose', label: 'Nhóm quả chín' },
  'rau, quả, củ dùng làm rau': { Icon: Salad, tone: 'green', label: 'Nhóm rau củ' },
  'sữa và sản phẩm chế biến': { Icon: Milk, tone: 'violet', label: 'Nhóm sữa' },
  'thịt và sản phẩm chế biến': { Icon: Beef, tone: 'terracotta', label: 'Nhóm thịt' },
  'thủy sản và sản phẩm chế biến': { Icon: Fish, tone: 'blue', label: 'Nhóm thủy sản' },
  'thức ăn truyền thống': { Icon: CookingPot, tone: 'violet', label: 'Nhóm thức ăn truyền thống' },
  'trứng và sản phẩm chế biến': { Icon: Egg, tone: 'amber', label: 'Nhóm trứng' },
}

function normalizeCategory(value?: string | null) {
  return value?.normalize('NFC').trim().toLocaleLowerCase('vi') ?? ''
}

function resolveDishVisual(categoryName: string): NutritionGroupVisual {
  if (categoryName.includes('burger') || categoryName.includes('pizza')) return { Icon: Pizza, tone: 'terracotta', label: 'Nhóm burger và pizza' }
  if (categoryName.includes('trái cây')) return { Icon: Apple, tone: 'rose', label: 'Nhóm trái cây' }
  if (categoryName.includes('bánh, kẹo')) return { Icon: Candy, tone: 'rose', label: 'Nhóm bánh kẹo' }
  if (categoryName.includes('các loại bánh')) return { Icon: CakeSlice, tone: 'rose', label: 'Nhóm các loại bánh' }
  if (categoryName.includes('chè, caramen, kem')) return { Icon: IceCreamBowl, tone: 'rose', label: 'Nhóm món tráng miệng' }
  if (categoryName.includes('xôi, chè')) return { Icon: Dessert, tone: 'rose', label: 'Nhóm xôi chè' }
  if (categoryName.includes('giải khát')) return { Icon: CupSoda, tone: 'blue', label: 'Nhóm đồ giải khát' }
  if (categoryName.includes('ngao') || categoryName.includes('ốc')) return { Icon: Shell, tone: 'blue', label: 'Nhóm hải sản có vỏ' }
  if (categoryName.includes('canh') || categoryName.includes('bún') || categoryName.includes('phở')) return { Icon: Soup, tone: 'green', label: 'Nhóm món nước' }
  if (categoryName.includes('cơm') || categoryName.includes('cháo') || categoryName.includes('xôi')) return { Icon: CookingPot, tone: 'amber', label: 'Nhóm cơm, cháo và xôi' }
  if (categoryName.includes('món xào')) return { Icon: CookingPot, tone: 'terracotta', label: 'Nhóm món xào' }
  if (categoryName.includes('trứng') || categoryName.includes('sữa')) return { Icon: Egg, tone: 'violet', label: 'Nhóm trứng và sữa' }
  if (categoryName.includes('chế biến sẵn')) return { Icon: Package, tone: 'neutral', label: 'Nhóm món chế biến sẵn' }
  return { Icon: Utensils, tone: 'violet', label: 'Nhóm món ăn' }
}

export function getNutritionGroupVisual(categoryName?: string | null, kind: NutritionGroupKind = 'food') {
  const normalizedCategory = normalizeCategory(categoryName)
  if (kind === 'food') {
    return FOOD_GROUP_VISUALS[normalizedCategory]
      ?? { Icon: Leaf, tone: 'green' as const, label: normalizedCategory ? `Nhóm ${categoryName}` : 'Nhóm thực phẩm' }
  }
  return resolveDishVisual(normalizedCategory)
}

interface NutritionGroupIconProps {
  categoryName?: string | null
  kind?: NutritionGroupKind
  size?: number
  strokeWidth?: number
  className?: string
  ariaLabel?: string
}

export default function NutritionGroupIcon({
  categoryName,
  kind = 'food',
  size = 20,
  strokeWidth = 1.8,
  className = '',
  ariaLabel,
}: NutritionGroupIconProps) {
  const { Icon, tone } = getNutritionGroupVisual(categoryName, kind)
  return (
    <span
      className={`nutrition-group-icon ${className}`.trim()}
      data-food-tone={tone}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" />
    </span>
  )
}
