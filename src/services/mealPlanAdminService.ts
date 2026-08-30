import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { firebaseStorage } from '../lib/firebaseStorage'

export type MealPlanDay = {
  dayName: string
  breakfast: string
  lunch: string
  snack: string
  dinner: string
  totalKcal: number
  totalProtein: number
}

export type AdminMealPlan = {
  id: string
  title: string
  goal: string
  proteinTarget: number
  calorieTarget: number
  popularRecipe: string
  days: MealPlanDay[]
  status?: 'draft' | 'published' | 'archived'
  assignedStudents?: number
  revision?: number
}

type RecipePayload = { id: string }

function functionsClient() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return firebaseFunctions
}

export async function loadMealPlanAdminData<TRecipe extends RecipePayload>() {
  const callable = httpsCallable<void, { recipes: TRecipe[]; mealPlans: AdminMealPlan[] }>(
    functionsClient(),
    'listMealPlanAdminData',
  )
  return (await callable()).data
}

export async function saveAdminRecipe<TRecipe extends RecipePayload>(recipe: TRecipe) {
  const callable = httpsCallable<{ recipe: TRecipe }, { recipe: TRecipe & { revision: number } }>(
    functionsClient(),
    'saveMealPlanRecipe',
  )
  return (await callable({ recipe })).data.recipe
}

export async function deleteAdminRecipe(recipeId: string) {
  const callable = httpsCallable<{ recipeId: string }, { deleted: boolean; recipeId: string }>(
    functionsClient(),
    'deleteMealPlanRecipe',
  )
  return (await callable({ recipeId })).data
}

export async function saveAdminMealPlan(mealPlan: AdminMealPlan) {
  const callable = httpsCallable<{ mealPlan: AdminMealPlan }, { mealPlan: AdminMealPlan }>(
    functionsClient(),
    'saveMealPlan',
  )
  return (await callable({ mealPlan })).data.mealPlan
}

export async function uploadRecipeImage(file: File, recipeId: string) {
  const user = firebaseAuth?.currentUser
  if (!firebaseStorage || !user) throw new Error('Firebase Storage chưa được cấu hình.')
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Ảnh phải là JPEG, PNG hoặc WebP và không vượt quá 5MB.')
  }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`
  const imageReference = ref(firebaseStorage, `recipe-images/${recipeId}/${fileName}`)
  await uploadBytes(imageReference, file, {
    contentType: file.type,
    customMetadata: { uploadedBy: user.uid, recipeId },
  })
  return getDownloadURL(imageReference)
}
