/**
 * Public product facts, not Aura inventory or a supplier integration.
 * Keep these separate from EatCleanMeal: a weekly plan is not one delivery or
 * one nutrition-log entry, and Fitfood's prices are not Aura's selling prices.
 */
export type EatCleanReferenceGroup = 'weekly' | 'prepared' | 'drinks' | 'snacks'

export interface EatCleanReferenceProduct {
  readonly id: string
  readonly name: string
  readonly group: EatCleanReferenceGroup
  readonly description: string
  readonly referencePrice: number
  readonly unitLabel: string
  readonly sourceUrl: string
  /** Local Aura image used for illustration; never a supplier-hosted image. */
  readonly imagePath?: string
  readonly nutritionNote?: string
  readonly caution?: string
  readonly weeklyPlan?: {
    readonly days: number
    readonly meals: readonly ('breakfast' | 'lunch' | 'dinner')[]
  }
}

export const FITFOOD_REFERENCE_SOURCE = {
  name: 'Fitfood VN',
  checkedOn: '2026-10-14',
  websiteUrl: 'https://fitfood.vn/',
  menuUrl: 'https://fitfood.vn/menu',
} as const

export const EAT_CLEAN_REFERENCE_IMAGE_BY_GROUP: Record<EatCleanReferenceGroup, string> = {
  weekly: '/images/eat-clean/reference/combo-weekly.webp',
  prepared: '/images/eat-clean/reference/combo-prepared.webp',
  drinks: '/images/eat-clean/reference/combo-drinks.webp',
  snacks: '/images/eat-clean/reference/combo-snacks.webp',
}

export const EAT_CLEAN_REFERENCE_GROUPS: ReadonlyArray<{ id: EatCleanReferenceGroup | 'all'; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'weekly', label: 'Gói tuần' },
  { id: 'prepared', label: 'Chế biến sẵn' },
  { id: 'drinks', label: 'Đồ uống' },
  { id: 'snacks', label: 'Ăn nhẹ' },
]

