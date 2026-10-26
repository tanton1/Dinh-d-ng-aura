import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bookmark, BookOpen, Check, ChefHat, ChevronDown, Clock3, Flame, Leaf, LoaderCircle, Search, Users, X } from 'lucide-react'
import { cookingHash, cookingRoute, filterCookingRecipes, readSavedRecipes, writeSavedRecipes } from './model'
import type { Cookbook, CookingChapter, CookingRecipe } from './types'
import './cooking.css'

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`

function RecipePhoto({ recipe, eager = false, className = '' }: { recipe: CookingRecipe; eager?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (failed) return <div className={`cooking-photo cooking-photo--empty ${className}`}><ChefHat size={30} aria-hidden="true" /><span>Chưa tải được ảnh</span><button type="button" onClick={() => { setAttempt((n) => n + 1); setFailed(false) }}>Tải lại ảnh</button></div>
  return <img className={`cooking-photo ${className}`} src={`${asset(recipe.image)}${attempt ? `?retry=${attempt}` : ''}`} srcSet={attempt ? undefined : `${asset(recipe.thumbnail)} 560w, ${asset(recipe.image)} 1200w`} sizes={eager ? '(max-width: 700px) 100vw, 55vw' : '(max-width: 700px) 100vw, (max-width: 1100px) 45vw, 30vw'} alt={`Ảnh minh họa ${recipe.name}`} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />
}

function SaveButton({ recipe, saved, toggle, compact = false }: { recipe: CookingRecipe; saved: boolean; toggle: (id: string) => void; compact?: boolean }) {
  return <button type="button" className={`cooking-save ${compact ? 'cooking-save--compact' : ''}`} aria-label={`${saved ? 'Bỏ lưu' : 'Lưu món'} ${recipe.name}`} aria-pressed={saved} onClick={() => toggle(recipe.id)}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />{!compact && <span>{saved ? 'Đã lưu món' : 'Lưu món'}</span>}</button>
}

function RecipeTime({ recipe }: { recipe: CookingRecipe }) {
  return <div className="cooking-times"><Clock3 size={16} aria-hidden="true" /><span>{recipe.timeLabels.join(' · ')}</span></div>
}

function SourcePdf({ chapter, page, onClose }: { chapter: CookingChapter; page: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const opener = document.activeElement
    const modal = dialog.current
    modal?.showModal()
    return () => {
      modal?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let blobUrl = ''
    let active = true
    setError(false)
    setUrl('')
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    void fetch(asset(chapter.pdf), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('pdf unavailable')
      const blob = await response.blob()
      if (!(await blob.slice(0, 5).text()).startsWith('%PDF-')) throw new Error('invalid pdf')
      if (!active) return
      blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      setUrl(blobUrl)
    }).catch(() => { if (active) setError(true) }).finally(() => window.clearTimeout(timeout))
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [chapter.pdf, attempt])
  return <dialog ref={dialog} className="cooking-pdf" onCancel={(event) => { event.preventDefault(); onClose() }} aria-labelledby="cooking-pdf-title">
    <header><div><span>Chương {chapter.id.padStart(2, '0')}</span><h2 id="cooking-pdf-title">{chapter.title}</h2></div><button type="button" onClick={onClose} aria-label="Đóng tài liệu"><X /></button></header>
    {error ? <div className="cooking-state" role="alert"><BookOpen /><h3>Chưa mở được tài liệu</h3><p>Kiểm tra kết nối rồi thử lại. Bạn vẫn có thể đọc công thức trên trang.</p><button type="button" onClick={() => setAttempt((n) => n + 1)}>Thử lại</button></div> : url ? <><a href={`${url}#page=${page}`} target="_blank" rel="noreferrer">Mở PDF ở tab mới <ArrowRight size={16} /></a><iframe src={`${url}#page=${page}`} title={`PDF ${chapter.title}`} /></> : <div className="cooking-state" role="status"><LoaderCircle className="cooking-spinner" /><p>Đang mở chương sách…</p></div>}
  </dialog>
}

function Ingredients({ recipe, checked, toggle }: { recipe: CookingRecipe; checked: Set<number>; toggle: (index: number) => void }) {
  return <ul className="cooking-ingredients">{recipe.ingredients.map((item, index) => <li key={index}><label><input type="checkbox" checked={checked.has(index)} onChange={() => toggle(index)} /><span>{item.name}</span><strong>{item.amount}</strong></label></li>)}</ul>
}

