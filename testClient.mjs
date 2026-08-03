import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  const email = 'nhattank16.1@gmail.com';
  const password = 'Tan889603$';
  
  const cred = await signInWithEmailAndPassword(auth, email, password);
  console.log('Signed in successfully:', cred.user.uid);
  
  const ref = doc(db, 'users', cred.user.uid);
  const existing = await getDoc(ref);
  console.log('Existing doc:', existing.data());
  
  await setDoc(ref, {
      role: 'super_admin',
      membership: 'pro',
  }, { merge: true });
  
  console.log('Role updated to super_admin in Firestore.');
  
  const newDoc = await getDoc(ref);
  console.log('New doc:', newDoc.data());
  process.exit(0);
}

run().catch(console.error);
