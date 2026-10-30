import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles-aura-tokens.css'
import { NutritionReviewWorkspace } from '../../src/features/nutrition-review/NutritionReviewWorkspace'

function Fixture() {
  const [focus, setFocus] = useState(new URLSearchParams(location.hash.split('?')[1]).get('focus'))
  useEffect(() => {
    const changed = () => setFocus(new URLSearchParams(location.hash.split('?')[1]).get('focus'))
    addEventListener('hashchange', changed)
    return () => removeEventListener('hashchange', changed)
  }, [])
  return <NutritionReviewWorkspace initialFocus={focus} />
}

createRoot(document.getElementById('root')!).render(<Fixture />)
