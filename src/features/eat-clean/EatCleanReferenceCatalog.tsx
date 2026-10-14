import { useMemo, useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { formatEatCleanMoney } from './EatCleanUi'
import {
  EAT_CLEAN_REFERENCE_GROUPS,
  FITFOOD_REFERENCE_SOURCE,
  filterEatCleanReferenceProducts,
  referencePricePerMeal,
  type EatCleanReferenceGroup,
} from './referenceCatalog'
import './EatCleanReferenceCatalog.css'

const MEAL_LABELS = { breakfast: 'Sáng', lunch: 'Trưa', dinner: 'Tối' } as const

export default function EatCleanReferenceCatalog() {
  const [group, setGroup] = useState<EatCleanReferenceGroup | 'all'>('all')
  const [query, setQuery] = useState('')
  const products = useMemo(() => filterEatCleanReferenceProducts(group, query), [group, query])
  const checkedOnLabel = FITFOOD_REFERENCE_SOURCE.checkedOn.split('-').reverse().join('/')

  return (
    <section className="eat-clean-reference" aria-labelledby="eat-clean-reference-title" data-testid="eat-clean-reference-catalog">
      <header className="eat-clean-reference__heading">
        <div>
          <h2 id="eat-clean-reference-title">Gói tuần & sản phẩm dùng kèm</h2>
          <p>Danh mục tham khảo từ <a href={FITFOOD_REFERENCE_SOURCE.websiteUrl} target="_blank" rel="noopener noreferrer">Fitfood VN</a>. Đối chiếu ngày {checkedOnLabel}.</p>
        </div>
        <a className="eat-clean-reference__menu-link" href={FITFOOD_REFERENCE_SOURCE.menuUrl} target="_blank" rel="noopener noreferrer">Thực đơn Fitfood <ExternalLink size={16} aria-hidden="true" /></a>
      </header>

      <div className="eat-clean-reference__notice">
        <strong>Sản phẩm Fitfood, không phải món Aura đang bán.</strong>
        <p>Giá và dinh dưỡng do Fitfood công bố, có thể thay đổi. Aura chưa nhận đơn hoặc cam kết giao các sản phẩm này tại Đà Nẵng. Các số kcal của gói chỉ tính những bữa trong gói, không phải mức năng lượng khuyến nghị cho bạn.</p>
      </div>

      <div className="eat-clean-reference__filters">
        <label className="eat-clean-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Tìm sản phẩm Fitfood</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm gói, món hoặc loại sản phẩm…" /></label>
        <div className="eat-clean-categories" aria-label="Nhóm sản phẩm tham khảo">
          {EAT_CLEAN_REFERENCE_GROUPS.map((item) => <button type="button" key={item.id} aria-pressed={group === item.id} className={group === item.id ? 'is-active' : ''} onClick={() => setGroup(item.id)}>{item.label}</button>)}
        </div>
      </div>
      <p className="eat-clean-reference__count" role="status">{products.length} sản phẩm tham khảo</p>

      {products.length > 0 ? <div className="eat-clean-reference__grid">
        {products.map((product) => {
          const perMeal = referencePricePerMeal(product)
          return (
            <article className="eat-clean-reference-product" key={product.id} data-testid="eat-clean-reference-product" data-product-id={product.id}>
              <header><span>{EAT_CLEAN_REFERENCE_GROUPS.find((item) => item.id === product.group)?.label}</span><h3>{product.name}</h3></header>
              {product.weeklyPlan && <div className="eat-clean-reference-product__meals" aria-label="Bữa ăn trong gói">{product.weeklyPlan.meals.map((meal) => <span key={meal}>{MEAL_LABELS[meal]}</span>)}</div>}
              <p className="eat-clean-reference-product__description">{product.description}</p>
              <div className="eat-clean-reference-product__price"><small>Giá tham khảo / {product.weeklyPlan ? 'gói tuần' : 'set hoặc hộp'}</small><strong>{formatEatCleanMoney(product.referencePrice)}</strong><span>{product.unitLabel}</span>{perMeal !== undefined && <small>Khoảng {formatEatCleanMoney(perMeal)}/bữa theo giá gói</small>}</div>
              {product.nutritionNote && <p className="eat-clean-reference-product__nutrition">{product.nutritionNote}</p>}
              {product.caution && <p className="eat-clean-reference-product__caution">{product.caution}</p>}
              <a className="eat-clean-reference-product__source" href={product.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Xem ${product.name} trên Fitfood`}>Xem trên Fitfood <ExternalLink size={16} aria-hidden="true" /></a>
            </article>
          )
        })}
      </div> : <div className="eat-clean-reference__empty"><p>Không tìm thấy sản phẩm. Thử từ khóa hoặc nhóm khác.</p><button type="button" className="eat-clean-button eat-clean-button--secondary" onClick={() => { setGroup('all'); setQuery('') }}>Xóa bộ lọc</button></div>}
    </section>
  )
}
