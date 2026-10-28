const { HttpsError } = require('firebase-functions/v2/https')

function normalizeRewardBanner(input, rewardId) {
  const bannerUrl = typeof input.bannerUrl === 'string' ? input.bannerUrl.trim() : ''
  const bannerStoragePath = typeof input.bannerStoragePath === 'string' ? input.bannerStoragePath.trim() : ''
  if (!bannerUrl && !bannerStoragePath) return { bannerUrl: '', bannerStoragePath: '' }
  try {
    const url = new URL(bannerUrl)
    const prefix = `public-assets/loyalty-rewards/${rewardId}/`
    const fileName = bannerStoragePath.slice(prefix.length)
    if (!bannerStoragePath.startsWith(prefix) || !/^[A-Za-z0-9_-]{8,160}\.webp$/.test(fileName)
      || bannerUrl.length > 2000 || url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com'
      || url.username || url.password || url.port
      || !/^\/v0\/b\/[^/]+\/o\//.test(url.pathname)
      || decodeURIComponent(url.pathname.split('/o/')[1] || '') !== bannerStoragePath) throw new Error('invalid banner')
    return { bannerUrl, bannerStoragePath }
  } catch {
    throw new HttpsError('invalid-argument', 'Ảnh banner không hợp lệ. Hãy tải lại ảnh cho quà tặng này.')
  }
}

module.exports = { normalizeRewardBanner }
