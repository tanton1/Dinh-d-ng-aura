import { httpsCallable } from 'firebase/functions'
import { firebaseAuth, firebaseConfig } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { assertFinanceIntentOutcome, type FinanceIntentOperation, type FinanceIntentOutcome } from './financeOperationIntent'

export const financeIntentProjectId = firebaseConfig.projectId || ''

export async function manageFinanceOperation(ownerUid: string, action: 'submit' | 'cancel', operation: FinanceIntentOperation): Promise<FinanceIntentOutcome> {
  if (!firebaseFunctions || !firebaseAuth?.currentUser || firebaseAuth.currentUser.uid !== ownerUid) throw new Error('Tài khoản đã thay đổi. Hãy mở lại màn hình để tiếp tục yêu cầu của đúng tài khoản.')
  const result = await httpsCallable<{
    protocol: 1; ownerUid: string; action: 'submit' | 'cancel'; operation: FinanceIntentOperation
  }, unknown>(firebaseFunctions, 'manageFinanceOperation')({ protocol: 1, ownerUid, action, operation })
  assertFinanceIntentOutcome(result.data, operation.payload.idempotencyKey)
  return result.data
}
