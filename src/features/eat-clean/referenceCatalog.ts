/**
 * Curated combo packages shown alongside the live Eat Clean menu.
 *
 * These entries are intentionally presentation-only. Ordering still goes
 * through the live Aura meal catalog so price, stock and delivery rules stay
 * canonical in the existing quote/cart flow.
 */
export type EatCleanPackageGroup = 'weekly' | 'prepared' | 'drinks' | 'snacks'

export interface EatCleanPackage {
  readonly id: string
  readonly name: string
  readonly group: EatCleanPackageGroup
  readonly description: string
  readonly price: number
  readonly unitLabel: string
  readonly imagePath?: string
  readonly nutritionNote?: string
  readonly caution?: string
  readonly weeklyPlan?: {
    readonly days: number
    readonly meals: readonly ('breakfast' | 'lunch' | 'dinner')[]
  }
}

export const EAT_CLEAN_PACKAGE_IMAGE_BY_GROUP: Record<EatCleanPackageGroup, string> = {
  weekly: '/images/eat-clean/reference/combo-weekly.webp',
  prepared: '/images/eat-clean/reference/combo-prepared.webp',
  drinks: '/images/eat-clean/reference/combo-drinks.webp',
  snacks: '/images/eat-clean/reference/combo-snacks.webp',
}

export const EAT_CLEAN_PACKAGE_GROUPS: ReadonlyArray<{ id: EatCleanPackageGroup | 'all'; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'weekly', label: 'Combo tuần' },
  { id: 'prepared', label: 'Món chuẩn bị sẵn' },
  { id: 'drinks', label: 'Đồ uống' },
  { id: 'snacks', label: 'Ăn nhẹ' },
]

export const EAT_CLEAN_PACKAGES: readonly EatCleanPackage[] = [
  {
    id: 'aura-weekly-dual', name: 'Combo 2 bữa / tuần', group: 'weekly',
    description: 'Bữa trưa và tối luân phiên cho năm ngày gọn nhẹ.',
    price: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    nutritionNote: 'Khoảng 1.100–1.200 kcal/ngày · 2 bữa.',
  },
  {
    id: 'aura-weekly-full', name: 'Combo đủ ngày', group: 'weekly',
    description: 'Ba bữa sáng, trưa và tối cho lịch ăn trọn vẹn trong tuần.',
    price: 825000, unitLabel: '5 ngày / 15 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'lunch', 'dinner'] },
    nutritionNote: 'Khoảng 1.300–1.500 kcal/ngày · 3 bữa.',
  },
  {
    id: 'aura-weekly-morning-noon', name: 'Combo sáng – trưa', group: 'weekly',
    description: 'Hai bữa đầu ngày, phù hợp lịch làm việc bận rộn.',
    price: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'lunch'] },
    nutritionNote: 'Khoảng 1.000–1.100 kcal/ngày · 2 bữa.',
  },
  {
    id: 'aura-weekly-morning-evening', name: 'Combo sáng – tối', group: 'weekly',
    description: 'Bữa sáng và tối linh hoạt cho ngày có lịch trưa riêng.',
    price: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'dinner'] },
    nutritionNote: 'Khoảng 1.000–1.100 kcal/ngày · 2 bữa.',
  },
  {
    id: 'aura-weekly-protein', name: 'Combo đạm cao', group: 'weekly',
    description: 'Tăng phần đạm và rau cho tuần tập luyện đều.',
    price: 950000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    nutritionNote: 'Khoảng 1.500–1.800 kcal/ngày · 2 bữa.',
  },
  {
    id: 'aura-weekly-protein-full', name: 'Combo đạm cao đủ ngày', group: 'weekly',
    description: 'Ba bữa mỗi ngày với khẩu phần đạm cao hơn.',
    price: 1225000, unitLabel: '5 ngày / 15 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'lunch', 'dinner'] },
    nutritionNote: 'Khoảng 1.800–2.100 kcal/ngày · 3 bữa.',
  },
  {
    id: 'aura-weekly-low-carb', name: 'Combo ít tinh bột', group: 'weekly',
    description: 'Bữa trưa và tối nhiều rau, tiết chế tinh bột.',
    price: 600000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    nutritionNote: 'Khoảng 300–400 kcal/phần ăn.',
  },
  {
    id: 'aura-weekly-plant', name: 'Combo thực vật', group: 'weekly',
    description: 'Hai bữa mỗi ngày từ rau củ, đậu và hạt đa dạng.',
    price: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    caution: 'Có thể chứa đậu nành, mè và các loại hạt.',
  },
  {
    id: 'aura-weekly-lunch', name: 'Combo trưa tiện lợi', group: 'weekly',
    description: 'Một bữa trưa mới mỗi ngày từ thứ hai đến thứ sáu.',
    price: 375000, unitLabel: '5 ngày / 5 bữa',
    weeklyPlan: { days: 5, meals: ['lunch'] },
  },
  {
    id: 'aura-prepared-chicken', name: 'Combo ức gà chuẩn bị sẵn', group: 'prepared',
    description: 'Nhiều phần ức gà đã sơ chế, tiện chia cho cả tuần.',
    price: 370000, unitLabel: '10 túi / 150 g mỗi túi',
  },
  {
    id: 'aura-prepared-rice', name: 'Combo cơm gạo lứt', group: 'prepared',
    description: 'Các phần cơm gạo lứt đóng sẵn cho bữa nhanh tại nhà.',
    price: 119000, unitLabel: '5 gói / 200 g mỗi gói',
  },
  {
    id: 'aura-drinks-nut', name: 'Set sữa hạt', group: 'drinks',
    description: 'Năm chai sữa hạt với hương vị luân phiên trong tuần.',
    price: 125000, unitLabel: '5 chai / 300 ml mỗi chai',
    caution: 'Có thể chứa đậu phộng, mè và đậu nành.',
  },
  {
    id: 'aura-drinks-juice', name: 'Set nước ép', group: 'drinks',
    description: 'Năm chai nước ép trái cây dùng kèm các bữa trong tuần.',
    price: 125000, unitLabel: '5 chai / 250 ml mỗi chai',
  },
  {
    id: 'aura-snacks-rice', name: 'Set gạo lứt rong biển', group: 'snacks',
    description: 'Thanh gạo lứt giòn nhẹ với rong biển và các loại hạt.',
    price: 100000, unitLabel: '1 hộp / 200 g',
    caution: 'Có thể chứa hạt điều, hạnh nhân và đường nâu.',
  },
  {
    id: 'aura-snacks-biscotti', name: 'Set biscotti nguyên cám', group: 'snacks',
    description: 'Bánh nướng giòn từ bột nguyên cám, hạnh nhân và hạt.',
    price: 100000, unitLabel: '1 hộp / 200 g',
    caution: 'Có bột mì và các loại hạt.',
  },
]

function searchKey(value: string) {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim()
}

export function filterEatCleanPackages(group: EatCleanPackageGroup | 'all', query: string) {
  const key = searchKey(query)
  return EAT_CLEAN_PACKAGES.filter((product) => (
    (group === 'all' || product.group === group)
    && (!key || searchKey([product.name, product.description, product.unitLabel].join(' ')).includes(key))
  ))
}

export function packageImagePath(product: EatCleanPackage): string {
  return product.imagePath || EAT_CLEAN_PACKAGE_IMAGE_BY_GROUP[product.group]
}

export function packagePricePerMeal(product: EatCleanPackage): number | undefined {
  const plan = product.weeklyPlan
  if (!plan || plan.days <= 0 || plan.meals.length === 0) return undefined
  return Math.round(product.price / (plan.days * plan.meals.length) / 100) * 100
}
