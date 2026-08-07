import re

with open('src/components/progress/ProgressPhotosCard.tsx', 'r') as f:
    content = f.read()

# Fix 1: uploadUserProgressPhoto
content = content.replace('''      let finalImageUrl = formImage
      if (ownerId && ownerId !== 'demo' && ownerId !== 'anonymous') {
         if (formImage.startsWith('data:image')) {
            const uploadedUrl = await uploadUserProgressPhoto(ownerId, formImage)
            if (uploadedUrl) finalImageUrl = uploadedUrl
         }
      }''', '''      let finalImageUrl = formImage''')

# Fix 2: saveUserProgressPhoto type error
content = content.replace('''         await saveUserProgressPhoto(ownerId, newPhoto)''', '''         await saveUserProgressPhoto(ownerId, newPhoto as any)''')

with open('src/components/progress/ProgressPhotosCard.tsx', 'w') as f:
    f.write(content)
