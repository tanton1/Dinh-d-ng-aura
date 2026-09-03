import React, { useMemo, useState } from 'react'
import '../../styles-meal-plan.css'
import {
  Bookmark,
  SlidersHorizontal,
  Search,
  Flame,
  Dumbbell,
  Scale,
  Wheat,
  Droplets,
  MilkOff,
  Leaf,
  Star,
  Heart,
  Clock3,
  Crown,
  ChevronRight,
  Utensils,
  Beef,
  Gauge,
  X,
  Plus,
  Check,
  ChefHat,
  Sparkles,
  Calendar,
  UtensilsCrossed,
  ArrowRight
} from 'lucide-react'
import type { ViewId } from '../../types'

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
type GoalType = 'fat-loss' | 'muscle-gain' | 'maintenance'
type CalorieRange = 'all' | 'under-300' | '300-400' | '400-500' | '500-600' | 'over-600'
type DietType = 'high-protein' | 'low-carb' | 'low-fat' | 'mediterranean' | 'dairy-free' | 'gluten-free'

export interface Recipe {
  id: number
  name: string
  image: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  minutes: number
  meal: MealType
  goals: GoalType[]
  diets: DietType[]
  badge?: string
  description?: string
  ingredients?: { name: string; amount: string }[]
  instructions?: string[]
}

const mealOptions = [
  {
    id: 'breakfast' as MealType,
    label: 'Bữa sáng (07:30)',
    image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'lunch' as MealType,
    label: 'Bữa trưa (12:00)',
    image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'dinner' as MealType,
    label: 'Bữa tối (18:30)',
    image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'snack' as MealType,
    label: 'Bữa phụ (15:30)',
    image: 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?auto=format&fit=crop&w=600&q=80',
  },
]

