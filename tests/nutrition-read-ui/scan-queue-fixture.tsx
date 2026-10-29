import { useState } from 'react'
import FoodScanModal from '../../src/pages/student/NutritionScanFlow'
import { rememberPendingFoodScan } from '../../src/services/nutritionScanQueue'
import type { AnalyzeFoodPhotoOptions, FoodAnalysisResponse } from '../../src/services/nutritionService'
import '../../src/styles-nutrition.css'

const state = { created: 0, resumed: 0, aborted: 0, saved: 0, status: (_value: string) => {}, complete: () => {} }
Object.assign(window, { scanQueueFixture: state })
const response = {
  scanId: 'fixture_scan_123', status: 'completed', mode: 'live', provider: 'apikey_fun', model: 'fixture', providerRequestId: 'fixture',
  imageRetained: false, analyzedAt: '2026-10-29T00:00:00.000Z', notices: [],
  analysis: { isFood: true, dishNameVi: 'Cơm kiểm thử hàng đợi', dishNameEn: 'Test rice', portionSummary: 'Một bát cơm', confidence: .9,
    calorieRange: { low: 200, high: 240 }, totals: { calories: 220, proteinG: 5, carbsG: 48, fatG: 1, fiberG: 1, sugarG: 0, sodiumMg: 0 },
    items: [{ nameVi: 'Cơm', nameEn: 'Rice', searchNameAscii: 'com', estimatedGrams: 170, confidence: .9, nutrition: { calories: 220, proteinG: 5, carbsG: 48, fatG: 1, fiberG: 1, sugarG: 0, sodiumMg: 0 }, calculationSource: 'ai' }],
    questions: [], warnings: [], databaseNotices: [],
  },
} as unknown as FoodAnalysisResponse
function observe(options?: AnalyzeFoodPhotoOptions) {
  options?.onQueueStatus?.('queued')
  return new Promise<FoodAnalysisResponse>(resolve => {
    state.status = status => options?.onQueueStatus?.(status as 'queued' | 'processing')
    state.complete = () => resolve(response)
    options?.signal?.addEventListener('abort', () => { state.aborted++ }, { once: true })
  })
}
export default function ScanQueueFixture() {
  const [show, setShow] = useState(true)
  const [owner, setOwner] = useState('queue-owner')
  return <><button onClick={() => setShow(false)}>Rời trang kiểm thử</button><button onClick={() => setOwner('other-owner')}>Đổi tài khoản kiểm thử</button>
    {show && <FoodScanModal key={owner} storageOwnerId={owner} initialDate="2026-10-29" presentation="page" onClose={() => setShow(false)}
      onSave={async () => { state.saved++ }} onAnalyzeImage={async (_file, options) => {
        state.created++
        rememberPendingFoodScan({ ownerUid: owner, createdAt: Date.now(), fingerprint: 'fixture', mealType: 'lunch',
          upload: { scanId: 'fixture_scan_123', storagePath: `nutrition-scans/${owner}/fixture_scan_123/original.jpg`, contentType: 'image/jpeg', size: 4 } })
        return observe(options)
      }} onResumeImageAnalysis={async options => { state.resumed++; return observe(options) }} />}
  </>
}
