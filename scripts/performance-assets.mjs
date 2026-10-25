/** A lazy dependency may also be named index-*.js; measure the actual HTML entry. */
export function viteEntryAsset(manifest, source = 'index.html') {
  const entry = manifest?.[source]
  if (!entry?.isEntry || entry.src !== source || typeof entry.file !== 'string'
      || !/^assets\/[A-Za-z0-9_.-]+\.js$/.test(entry.file) || entry.file.includes('..')) {
    throw new Error(`Không tìm thấy entry hợp lệ ${source} trong Vite manifest.`)
  }
  return entry.file
}