const recipes: Recipe[] = [
  {
    id: 1,
    name: 'Ức gà áp chảo & rau củ',
    image: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80',
    kcal: 428,
    protein: 42,
    carbs: 36,
    fat: 12,
    fiber: 6,
    minutes: 25,
    meal: 'lunch',
    goals: ['fat-loss', 'muscle-gain'],
    diets: ['high-protein', 'low-fat'],
    badge: 'Giàu đạm',
    description: 'Ức gà tẩm ướp thảo mộc áp chảo vàng giòn, ăn kèm bông cải xanh, ớt chuông và khoai tây nướng.',
    ingredients: [
      { name: 'Ức gà tươi', amount: '200g' },
      { name: 'Bông cải xanh', amount: '100g' },
      { name: 'Ớt chuông đà lạt', amount: '50g' },
      { name: 'Dầu ô liu extra virgin', amount: '1 muỗng cà phê' },
      { name: 'Thảo mộc Ý & muối tiêu', amount: 'Tùy khẩu vị' }
    ],
    instructions: [
      'Làm sạch ức gà, khứa nhẹ bề mặt và tẩm ướp với thảo mộc, muối, tiêu trong 10 phút.',
      'Cắt bông cải xanh và ớt chuông thành miếng vừa ăn, hấp nhẹ hoặc chần qua nước sôi 2 phút.',
      'Đun nóng chảo chống dính với 1 muỗng dầu ô liu, áp chảo ức gà mỗi mặt 5-6 phút đến khi chín vàng.',
      'Cho rau củ vào chảo xào nhanh cùng ức gà trong 1 phút cuối. Bày ra đĩa và thưởng thức khi còn nóng.'
    ]
  },
  {
    id: 2,
    name: 'Salad khoai lang nướng & cải kale',
    image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80',
    kcal: 386,
    protein: 18,
    carbs: 52,
    fat: 11,
    fiber: 8,
    minutes: 20,
    meal: 'lunch',
    goals: ['fat-loss', 'maintenance'],
    diets: ['low-fat', 'mediterranean'],
    badge: 'Giảm mỡ',
    description: 'Món salad thanh mát, giàu xơ và vitamin với khoai lang vàng nướng ngọt bùi, cải kale giòn rụm.',
    ingredients: [
      { name: 'Khoai lang mật', amount: '150g' },
      { name: 'Cải kale tươi', amount: '80g' },
      { name: 'Hạt điều nướng', amount: '15g' },
      { name: 'Cà chua cherry', amount: '50g' },
      { name: 'Sốt chanh chanh leo dầu ô liu', amount: '2 muỗng canh' }
    ],
    instructions: [
      'Khoai lang rửa sạch, cắt khối vuông 2cm, trộn xíu muối tiêu và nướng nồi chiên không dầu 180°C trong 15 phút.',
      'Cải kale rửa sạch, xé nhỏ, bóp nhẹ với vài giọt dầu ô liu cho mềm lá.',
      'Bổ đôi cà chua cherry, trộn đều tất cả nguyên liệu trong tô lớn.',
      'Rưới sốt chanh chanh leo, rắc hạt điều nướng lên trên và dùng ngay.'
    ]
  },
  {
    id: 3,
    name: 'Mì Ý sốt cà chua với tôm',
    image: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=800&q=80',
    kcal: 312,
    protein: 28,
    carbs: 41,
    fat: 7,
    fiber: 5,
    minutes: 20,
    meal: 'dinner',
    goals: ['fat-loss', 'maintenance'],
    diets: ['low-fat'],
    badge: 'Ít chất béo',
    description: 'Mì Ý nguyên cám dai ngon kết hợp tôm biển tươi ngọt đậm đà sốt cà chua Basil chuẩn vị Ý.',
    ingredients: [
      { name: 'Mì Ý nguyên cám', amount: '70g' },
      { name: 'Tôm bóc vỏ', amount: '120g' },
      { name: 'Sốt cà chua nguyên chất', amount: '100ml' },
      { name: 'Tỏi băm & lá húng tây (Basil)', amount: '1 muỗng cà phê' }
    ],
    instructions: [
      'Luộc mì Ý trong nước sôi có xíu muối khoảng 8-9 phút cho chín tới (al dente).',
      'Phi thơm tỏi băm với chảo nóng, cho tôm vào đảo nhanh 2 phút đến khi săn lại.',
      'Đổ sốt cà chua vào đun sôi lăn tăn, nêm nhẹ gia vị rồi cho mì Ý vào đảo đều 1 phút.',
      'Trang trí lá Basil tươi lên trên và thưởng thức.'
    ]
  },
  {
    id: 4,
    name: 'Cá hồi áp chảo & măng tây',
    image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80',
    kcal: 518,
    protein: 44,
    carbs: 24,
    fat: 26,
    fiber: 4,
    minutes: 30,
    meal: 'dinner',
    goals: ['muscle-gain', 'maintenance'],
    diets: ['high-protein', 'low-carb', 'mediterranean'],
    badge: 'Giàu Omega-3',
    description: 'Filet cá hồi Nauy giòn da mềm thịt, giàu béo tốt Omega-3 kèm măng tây xào bơ tỏi thơm lừng.',
    ingredients: [
      { name: 'Filet cá hồi', amount: '180g' },
      { name: 'Măng tây tươi', amount: '100g' },
      { name: 'Bơ lạt', amount: '10g' },
      { name: 'Chanh vàng & tỏi băm', amount: '1 quả' }
    ],
    instructions: [
      'Thấm khô filet cá hồi, rắc muối hồng và tiêu đen hai mặt.',
      'Áp chảo mặt da cá hồi 4 phút cho giòn rụm, lật mặt thịt áp thêm 3 phút.',
      'Xào măng tây với bơ lạt và tỏi băm trong 3 phút trên lửa vừa.',
      'Bày cá hồi lên đĩa, vắt nước cốt chanh vàng lên cá và ăn kèm măng tây.'
    ]
  },
  {
    id: 5,
    name: 'Sữa chua Hy Lạp, yến mạch & quả mọng',
    image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=800&q=80',
    kcal: 256,
    protein: 21,
    carbs: 29,
    fat: 6,
    fiber: 5,
    minutes: 10,
    meal: 'breakfast',
    goals: ['fat-loss', 'maintenance'],
    diets: ['high-protein'],
    badge: 'Bữa sáng nhanh',
    description: 'Bữa sáng giàu đạm mịn màng, tràn đầy năng lượng tươi mới từ việt quất, dâu tây và yến mạch nướng.',
    ingredients: [
      { name: 'Sữa chua Hy Lạp không đường', amount: '150g' },
      { name: 'Yến mạch cán vỡ nướng', amount: '30g' },
      { name: 'Quả mọng tươi (Dâu/Việt quất)', amount: '50g' },
      { name: 'Mật hoa dừa hoặc mật ong', amount: '1 muỗng cà phê' }
    ],
    instructions: [
      'Cho sữa chua Hy Lạp vào tô hoặc ly thủy tinh.',
      'Phủ yến mạch nướng lên bề mặt.',
      'Xếp dâu tây cắt lát và việt quất tươi lên trên.',
      'Rưới nhẹ xíu mật ong và thưởng thức bữa sáng giàu đạm ngon lành.'
    ]
  },
  {
    id: 6,
    name: 'Bò lúc lắc khoai tây múi cau',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    kcal: 540,
    protein: 45,
    carbs: 40,
    fat: 20,
    fiber: 4,
    minutes: 25,
    meal: 'lunch',
    goals: ['muscle-gain'],
    diets: ['high-protein'],
    badge: 'Tăng cơ nạc',
    description: 'Thịt thăn bò mềm thơm xào lửa lớn cùng hành tây, ớt chuông và khoai tây chiên nồi chiên không dầu.',
    ingredients: [
      { name: 'Thăn bò Úc', amount: '180g' },
      { name: 'Khoai tây múi cau nướng', amount: '120g' },
      { name: 'Hành tây & ớt chuông', amount: '80g' },
      { name: 'Dầu hào & xì dầu tỏi', amount: '1 muỗng canh' }
    ],
    instructions: [
      'Thịt bò cắt khối vuông 2cm, tẩm ướp tỏi băm, dầu hào, tiêu trong 15 phút.',
      'Khoai tây nướng nồi chiên không dầu 200°C trong 15 phút cho giòn.',
      'Đun chảo thật nóng, đảo bò lửa lớn trong 2 phút cho xém cạnh rồi trút ra.',
      'Xào nhanh hành tây, ớt chuông rồi cho bò vào đảo lại 30 giây. Ăn kèm khoai tây.'
    ]
  },
  {
    id: 7,
    name: 'Bánh Pancake yến mạch chuối & mật ong',
    image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80',
    kcal: 320,
    protein: 16,
    carbs: 48,
    fat: 7,
    fiber: 6,
    minutes: 15,
    meal: 'breakfast',
    goals: ['maintenance', 'fat-loss'],
    diets: ['low-fat'],
    badge: 'Giàu năng lượng',
    description: 'Pancake thơm lừng ngọt dịu tự nhiên từ chuối chín và bột yến mạch nguyên cám, ăn kèm mật ong.',
    ingredients: [
      { name: 'Bột yến mạch mịn', amount: '50g' },
      { name: 'Chuối chín vừa', amount: '1 quả' },
      { name: 'Trứng gà tươi', amount: '1 quả' },
      { name: 'Sữa tươi không đường', amount: '50ml' },
      { name: 'Mật ong nguyên chất', amount: '1 muỗng cà phê' }
    ],
    instructions: [
      'Dầm nát chuối chín trong tô, đánh đều cùng trứng gà và sữa tươi.',
      'Trộn bột yến mạch vào hỗn hợp cho đến khi mịn mượt.',
      'Áp chảo chống dính lửa nhỏ mỗi mặt bánh 2-3 phút đến khi chín vàng đều.',
      'Xếp bánh ra đĩa, cắt thêm vài lát chuối tươi và rưới mật ong lên trên.'
    ]
  },
  {
    id: 8,
    name: 'Salad bơ ức gà & hạt điều',
    image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80',
    kcal: 390,
    protein: 36,
    carbs: 22,
    fat: 18,
    fiber: 7,
    minutes: 15,
    meal: 'lunch',
    goals: ['fat-loss', 'maintenance'],
    diets: ['high-protein', 'low-carb'],
    badge: 'Eat Clean',
    description: 'Sự kết hợp hoàn hảo giữa ức gà xé mềm, bơ chín béo ngậy, rau xà lách giòn tươi và hạt điều thơm bùi.',
    ingredients: [
      { name: 'Ức gà luộc xé phay', amount: '150g' },
      { name: 'Bơ sáp chín', amount: '1/2 quả' },
      { name: 'Rau xà lách lolo xanh', amount: '100g' },
      { name: 'Cà chua cherry', amount: '6 quả' },
      { name: 'Sốt sữa chua mù tạt', amount: '2 muỗng canh' }
    ],
    instructions: [
      'Rau xà lách rửa sạch vẩy khô nước, cà chua bổ đôi, bơ thái miếng vừa ăn.',
      'Cho ức gà xé và rau củ vào tô trộn lớn.',
      'Thêm sốt sữa chua mù tạt nhẹ nhàng trộn đều.',
      'Rắc hạt điều nướng giòn lên đĩa salad và dùng ngay.'
    ]
  },
  {
    id: 9,
    name: 'Sinh tố dâu tây & sữa hạnh nhân (Whey Protein)',
    image: 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?auto=format&fit=crop&w=800&q=80',
    kcal: 195,
    protein: 24,
    carbs: 18,
    fat: 4,
    fiber: 4,
    minutes: 5,
    meal: 'snack',
    goals: ['fat-loss', 'muscle-gain'],
    diets: ['high-protein', 'dairy-free'],
    badge: 'Bữa phụ Pro',
    description: 'Ly sinh tố mát lạnh giàu đạm tinh khiết, hỗ trợ phục hồi cơ bắp cấp tốc sau giờ tập luyện.',
    ingredients: [
      { name: 'Whey Protein Isolate vani', amount: '1 muỗng (30g)' },
      { name: 'Dâu tây đông lạnh', amount: '80g' },
      { name: 'Sữa hạnh nhân không đường', amount: '200ml' },
      { name: 'Đá viên mát lạnh', amount: '1/2 cốc' }
    ],
    instructions: [
      'Cho tất cả nguyên liệu dâu tây, sữa hạnh nhân, Whey Protein và đá viên vào máy xay.',
      'Xay tốc độ cao trong 45 giây cho đến khi hỗn hợp sánh mịn hoàn hảo.',
      'Rót ra ly thủy tinh và thưởng thức ngay.'
    ]
  },
  {
    id: 10,
    name: 'Cá chẽm hấp gừng hành & cơm gạo lứt',
    image: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=800&q=80',
    kcal: 410,
    protein: 38,
    carbs: 44,
    fat: 9,
    fiber: 5,
    minutes: 25,
    meal: 'dinner',
    goals: ['fat-loss', 'maintenance'],
    diets: ['low-fat'],
    badge: 'Thanh nhẹ',
    description: 'Cá chẽm tươi hấp gừng hành thơm lừng vị thanh ngọt tự nhiên, ăn kèm cơm gạo lứt dẻo thơm.',
    ingredients: [
      { name: 'Filet cá chẽm tươi', amount: '160g' },
      { name: 'Cơm gạo lứt huyết rồng', amount: '120g' },
      { name: 'Gừng sợi & hành lá', amount: '20g' },
      { name: 'Nước tương nhạt & dầu mè', amount: '1 muỗng cà phê' }
    ],
    instructions: [
      'Làm sạch cá chẽm, xếp gừng thái sợi và đầu hành lá lên mình cá.',
      'Hấp cách thủy cá trong 12-15 phút đến khi chín tới.',
      'Rưới 1 muỗng nước tương nhạt đun nóng nhẹ và xíu dầu mè lên cá.',
      'Ăn kèm cơm gạo lứt dẻo ấm và rau luộc.'
    ]
  }
]

