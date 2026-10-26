import type { NutritionFoodCatalogItem } from './types'

export const DEMO_CATALOG: NutritionFoodCatalogItem[] = [
  { kind: 'dish', id: 'demo-pho-bo', code: 'MA-001', name: 'Phở bò', servingGrams: 500, calories: 394, protein: 26.8, carbs: 51.4, fat: 9.1, source: 'Viện Dinh dưỡng' },
  { kind: 'food', id: 'demo-com-trang', code: 'TP-001', name: 'Cơm trắng', servingGrams: 100, calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, source: 'Viện Dinh dưỡng' },
  { kind: 'food', id: 'demo-uc-ga', code: 'TP-002', name: 'Ức gà chín', servingGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6, source: 'Dữ liệu minh họa' },
  { kind: 'dish', id: 'demo-banh-mi-trung', code: 'MA-002', name: 'Bánh mì trứng', servingGrams: 180, calories: 385, protein: 17, carbs: 44, fat: 16, source: 'Dữ liệu minh họa' },
  { kind: 'food', id: 'demo-ca-hoi', code: 'TP-003', name: 'Cá hồi áp chảo', servingGrams: 100, calories: 208, protein: 22, carbs: 0, fat: 13, source: 'Dữ liệu minh họa' },
  { kind: 'food', id: 'demo-khoai-lang', code: 'TP-004', name: 'Khoai lang luộc', servingGrams: 100, calories: 86, protein: 1.6, carbs: 20.1, fat: 0.1, source: 'Dữ liệu minh họa' },
]
