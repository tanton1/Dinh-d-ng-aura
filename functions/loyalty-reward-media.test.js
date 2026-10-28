const assert = require('node:assert/strict')
const test = require('node:test')
const { normalizeRewardBanner } = require('./loyalty-reward-media')

const path = 'public-assets/loyalty-rewards/gift-one/banner-12345678.webp'
const banner = { bannerUrl: `https://firebasestorage.googleapis.com/v0/b/aura.test/o/${encodeURIComponent(path)}?alt=media&token=example`, bannerStoragePath: path }
test('reward banners accept matching immutable assets and explicit removal', () => {
  assert.deepEqual(normalizeRewardBanner(banner, 'gift-one'), banner)
  assert.deepEqual(normalizeRewardBanner({ bannerUrl: '', bannerStoragePath: '' }, 'gift-one'), { bannerUrl: '', bannerStoragePath: '' })
})
test('reward banners reject other rewards, unsafe URLs and mismatched paths', () => {
  for (const input of [
    { ...banner, bannerUrl: 'javascript:alert(1)' }, { ...banner, bannerUrl: 'https://example.org/image.webp' },
    { ...banner, bannerStoragePath: path.replace('gift-one', 'gift-two') }, { ...banner, bannerUrl: banner.bannerUrl.replace('https:', 'http:') },
    { ...banner, bannerStoragePath: path.replace('.webp', '.svg') }, { bannerUrl: banner.bannerUrl }, { bannerStoragePath: path },
  ]) assert.throws(() => normalizeRewardBanner(input, 'gift-one'), /banner không hợp lệ/)
})
