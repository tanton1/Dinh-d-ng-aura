import re

with open('firestore.rules', 'r') as f:
    content = f.read()

target = '''      match /progressPhotos/{photoId} {
        allow read, write: if isOwner(userId);
        allow read: if isAdmin();
      }'''

replacement = '''      match /progressPhotos/{photoId} {
        allow read, write: if isOwner(userId);
        allow read: if isAdmin();
      }

      match /notifications/{notificationId} {
        allow read, write: if isOwner(userId);
      }'''

content = content.replace(target, replacement)

with open('firestore.rules', 'w') as f:
    f.write(content)
