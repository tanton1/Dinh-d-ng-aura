import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  const email = 'test_new_user123@gmail.com';
  const password = 'Password123!';
  
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  console.log('Created:', cred.user.uid);
  
  const ref = doc(db, 'users', cred.user.uid);
  
  await setDoc(ref, {
      uid: cred.user.uid,
      email,
      role: 'student',
      membership: 'free',
  });
  
  console.log('Saved to Firestore.');
  process.exit(0);
}

run().catch(console.error);