const planDays = [
  {
    dayId: 'mon',
    dayName: 'Thứ Hai',
    shortDay: 'T2',
    dateNum: 10,
    tagline: 'Khởi đầu tuần mới nhẹ nhàng, cân bằng macro & đốt mỡ hiệu quả',
    totalKcal: 1191,
    totalProtein: 115,
    totalCarbs: 124,
    totalFat: 31,
    waterTarget: '2.5L',
    meals: [
      { time: '07:30', mealLabel: 'Bữa sáng', recipe: recipes[4] },
      { time: '12:00', mealLabel: 'Bữa trưa', recipe: recipes[0] },
      { time: '15:30', mealLabel: 'Bữa phụ', recipe: recipes[8] },
      { time: '18:30', mealLabel: 'Bữa tối', recipe: recipes[2] },
    ]
  },
  {
    dayId: 'tue',
    dayName: 'Thứ Ba',
    shortDay: 'T3',
    dateNum: 11,
    tagline: 'Tăng cường lượng đạm chuẩn Pro giúp phục hồi & xây dựng cơ bắp',
    totalKcal: 1573,
    totalProtein: 129,
    totalCarbs: 130,
    totalFat: 51,
    waterTarget: '2.8L',
    meals: [
      { time: '07:30', mealLabel: 'Bữa sáng', recipe: recipes[6] },
      { time: '12:00', mealLabel: 'Bữa trưa', recipe: recipes[5] },
      { time: '15:30', mealLabel: 'Bữa phụ', recipe: recipes[8] },
      { time: '18:30', mealLabel: 'Bữa tối', recipe: recipes[3] },
    ]
  },
  {
    dayId: 'wed',
    dayName: 'Thứ Tư',
    shortDay: 'T4',
    dateNum: 12,
    tagline: 'Thanh lọc cơ thể, giàu chất xơ & tối ưu hóa quá trình trao đổi chất',
    totalKcal: 1247,
    totalProtein: 101,
    totalCarbs: 143,
    totalFat: 30,
    waterTarget: '2.5L',
    meals: [
      { time: '07:30', mealLabel: 'Bữa sáng', recipe: recipes[4] },
      { time: '12:00', mealLabel: 'Bữa trưa', recipe: recipes[1] },
      { time: '15:30', mealLabel: 'Bữa phụ', recipe: recipes[8] },
      { time: '18:30', mealLabel: 'Bữa tối', recipe: recipes[9] },
    ]
  },
  {
    dayId: 'thu',
    dayName: 'Thứ Năm',
    shortDay: 'T5',
    dateNum: 13,
    tagline: 'Giàu Omega-3 & vitamin thiết yếu bảo vệ sức khỏe tim mạch',
    totalKcal: 1423,
    totalProtein: 120,
    totalCarbs: 112,
    totalFat: 55,
    waterTarget: '2.6L',
    meals: [
      { time: '07:30', mealLabel: 'Bữa sáng', recipe: recipes[6] },
      { time: '12:00', mealLabel: 'Bữa trưa', recipe: recipes[7] },
      { time: '15:30', mealLabel: 'Bữa phụ', recipe: recipes[8] },
      { time: '18:30', mealLabel: 'Bữa tối', recipe: recipes[3] },
    ]
  },
  {
    dayId: 'fri',
    dayName: 'Thứ Sáu',
    shortDay: 'T6',
    dateNum: 14,
    tagline: 'Đủ năng lượng bùng nổ cho buổi tập tạ & Cardio cuối tuần',
    totalKcal: 1419,
    totalProtein: 132,
    totalCarbs: 123,
    totalFat: 42,
    waterTarget: '3.0L',
    meals: [
      { time: '07:30', mealLabel: 'Bữa sáng', recipe: recipes[4] },
      { time: '12:00', mealLabel: 'Bữa trưa', recipe: recipes[0] },
      { time: '15:30', mealLabel: 'Bữa phụ', recipe: recipes[8] },
      { time: '18:30', mealLabel: 'Bữa tối', recipe: recipes[5] },
    ]
  },
  {
    dayId: 'sat',
    dayName: 'Thứ Bảy',
    shortDay: 'T7',
    dateNum: 15,
    tagline: 'Thực đơn Eat Clean thơm ngon chuẩn vị nhà làm',
    totalKcal: 1213,
    totalProtein: 86,
    totalCarbs: 166,
    totalFat: 29,
    waterTarget: '2.4L',
    meals: [
      { time: '07:30', mealLabel: 'Bữa sáng', recipe: recipes[6] },
      { time: '12:00', mealLabel: 'Bữa trưa', recipe: recipes[1] },
      { time: '15:30', mealLabel: 'Bữa phụ', recipe: recipes[8] },
      { time: '18:30', mealLabel: 'Bữa tối', recipe: recipes[2] },
    ]
  },
  {
    dayId: 'sun',
    dayName: 'Chủ Nhật',
    shortDay: 'CN',
    dateNum: 16,
    tagline: 'Thư giãn, tái tạo năng lượng & duy trì vóc dáng săn chắc',
    totalKcal: 1251,
    totalProtein: 119,
    totalCarbs: 113,
    totalFat: 37,
    waterTarget: '2.5L',
    meals: [
      { time: '07:30', mealLabel: 'Bữa sáng', recipe: recipes[4] },
      { time: '12:00', mealLabel: 'Bữa trưa', recipe: recipes[7] },
      { time: '15:30', mealLabel: 'Bữa phụ', recipe: recipes[8] },
      { time: '18:30', mealLabel: 'Bữa tối', recipe: recipes[9] },
    ]
  }
]

