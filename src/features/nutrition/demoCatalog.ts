import type { NutritionFoodCatalogItem } from './types'

export const DEMO_CATALOG: NutritionFoodCatalogItem[] = [
  { kind: 'dish', id: 'demo-pho-bo', code: 'MA-001', name: 'Phở bò', servingGrams: 500, calories: 394, protein: 26.8, carbs: 51.4, fat: 9.1, source: 'Viện Dinh dưỡng' },
  { kind: 'food', id: 'demo-com-trang', code: 'TP-001', name: 'Cơm trắng', servingGrams: 100, calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, source: 'Viện Dinh dưỡng' },
  { kind: 'food', id: 'demo-uc-ga', code: 'TP-002', name: 'Ức gà chín', servingGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6, source: 'Dữ liệu minh họa' },
  { kind: 'dish', id: 'demo-banh-mi-trung', code: 'MA-002', name: 'Bánh mì trứng', servingGrams: 180, calories: 385, protein: 17, carbs: 44, fat: 16, source: 'Dữ liệu minh họa' },
  { kind: 'food', id: 'demo-ca-hoi', code: 'TP-003', name: 'Cá hồi áp chảo', servingGrams: 100, calories: 208, protein: 22, carbs: 0, fat: 13, source: 'Dữ liệu minh họa' },
  { kind: 'food', id: 'demo-khoai-lang', code: 'TP-004', name: 'Khoai lang luộc', servingGrams: 100, calories: 86, protein: 1.6, carbs: 20.1, fat: 0.1, source: 'Dữ liệu minh họa' },
]

export const DEMO_MENU_DISHES: NutritionFoodCatalogItem[] = [
  { id: 'demo-chicken', kind: 'dish', name: 'Ức gà áp chảo & rau củ', category: { nameVi: 'Món chính' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 428, protein: 42, carbs: 36, fat: 12, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-salad', kind: 'dish', name: 'Salad khoai lang nướng & cải kale', category: { nameVi: 'Salad' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 386, protein: 18, carbs: 52, fat: 11, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-pasta', kind: 'dish', name: 'Mì Ý sốt cà chua với tôm', category: { nameVi: 'Mì và bún' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 312, protein: 28, carbs: 41, fat: 7, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-salmon', kind: 'dish', name: 'Cá hồi áp chảo & măng tây', category: { nameVi: 'Món chính' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 518, protein: 44, carbs: 24, fat: 26, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-yogurt', kind: 'dish', name: 'Sữa chua Hy Lạp, yến mạch & quả mọng', category: { nameVi: 'Bữa sáng' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 256, protein: 21, carbs: 29, fat: 6, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-seabass', kind: 'dish', name: 'Cá chẽm hấp gừng hành & cơm gạo lứt', category: { nameVi: 'Món chính' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 410, protein: 38, carbs: 44, fat: 9, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=800&q=80' },
]
