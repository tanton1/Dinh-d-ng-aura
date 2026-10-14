import { useMemo, useState } from 'react'
import { ArrowRight, Search, ShoppingBag } from 'lucide-react'
import { formatEatCleanMoney } from './EatCleanUi'
import {
  EAT_CLEAN_PACKAGE_GROUPS,
  filterEatCleanPackages,
  packageImagePath,
  packagePricePerMeal,
  type EatCleanPackageGroup,
} from './referenceCatalog'
import './EatCleanReferenceCatalog.css'

const MEAL_LABELS = { breakfast: 'Sáng', lunch: 'Trưa', dinner: 'Tối' } as const

interface EatCleanPackageCatalogProps {
  onBrowseMenu?: () => void
}

export default function EatCleanReferenceCatalog({ onBrowseMenu }: EatCleanPackageCatalogProps) {
  const [group, setGroup] = useState<EatCleanPackageGroup | 'all'>('all')
  const [query, setQuery] = useState('')
  const products = useMemo(() => filterEatCleanPackages(group, query), [group, query])

  return (
    <section className="eat-clean-reference" aria-labelledby="eat-clean-package-title" data-testid="eat-clean-package-catalog">
      <header className="eat-clean-reference__heading">
        <div>
          <h2 id="eat-clean-package-title">Combo gói ăn</h2>
          <p>Chọn sẵn số bữa, khẩu phần và lịch ăn phù hợp với bạn.</p>
        </div>
        {onBrowseMenu && <button type="button" className="eat-clean-reference__menu-link" onClick={onBrowseMenu}><ShoppingBag size={16} aria-hidden="true" /> Chọn món để đặt</button>}
      </header>

      <div className="eat-clean-reference__filters">
        <label className="eat-clean-search">
          <Search size={19} aria-hidden="true" />
          <span className="sr-only">Tìm combo gói ăn</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm combo, món hoặc loại sản phẩm…" />
        </label>
        <div className="eat-clean-categories" aria-label="Nhóm combo gói ăn">
          {EAT_CLEAN_PACKAGE_GROUPS.map((item) => <button type="button" key={item.id} aria-pressed={group === item.id} className={group === item.id ? 'is-active' : ''} onClick={() => setGroup(item.id)}>{item.label}</button>)}
        </div>
      </div>
      <p className="eat-clean-reference__count" role="status">{products.length} combo</p>

      {products.length > 0 ? <div className="eat-clean-reference__grid">
        {products.map((product, index) => {
          const perMeal = packagePricePerMeal(product)
          return (
            <article className="eat-clean-reference-product" key={product.id} data-testid="eat-clean-package" data-product-id={product.id}>
              <div className="eat-clean-reference-product__image-wrap">
                <img
                  className="eat-clean-reference-product__image"
                  src={packageImagePath(product)}
                  alt={product.name}
                  width={640}
                  height={376}
                  loading={index < 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={index < 2 ? 'high' : 'auto'}
                  sizes="(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 33vw"
                />
              </div>
              <div className="eat-clean-reference-product__body">
                <header><span>{EAT_CLEAN_PACKAGE_GROUPS.find((item) => item.id === product.group)?.label}</span><h3>{product.name}</h3></header>
                {product.weeklyPlan && <div className="eat-clean-reference-product__meals" aria-label="Bữa ăn trong gói">{product.weeklyPlan.meals.map((meal) => <span key={meal}>{MEAL_LABELS[meal]}</span>)}</div>}
                <p className="eat-clean-reference-product__description">{product.description}</p>
                <div className="eat-clean-reference-product__price"><small>Giá combo</small><strong>{formatEatCleanMoney(product.price)}</strong><span>{product.unitLabel}</span>{perMeal !== undefined && <small>Khoảng {formatEatCleanMoney(perMeal)} / bữa</small>}</div>
                {product.nutritionNote && <p className="eat-clean-reference-product__nutrition">{product.nutritionNote}</p>}
                {product.caution && <p className="eat-clean-reference-product__caution">{product.caution}</p>}
                {onBrowseMenu && <button type="button" className="eat-clean-button eat-clean-button--primary eat-clean-reference-product__action" onClick={onBrowseMenu}>Xem món để đặt <ArrowRight size={16} aria-hidden="true" /></button>}
              </div>
            </article>
          )
        })}
      </div> : <div className="eat-clean-reference__empty"><p>Không tìm thấy combo. Thử từ khóa hoặc nhóm khác.</p><button type="button" className="eat-clean-button eat-clean-button--secondary" onClick={() => { setGroup('all'); setQuery('') }}>Xóa bộ lọc</button></div>}
    </section>
  )
}
