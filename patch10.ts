import fs from 'fs';
const file = 'src/lib/firebase.ts';
let content = fs.readFileSync(file, 'utf8');

const target = `  try {
    firestoreDb = initializeFirestore(
      firebaseApp,
      { 
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        experimentalForceLongPolling: true
      },
      firestoreDatabaseId,
    )
  } catch {
    try {
      firestoreDb = initializeFirestore(
        firebaseApp,
        { 
          localCache: memoryLocalCache(),
          experimentalForceLongPolling: true
        },
        firestoreDatabaseId,
      )
    } catch {
      firestoreDb = getFirestore(firebaseApp, firestoreDatabaseId)
    }
  }`;

const replacement = `  try {
    firestoreDb = initializeFirestore(
      firebaseApp,
      { 
        localCache: memoryLocalCache(),
        experimentalForceLongPolling: true
      },
      firestoreDatabaseId,
    )
  } catch {
    firestoreDb = getFirestore(firebaseApp, firestoreDatabaseId)
  }`;

content = content.replace(target, replacement);
fs.writeFileSync(file, content);
