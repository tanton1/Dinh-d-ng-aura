// Client mirror of functions/installment-payment-core.js#vietQrPayload. The
// server builds every real payload; this copy only serves demo mode and the
// parity test that keeps both implementations byte-identical.

function emvField(id: string, value: string) {
  if (value.length > 99) throw new Error(`VietQR field ${id} is too long.`)
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

export function crc16Ccitt(payload: string) {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function vietQrPayload({ bankBin, accountNumber, amount, content }: { bankBin: string; accountNumber: string; amount: number; content: string }) {
  if (!/^\d{6}$/.test(bankBin)) throw new Error('VietQR requires a 6-digit bank BIN.')
  if (!/^[0-9A-Za-z]{4,19}$/.test(accountNumber)) throw new Error('VietQR requires a valid account number.')
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('VietQR requires a positive integer amount.')
  if (!/^[A-Z0-9 ]{1,25}$/.test(content)) throw new Error('VietQR memo must be upper-case ASCII.')
  const beneficiary = emvField('00', bankBin) + emvField('01', accountNumber)
  const merchant = emvField('00', 'A000000727') + emvField('01', beneficiary) + emvField('02', 'QRIBFTTA')
  const body = emvField('00', '01')
    + emvField('01', '12')
    + emvField('38', merchant)
    + emvField('53', '704')
    + emvField('54', String(amount))
    + emvField('58', 'VN')
    + emvField('62', emvField('08', content))
    + '6304'
  return body + crc16Ccitt(body)
}

/** NAPAS BINs of the banks Aura branches use most. Any other bank can be entered by BIN. */
export const VIETQR_BANKS: ReadonlyArray<{ bin: string; name: string }> = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970443', name: 'SHB' },
  { bin: '970431', name: 'Eximbank' },
  { bin: '970426', name: 'MSB' },
  { bin: '970448', name: 'OCB' },
  { bin: '970440', name: 'SeABank' },
  { bin: '970449', name: 'LPBank' },
  { bin: '970428', name: 'Nam A Bank' },
  { bin: '970454', name: 'BVBank' },
]
