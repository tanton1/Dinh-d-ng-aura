#!/bin/bash
FILES=(
  "src/styles-onboarding.css"
  "src/styles-coaching.css"
  "src/styles-nutrition-detail.css"
  "src/styles-auth.css"
  "src/styles-nutrition.css"
  "src/styles-admin.css"
  "src/styles.css"
  "src/styles-academy.css"
)
for file in "${FILES[@]}"; do
  sed -i 's/var(--purple)/var(--primary)/g' "$file"
  sed -i 's/var(--purple-dark)/var(--primary-dark)/g' "$file"
  sed -i 's/var(--purple-soft)/var(--primary-soft)/g' "$file"
  sed -i 's/background: var(--primary)/background: var(--gradient-primary)/g' "$file"
done
