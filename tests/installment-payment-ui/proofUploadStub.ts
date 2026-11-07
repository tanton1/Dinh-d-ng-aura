// Stands in for src/services/installmentProofUpload.ts: no Storage, the
// "uploaded" receipt is kept as an object URL the callable stub hands back.
export const PROOF_MAX_BYTES = 8 * 1024 * 1024

export async function prepareReceiptImage(file: File) {
  return file
}

export async function uploadInstallmentProof(claimId: string, image: Blob, onProgress?: (percent: number) => void) {
  for (const percent of [20, 65, 100]) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    onProgress?.(percent)
  }
  const path = `installment-proofs/uid-test/${claimId}/proof-${Date.now()}.jpg`
  const state = (window as unknown as { __payment: { uploads: Record<string, string> } }).__payment
  state.uploads[path] = URL.createObjectURL(image)
  return path
}
