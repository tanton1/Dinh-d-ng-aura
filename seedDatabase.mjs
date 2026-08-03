import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, doc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, config.firestoreDatabaseId);

const demoCourses = [
  {
    id: 'course-1',
    title: 'Nền tảng dinh dưỡng ứng dụng',
    description: 'Hiểu nguyên lý cốt lõi, đọc nhãn đúng và đưa ra quyết định dinh dưỡng có cơ sở.',
    category: 'Dinh dưỡng nền tảng',
    level: 'Foundation',
    coach: 'Aura Academy',
    lessons: 24,
    duration: '6 tuần',
    progress: 0,
    accent: 'purple',
    icon: 'nutrition',
    learnerStatus: 'Khám phá',
    status: 'published',
    schemaVersion: 2,
    slug: 'nen-tang-dinh-duong-ung-dung',
    outcomes: [
      'Hiểu cân bằng năng lượng và vai trò của chất dinh dưỡng đa lượng',
      'Đọc nhãn thực phẩm và đánh giá chất lượng thông tin dinh dưỡng',
    ],
    requirements: ['Sẵn sàng thực hành đọc nhãn thực phẩm'],
    modules: [],
    settings: { accessTier: 'free', visibility: 'members', completionPercent: 100, certificateEnabled: true, dripSchedule: 'none' }
  },
  {
    id: 'course-2',
    title: 'Dinh dưỡng giảm mỡ chuyên sâu',
    description: 'Phân tích cân bằng năng lượng, hành vi và chiến lược giảm mỡ bền vững qua case study.',
    category: 'Quản lý cân nặng',
    level: 'Intermediate',
    coach: 'Aura Academy',
    lessons: 18,
    duration: '4 tuần',
    progress: 0,
    accent: 'green',
    icon: 'nutrition',
    learnerStatus: 'Khám phá',
    status: 'published',
    schemaVersion: 2,
    slug: 'dinh-duong-giam-mo-chuyen-sau',
    outcomes: ['Xây dựng thói quen ăn uống lành mạnh bền vững'],
    requirements: ['Đã hoàn thành khóa Nền tảng dinh dưỡng'],
    modules: [],
    settings: { accessTier: 'pro', visibility: 'members', completionPercent: 100, certificateEnabled: true, dripSchedule: 'none' }
  },
  {
    id: 'course-3',
    title: 'Dinh dưỡng thể thao nâng cao',
    description: 'Xây dựng chiến lược năng lượng, hydration và phục hồi cho các bối cảnh vận động khác nhau.',
    category: 'Dinh dưỡng thể thao',
    level: 'Advanced',
    coach: 'Aura Academy',
    lessons: 21,
    duration: '3 tuần',
    progress: 0,
    accent: 'orange',
    icon: 'mobility',
    learnerStatus: 'Khám phá',
    status: 'published',
    schemaVersion: 2,
    slug: 'dinh-duong-the-thao-nang-cao',
    outcomes: ['Tối ưu hiệu suất vận động bằng dinh dưỡng chuẩn hóa'],
    requirements: ['Hiểu các nguyên lý vận động cơ bản'],
    modules: [],
    settings: { accessTier: 'pro', visibility: 'members', completionPercent: 100, certificateEnabled: true, dripSchedule: 'none' }
  },
  {
    id: 'course-4',
    title: 'Đọc nghiên cứu dinh dưỡng',
    description: 'Học cách đánh giá chất lượng bằng chứng và chuyển hóa nghiên cứu thành quyết định thực hành.',
    category: 'Chuyên sâu',
    level: 'Professional',
    coach: 'Aura Academy',
    lessons: 16,
    duration: '4 tuần',
    progress: 0,
    accent: 'pink',
    icon: 'hiit',
    learnerStatus: 'Khám phá',
    status: 'published',
    schemaVersion: 2,
    slug: 'doc-nghien-cuu-dinh-duong',
    outcomes: ['Đánh giá phản xạ phản biện đối với bài báo dinh dưỡng'],
    requirements: ['Đã có nền tảng dinh dưỡng tổng quát'],
    modules: [],
    settings: { accessTier: 'pro', visibility: 'members', completionPercent: 100, certificateEnabled: true, dripSchedule: 'none' }
  }
];

async function run() {
  try {
    const cred = await signInWithEmailAndPassword(auth, 'testuser2_abc123@example.com', 'Password123!');
    console.log('Logged in user:', cred.user.uid);
    const batch = writeBatch(db);
    for (const c of demoCourses) {
      batch.set(doc(db, 'courses', c.id), {
        ...c,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    console.log('Seeded courses into Firestore successfully!');
  } catch (err) {
    console.error('Seed error:', err);
  }
  process.exit(0);
}

run();