function matchCalories(kcal: number, range: CalorieRange) {
  if (range === 'all') return true
  if (range === 'under-300') return kcal < 300
  if (range === '300-400') return kcal >= 300 && kcal < 400
  if (range === '400-500') return kcal >= 400 && kcal < 500
  if (range === '500-600') return kcal >= 500 && kcal < 600
  if (range === 'over-600') return kcal >= 600
  return true
}

export default function MealPlanPage({
  onNavigate,
  onLogRecipe
}: {
  onNavigate: (view: ViewId) => void
  onLogRecipe?: (recipe: Recipe) => void
}) {
  const [activeTab, setActiveTab] = useState<'plan' | 'recipes'>('recipes')
  const [search, setSearch] = useState('')
  const [meal, setMeal] = useState<MealType | null>(null)
  const [goal, setGoal] = useState<GoalType | null>(null)
  const [calorieRange, setCalorieRange] = useState<CalorieRange>('all')
  const [diet, setDiet] = useState<DietType | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<number[]>([1, 4])
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [loggedRecipeIds, setLoggedRecipeIds] = useState<number[]>([])
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [selectedPlanDayId, setSelectedPlanDayId] = useState<string>('mon')

  const activePlanDay = useMemo(() => {
    return planDays.find((d) => d.dayId === selectedPlanDayId) || planDays[0]
  }, [selectedPlanDayId])

  const filteredRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      const searchMatch = recipe.name.toLowerCase().includes(search.toLowerCase()) ||
        (recipe.description && recipe.description.toLowerCase().includes(search.toLowerCase()))
      const mealMatch = !meal || recipe.meal === meal
      const goalMatch = !goal || recipe.goals.includes(goal)
      const dietMatch = !diet || recipe.diets.includes(diet)
      const calorieMatch = matchCalories(recipe.kcal, calorieRange)
      return searchMatch && mealMatch && goalMatch && dietMatch && calorieMatch
    })
  }, [search, meal, goal, diet, calorieRange])

  function toggleFavorite(id: number, event?: React.MouseEvent) {
    event?.stopPropagation()
    setFavoriteIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }

  const handleAddRecipeToLog = (recipe: Recipe) => {
    onLogRecipe?.(recipe)
    setLoggedRecipeIds((prev) => [...prev, recipe.id])
    setTimeout(() => {
      setSelectedRecipe(null)
    }, 1200)
  }

  const activeFilterCount = (meal ? 1 : 0) + (goal ? 1 : 0) + (diet ? 1 : 0) + (calorieRange !== 'all' ? 1 : 0)

  return (
    <div className="meal-plan-page-container">
      <div className="meal-plan-shell">
        {/* =====================================================
            HEADER
        ===================================================== */}
        <header className="meal-plan-header">
          <div className="meal-plan-header__top">
            <div>
              <h1 className="meal-plan-header__title">
                THỰC ĐƠN
              </h1>
              <p className="meal-plan-header__subtitle">
                Ăn uống khoa học – Đạt mục tiêu vóc dáng
              </p>
            </div>
            <div className="meal-plan-header__actions">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('recipes')
                  setSearch('')
                }}
                title="Món đã lưu"
                className="meal-plan-icon-btn"
              >
                <Bookmark size={20} strokeWidth={2.2} />
                {favoriteIds.length > 0 && (
                  <span className="meal-plan-badge-count">
                    {favoriteIds.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setFilterModalOpen(true)}
                className="meal-plan-icon-btn"
              >
                <SlidersHorizontal size={20} />
                {activeFilterCount > 0 && (
                  <span className="meal-plan-badge-dot" />
                )}
              </button>
            </div>
          </div>

          {/* TABS */}
          <div className="meal-plan-tabs">
            <button
              type="button"
              onClick={() => setActiveTab('recipes')}
              className={`meal-plan-tab-btn ${
                activeTab === 'recipes' ? 'meal-plan-tab-btn--active' : ''
              }`}
            >
              Thư viện công thức
              {activeTab === 'recipes' && (
                <span className="meal-plan-tab-indicator" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('plan')}
              className={`meal-plan-tab-btn ${
                activeTab === 'plan' ? 'meal-plan-tab-btn--active' : ''
              }`}
            >
              Kế hoạch 7 ngày
              {activeTab === 'plan' && (
                <span className="meal-plan-tab-indicator" />
              )}
            </button>
          </div>
        </header>

        {/* =====================================================
            MAIN CONTENT
        ===================================================== */}
        {activeTab === 'recipes' ? (
          <main className="meal-plan-main">
            {/* SEARCH */}
            <div className="meal-plan-search-row">
              <div className="meal-plan-search-input-wrapper">
                <Search size={20} style={{ color: '#969090', flexShrink: 0 }} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm món ăn hoặc nguyên liệu..."
                  className="meal-plan-search-input"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#888' }}>
                    <X size={16} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFilterModalOpen(!filterModalOpen)}
                className={`meal-plan-filter-trigger ${
                  activeFilterCount > 0 ? 'meal-plan-filter-trigger--active' : ''
                }`}
              >
                <SlidersHorizontal size={18} />
                Bộ lọc {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
              </button>
            </div>

            {/* MEAL TYPES */}
            <section style={{ marginTop: '26px' }} className="meal-plan-padding-x">
              <SectionTitle icon={<Utensils size={19} />} title="CHỌN BỮA ĂN" />
              <div className="meal-plan-meals-grid">
                {mealOptions.map((item) => {
                  const active = meal === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMeal(active ? null : item.id)}
                      className={`meal-card ${active ? 'meal-card--active' : ''}`}
                    >
                      <div className="meal-card__img-wrap">
                        <img src={item.image} alt={item.label} className="meal-card__img" />
                      </div>
                      <div className="meal-card__label">
                        {item.label}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* GOALS */}
            <section style={{ marginTop: '26px' }} className="meal-plan-padding-x">
              <SectionTitle icon={<Gauge size={19} />} title="THEO MỤC TIÊU" />
              <div className="meal-plan-goals-grid">
                <GoalCard
                  active={goal === 'fat-loss'}
                  title="Giảm mỡ"
                  subtitle="Đốt mỡ hiệu quả"
                  icon={<Flame size={22} />}
                  onClick={() => setGoal(goal === 'fat-loss' ? null : 'fat-loss')}
                />
                <GoalCard
                  active={goal === 'muscle-gain'}
                  title="Tăng cơ"
                  subtitle="Xây dựng cơ bắp"
                  icon={<Dumbbell size={22} />}
                  onClick={() => setGoal(goal === 'muscle-gain' ? null : 'muscle-gain')}
                />
                <GoalCard
                  active={goal === 'maintenance'}
                  title="Duy trì"
                  subtitle="Giữ dáng khỏe đẹp"
                  icon={<Scale size={22} />}
                  onClick={() => setGoal(goal === 'maintenance' ? null : 'maintenance')}
                />
              </div>
            </section>

            {/* CALORIE RANGE */}
            <section style={{ marginTop: '26px' }}>
              <div className="meal-plan-padding-x">
                <SectionTitle icon={<Flame size={19} />} title="THEO MỨC NĂNG LƯỢNG" />
              </div>
              <div className="meal-plan-scroll-row">
                {[
                  { id: 'under-300' as CalorieRange, label: 'Dưới 300' },
                  { id: '300-400' as CalorieRange, label: '300–400' },
                  { id: '400-500' as CalorieRange, label: '400–500' },
                  { id: '500-600' as CalorieRange, label: '500–600' },
                  { id: 'over-600' as CalorieRange, label: 'Trên 600' },
                ].map((item) => (
                  <CalorieCard
                    key={item.id}
                    active={calorieRange === item.id}
                    title={item.label}
                    onClick={() => setCalorieRange(calorieRange === item.id ? 'all' : item.id)}
                  />
                ))}
              </div>
            </section>

            {/* DIET TYPES */}
            <section style={{ marginTop: '22px' }}>
              <div className="meal-plan-padding-x">
                <SectionTitle icon={<Leaf size={19} />} title="CHẾ ĐỘ ĂN" />
              </div>
              <div className="meal-plan-scroll-row">
                <FilterChip
                  active={diet === 'high-protein'}
                  onClick={() => setDiet(diet === 'high-protein' ? null : 'high-protein')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Beef size={15} /> Giàu đạm</span>
                </FilterChip>
                <FilterChip
                  active={diet === 'low-carb'}
                  onClick={() => setDiet(diet === 'low-carb' ? null : 'low-carb')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Wheat size={15} /> Ít tinh bột</span>
                </FilterChip>
                <FilterChip
                  active={diet === 'low-fat'}
                  onClick={() => setDiet(diet === 'low-fat' ? null : 'low-fat')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Droplets size={15} /> Ít béo</span>
                </FilterChip>
                <FilterChip
                  active={diet === 'mediterranean'}
                  onClick={() => setDiet(diet === 'mediterranean' ? null : 'mediterranean')}
                >
                  Địa Trung Hải
                </FilterChip>
                <FilterChip
                  active={diet === 'dairy-free'}
                  onClick={() => setDiet(diet === 'dairy-free' ? null : 'dairy-free')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><MilkOff size={15} /> Không sữa</span>
                </FilterChip>
              </div>
            </section>

            {/* RECIPES LISTING */}
            <section style={{ marginTop: '28px' }}>
              <div className="meal-plan-padding-x">
                <SectionTitle
                  icon={<Star size={19} style={{ fill: '#ff3f7d', color: '#ff3f7d' }} />}
                  title="GỢI Ý DÀNH RIÊNG CHO BẠN"
                  rightText={filteredRecipes.length > 0 ? `${filteredRecipes.length} món` : undefined}
                />
              </div>

              <div className="meal-plan-scroll-row" style={{ paddingBottom: '16px' }}>
                {filteredRecipes.length > 0 ? (
                  filteredRecipes.map((recipe) => (
                    <RecipeCard
                      key={recipe.id}
                      recipe={recipe}
                      favorite={favoriteIds.includes(recipe.id)}
                      onFavorite={(e) => toggleFavorite(recipe.id, e)}
                      onClick={() => setSelectedRecipe(recipe)}
                    />
                  ))
                ) : (
                  <div style={{ width: '100%', borderRadius: '24px', border: '1px dashed #f1c9c9', backgroundColor: '#fff8f7', padding: '32px 20px', textAlign: 'center' }}>
                    <p style={{ fontWeight: 800, color: '#333', margin: 0 }}>Chưa tìm thấy món phù hợp</p>
                    <p style={{ marginTop: '4px', fontSize: '12px', color: '#8d8585' }}>
                      Hãy thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setMeal(null)
                        setGoal(null)
                        setDiet(null)
                        setCalorieRange('all')
                        setSearch('')
                      }}
                      style={{ marginTop: '16px', borderRadius: '20px', background: 'linear-gradient(90deg, #ff3976, #ff8d34)', padding: '10px 20px', fontSize: '12px', fontWeight: 700, color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      Xóa tất cả bộ lọc
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* PREMIUM CTA BANNER */}
            <section className="meal-plan-padding-x" style={{ paddingTop: '12px' }}>
              <div className="meal-plan-premium-banner">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="meal-plan-premium-banner__icon">
                    <Crown size={26} />
                  </div>
                  <div>
                    <p className="meal-plan-premium-banner__title">Mở khóa 3.000+ công thức Pro</p>
                    <p className="meal-plan-premium-banner__desc">Thực đơn đa dạng, có kcal và macro chi tiết</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('profile')}
                  className="meal-plan-premium-banner__btn"
                >
                  Khám phá ngay →
                </button>
              </div>
            </section>
          </main>
        ) : (
          /* =====================================================
              MY PLAN (7-DAY PLAN) TAB
          ===================================================== */
          <main className="meal-plan-main">
            {/* Header Summary Card */}
            <div className="plan-summary-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <Sparkles size={18} style={{ color: '#ff3f7d' }} />
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: '16px', color: '#111' }}>Kế hoạch dinh dưỡng cá nhân hóa</h3>
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: '#555', lineHeight: 1.5 }}>
                Được tính toán tối ưu dựa trên chỉ số TDEE & mục tiêu của bạn. Đủ 4 bữa/ngày, cân bằng đạm, tinh bột & chất béo tốt.
              </p>
            </div>

            {/* Date Selector Strip */}
            <div className="plan-date-strip-container" style={{ padding: 0 }}>
              <div className="plan-date-strip">
                {planDays.map((pDay) => {
                  const isActive = pDay.dayId === selectedPlanDayId
                  return (
                    <button
                      key={pDay.dayId}
                      type="button"
                      onClick={() => setSelectedPlanDayId(pDay.dayId)}
                      className={`plan-date-pill ${isActive ? 'plan-date-pill--active' : ''}`}
                    >
                      <span className="day-name">{pDay.shortDay}</span>
                      <div className="day-number-circle">{pDay.dateNum}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Active Day Banner & Targets */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: '20px',
                padding: '16px 20px',
                border: '1px solid #f0dede',
                boxShadow: '0 4px 16px rgba(0,0,0,0.02)',
                marginBottom: '20px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#1a1a1a' }}>
                    {activePlanDay.dayName} <span style={{ fontSize: '14px', fontWeight: 600, color: '#888' }}>(Ngày {activePlanDay.dateNum} Th08)</span>
                  </h2>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#666', lineHeight: 1.4 }}>
                    {activePlanDay.tagline}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      background: 'linear-gradient(135deg, #ff3578 0%, #ff8a33 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      display: 'block',
                      lineHeight: 1
                    }}
                  >
                    {activePlanDay.totalKcal}
                  </span>
                  <small style={{ fontSize: '11px', color: '#888', fontWeight: 700 }}>kcal / ngày</small>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px',
                  paddingTop: '12px',
                  borderTop: '1px dashed #f0dede',
                  marginTop: '12px',
                  textAlign: 'center'
                }}
              >
                <div>
                  <span style={{ fontSize: '11px', color: '#888', display: 'block' }}>Đạm (Protein)</span>
                  <strong style={{ fontSize: '14px', color: '#ff3578', fontWeight: 800 }}>{activePlanDay.totalProtein}g</strong>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#888', display: 'block' }}>Carb</span>
                  <strong style={{ fontSize: '14px', color: '#ff8c34', fontWeight: 800 }}>{activePlanDay.totalCarbs}g</strong>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#888', display: 'block' }}>Chất béo</span>
                  <strong style={{ fontSize: '14px', color: '#3b82f6', fontWeight: 800 }}>{activePlanDay.totalFat}g</strong>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#888', display: 'block' }}>Nước uống</span>
                  <strong style={{ fontSize: '14px', color: '#06b6d4', fontWeight: 800 }}>{activePlanDay.waterTarget}</strong>
                </div>
              </div>
            </div>

            {/* Detailed Meal List for Selected Day */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activePlanDay.meals.map((item, mIdx) => {
                const rec = item.recipe
                const isLogged = loggedRecipeIds.includes(rec.id)
                return (
                  <div key={`${item.mealLabel}-${mIdx}`} className="plan-detailed-meal-card">
                    <div style={{ padding: '16px 18px', display: 'flex', gap: '14px', alignItems: 'center' }}>
                      <img
                        src={rec.image}
                        alt={rec.name}
                        style={{
                          width: '90px',
                          height: '90px',
                          borderRadius: '16px',
                          objectFit: 'cover',
                          flexShrink: 0
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span className="plan-meal-time-badge">
                            <Clock3 size={12} /> {item.time} • {item.mealLabel}
                          </span>
                          <span
                            style={{
                              fontSize: '15px',
                              fontWeight: 800,
                              background: 'linear-gradient(135deg, #ff3578 0%, #ff8a33 100%)',
                              WebkitBackgroundClip: 'text',
                              WebkitTextFillColor: 'transparent'
                            }}
                          >
                            {rec.kcal} kcal
                          </span>
                        </div>

                        <h4
                          onClick={() => setSelectedRecipe(rec)}
                          style={{
                            margin: '0 0 6px 0',
                            fontSize: '15px',
                            fontWeight: 800,
                            color: '#1a1a1a',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {rec.name}
                        </h4>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                          <span><strong>{rec.protein}g</strong> đạm</span>
                          <span>•</span>
                          <span><strong>{rec.carbs}g</strong> carb</span>
                          <span>•</span>
                          <span><strong>{rec.fat}g</strong> béo</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedRecipe(rec)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '12px',
                              border: '1px solid #ffb5bd',
                              background: '#fff0f3',
                              color: '#ff3578',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Xem công thức
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddRecipeToLog(rec)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '12px',
                              border: 'none',
                              background: isLogged ? '#059669' : 'linear-gradient(135deg, #ff3578, #ff8c34)',
                              color: '#ffffff',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            {isLogged ? <Check size={13} /> : <Plus size={13} />}
                            {isLogged ? 'Đã ghi nhận' : 'Lưu vào nhật ký'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </main>
        )}

        {/* =====================================================
            RECIPE DETAIL MODAL SHEET
        ===================================================== */}
        {selectedRecipe && (
          <div className="meal-plan-modal-overlay" role="presentation" onClick={() => setSelectedRecipe(null)}>
            <div
              className="meal-plan-modal-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`Công thức ${selectedRecipe.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="recipe-modal-hero">
                <img src={selectedRecipe.image} alt={selectedRecipe.name} className="recipe-modal-hero__img" />
                <div className="recipe-modal-hero__overlay" />

                <button
                  type="button"
                  onClick={() => setSelectedRecipe(null)}
                  className="recipe-modal-close-btn"
                >
                  <X size={18} />
                </button>

                {selectedRecipe.badge && (
                  <span style={{ position: 'absolute', top: '14px', left: '14px', borderRadius: '20px', background: 'linear-gradient(90deg, #ff3475, #ff7150)', padding: '4px 12px', fontSize: '11px', fontWeight: 800, color: '#fff' }}>
                    {selectedRecipe.badge}
                  </span>
                )}

                <div style={{ position: 'absolute', bottom: '16px', left: '16px', right: '16px', color: '#fff' }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 900, lineHeight: 1.25, margin: 0 }}>{selectedRecipe.name}</h2>
                  <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', opacity: 0.9 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}><Clock3 size={14} /> {selectedRecipe.minutes} phút</span>
                    <span>•</span>
                    <span style={{ fontWeight: 600 }}>{selectedRecipe.kcal} kcal</span>
                    <span>•</span>
                    <span style={{ fontWeight: 600 }}>{selectedRecipe.protein}g protein</span>
                  </div>
                </div>
              </div>

              {/* MACROS BREAKDOWN BAR */}
              <div className="macros-grid">
                <div>
                  <small className="macros-item__label">Kcal</small>
                  <strong className="macros-item__val" style={{ color: '#ff3f7d' }}>{selectedRecipe.kcal}</strong>
                </div>
                <div>
                  <small className="macros-item__label">Đạm (P)</small>
                  <strong className="macros-item__val" style={{ color: '#10b981' }}>{selectedRecipe.protein}g</strong>
                </div>
                <div>
                  <small className="macros-item__label">Tinh bột (C)</small>
                  <strong className="macros-item__val" style={{ color: '#f59e0b' }}>{selectedRecipe.carbs}g</strong>
                </div>
                <div>
                  <small className="macros-item__label">Chất béo (F)</small>
                  <strong className="macros-item__val" style={{ color: '#8b5cf6' }}>{selectedRecipe.fat}g</strong>
                </div>
              </div>

              {/* DESCRIPTION */}
              {selectedRecipe.description && (
                <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, marginBottom: '16px' }}>
                  {selectedRecipe.description}
                </p>
              )}

              {/* INGREDIENTS */}
              {selectedRecipe.ingredients && selectedRecipe.ingredients.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#111', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Utensils size={16} style={{ color: '#ff3f7d' }} /> Nguyên liệu cần chuẩn bị
                  </h3>
                  <div style={{ borderRadius: '14px', border: '1px solid #f0f0f0', backgroundColor: '#f9f9f9', padding: '12px' }}>
                    {selectedRecipe.ingredients.map((ing, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: i < selectedRecipe.ingredients!.length - 1 ? '1px solid #eee' : 'none', padding: '6px 0', fontSize: '12px' }}>
                        <span style={{ fontWeight: 500, color: '#333' }}>• {ing.name}</span>
                        <span style={{ fontWeight: 700, color: '#ff3f7d', marginLeft: 'auto' }}>{ing.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* INSTRUCTIONS */}
              {selectedRecipe.instructions && selectedRecipe.instructions.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#111', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ChefHat size={16} style={{ color: '#ff3f7d' }} /> Các bước thực hiện
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedRecipe.instructions.map((step, sIdx) => (
                      <div key={sIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '12px', color: '#444', lineHeight: 1.5 }}>
                        <span style={{ width: '20px', height: '20px', flexShrink: 0, borderRadius: '50%', backgroundColor: '#ff3f7d', color: '#fff', fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px' }}>
                          {sIdx + 1}
                        </span>
                        <p style={{ margin: 0 }}>{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LOG TO NUTRITION BUTTON */}
              <button
                type="button"
                onClick={() => handleAddRecipeToLog(selectedRecipe)}
                disabled={loggedRecipeIds.includes(selectedRecipe.id)}
                className={`meal-plan-log-btn ${
                  loggedRecipeIds.includes(selectedRecipe.id) ? 'meal-plan-log-btn--done' : ''
                }`}
              >
                {loggedRecipeIds.includes(selectedRecipe.id) ? (
                  <>
                    <Check size={18} /> Đã thêm vào nhật ký ăn hôm nay
                  </>
                ) : (
                  <>
                    <Plus size={18} /> Ghi món này vào nhật ký ăn hôm nay ({selectedRecipe.kcal} kcal)
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* =====================================================
            FILTER MODAL
        ===================================================== */}
        {filterModalOpen && (
          <div className="meal-plan-modal-overlay" role="presentation" onClick={() => setFilterModalOpen(false)}>
            <div
              className="meal-plan-modal-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Bộ lọc tìm kiếm món ăn"
              style={{ maxWidth: '500px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: '12px', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <SlidersHorizontal size={18} style={{ color: '#ff3f7d' }} /> Bộ lọc tìm kiếm món ăn
                </h3>
                <button type="button" onClick={() => setFilterModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#888' }}>
                  <X size={20} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#333', marginBottom: '8px' }}>Bữa ăn</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {mealOptions.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMeal(meal === m.id ? null : m.id)}
                        style={{
                          padding: '8px 0',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 700,
                          border: meal === m.id ? '1px solid #ff3f7d' : '1px solid #e5e7eb',
                          backgroundColor: meal === m.id ? '#ff3f7d' : '#f9fafb',
                          color: meal === m.id ? '#ffffff' : '#374151',
                          cursor: 'pointer'
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#333', marginBottom: '8px' }}>Mục tiêu</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { id: 'fat-loss' as GoalType, label: 'Giảm mỡ' },
                      { id: 'muscle-gain' as GoalType, label: 'Tăng cơ' },
                      { id: 'maintenance' as GoalType, label: 'Duy trì' },
                    ].map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setGoal(goal === g.id ? null : g.id)}
                        style={{
                          padding: '8px 0',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 700,
                          border: goal === g.id ? '1px solid #ff3f7d' : '1px solid #e5e7eb',
                          backgroundColor: goal === g.id ? '#ff3f7d' : '#f9fafb',
                          color: goal === g.id ? '#ffffff' : '#374151',
                          cursor: 'pointer'
                        }}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#333', marginBottom: '8px' }}>Mức Calo (kcal)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { id: 'under-300' as CalorieRange, label: '< 300 kcal' },
                      { id: '300-400' as CalorieRange, label: '300–400' },
                      { id: '400-500' as CalorieRange, label: '400–500' },
                      { id: '500-600' as CalorieRange, label: '500–600' },
                      { id: 'over-600' as CalorieRange, label: '> 600 kcal' },
                    ].map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCalorieRange(calorieRange === c.id ? 'all' : c.id)}
                        style={{
                          padding: '8px 0',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 700,
                          border: calorieRange === c.id ? '1px solid #ff3f7d' : '1px solid #e5e7eb',
                          backgroundColor: calorieRange === c.id ? '#ff3f7d' : '#f9fafb',
                          color: calorieRange === c.id ? '#ffffff' : '#374151',
                          cursor: 'pointer'
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '20px', paddingTop: '12px', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setMeal(null)
                    setGoal(null)
                    setDiet(null)
                    setCalorieRange('all')
                    setSearch('')
                  }}
                  style={{ width: '35%', padding: '10px', borderRadius: '12px', border: '1px solid #e5e7eb', backgroundColor: '#ffffff', fontSize: '12px', fontWeight: 700, color: '#4b5563', cursor: 'pointer' }}
                >
                  Xóa lọc
                </button>
                <button
                  type="button"
                  onClick={() => setFilterModalOpen(false)}
                  style={{ width: '65%', padding: '10px', borderRadius: '12px', border: 'none', background: 'linear-gradient(90deg, #ff3f7d, #ff7e40)', fontSize: '12px', fontWeight: 800, color: '#ffffff', cursor: 'pointer' }}
                >
                  Áp dụng ({filteredRecipes.length} món)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
/* =========================================================
   SUB COMPONENTS
========================================================= */
function SectionTitle({
  icon,
  title,
  rightText,
}: {
  icon: React.ReactNode
  title: string
  rightText?: string
}) {
  return (
    <div className="meal-plan-section-header">
      <div className="meal-plan-section-title">
        <span className="meal-plan-section-title-icon">{icon}</span>
        <h2>{title}</h2>
      </div>
      {rightText && (
        <span className="meal-plan-section-right">
          {rightText}
        </span>
      )}
    </div>
  )
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`filter-chip ${active ? 'filter-chip--active' : ''}`}
    >
      {children}
    </button>
  )
}

function GoalCard({
  active,
  title,
  subtitle,
  icon,
  onClick,
}: {
  active?: boolean
  title: string
  subtitle: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`goal-card ${active ? 'goal-card--active' : ''}`}
    >
      <div className="goal-card__icon-wrap">
        {icon}
      </div>
      <p className="goal-card__title">{title}</p>
      <p className="goal-card__subtitle">{subtitle}</p>
    </button>
  )
}

function CalorieCard({
  active,
  title,
  onClick,
}: {
  active: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`calorie-card ${active ? 'calorie-card--active' : ''}`}
    >
      <div className="calorie-card__icon-wrap">
        <Flame size={16} />
      </div>
      <p className="calorie-card__title">{title}</p>
      <span className="calorie-card__unit">kcal</span>
    </button>
  )
}

function RecipeCard({
  recipe,
  favorite,
  onFavorite,
  onClick
}: {
  recipe: Recipe
  favorite: boolean
  onFavorite: (e: React.MouseEvent) => void
  onClick: () => void
}) {
  return (
    <article
      onClick={onClick}
      className="recipe-card"
    >
      <div className="recipe-card__img-wrap">
        <img
          src={recipe.image}
          alt={recipe.name}
          className="recipe-card__img"
        />
        {recipe.badge && (
          <span className="recipe-card__badge">
            {recipe.badge}
          </span>
        )}
        <button
          type="button"
          onClick={onFavorite}
          className="recipe-card__fav-btn"
        >
          <Heart
            size={16}
            className={favorite ? 'fill-[#ff3a70] text-[#ff3a70]' : 'text-[#252525]'}
          />
        </button>
      </div>
      <div className="recipe-card__body">
        <h3 className="recipe-card__title">
          {recipe.name}
        </h3>
        <div className="recipe-card__stats">
          <span className="recipe-card__kcal">{recipe.kcal} kcal</span>
          <span className="recipe-card__dot">•</span>
          <span className="recipe-card__protein">{recipe.protein}g đạm</span>
        </div>
        <div className="recipe-card__time">
          <span className="recipe-card__time-pill">
            <Clock3 size={12} />
            {recipe.minutes} phút
          </span>
        </div>
      </div>
    </article>
  )
}
