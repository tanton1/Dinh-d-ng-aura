import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, config.firestoreDatabaseId);

async function run() {
  const cred = await signInWithEmailAndPassword(auth, 'testuser2_abc123@example.com', 'Password123!');
  console.log('Signed in:', cred.user.uid);
  
  const ref = doc(db, 'users', cred.user.uid);
  
  try {
    await setDoc(ref, {
      uid: cred.user.uid,
      email: 'testuser2_abc123@example.com',
      role: 'student',
      membership: 'free',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    console.log('Saved to Firestore successfully with explicit databaseId.');
  } catch (e) {
    console.error('Firestore Error:', e);
  }
  process.exit(0);
}

run().catch(console.error);
