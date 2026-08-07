import re

with open("src/services/nutritionService.ts", "r", encoding="utf-8") as f:
    code = f.read()

# Update generateMealReview
review_old = """
export async function generateMealReview(meal: any, userProfile: any): Promise<string> {
  try {
    const response = await fetch('/api/generateMealReview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ meal, userProfile })
    });
"""

review_new = """
export async function generateMealReview(meal: any, userProfile: any): Promise<string> {
  try {
    const firebase = requireNutritionFirebase();
    const token = await firebase.user.getIdToken();
    const response = await fetch('/api/generateMealReview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ meal }) // userProfile is fetched on server now
    });
"""

code = code.replace(review_old.strip(), review_new.strip())

# Update askAiCoach
coach_old = """
export async function askAiCoach(message: string, userProfile: any): Promise<string> {
  try {
    const response = await fetch('/api/ai/coach-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, userProfile })
    });
"""

coach_new = """
export async function askAiCoach(message: string, userProfile: any): Promise<string> {
  try {
    const firebase = requireNutritionFirebase();
    const token = await firebase.user.getIdToken();
    const response = await fetch('/api/ai/coach-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message }) // userProfile is fetched on server now
    });
"""

code = code.replace(coach_old.strip(), coach_new.strip())

with open("src/services/nutritionService.ts", "w", encoding="utf-8") as f:
    f.write(code)

print("Patched nutritionService auth headers")
