import { SwapRule } from '../types';

export const swapRules: SwapRule[] = [
  {
    id: 'sr1',
    swap_key: 'protein_swap_A',
    options: [
      { foodId: 'f2', multiplier: 1 }, // 120g ức gà
      { foodId: 'f30', multiplier: 1 }, // 120g ức gà luộc
      { foodId: 'f31', multiplier: 1.2 }, // Đùi gà luộc
      { foodId: 'f32', multiplier: 1 }, // Thịt bò xào
      { foodId: 'f33', multiplier: 1 }, // Thịt bò luộc
      { foodId: 'f34', multiplier: 1 }, // Thịt lợn nạc vai
      { foodId: 'f38', multiplier: 1 }, // Cá hồi
      { foodId: 'f39', multiplier: 1.5 }, // Cá diêu hồng
      { foodId: 'f40', multiplier: 1.5 }, // Tôm sú
      { foodId: 'f42', multiplier: 1.5 }, // Mực ống
      { foodId: 'f5', multiplier: 3 }, // 3 quả trứng
      { foodId: 'f8', multiplier: 2 }, // 300g đậu hũ non
      { foodId: 'f10', multiplier: 1.5 } // 150g thịt băm
    ]
  },
  {
    id: 'sr2',
    swap_key: 'carb_swap_A',
    options: [
      { foodId: 'f1', multiplier: 1 }, // 1 bát cơm trắng
      { foodId: 'f11', multiplier: 1 }, // 1 bát cơm lứt
      { foodId: 'f12', multiplier: 1 }, // Bún tươi
      { foodId: 'f13', multiplier: 1 }, // Phở tươi
      { foodId: 'f17', multiplier: 1.5 }, // Khoai lang
      { foodId: 'f18', multiplier: 1.5 }, // Ngô ngọt
      { foodId: 'f19', multiplier: 1 }, // Yến mạch
      { foodId: 'f25', multiplier: 1.5 } // Khoai tây
    ]
  },
  {
    id: 'sr3',
    swap_key: 'veg_swap_A',
    options: [
      { foodId: 'f3', multiplier: 1 }, // Rau muống xào
      { foodId: 'f57', multiplier: 1 }, // Rau muống luộc
      { foodId: 'f58', multiplier: 1 }, // Cải ngọt luộc
      { foodId: 'f60', multiplier: 1 }, // Súp lơ xanh
      { foodId: 'f61', multiplier: 1 }, // Bắp cải
      { foodId: 'f66', multiplier: 1.5 }, // Dưa leo
      { foodId: 'f67', multiplier: 1.5 }, // Cà chua
      { foodId: 'f68', multiplier: 1 }, // Xà lách
      { foodId: 'f71', multiplier: 1 } // Cà rốt
    ]
  },
  {
    id: 'sr4',
    swap_key: 'snack_swap_A',
    options: [
      { foodId: 'f6', multiplier: 1 }, // Sữa chua không đường
      { foodId: 'f77', multiplier: 1 }, // Chuối
      { foodId: 'f78', multiplier: 1 }, // Táo
      { foodId: 'f79', multiplier: 1 }, // Ổi
      { foodId: 'f80', multiplier: 1 }, // Đu đủ
      { foodId: 'f81', multiplier: 1 }, // Dưa hấu
      { foodId: 'f85', multiplier: 1 }, // Hạt điều
      { foodId: 'f89', multiplier: 1 } // Socola đen
    ]
  },
  {
    id: 'sr5',
    swap_key: 'eatout_noodle_swap',
    options: [
      { foodId: 'f4', multiplier: 1 }, // Phở bò tái
      { foodId: 'f94', multiplier: 1 }, // Bún bò Huế
      { foodId: 'f98', multiplier: 1 }, // Hủ tiếu
      { foodId: 'f102', multiplier: 1 } // Mì Quảng
    ]
  }
];
