import { HealthyDish } from '../types';

export const healthyDishes: HealthyDish[] = [
  {
    id: '1',
    name: 'Ức gà nướng chanh',
    image: 'https://picsum.photos/seed/chicken/400/300',
    calories: 350,
    protein: 45,
    carbs: 10,
    fat: 12,
    category: 'lunch',
    ingredients: ['Ức gà', 'Chanh', 'Tỏi', 'Dầu olive'],
    portion: '1 phần',
    instructions: ['Rửa sạch ức gà.', 'Ướp với chanh và tỏi.', 'Nướng ở 200 độ C trong 20 phút.']
  },
  {
    id: '2',
    name: 'Salad cá ngừ',
    image: 'https://picsum.photos/seed/salad/400/300',
    calories: 280,
    protein: 30,
    carbs: 15,
    fat: 8,
    category: 'dinner',
    ingredients: ['Cá ngừ', 'Xà lách', 'Cà chua', 'Hành tây'],
    portion: '1 đĩa',
    instructions: ['Rửa sạch rau củ.', 'Trộn cá ngừ với rau.', 'Thêm nước sốt.']
  }
];