export const FITFOOD_REFERENCE_PRODUCTS: readonly EatCleanReferenceProduct[] = [
  {
    id: 'fitfood-fit3', name: 'Gói FIT 3', group: 'weekly',
    description: 'Hai bữa trưa và tối theo thực đơn luân phiên, từ thứ 2 đến thứ 6.',
    referencePrice: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    nutritionNote: '1.100–1.200 kcal/ngày cho hai bữa, theo Fitfood.',
    sourceUrl: 'https://fitfood.vn/san-pham/fit3',
  },
  {
    id: 'fitfood-full', name: 'Gói FULL', group: 'weekly',
    description: 'Ba bữa sáng, trưa và tối cho năm ngày trong tuần.',
    referencePrice: 825000, unitLabel: '5 ngày / 15 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'lunch', 'dinner'] },
    nutritionNote: '1.300–1.500 kcal/ngày cho ba bữa, theo Fitfood.',
    sourceUrl: 'https://fitfood.vn/san-pham/full',
  },
  {
    id: 'fitfood-fit1', name: 'Gói FIT 1', group: 'weekly',
    description: 'Hai bữa sáng và trưa; bữa tối do bạn tự lựa chọn.',
    referencePrice: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'lunch'] },
    nutritionNote: '1.000–1.100 kcal/ngày cho hai bữa, theo Fitfood.',
    sourceUrl: 'https://fitfood.vn/san-pham/fit1',
  },
  {
    id: 'fitfood-fit2', name: 'Gói FIT 2', group: 'weekly',
    description: 'Hai bữa sáng và tối; linh hoạt cho người có lịch ăn trưa riêng.',
    referencePrice: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'dinner'] },
    nutritionNote: '1.000–1.100 kcal/ngày cho hai bữa, theo Fitfood.',
    sourceUrl: 'https://fitfood.vn/san-pham/fit2',
  },
  {
    id: 'fitfood-meat', name: 'Gói MEAT', group: 'weekly',
    description: 'Hai bữa trưa và tối, tăng 1,5 lần định lượng thịt và rau so với gói thường.',
    referencePrice: 950000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    nutritionNote: '1.500–1.800 kcal/ngày cho hai bữa, theo Fitfood.',
    sourceUrl: 'https://fitfood.vn/san-pham/meat',
  },
  {
    id: 'fitfood-meat-s', name: 'Gói MEAT-S', group: 'weekly',
    description: 'Bữa sáng khẩu phần thường, kèm hai bữa trưa và tối tăng định lượng đạm.',
    referencePrice: 1225000, unitLabel: '5 ngày / 15 bữa',
    weeklyPlan: { days: 5, meals: ['breakfast', 'lunch', 'dinner'] },
    nutritionNote: '1.800–2.100 kcal/ngày cho ba bữa, theo Fitfood.',
    sourceUrl: 'https://fitfood.vn/san-pham/meat-s',
  },
  {
    id: 'fitfood-slim', name: 'Gói SLIM', group: 'weekly',
    description: 'Hai bữa trưa và tối, hạn chế tinh bột và tăng lượng rau.',
    referencePrice: 600000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    nutritionNote: '300–400 kcal/phần ăn, theo Fitfood; không phải kcal cả ngày.',
    sourceUrl: 'https://fitfood.vn/san-pham/slim',
  },
  {
    id: 'fitfood-veg', name: 'Gói CHAY', group: 'weekly',
    description: 'Hai bữa chay mỗi ngày, thay đổi theo thực đơn trong tuần.',
    referencePrice: 650000, unitLabel: '5 ngày / 10 bữa',
    weeklyPlan: { days: 5, meals: ['lunch', 'dinner'] },
    nutritionNote: '1.000–1.100 kcal/ngày cho hai bữa, theo Fitfood.',
    caution: 'Fitfood ghi rõ gói này không thuần chay 100%.',
    sourceUrl: 'https://fitfood.vn/san-pham/veg',
  },
  {
    id: 'fitfood-lunch', name: 'Gói LUNCH', group: 'weekly',
    description: 'Một bữa trưa giao nóng mỗi ngày, từ thứ 2 đến thứ 6.',
    referencePrice: 375000, unitLabel: '5 ngày / 5 bữa',
    weeklyPlan: { days: 5, meals: ['lunch'] },
    caution: 'Fitfood chỉ giao gói này tại một số khu vực TP.HCM, theo khung trưa cố định.',
    sourceUrl: 'https://fitfood.vn/san-pham/lunch-eatclean',
  },
  {
    id: 'fitfood-chicken-150', name: 'Ức gà ăn liền 150 g', group: 'prepared',
    description: 'Set 10 túi ức gà chế biến sẵn, mỗi túi 150 g.',
    referencePrice: 370000, unitLabel: '10 túi / 150 g mỗi túi',
    nutritionNote: 'Mỗi 100 g: 120 kcal, 24 g đạm, 0,7 g carb, 2,5 g chất béo (Fitfood công bố).',
    caution: 'Giá lấy từ trang chi tiết; khu vực gợi ý trên website có thể hiển thị giá khác.',
    sourceUrl: 'https://fitfood.vn/san-pham/10-goi-uc-ga-an-lien-150gr',
  },
  {
    id: 'fitfood-brown-rice', name: 'Cơm gạo lứt ăn liền', group: 'prepared',
    description: 'Set 5 gói cơm, mỗi gói 200 g, gồm các vị truyền thống, rong biển và cá mặn.',
    referencePrice: 119000, unitLabel: '5 gói / 200 g mỗi gói',
    caution: 'Có vị cá mặn; không mặc định là sản phẩm chay. Chỉ số dinh dưỡng cần đối chiếu lại với nhãn.',
    sourceUrl: 'https://fitfood.vn/san-pham/05-goi-com-gao-luc-an-lien',
  },
  {
    id: 'fitfood-nut-milk', name: 'Sữa hạt Fitfood', group: 'drinks',
    description: 'Set 5 chai sữa hạt với các hương vị luân phiên trong tuần.',
    referencePrice: 125000, unitLabel: '5 chai / 300 ml mỗi chai',
    caution: 'Có các vị đậu phộng, mè và đậu nành; cần kiểm tra thành phần nếu có dị ứng.',
    sourceUrl: 'https://fitfood.vn/san-pham/fitfood-sua-hat-moi',
  },
  {
    id: 'fitfood-juice', name: 'Juice Fitfood', group: 'drinks',
    description: 'Set 5 chai nước ép trái cây, giao kèm phần ăn trong tuần.',
    referencePrice: 125000, unitLabel: '5 chai / 250 ml mỗi chai',
    sourceUrl: 'https://fitfood.vn/san-pham/fitfood-juice-moi',
  },
  {
    id: 'fitfood-seaweed-snack', name: 'Gạo lứt rong biển', group: 'snacks',
    description: 'Thanh gạo lứt kết hợp rong biển và các loại hạt.',
    referencePrice: 100000, unitLabel: '1 hộp / 200 g',
    caution: 'Thành phần công bố có hạt điều, hạnh nhân và đường nâu.',
    sourceUrl: 'https://fitfood.vn/san-pham/gao-lut-rong-bien',
  },
  {
    id: 'fitfood-biscotti', name: 'Biscotti vị truyền thống', group: 'snacks',
    description: 'Bánh nướng hai lần từ bột nguyên cám, hạnh nhân và các loại hạt.',
    referencePrice: 100000, unitLabel: '1 hộp / 200 g',
    nutritionNote: 'Mỗi 100 g: 412 kcal, 16 g đạm, 50 g carb, 14,2 g chất béo (Fitfood công bố).',
    caution: 'Có bột mì và hạt cây; kiểm tra nhãn dị ứng trước khi dùng.',
    sourceUrl: 'https://fitfood.vn/san-pham/biscotti-vi-truyen-thong',
  },
]

function searchKey(value: string) {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim()
}

export function filterEatCleanReferenceProducts(group: EatCleanReferenceGroup | 'all', query: string) {
  const key = searchKey(query)
  return FITFOOD_REFERENCE_PRODUCTS.filter((product) => (
    (group === 'all' || product.group === group)
    && (!key || searchKey([product.name, product.description, product.unitLabel].join(' ')).includes(key))
  ))
}

export function referenceImagePath(product: EatCleanReferenceProduct): string {
  return product.imagePath || EAT_CLEAN_REFERENCE_IMAGE_BY_GROUP[product.group]
}

/** Arithmetic comparison only; not a per-meal selling price or shipping quote. */
export function referencePricePerMeal(product: EatCleanReferenceProduct): number | undefined {
  const plan = product.weeklyPlan
  if (!plan || plan.days <= 0 || plan.meals.length === 0) return undefined
  return Math.round(product.referencePrice / (plan.days * plan.meals.length) / 100) * 100
}
