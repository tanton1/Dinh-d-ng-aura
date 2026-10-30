import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/styles-bootstrap.css'
import '../../../src/styles-nutrition.css'
import '../../../src/styles-nutrition-visuals.css'
import FoodScanModal from '../../../src/pages/student/NutritionScanFlow'
import { readPendingFoodScan, rememberPendingFoodScan } from '../../../src/services/nutritionScanQueue'

const ownerUid = 'queue-fixture-owner'
if (!readPendingFoodScan(ownerUid)) rememberPendingFoodScan({ ownerUid, fingerprint: 'synthetic-photo-hash', createdAt: Date.now() - 120_000,
  mealType: 'lunch', upload: { scanId: 'synthetic_scan_123', storagePath: `nutrition-scans/${ownerUid}/synthetic_scan_123/original.jpg`, contentType: 'image/jpeg', size: 100 } })
const state = window as unknown as { scanResumeCount: number; scanProcessing?: () => void }
state.scanResumeCount = 0
createRoot(document.getElementById('root')!).render(<FoodScanModal initialDate="2026-10-30" storageOwnerId={ownerUid} onClose={() => {}} onSave={async () => {}}
  onResumeImageAnalysis={options => {
    state.scanResumeCount++
    options?.onQueueStatus?.('queued')
    state.scanProcessing = () => options?.onQueueStatus?.('processing')
    return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }} />)
