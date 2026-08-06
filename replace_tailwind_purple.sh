#!/bin/bash
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/bg-purple-600/bg-gradient-to-r from-pink-500 to-orange-400/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/bg-purple-500/bg-gradient-to-r from-pink-500 to-orange-400/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/text-purple-/text-pink-/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/bg-purple-/bg-pink-/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/border-purple-/border-pink-/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/ring-purple-/ring-pink-/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/from-purple-/from-pink-/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/to-purple-/to-orange-/g' {} +
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/shadow-purple-/shadow-pink-/g' {} +
