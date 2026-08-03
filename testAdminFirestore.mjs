import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, initializeFirestore } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, config.firestoreDatabaseId);

async function run() {
  const cred = await signInWithEmailAndPassword(auth, 'nhattank16.1@gmail.com', 'Tan889603$');
  console.log('Signed in admin:', cred.user.uid);
  
  const ref = doc(db, 'users', cred.user.uid);
  
  try {
    const existing = await getDoc(ref);
    console.log('Admin existing doc:', existing.exists());
    
    await setDoc(ref, {
      role: 'super_admin',
      membership: 'pro',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    console.log('Saved admin role to Firestore.');
  } catch (e) {
    console.error('Firestore Error:', e);
  }
  process.exit(0);
}

run().catch(console.error);
