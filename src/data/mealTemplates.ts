import { MealTemplate } from '../types';

export const mealTemplates: MealTemplate[] = [
  {
    id: 't1',
    name: 'Cơm ức gà áp chảo + Rau muống',
    context: ['home', 'office', 'after-workout'],
    fallback_level: 2,
    swap_keys: ['protein_swap_A', 'carb_swap_A', 'veg_swap_A'],
    taste_profile: ['mặn'],
    items: [
      { foodId: 'f1', multiplier: 1 }, // Cơm
      { foodId: 'f2', multiplier: 1 }, // Ức gà
      { foodId: 'f3', multiplier: 1 }  // Rau muống
    ],
    base_macros: { kcal: 433, protein: 43.5, carb: 42, fat: 8.6 }
  },
  {
    id: 't2',
    name: 'Phở bò tái (ít bánh)',
    context: ['eatout', 'office'],
    fallback_level: 1,
    swap_keys: ['eatout_noodle_swap'],
    taste_profile: ['mặn'],
    items: [
      { foodId: 'f4', multiplier: 1 }
    ],
    base_macros: { kcal: 350, protein: 25, carb: 40, fat: 10 }
  },
  {
    id: 't3',
    name: 'Bữa phụ: Sữa chua + Trứng luộc',
    context: ['office', 'home', 'pms'],
    fallback_level: 1,
    swap_keys: ['snack_swap_A'],
    taste_profile: ['nhạt'],
    items: [
      { foodId: 'f5', multiplier: 1 }, // Trứng
      { foodId: 'f6', multiplier: 1 }  // Sữa chua
    ],
    base_macros: { kcal: 138, protein: 9.8, carb: 5.1, fat: 8.3 }
  },
  {
    id: 't4',
    name: 'Khoai lang + Đậu hũ non xì dầu',
    context: ['home', 'pms'],
    fallback_level: 1,
    swap_keys: ['carb_swap_A', 'protein_swap_B'],
    taste_profile: ['nhạt', 'mặn'],
    items: [
      { foodId: 'f9', multiplier: 1 }, // Khoai lang
      { foodId: 'f8', multiplier: 1 }  // Đậu hũ
    ],
    base_macros: { kcal: 202, protein: 11, carb: 29, fat: 4.6 }
  },
  {
    id: 't5',
    name: 'Cơm thịt băm xào cà chua',
    context: ['home'],
    fallback_level: 2,
    swap_keys: ['protein_swap_A', 'carb_swap_A'],
    taste_profile: ['mặn'],
    items: [
      { foodId: 'f1', multiplier: 1 }, // Cơm
      { foodId: 'f10', multiplier: 1 }, // Thịt băm
      { foodId: 'f3', multiplier: 0.5 } // Rau muống (nửa đĩa)
    ],
    base_macros: { kcal: 412, protein: 23, carb: 43.5, fat: 15.3 }
  }
,
  {
    id: 't6',
    name: 'Cơm trắng + Cá hồi áp chảo + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":391,"protein":26,"carb":41,"fat":13}
  },
  {
    id: 't7',
    name: 'Yến mạch (khô) + Trứng gà luộc + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f5","multiplier":2},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":329,"protein":19,"carb":32,"fat":13}
  },
  {
    id: 't8',
    name: 'Bún tươi + Cá lóc kho tộ + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f37","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":333,"protein":21,"carb":45,"fat":7}
  },
  {
    id: 't9',
    name: 'Miến dong (khô) + Thịt bò luộc (bắp) + Rau muống luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f57","multiplier":1}],
    base_macros: {"kcal":376,"protein":31,"carb":46,"fat":7}
  },
  {
    id: 't10',
    name: 'Cơm gạo lứt + Mực ống hấp + Rau muống luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f42","multiplier":1},{"foodId":"f57","multiplier":1}],
    base_macros: {"kcal":267,"protein":22,"carb":38,"fat":3}
  },
  {
    id: 't11',
    name: 'Khoai lang luộc + Thịt bò luộc (bắp) + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":307,"protein":31,"carb":30,"fat":7}
  },
  {
    id: 't12',
    name: 'Ngô ngọt luộc + Ức gà luộc + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f18","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":286,"protein":41,"carb":27,"fat":4}
  },
  {
    id: 't13',
    name: 'Ngô ngọt luộc + Thịt bò xào (nạc) + Súp lơ xanh luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f18","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":341,"protein":32,"carb":28,"fat":14}
  },
  {
    id: 't14',
    name: 'Ngô ngọt luộc + Thịt bò luộc (bắp) + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f18","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":301,"protein":33,"carb":27,"fat":8}
  },
  {
    id: 't15',
    name: 'Cơm gạo lứt + Thịt bò luộc (bắp) + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":340,"protein":32,"carb":34,"fat":8}
  },
  {
    id: 't16',
    name: 'Miến dong (khô) + Thịt bò luộc (bắp) + Súp lơ xanh luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":381,"protein":31,"carb":48,"fat":7}
  },
  {
    id: 't17',
    name: 'Cơm gạo lứt + Cá hồi áp chảo + Xà lách trộn dầu giấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":411,"protein":26,"carb":33,"fat":19}
  },
  {
    id: 't18',
    name: 'Miến dong (khô) + Thịt băm xào cà chua + Cải ngọt luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f10","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":401,"protein":20,"carb":49,"fat":13}
  },
  {
    id: 't19',
    name: 'Miến dong (khô) + Trứng gà luộc + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f5","multiplier":2},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":340,"protein":14,"carb":46,"fat":11}
  },
  {
    id: 't20',
    name: 'Khoai lang luộc + Tôm sú luộc + Súp lơ xanh luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":246,"protein":29,"carb":33,"fat":1}
  },
  {
    id: 't21',
    name: 'Khoai lang luộc + Đậu hũ non + Rau muống xào tỏi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f3","multiplier":1}],
    base_macros: {"kcal":267,"protein":14,"carb":34,"fat":9}
  },
  {
    id: 't22',
    name: 'Ngô ngọt luộc + Đậu hũ non + Xà lách trộn dầu giấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f18","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":236,"protein":13,"carb":25,"fat":11}
  },
  {
    id: 't23',
    name: 'Khoai lang luộc + Ức gà luộc + Cải ngọt luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":302,"protein":40,"carb":30,"fat":3}
  },
  {
    id: 't24',
    name: 'Khoai tây luộc + Ức gà luộc + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":310,"protein":40,"carb":34,"fat":3}
  },
  {
    id: 't25',
    name: 'Cơm gạo lứt + Thịt bò xào (nạc) + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":383,"protein":30,"carb":36,"fat":13}
  },
  {
    id: 't26',
    name: 'Bánh mì đen + Thịt bò xào (nạc) + Rau muống xào tỏi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f16","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f3","multiplier":1}],
    base_macros: {"kcal":435,"protein":34,"carb":35,"fat":18}
  },
  {
    id: 't27',
    name: 'Yến mạch (khô) + Ức gà áp chảo + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":371,"protein":43,"carb":31,"fat":7}
  },
  {
    id: 't28',
    name: 'Cơm gạo lứt + Thịt băm xào cà chua + Xà lách trộn dầu giấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f10","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":415,"protein":22,"carb":37,"fat":19}
  },
  {
    id: 't29',
    name: 'Khoai tây luộc + Ức gà áp chảo + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":346,"protein":41,"carb":34,"fat":5}
  },
  {
    id: 't30',
    name: 'Khoai tây luộc + Ức gà luộc + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":330,"protein":41,"carb":38,"fat":3}
  },
  {
    id: 't31',
    name: 'Miến dong (khô) + Ức gà áp chảo + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":379,"protein":38,"carb":45,"fat":4}
  },
  {
    id: 't32',
    name: 'Bún tươi + Thịt bò xào (nạc) + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":403,"protein":29,"carb":44,"fat":12}
  },
  {
    id: 't33',
    name: 'Khoai lang luộc + Thịt bò luộc (bắp) + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":307,"protein":31,"carb":30,"fat":7}
  },
  {
    id: 't34',
    name: 'Khoai lang luộc + Mực ống hấp + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f42","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":239,"protein":20,"carb":37,"fat":2}
  },
  {
    id: 't35',
    name: 'Miến dong (khô) + Ức gà luộc + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":349,"protein":37,"carb":45,"fat":3}
  },
  {
    id: 't36',
    name: 'Bún tươi + Ức gà luộc + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":348,"protein":39,"carb":42,"fat":3}
  },
  {
    id: 't37',
    name: 'Miến dong (khô) + Ức gà luộc + Rau muống luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f57","multiplier":1}],
    base_macros: {"kcal":361,"protein":39,"carb":46,"fat":3}
  },
  {
    id: 't38',
    name: 'Cơm trắng + Thịt lợn nạc vai luộc + Xà lách trộn dầu giấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f34","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":420,"protein":32,"carb":40,"fat":14}
  },
  {
    id: 't39',
    name: 'Yến mạch (khô) + Trứng gà luộc + Súp lơ xanh luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f5","multiplier":2},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":346,"protein":21,"carb":35,"fat":14}
  },
  {
    id: 't40',
    name: 'Bún tươi + Tôm sú luộc + Cải ngọt luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":289,"protein":29,"carb":42,"fat":1}
  },
  {
    id: 't41',
    name: 'Miến dong (khô) + Ức gà luộc + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":349,"protein":37,"carb":45,"fat":3}
  },
  {
    id: 't42',
    name: 'Yến mạch (khô) + Thịt bò xào (nạc) + Cải ngọt luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":400,"protein":34,"carb":33,"fat":15}
  },
  {
    id: 't43',
    name: 'Cơm trắng + Thịt lợn nạc vai luộc + Xà lách trộn dầu giấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f34","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":420,"protein":32,"carb":40,"fat":14}
  },
  {
    id: 't44',
    name: 'Bánh mì đen + Ức gà luộc + Rau muống xào tỏi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f16","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f3","multiplier":1}],
    base_macros: {"kcal":380,"protein":44,"carb":33,"fat":9}
  },
  {
    id: 't45',
    name: 'Bún tươi + Tôm sú luộc + Súp lơ xanh luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":299,"protein":30,"carb":45,"fat":1}
  },
  {
    id: 't46',
    name: 'Yến mạch (khô) + Ức gà áp chảo + Cà chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":371,"protein":43,"carb":31,"fat":7}
  },
  {
    id: 't47',
    name: 'Cơm gạo lứt + Cá hồi áp chảo + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":366,"protein":26,"carb":34,"fat":14}
  },
  {
    id: 't48',
    name: 'Miến dong (khô) + Cá hồi áp chảo + Súp lơ xanh luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":407,"protein":25,"carb":48,"fat":13}
  },
  {
    id: 't49',
    name: 'Yến mạch (khô) + Mực ống hấp + Cải ngọt luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f42","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":272,"protein":24,"carb":34,"fat":4}
  },
  {
    id: 't50',
    name: 'Yến mạch (khô) + Thịt bò xào (nạc) + Rau muống xào tỏi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f3","multiplier":1}],
    base_macros: {"kcal":440,"protein":35,"carb":34,"fat":19}
  },
  {
    id: 't51',
    name: 'Bún tươi + Ức gà áp chảo + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":378,"protein":40,"carb":42,"fat":5}
  },
  {
    id: 't52',
    name: 'Cơm gạo lứt + Thịt bò xào (nạc) + Xà lách trộn dầu giấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":425,"protein":30,"carb":35,"fat":18}
  },
  {
    id: 't53',
    name: 'Miến dong (khô) + Tôm sú luộc + Dưa leo (Dưa chuột)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":280,"protein":25,"carb":45,"fat":0}
  },
  {
    id: 't54',
    name: 'Miến dong (khô) + Mực ống hấp + Cải ngọt luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f42","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":283,"protein":18,"carb":48,"fat":2}
  },
  {
    id: 't55',
    name: 'Bánh mì đen + Đậu hũ non + Xà lách trộn dầu giấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: ["protein_swap_A","carb_swap_A","veg_swap_A"],
    taste_profile: ["mặn"],
    items: [{"foodId":"f16","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":300,"protein":15,"carb":34,"fat":12}
  },
  {
    id: 't56',
    name: 'Bữa phụ: Socola đen 70% + Sữa chua không đường',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f89","multiplier":1},{"foodId":"f6","multiplier":1}],
    base_macros: {"kcal":180,"protein":5,"carb":14,"fat":11}
  },
  {
    id: 't57',
    name: 'Bữa phụ: Hạnh nhân + Hạt điều rang',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f86","multiplier":1},{"foodId":"f85","multiplier":1}],
    base_macros: {"kcal":335,"protein":11,"carb":15,"fat":28}
  },
  {
    id: 't58',
    name: 'Bữa phụ: Táo + Socola đen 70%',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f78","multiplier":1},{"foodId":"f89","multiplier":1}],
    base_macros: {"kcal":198,"protein":2,"carb":30,"fat":8}
  },
  {
    id: 't59',
    name: 'Bữa phụ: Táo + Socola đen 70%',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f78","multiplier":1},{"foodId":"f89","multiplier":1}],
    base_macros: {"kcal":198,"protein":2,"carb":30,"fat":8}
  },
  {
    id: 't60',
    name: 'Bữa phụ: Socola đen 70% + Hạt điều rang',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f89","multiplier":1},{"foodId":"f85","multiplier":1}],
    base_macros: {"kcal":285,"protein":7,"carb":18,"fat":21}
  },
  {
    id: 't61',
    name: 'Bữa phụ: Socola đen 70% + Sữa chua không đường',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f89","multiplier":1},{"foodId":"f6","multiplier":1}],
    base_macros: {"kcal":180,"protein":5,"carb":14,"fat":11}
  },
  {
    id: 't62',
    name: 'Bữa phụ: Hạt điều rang + Chuối tây',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f85","multiplier":1},{"foodId":"f77","multiplier":1}],
    base_macros: {"kcal":254,"protein":6,"carb":32,"fat":13}
  },
  {
    id: 't63',
    name: 'Bữa phụ: Táo + Hạnh nhân',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f78","multiplier":1},{"foodId":"f86","multiplier":1}],
    base_macros: {"kcal":248,"protein":6,"carb":27,"fat":15}
  },
  {
    id: 't64',
    name: 'Bữa phụ: Socola đen 70% + Chuối tây',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f89","multiplier":1},{"foodId":"f77","multiplier":1}],
    base_macros: {"kcal":209,"protein":3,"carb":32,"fat":8}
  },
  {
    id: 't65',
    name: 'Bữa phụ: Sữa chua không đường + Socola đen 70%',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f6","multiplier":1},{"foodId":"f89","multiplier":1}],
    base_macros: {"kcal":180,"protein":5,"carb":14,"fat":11}
  },
  {
    id: 't66',
    name: 'Bữa phụ: Chuối tây + Táo',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f77","multiplier":1},{"foodId":"f78","multiplier":1}],
    base_macros: {"kcal":167,"protein":2,"carb":44,"fat":1}
  },
  {
    id: 't67',
    name: 'Bữa phụ: Hạnh nhân + Chuối tây',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f86","multiplier":1},{"foodId":"f77","multiplier":1}],
    base_macros: {"kcal":259,"protein":7,"carb":29,"fat":15}
  },
  {
    id: 't68',
    name: 'Bữa phụ: Chuối tây + Hạt điều rang',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f77","multiplier":1},{"foodId":"f85","multiplier":1}],
    base_macros: {"kcal":254,"protein":6,"carb":32,"fat":13}
  },
  {
    id: 't69',
    name: 'Bữa phụ: Hạt điều rang + Sữa chua không đường',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f85","multiplier":1},{"foodId":"f6","multiplier":1}],
    base_macros: {"kcal":225,"protein":9,"carb":14,"fat":16}
  },
  {
    id: 't70',
    name: 'Bữa phụ: Chuối tây + Hạt điều rang',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f77","multiplier":1},{"foodId":"f85","multiplier":1}],
    base_macros: {"kcal":254,"protein":6,"carb":32,"fat":13}
  },
  {
    id: 't71',
    name: 'Bữa phụ: Táo + Hạt điều rang',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f78","multiplier":1},{"foodId":"f85","multiplier":1}],
    base_macros: {"kcal":243,"protein":5,"carb":30,"fat":13}
  },
  {
    id: 't72',
    name: 'Bữa phụ: Táo + Socola đen 70%',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f78","multiplier":1},{"foodId":"f89","multiplier":1}],
    base_macros: {"kcal":198,"protein":2,"carb":30,"fat":8}
  },
  {
    id: 't73',
    name: 'Bữa phụ: Chuối tây + Sữa chua không đường',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f77","multiplier":1},{"foodId":"f6","multiplier":1}],
    base_macros: {"kcal":149,"protein":5,"carb":28,"fat":3}
  },
  {
    id: 't74',
    name: 'Bữa phụ: Chuối tây + Sữa chua không đường',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f77","multiplier":1},{"foodId":"f6","multiplier":1}],
    base_macros: {"kcal":149,"protein":5,"carb":28,"fat":3}
  },
  {
    id: 't75',
    name: 'Bữa phụ: Chuối tây + Sữa chua không đường',
    context: ["office","home"],
    fallback_level: 1,
    swap_keys: ["snack_swap_A"],
    taste_profile: ["nhạt","ngọt"],
    items: [{"foodId":"f77","multiplier":1},{"foodId":"f6","multiplier":1}],
    base_macros: {"kcal":149,"protein":5,"carb":28,"fat":3}
  }
,
  {
    id: 't76',
    name: 'Bữa sáng: Phở bò tái',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f4","multiplier":1}],
    base_macros: {"kcal":450,"protein":25,"carb":60,"fat":12}
  },
  {
    id: 't77',
    name: 'Bữa sáng: Bún bò Huế',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f94","multiplier":1}],
    base_macros: {"kcal":550,"protein":30,"carb":65,"fat":18}
  },
  {
    id: 't78',
    name: 'Bữa sáng: Bánh mì thịt chả',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f97","multiplier":1}],
    base_macros: {"kcal":450,"protein":18,"carb":50,"fat":20}
  },
  {
    id: 't79',
    name: 'Bữa sáng: Hủ tiếu Nam Vang',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f98","multiplier":1}],
    base_macros: {"kcal":480,"protein":22,"carb":65,"fat":14}
  },
  {
    id: 't80',
    name: 'Bữa sáng: Mì Quảng',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f102","multiplier":1}],
    base_macros: {"kcal":500,"protein":28,"carb":60,"fat":16}
  },
  {
    id: 't81',
    name: 'Bữa sáng: Xôi gấc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f21","multiplier":1}],
    base_macros: {"kcal":290,"protein":6,"carb":62,"fat":1.5}
  },
  {
    id: 't82',
    name: 'Bữa sáng: Xôi xéo',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f22","multiplier":1}],
    base_macros: {"kcal":310,"protein":7,"carb":58,"fat":5}
  },
  {
    id: 't83',
    name: 'Bữa sáng: Bánh chưng',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f23","multiplier":1}],
    base_macros: {"kcal":200,"protein":6,"carb":28,"fat":7}
  },
  {
    id: 't84',
    name: 'Bữa sáng: Bánh bao (chay)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f24","multiplier":1}],
    base_macros: {"kcal":220,"protein":6,"carb":45,"fat":1.5}
  },
  {
    id: 't85',
    name: 'Bữa sáng: Bánh cuốn (chay)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f20","multiplier":1}],
    base_macros: {"kcal":280,"protein":4,"carb":60,"fat":2}
  },
  {
    id: 't86',
    name: 'Bữa sáng: Bánh mì ốp la',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn","ngọt"],
    items: [{"foodId":"f15","multiplier":1},{"foodId":"f44","multiplier":1}],
    base_macros: {"kcal":440,"protein":20,"carb":46,"fat":19}
  },
  {
    id: 't87',
    name: 'Bữa sáng: Yến mạch sữa chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn","ngọt"],
    items: [{"foodId":"f19","multiplier":1},{"foodId":"f6","multiplier":1}],
    base_macros: {"kcal":215,"protein":9,"carb":32,"fat":6}
  },
  {
    id: 't88',
    name: 'Bữa sáng: Granola sữa chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn","ngọt"],
    items: [{"foodId":"f109","multiplier":1},{"foodId":"f108","multiplier":1}],
    base_macros: {"kcal":240,"protein":14,"carb":20,"fat":12}
  },
  {
    id: 't89',
    name: 'Bữa sáng: Bánh mì đen bơ đậu phộng',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn","ngọt"],
    items: [{"foodId":"f16","multiplier":1},{"foodId":"f84","multiplier":1}],
    base_macros: {"kcal":310,"protein":7,"carb":36,"fat":17}
  },
  {
    id: 't90',
    name: 'Bữa sáng: Khoai lang luộc & Trứng luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn","ngọt"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f5","multiplier":2}],
    base_macros: {"kcal":268,"protein":15,"carb":27,"fat":11}
  },
  {
    id: 't91',
    name: 'Bữa chính: Mì Soba cá hồi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f106","multiplier":1}],
    base_macros: {"kcal":345,"protein":30,"carb":25,"fat":14}
  },
  {
    id: 't92',
    name: 'Bữa chính: Udon xào bò',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f104","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":515,"protein":37,"carb":62,"fat":13}
  },
  {
    id: 't93',
    name: 'Bữa chính: Cơm gạo lứt & Sashimi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f105","multiplier":1}],
    base_macros: {"kcal":368,"protein":24,"carb":32,"fat":14}
  },
  {
    id: 't94',
    name: 'Bữa chính: Bít tết măng tây',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f111","multiplier":1},{"foodId":"f114","multiplier":1}],
    base_macros: {"kcal":525,"protein":41,"carb":35,"fat":24}
  },
  {
    id: 't95',
    name: 'Bữa chính: Salad Caesar Ức gà',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f16","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f113","multiplier":1}],
    base_macros: {"kcal":528,"protein":47,"carb":36,"fat":21}
  }
,
  {
    id: 't96',
    name: 'Bữa chính: Cơm gạo lứt Cá lóc kho tộ',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f37","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":340,"protein":26,"carb":37,"fat":9}
  },
  {
    id: 't97',
    name: 'Bữa chính: Bún bò xào Nam Bộ (Eat Clean)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":445,"protein":30,"carb":43,"fat":17}
  },
  {
    id: 't98',
    name: 'Bữa chính: Khoai lang Ức gà luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f57","multiplier":1}],
    base_macros: {"kcal":307,"protein":41,"carb":31,"fat":3}
  },
  {
    id: 't99',
    name: 'Bữa chính: Cơm trắng Tôm rang thịt',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f41","multiplier":1},{"foodId":"f64","multiplier":1}],
    base_macros: {"kcal":500,"protein":28,"carb":46,"fat":22}
  },
  {
    id: 't100',
    name: 'Bữa chính: Miến xào thịt băm nấm',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f10","multiplier":1},{"foodId":"f75","multiplier":1}],
    base_macros: {"kcal":456,"protein":22,"carb":53,"fat":17}
  },
  {
    id: 't101',
    name: 'Bữa chính: Cơm gạo lứt Đậu hũ chiên',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f46","multiplier":1},{"foodId":"f59","multiplier":1}],
    base_macros: {"kcal":465,"protein":21,"carb":40,"fat":25}
  },
  {
    id: 't102',
    name: 'Bữa chính: Khoai tây Sườn non rim',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f36","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":445,"protein":25,"carb":43,"fat":20}
  },
  {
    id: 't103',
    name: 'Bữa chính: Cơm trắng Mực xào cần tỏi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f43","multiplier":1},{"foodId":"f65","multiplier":1}],
    base_macros: {"kcal":430,"protein":32,"carb":53,"fat":9}
  },
  {
    id: 't104',
    name: 'Bữa chính: Cơm gạo lứt Bò xào Kim chi (Hàn)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f105","multiplier":1},{"foodId":"f106","multiplier":1}],
    base_macros: {"kcal":420,"protein":33,"carb":38,"fat":14}
  },
  {
    id: 't105',
    name: 'Bữa chính: Cơm Cá hồi áp chảo (Nhật)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f106","multiplier":1},{"foodId":"f107","multiplier":1}],
    base_macros: {"kcal":436,"protein":31,"carb":43,"fat":15}
  },
  {
    id: 't106',
    name: 'Bữa chính: Udon Tôm sú (Nhật)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f104","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":384,"protein":34,"carb":57,"fat":1}
  },
  {
    id: 't107',
    name: 'Bữa chính: Soba Đậu hũ non (Nhật chay)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f107","multiplier":1},{"foodId":"f66","multiplier":1}],
    base_macros: {"kcal":224,"protein":17,"carb":30,"fat":6}
  },
  {
    id: 't108',
    name: 'Bữa chính: Bít tết bò Salad Caesar (Tây)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f111","multiplier":1},{"foodId":"f113","multiplier":1}],
    base_macros: {"kcal":660,"protein":43,"carb":38,"fat":37}
  },
  {
    id: 't109',
    name: 'Bữa chính: Bánh mì đen Cá ngừ Salad (Tây)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f16","multiplier":1},{"foodId":"f51","multiplier":1},{"foodId":"f67","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":338,"protein":32,"carb":35,"fat":8}
  },
  {
    id: 't110',
    name: 'Bữa chính: Khoai lang Ức gà Măng tây (Tây)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f114","multiplier":1}],
    base_macros: {"kcal":355,"protein":42,"carb":31,"fat":6}
  },
  {
    id: 't111',
    name: 'Bữa chính: Miến Sashimi Kim chi (Fusion)',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f105","multiplier":1}],
    base_macros: {"kcal":389,"protein":21,"carb":43,"fat":13}
  },
  {
    id: 't112',
    name: 'Bữa chính: Cơm gạo lứt Thịt luộc Rau dền',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f34","multiplier":1},{"foodId":"f72","multiplier":1}],
    base_macros: {"kcal":370,"protein":34,"carb":36,"fat":10}
  },
  {
    id: 't113',
    name: 'Bữa chính: Bún Chả lụa Dưa leo',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f47","multiplier":1},{"foodId":"f66","multiplier":1},{"foodId":"f67","multiplier":1}],
    base_macros: {"kcal":298,"protein":12,"carb":48,"fat":8}
  },
  {
    id: 't114',
    name: 'Bữa chính: Cơm trắng Cua biển Súp lơ',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f54","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":290,"protein":25,"carb":44,"fat":2}
  },
  {
    id: 't115',
    name: 'Bữa chính: Phở khô Nghêu hấp Cải thìa',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f26","multiplier":1},{"foodId":"f53","multiplier":1},{"foodId":"f59","multiplier":1}],
    base_macros: {"kcal":325,"protein":20,"carb":50,"fat":6}
  }
,
  {
    id: 't116',
    name: 'Bữa chính: Bún tươi + Thịt bò luộc + Măng tây',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f114","multiplier":1}],
    base_macros: {"kcal":390,"protein":34,"carb":43,"fat":9}
  },
  {
    id: 't117',
    name: 'Bữa chính: Mì Soba + Đậu hũ non + Xà lách trộn',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":249,"protein":15,"carb":27,"fat":10}
  },
  {
    id: 't118',
    name: 'Bữa chính: Bún tươi + Tôm sú + Xà lách trộn',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":324,"protein":28,"carb":41,"fat":6}
  },
  {
    id: 't119',
    name: 'Bữa chính: Mì Soba + Cá lóc kho + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f37","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":284,"protein":25,"carb":32,"fat":7}
  },
  {
    id: 't120',
    name: 'Bữa chính: Miến dong + Tôm sú + Súp lơ xanh',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":300,"protein":27,"carb":48,"fat":1}
  },
  {
    id: 't121',
    name: 'Bữa chính: Mì Udon + Sashimi + Đậu cô ve xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f104","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f69","multiplier":1}],
    base_macros: {"kcal":553,"protein":31,"carb":63,"fat":18}
  },
  {
    id: 't122',
    name: 'Bữa chính: Khoai tây + Cá hồi + Canh mồng tơi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":381,"protein":30,"carb":34,"fat":14}
  },
  {
    id: 't123',
    name: 'Bữa chính: Cơm trắng + Đậu hũ chiên + Canh chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f46","multiplier":1},{"foodId":"f65","multiplier":1}],
    base_macros: {"kcal":540,"protein":29,"carb":51,"fat":24}
  },
  {
    id: 't124',
    name: 'Bữa chính: Mì Soba + Đậu hũ non + Canh bí đao',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f64","multiplier":1}],
    base_macros: {"kcal":269,"protein":20,"carb":29,"fat":9}
  },
  {
    id: 't125',
    name: 'Bữa chính: Khoai lang + Mực xào + Cải thìa xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f43","multiplier":1},{"foodId":"f59","multiplier":1}],
    base_macros: {"kcal":322,"protein":23,"carb":38,"fat":9}
  },
  {
    id: 't126',
    name: 'Bữa chính: Cơm gạo lứt + Đậu hũ chiên + Canh bí đao',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f46","multiplier":1},{"foodId":"f64","multiplier":1}],
    base_macros: {"kcal":475,"protein":24,"carb":39,"fat":25}
  },
  {
    id: 't127',
    name: 'Bữa chính: Khoai tây + Cá lóc kho + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f37","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":315,"protein":23,"carb":41,"fat":7}
  },
  {
    id: 't128',
    name: 'Bữa chính: Khoai tây + Thịt lợn nạc + Kim chi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f34","multiplier":1},{"foodId":"f105","multiplier":1}],
    base_macros: {"kcal":335,"protein":31,"carb":32,"fat":9}
  },
  {
    id: 't129',
    name: 'Bữa chính: Miến dong + Cá hồi + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":407,"protein":24,"carb":49,"fat":13}
  },
  {
    id: 't130',
    name: 'Bữa chính: Cơm gạo lứt + Cá hồi + Canh mồng tơi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":396,"protein":30,"carb":34,"fat":15}
  },
  {
    id: 't131',
    name: 'Bữa chính: Mì Soba + Mực xào + Xà lách trộn',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f43","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":299,"protein":24,"carb":30,"fat":10}
  },
  {
    id: 't132',
    name: 'Bữa chính: Bún tươi + Trứng luộc + Xà lách trộn',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f5","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":303,"protein":10,"carb":42,"fat":11}
  },
  {
    id: 't133',
    name: 'Bữa chính: Mì Soba + Trứng luộc + Kim chi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f5","multiplier":1},{"foodId":"f105","multiplier":1}],
    base_macros: {"kcal":192,"protein":12,"carb":24,"fat":5}
  },
  {
    id: 't134',
    name: 'Bữa chính: Cơm trắng + Đậu hũ chiên + Súp Miso',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f46","multiplier":1},{"foodId":"f106","multiplier":1}],
    base_macros: {"kcal":460,"protein":22,"carb":45,"fat":21}
  },
  {
    id: 't135',
    name: 'Bữa chính: Mì Soba + Tôm sú + Kim chi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f105","multiplier":1}],
    base_macros: {"kcal":213,"protein":30,"carb":23,"fat":0}
  },
  {
    id: 't136',
    name: 'Bữa chính: Miến dong + Sashimi + Xà lách trộn',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f14","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":434,"protein":21,"carb":44,"fat":18}
  },
  {
    id: 't137',
    name: 'Bữa chính: Mì Udon + Cá hồi + Bắp cải luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f104","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f61","multiplier":1}],
    base_macros: {"kcal":501,"protein":32,"carb":61,"fat":14}
  },
  {
    id: 't138',
    name: 'Bữa chính: Mì Soba + Đậu hũ non + Măng tây',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f114","multiplier":1}],
    base_macros: {"kcal":234,"protein":17,"carb":29,"fat":7}
  },
  {
    id: 't139',
    name: 'Bữa chính: Mì Udon + Thịt bò luộc + Súp Miso',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f104","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f106","multiplier":1}],
    base_macros: {"kcal":480,"protein":39,"carb":57,"fat":9}
  },
  {
    id: 't140',
    name: 'Bữa chính: Khoai tây + Cá lóc kho + Canh mồng tơi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f37","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":325,"protein":26,"carb":37,"fat":8}
  },
  {
    id: 't141',
    name: 'Bữa chính: Cơm gạo lứt + Thịt lợn nạc + Rau muống xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f34","multiplier":1},{"foodId":"f3","multiplier":1}],
    base_macros: {"kcal":400,"protein":33,"carb":35,"fat":14}
  },
  {
    id: 't142',
    name: 'Bữa chính: Khoai lang + Đậu hũ non + Cải thìa xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f59","multiplier":1}],
    base_macros: {"kcal":272,"protein":14,"carb":35,"fat":9}
  },
  {
    id: 't143',
    name: 'Bữa chính: Mì Soba + Thịt bò luộc + Xà lách trộn',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":339,"protein":34,"carb":24,"fat":12}
  },
  {
    id: 't144',
    name: 'Bữa chính: Cơm gạo lứt + Thịt lợn nạc + Cải thìa xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f34","multiplier":1},{"foodId":"f59","multiplier":1}],
    base_macros: {"kcal":405,"protein":33,"carb":36,"fat":14}
  },
  {
    id: 't145',
    name: 'Bữa chính: Khoai tây + Bít tết bò + Canh mồng tơi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f111","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":525,"protein":43,"carb":34,"fat":23}
  },
  {
    id: 't146',
    name: 'Bữa chính: Bún tươi + Cá hồi + Canh chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f65","multiplier":1}],
    base_macros: {"kcal":491,"protein":35,"carb":48,"fat":17}
  },
  {
    id: 't147',
    name: 'Bữa chính: Khoai tây + Cá lóc kho + Măng tây',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f37","multiplier":1},{"foodId":"f114","multiplier":1}],
    base_macros: {"kcal":325,"protein":24,"carb":38,"fat":9}
  },
  {
    id: 't148',
    name: 'Bữa chính: Khoai tây + Mực xào + Rau muống xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f43","multiplier":1},{"foodId":"f3","multiplier":1}],
    base_macros: {"kcal":335,"protein":24,"carb":41,"fat":9}
  },
  {
    id: 't149',
    name: 'Bữa chính: Bún tươi + Thịt lợn nạc + Canh mồng tơi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f12","multiplier":1},{"foodId":"f34","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":400,"protein":35,"carb":42,"fat":10}
  },
  {
    id: 't150',
    name: 'Bữa chính: Khoai lang + Đậu hũ non + Xà lách trộn',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f8","multiplier":1},{"foodId":"f68","multiplier":1}],
    base_macros: {"kcal":262,"protein":12,"carb":32,"fat":10}
  },
  {
    id: 't151',
    name: 'Bữa chính: Cơm gạo lứt + Thịt bò luộc + Súp lơ xanh',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f33","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":360,"protein":34,"carb":37,"fat":9}
  },
  {
    id: 't152',
    name: 'Bữa chính: Cơm gạo lứt + Cá hồi + Canh mồng tơi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f38","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":396,"protein":30,"carb":34,"fat":15}
  },
  {
    id: 't153',
    name: 'Bữa chính: Mì Soba + Sashimi + Cải ngọt luộc',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f58","multiplier":1}],
    base_macros: {"kcal":332,"protein":27,"carb":25,"fat":13}
  },
  {
    id: 't154',
    name: 'Bữa chính: Khoai tây + Cá lóc kho + Măng tây',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f37","multiplier":1},{"foodId":"f114","multiplier":1}],
    base_macros: {"kcal":325,"protein":24,"carb":38,"fat":9}
  },
  {
    id: 't155',
    name: 'Bữa chính: Cơm trắng + Ức gà áp chảo + Kim chi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f2","multiplier":1},{"foodId":"f105","multiplier":1}],
    base_macros: {"kcal":383,"protein":42,"carb":39,"fat":5}
  },
  {
    id: 't156',
    name: 'Bữa chính: Cơm trắng + Sashimi + Măng tây',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f114","multiplier":1}],
    base_macros: {"kcal":423,"protein":27,"carb":42,"fat":15}
  },
  {
    id: 't157',
    name: 'Bữa chính: Mì Soba + Ức gà luộc + Kim chi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f30","multiplier":1},{"foodId":"f105","multiplier":1}],
    base_macros: {"kcal":279,"protein":42,"carb":23,"fat":3}
  },
  {
    id: 't158',
    name: 'Bữa chính: Khoai lang + Thịt bò xào + Cải thìa xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f59","multiplier":1}],
    base_macros: {"kcal":402,"protein":31,"carb":34,"fat":16}
  },
  {
    id: 't159',
    name: 'Bữa chính: Mì Udon + Đậu hũ chiên + Canh chua',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f104","multiplier":1},{"foodId":"f46","multiplier":1},{"foodId":"f65","multiplier":1}],
    base_macros: {"kcal":630,"protein":33,"carb":67,"fat":25}
  },
  {
    id: 't160',
    name: 'Bữa chính: Mì Soba + Tôm sú + Canh mồng tơi',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f103","multiplier":1},{"foodId":"f40","multiplier":1},{"foodId":"f63","multiplier":1}],
    base_macros: {"kcal":243,"protein":34,"carb":25,"fat":1}
  },
  {
    id: 't161',
    name: 'Bữa chính: Cơm gạo lứt + Trứng luộc + Đậu cô ve xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f5","multiplier":1},{"foodId":"f69","multiplier":1}],
    base_macros: {"kcal":308,"protein":12,"carb":41,"fat":11}
  },
  {
    id: 't162',
    name: 'Bữa chính: Khoai lang + Thịt bò xào + Rau muống xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f17","multiplier":1},{"foodId":"f32","multiplier":1},{"foodId":"f3","multiplier":1}],
    base_macros: {"kcal":397,"protein":31,"carb":33,"fat":16}
  },
  {
    id: 't163',
    name: 'Bữa chính: Cơm gạo lứt + Sashimi + Súp lơ xanh',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f11","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":388,"protein":26,"carb":37,"fat":15}
  },
  {
    id: 't164',
    name: 'Bữa chính: Khoai tây + Sashimi + Cải thìa xào',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f25","multiplier":1},{"foodId":"f112","multiplier":1},{"foodId":"f59","multiplier":1}],
    base_macros: {"kcal":408,"protein":26,"carb":36,"fat":17}
  },
  {
    id: 't165',
    name: 'Bữa chính: Cơm trắng + Trứng luộc + Súp lơ xanh',
    context: ["home","office"],
    fallback_level: 2,
    swap_keys: [],
    taste_profile: ["mặn"],
    items: [{"foodId":"f1","multiplier":1},{"foodId":"f5","multiplier":1},{"foodId":"f60","multiplier":1}],
    base_macros: {"kcal":283,"protein":13,"carb":45,"fat":6}
  }
];