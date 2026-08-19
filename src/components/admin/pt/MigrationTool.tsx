import React, { useState } from 'react';
import { getFirestore, collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { app, db as newDb } from '../../../lib/firebase';
import { Loader2, Database, AlertTriangle } from 'lucide-react';

export default function MigrationTool() {
  const [isMigrating, setIsMigrating] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const handleMigrate = async () => {
    if (!app || !newDb) {
      setError('Firebase chưa được khởi tạo.');
      return;
    }
    setIsMigrating(true);
    setStatus('Đang khởi tạo kết nối...');
    setError('');

    try {
      // Sử dụng chung app instance đã đăng nhập để có quyền truy cập
      const oldDb = getFirestore(app, "ai-studio-e5f97025-f298-4bc8-a850-b867e95f717b");

      const collectionsToMigrate = [
        'users',
        'students',
        'contracts',
        'sessions',
        'trainers',
        'schedules',
        'payments',
        'branches',
        'packages',
        'staff',
        'dailyCheckins',
        'healthyDishes',
        'mealPlans'
      ];

      for (const collectionName of collectionsToMigrate) {
        setStatus(`Đang chuyển dữ liệu bảng: ${collectionName}...`);
        console.log(`Bắt đầu đọc từ bảng ${collectionName} (oldDb)...`);
        let oldSnapshot;
        try {
          oldSnapshot = await getDocs(collection(oldDb, collectionName));
        } catch (e: any) {
          console.error(`Lỗi khi đọc bảng ${collectionName} từ oldDb:`, e);
          throw new Error(`Lỗi đọc bảng ${collectionName}: ${e.message}`);
        }
        
        let count = 0;
        
        for (const document of oldSnapshot.docs) {
          const data = document.data();
          try {
            await setDoc(doc(newDb, collectionName, document.id), data);
          } catch (e: any) {
            console.error(`Lỗi khi ghi document ${document.id} vào bảng ${collectionName} (newDb):`, e);
            throw new Error(`Lỗi ghi document ${document.id} vào bảng ${collectionName}: ${e.message}`);
          }
          count++;
          
          // Migrate subcollections for users (progress_photos)
          if (collectionName === 'users') {
              let photosSnapshot;
              try {
                photosSnapshot = await getDocs(collection(oldDb, 'users', document.id, 'progress_photos'));
              } catch (e: any) {
                console.error(`Lỗi khi đọc progress_photos của user ${document.id}:`, e);
                throw new Error(`Lỗi đọc progress_photos của user ${document.id}: ${e.message}`);
              }
              
              for (const photoDoc of photosSnapshot.docs) {
                  try {
                    await setDoc(doc(newDb, 'users', document.id, 'progress_photos', photoDoc.id), photoDoc.data());
                  } catch (e: any) {
                    console.error(`Lỗi khi ghi progress_photos ${photoDoc.id} của user ${document.id}:`, e);
                    throw new Error(`Lỗi ghi progress_photos ${photoDoc.id} của user ${document.id}: ${e.message}`);
                  }
              }
          }
        }
        console.log(`Đã chuyển thành công ${count} documents trong collection ${collectionName}`);
      }

      setStatus('Hoàn tất chuyển dữ liệu! Bạn có thể tải lại trang.');
    } catch (err: any) {
      console.error("Migration error:", err);
      if (err.code === 'permission-denied' || err.message?.includes('Quota limit exceeded')) {
        setError('Lỗi phân quyền: Database cũ vẫn đang chặn quyền đọc (Quota limit exceeded). Vui lòng thử lại vào ngày mai khi hạn mức được làm mới.');
      } else {
        setError(err.message || 'Có lỗi xảy ra trong quá trình chuyển dữ liệu.');
      }
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow-sm border border-orange-100">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Database className="w-5 h-5 text-orange-500" />
        Công cụ chuyển đổi dữ liệu
      </h2>
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-orange-800 mb-1">
              Lưu ý quan trọng
            </h3>
            <p className="text-sm text-orange-700">
              Sử dụng công cụ này để copy toàn bộ dữ liệu từ database cũ (bị giới hạn) sang database mới. 
              Nếu database cũ vẫn đang bị khóa hạn mức (Quota limit exceeded), bạn cần đợi đến khi hạn mức được làm mới (khoảng 2h-3h chiều giờ VN) mới có thể thực hiện.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {status && !error && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 text-sm rounded-lg border border-blue-200">
          {status}
        </div>
      )}

      <button 
        onClick={handleMigrate} 
        disabled={isMigrating}
        className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium flex items-center justify-center disabled:opacity-50"
      >
        {isMigrating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Đang xử lý...
          </>
        ) : (
          'Bắt đầu chuyển dữ liệu'
        )}
      </button>
    </div>
  );
}