function CookingExperience({ ownerId }: { ownerId: string }) {
  const [book, setBook] = useState<Cookbook | null>(null)
  const [error, setError] = useState(false)
  const [route, setRoute] = useState(() => cookingRoute(window.location.hash))
  const [query, setQuery] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [savedOnly, setSavedOnly] = useState(false)
  const [limit, setLimit] = useState(12)
  const [saved, setSaved] = useState(() => {
    try { return readSavedRecipes(window.localStorage, ownerId) } catch { return new Set<string>() }
  })
  const [message, setMessage] = useState('')
  const [checkedByRecipe, setCheckedByRecipe] = useState<Record<string, Set<number>>>({})
  const [stepByRecipe, setStepByRecipe] = useState<Record<string, number>>({})
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const [pdf, setPdf] = useState<{ chapter: CookingChapter; page: number } | null>(null)
  const listScroll = useRef(0)
  const openedRecipe = useRef('')
  const heading = useRef<HTMLHeadingElement>(null)
  const previousRoute = useRef('')

  useEffect(() => {
    let active = true
    setError(false)
    void import('./data/cookbook.json').then((module) => { if (active) setBook(module.default) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const changed = () => setRoute(cookingRoute(window.location.hash))
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 5000)
    return () => window.clearTimeout(timer)
  }, [message])
  useEffect(() => { setLimit(12) }, [query, chapterId, savedOnly])
  const recipe = book?.recipes.find((item) => item.id === route.recipeId)
  const chapter = book?.chapters.find((item) => item.id === recipe?.chapterId)
  const matches = useMemo(() => filterCookingRecipes(book?.recipes || [], query, chapterId, savedOnly, saved), [book, query, chapterId, savedOnly, saved])
  const filtered = Boolean(query.trim() || chapterId || savedOnly)
  const featured = book?.recipes.find((item) => item.id === 'B01')
  const stepIndex = recipe ? Math.min(stepByRecipe[recipe.id] || 0, recipe.steps.length - 1) : 0
  const checked = recipe ? checkedByRecipe[recipe.id] || new Set<number>() : new Set<number>()

  useLayoutEffect(() => {
    if (!book) return
    const key = `${route.recipeId}:${route.cooking}`
    if (previousRoute.current === key) return
    const wasDetail = previousRoute.current.includes(':') && previousRoute.current !== ':false'
    previousRoute.current = key
    if (!route.recipeId && wasDetail) {
      window.scrollTo({ top: listScroll.current, behavior: 'instant' })
      document.getElementById(`cooking-open-${openedRecipe.current}`)?.focus({ preventScroll: true })
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' })
      if (route.recipeId) heading.current?.focus({ preventScroll: true })
    }
  }, [book, route.recipeId, route.cooking])

  function toggleSaved(id: string) {
    const next = new Set(saved)
    const removing = next.has(id)
    if (removing) next.delete(id)
    else next.add(id)
    let persisted = false
    try { persisted = writeSavedRecipes(window.localStorage, ownerId, next) } catch { /* Keep the in-memory bookmark usable. */ }
    setSaved(next)
    setMessage(persisted ? removing ? 'Đã bỏ lưu món.' : 'Đã lưu món trên thiết bị này.' : 'Thay đổi chỉ được giữ trong phiên này vì trình duyệt chưa cho phép lưu.')
  }
  function rememberList(id: string) {
    listScroll.current = window.scrollY
    openedRecipe.current = id
  }
  function toggleIngredient(index: number) {
    if (!recipe) return
    const next = new Set(checked)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setCheckedByRecipe((current) => ({ ...current, [recipe.id]: next }))
  }
  function resetFilters() { setQuery(''); setChapterId(''); setSavedOnly(false) }

  if (!book) return <div className="cooking-page"><div className="cooking-state" role={error ? 'alert' : 'status'}>{error ? <><ChefHat /><h1>Chưa mở được bếp Aura</h1><p>Kiểm tra kết nối rồi thử tải lại công thức.</p><button type="button" onClick={() => window.location.reload()}>Tải lại trang</button></> : <><LoaderCircle className="cooking-spinner" /><p>Đang mở bếp Aura…</p></>}</div></div>

  return <div className="cooking-page">
    <div className="cooking-announcement" role="status" aria-live="polite">{message && <span>{message}</span>}</div>
    {route.recipeId && (!recipe || !chapter) ? <div className="cooking-state"><ChefHat /><h1>Chưa tìm thấy công thức này</h1><p>Chọn một món trong bộ sưu tập để tiếp tục.</p><a href={cookingHash()}>Về danh sách món</a></div> : recipe && chapter ? <>
      <nav className="cooking-breadcrumb" aria-label="Điều hướng công thức"><a href={cookingHash()}><ArrowLeft size={17} /> Về danh sách món</a><span>{chapter.label}</span></nav>
      {route.cooking ? <section className="cooking-session" aria-label="Chế độ nấu">
        <header><div><span className="cooking-step-label">{completed.has(recipe.id) ? 'Đã hoàn thành' : `Bước ${stepIndex + 1}/${recipe.steps.length}`}</span><h1 ref={heading} tabIndex={-1}>{recipe.name}</h1></div><a className="cooking-quiet" href={cookingHash(recipe.id)}><X size={18} /> Đóng chế độ nấu</a></header>
        {completed.has(recipe.id) ? <div className="cooking-finished" role="status"><Check size={40} /><h2>Bữa ngon đã sẵn sàng.</h2><p>{recipe.portionDetail}</p><div><a className="cooking-primary" href={cookingHash()}>Khám phá món khác</a><button className="cooking-quiet" type="button" onClick={() => { setCompleted((current) => { const next = new Set(current); next.delete(recipe.id); return next }); setStepByRecipe((current) => ({ ...current, [recipe.id]: 0 })) }}>Xem lại các bước</button></div></div> : <>
          <div className="cooking-step-track" aria-hidden="true">{recipe.steps.map((_, index) => <span key={index} className={index <= stepIndex ? 'is-done' : ''} />)}</div>
          <div className="cooking-current-step" aria-live="polite" aria-atomic="true"><span aria-hidden="true">{String(stepIndex + 1).padStart(2, '0')}</span><div><h2>{recipe.steps[stepIndex].title}</h2><p>{recipe.steps[stepIndex].text}</p></div></div>
          <div className="cooking-step-actions"><button type="button" className="cooking-quiet" disabled={stepIndex === 0} onClick={() => setStepByRecipe((current) => ({ ...current, [recipe.id]: stepIndex - 1 }))}><ArrowLeft size={18} /> Bước trước</button><button type="button" className="cooking-primary" onClick={() => stepIndex === recipe.steps.length - 1 ? setCompleted((current) => new Set(current).add(recipe.id)) : setStepByRecipe((current) => ({ ...current, [recipe.id]: stepIndex + 1 }))}>{stepIndex === recipe.steps.length - 1 ? 'Hoàn thành' : 'Bước tiếp'}{stepIndex === recipe.steps.length - 1 ? <Check size={18} /> : <ArrowRight size={18} />}</button></div>
        </>}
        <details className="cooking-fold"><summary><Users size={18} /> Nguyên liệu cho {recipe.servings} {recipe.chapterId === '6' ? 'phần sốt / gia vị' : 'phần ăn'}<ChevronDown size={16} /></summary><Ingredients recipe={recipe} checked={checked} toggle={toggleIngredient} /><p className="cooking-allergens"><strong>Thành phần cần lưu ý:</strong> {recipe.allergenNote}</p></details>
        <aside className="cooking-tip"><ChefHat size={22} /><div><h3>Bếp mình mách bạn</h3><p>{recipe.tip}</p></div></aside>
      </section> : <article className="cooking-detail">
        <header className="cooking-detail-head"><h1 ref={heading} tabIndex={-1}>{recipe.name}</h1><p>{recipe.description}</p></header>
        <div className="cooking-detail-overview"><div><RecipePhoto key={recipe.id} recipe={recipe} eager /><small className="cooking-photo-caption">Ảnh minh họa AI</small></div><section className="cooking-recipe-facts" aria-label="Thông tin công thức"><div className="cooking-energy"><Flame size={20} /><strong>≈ {recipe.kcalPerServing}</strong><span>kcal/phần</span></div><p>{recipe.portionNote}</p><RecipeTime recipe={recipe} />{recipe.timeNote && <p className="cooking-time-note">{recipe.timeNote}</p>}<div className="cooking-portions"><Users size={17} /> Công thức cho {recipe.servings} {recipe.chapterId === '6' ? 'phần sử dụng' : 'phần ăn'}</div>{recipe.requiresCooking && <p className="cooking-time-note"><strong>Cần nấu chín cùng món</strong></p>}<a className="cooking-primary" href={cookingHash(recipe.id, true)}><ChefHat size={20} /> Vào bếp thôi</a><SaveButton recipe={recipe} saved={saved.has(recipe.id)} toggle={toggleSaved} /></section></div>
        <div className="cooking-detail-body"><section className="cooking-ingredient-section"><div className="cooking-section-heading"><h2>Chuẩn bị nguyên liệu</h2><span>{checked.size}/{recipe.ingredients.length}</span></div><p className="cooking-secondary">Đánh dấu những gì bạn đã chuẩn bị.</p><Ingredients recipe={recipe} checked={checked} toggle={toggleIngredient} /><p className="cooking-allergens"><strong>Thành phần cần lưu ý:</strong> {recipe.allergenNote}</p></section><section className="cooking-method"><h2>Cách làm</h2><ol>{recipe.steps.map((step, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol><aside className="cooking-tip"><ChefHat size={22} /><div><h3>Bếp mình mách bạn</h3><p>{recipe.tip}</p></div></aside></section></div>
        <section className="cooking-notes" aria-label="Hiểu rõ công thức"><h2>Một chút lưu ý</h2>{recipe.substitution && <details className="cooking-fold"><summary>Đổi nguyên liệu<ChevronDown size={16} /></summary><p>{recipe.substitution}</p><p className="cooking-secondary">Kcal trên trang áp dụng cho công thức gốc; thay nguyên liệu có thể làm thay đổi kết quả.</p></details>}<details className="cooking-fold"><summary>Chia phần & món ăn kèm<ChevronDown size={16} /></summary><p>{recipe.portionDetail}</p>{recipe.chapterId === '6' && <p>Cân toàn bộ thành phẩm rồi chia bốn phần. Một phần không mặc định bằng 15 g hay 15 ml.</p>}</details><details className="cooking-fold"><summary>Kcal được tính như thế nào?<ChevronDown size={16} /></summary><p>Cộng năng lượng của nguyên liệu theo định lượng rồi chia cho {recipe.servings} phần. Đã tính dầu, sốt và phần rắc trong công thức; món ăn thêm tính riêng. Kcal được làm tròn đến 5 kcal.</p><p>Đây là ước tính từ nguyên liệu tham chiếu. Bộ công thức chưa được thử bếp thực tế; thời gian là dự kiến.</p>{recipe.batchKcal !== null && <p>Cả mẻ: ≈ {recipe.batchKcal} kcal. Kcal cả mẻ và mỗi phần được làm tròn riêng.</p>}<button type="button" className="cooking-text-button" onClick={() => setPdf({ chapter, page: chapter.methodPage })}>Xem phương pháp và nguồn trong PDF <BookOpen size={16} /></button></details><button type="button" className="cooking-source-row" onClick={() => setPdf({ chapter, page: chapter.safetyPage })}>Hướng dẫn nấu chín & bảo quản<BookOpen size={18} /></button></section>
        <footer className="cooking-detail-footer"><div><span>Chương {chapter.id.padStart(2, '0')} · Công thức {recipe.id}</span><strong>{chapter.title}</strong></div><button type="button" className="cooking-quiet" onClick={() => setPdf({ chapter, page: recipe.sourcePage })}><BookOpen size={18} /> Đọc chương PDF</button></footer>
      </article>}
    </> : <>
      <header className="cooking-page-heading"><div><a href="#/home" className="cooking-back"><ArrowLeft size={15} /> Trang chủ</a><h1>Vào Bếp cùng Aura</h1><p>Healthy từ bếp nhà mình</p></div><button type="button" className="cooking-saved-filter" aria-pressed={savedOnly} onClick={() => setSavedOnly((value) => !value)}><Bookmark size={19} fill={savedOnly ? 'currentColor' : 'none'} /><span>Đã lưu</span>{saved.size > 0 && <strong>{saved.size}</strong>}</button></header>
      {!filtered && featured && <section className="cooking-hero" aria-label="Món nổi bật"><div className="cooking-hero-copy"><span className="cooking-hero-intro"><ChefHat size={20} /> Hôm nay mình nấu gì?</span><h2>{featured.name}</h2><p>Một bữa sáng quen thuộc, từ chiếc chảo sẵn có.</p><RecipeTime recipe={featured} /><span className="cooking-hero-kcal">≈ {featured.kcalPerServing} kcal/phần</span><a className="cooking-primary" href={cookingHash(featured.id)} onClick={() => rememberList(featured.id)}>Xem cách làm <ArrowRight size={18} /></a></div><div className="cooking-hero-visual"><RecipePhoto recipe={featured} eager /><span>Ảnh minh họa AI</span></div></section>}
      <section className="cooking-collection" aria-labelledby="cooking-collection-heading"><div className="cooking-collection-top"><div><h2 id="cooking-collection-heading">{savedOnly ? 'Món mình muốn nấu' : 'Tìm một món ngon'}</h2><p>{savedOnly ? 'Món đã lưu trên thiết bị này.' : 'Món quen, nguyên liệu rõ, từng bước dễ làm.'}</p></div><label className="cooking-search"><Search size={19} aria-hidden="true" /><span className="cooking-sr-only">Tìm tên món hoặc nguyên liệu</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm món, nguyên liệu…" type="search" /></label></div>
        <div className="cooking-categories" role="group" aria-label="Nhóm công thức"><button type="button" aria-pressed={!chapterId} onClick={() => setChapterId('')}>Tất cả <span>60</span></button>{book.chapters.map((item) => <button type="button" key={item.id} aria-pressed={chapterId === item.id} onClick={() => setChapterId(item.id)}>{item.label}<span>{item.count}</span></button>)}</div>
        <div className="cooking-results"><span role="status">{matches.length} công thức{chapterId ? ` · ${book.chapters.find((item) => item.id === chapterId)?.label}` : ''}</span>{filtered && <button type="button" onClick={resetFilters}>Xóa bộ lọc</button>}</div>
        {matches.length ? <><div className="cooking-grid">{matches.slice(0, limit).map((item) => <article className="cooking-recipe-card" key={item.id}><div className="cooking-card-photo"><RecipePhoto recipe={item} /><SaveButton compact recipe={item} saved={saved.has(item.id)} toggle={toggleSaved} /></div><div className="cooking-card-copy"><span className="cooking-card-category">{book.chapters.find((c) => c.id === item.chapterId)?.label}</span><h3><a id={`cooking-open-${item.id}`} href={cookingHash(item.id)} onClick={() => rememberList(item.id)}>{item.name}</a></h3><RecipeTime recipe={item} />{item.timeNote && <p className="cooking-card-wait">{item.timeNote}</p>}<div className="cooking-card-foot"><span>≈ {item.kcalPerServing} kcal/phần</span><ArrowRight size={18} aria-hidden="true" /></div></div></article>)}</div>{matches.length > limit && <button className="cooking-load-more" type="button" onClick={() => setLimit((value) => value + 12)}>Xem thêm món <ChevronDown size={18} /></button>}</> : <div className="cooking-state"><Leaf size={32} /><h3>{savedOnly && !saved.size ? 'Giữ lại món bạn muốn nấu' : 'Chưa tìm thấy món phù hợp'}</h3><p>{savedOnly && !saved.size ? 'Bấm biểu tượng lưu trên món yêu thích để dễ tìm lại.' : 'Thử một nguyên liệu khác hoặc bỏ bớt bộ lọc.'}</p><button type="button" onClick={resetFilters}>Khám phá tất cả món</button></div>}
      </section>
      <footer className="cooking-library-footer"><ChefHat size={22} /><div><strong>Công thức rõ. Thông tin minh bạch.</strong><p>60 công thức từ bộ sách Aura. Kcal ước tính theo phần; thời gian dự kiến. Công thức chưa thử bếp thực tế, ảnh minh họa AI.</p></div><details className="cooking-chapter-links"><summary>Đọc theo chương <BookOpen size={17} /></summary>{book.chapters.map((item) => <button type="button" key={item.id} onClick={() => setPdf({ chapter: item, page: 1 })}>{item.id.padStart(2, '0')} · {item.title}</button>)}</details></footer>
    </>}
    {pdf && <SourcePdf key={`${pdf.chapter.id}-${pdf.page}`} {...pdf} onClose={() => setPdf(null)} />}
  </div>
}

export default function CookingPage({ ownerId }: { ownerId: string }) {
  // Remount all personal state when the actor changes, even in an already-open route.
  return <CookingExperience key={ownerId} ownerId={ownerId} />
}
