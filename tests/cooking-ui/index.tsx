import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles-bootstrap.css'
import '../../src/styles.css'
import '../../src/styles-aura.css'
import '../../src/styles-ai-coach.css'
import '../../src/styles-ui-v4.css'
import '../../src/styles-aura-tokens.css'
import AppShell from '../../src/components/AppShell'
import CookingPage from '../../src/features/cooking/CookingPage'
import ConnectedMealPlanPage, { type ConnectedMealPlanPageProps } from '../../src/pages/student/ConnectedMealPlanPage'
import { DEMO_CATALOG, DEMO_MENU_DISHES } from '../../src/features/nutrition/demoCatalog'
import '../../src/styles-nutrition.css'
const artworkExamples = [{"code":"6001","name":"Bơ"},{"code":"13049","name":"Mẻ"},{"code":"3015","name":"Hạt điều, khô "},{"code":"2015","name":"Miến dong, khô"},{"code":"14057","name":"Nước đá"},{"code":"5033","name":"Muỗm, quéo, tươi"},{"code":"4010002","name":"Cải bắp, luộc"},{"code":"4047","name":"Lá me, tươi "},{"code":"4076","name":"Rau khoai lang, tươi"},{"code":"4062","name":"Ớt vàng to, tươi"},{"code":"7044","name":"Lưỡi bò, tươi"},{"code":"7020","name":"Thịt ngựa, tươi"},{"code":"8012","name":"Cá khô (chim, thu, nụ, đé), sống"},{"code":"8036","name":"Hải sâm, tươi"},{"code":"15019","name":"Bánh khoái"},{"code":"11001","name":"Chuối nước đường"},{"code":"12018","name":"Kẹo dừa mềm"}]
const artworkItems = artworkExamples.map((food, index) => ({ ...DEMO_CATALOG[1], ...food, id: `art-${index}` }))
const libraryItems = [...DEMO_MENU_DISHES, ...DEMO_CATALOG.filter(food => food.kind === 'food').map(food => food.id === 'demo-uc-ga' ? { ...food, code: '6001', name: 'Bơ' } : food), { ...DEMO_MENU_DISHES[0], id: 'duplicate', name: 'ỨC GÀ ÁP CHẢO & RAU CỦ' }, { ...DEMO_MENU_DISHES[0], id: 'missing', name: 'Món chưa đủ dữ liệu dinh dưỡng', calories: null, servingLabel: 'Trang nguồn không nêu rõ khẩu phần chuẩn' }]
import NutritionWorkspace, { type NutritionWorkspaceProps } from '../../src/pages/student/NutritionWorkspace'

function Fixture() {
  const [owner, setOwner] = useState('member-a')
  const [hash, setHash] = useState(location.hash || '#/cooking')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [savedFoods, setSavedFoods] = useState(new Set<string>())
  useEffect(() => {
    const changed = () => setHash(location.hash)
    const actorChanged = (event: Event) => setOwner((event as CustomEvent<string>).detail)
    addEventListener('hashchange', changed)
    addEventListener('cooking-test:actor', actorChanged)
    return () => { removeEventListener('hashchange', changed); removeEventListener('cooking-test:actor', actorChanged) }
  }, [])
  const view = hash.startsWith('#/food-library') ? 'food-library' : hash.startsWith('#/nutrition') ? 'nutrition' : 'cooking'
  const noOp = () => {}
  return <AppShell mode="student" view={view} onNavigate={(next) => { location.hash = `#/${next}` }} onModeChange={noOp} mobileMenu={mobileMenu} setMobileMenu={setMobileMenu} userName="Thành viên Aura" userId={owner} userRole="Học viên" role="student" backendMode="firebase" onSignOut={noOp}>
    {view === 'food-library' ? <div className="page nutrition-page"><ConnectedMealPlanPage {...({ days: [], meals: [], selectedDayId: '', dailyCalorieGoal: 2000, weekLabel: '', strategyTitle: '', strategyDescription: '', constraints: [], onSelectDay: noOp, onGeneratePlan: noOp, onAddMeal: noOp, onReplaceMeal: noOp, onRemoveMeal: noOp, onConfirmPlan: noOp, onReload: noOp, onShiftWeek: noOp, onOpenCatalogFood: noOp, onLogPlannedMeal: noOp } as Omit<ConnectedMealPlanPageProps, 'savedFoodIds' | 'onToggleSaved'>)} allowDemo initialCatalog={location.search.includes('artwork=1') ? artworkItems : libraryItems} savedFoodIds={savedFoods} onToggleSaved={(food, saved) => setSavedFoods(current => { const next = new Set(current); if (saved) next.add(food.id); else next.delete(food.id); return next })} /></div> : view === 'cooking' ? <CookingPage ownerId={owner} /> : <NutritionWorkspace activeSection="explore" onSectionChange={noOp} todayContent={null} diary={{} as NutritionWorkspaceProps['diary']} plan={{} as NutritionWorkspaceProps['plan']} onScan={noOp} onOpenAskAura={noOp} v4={!new URLSearchParams(location.search).has('legacy')} />}
  </AppShell>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
