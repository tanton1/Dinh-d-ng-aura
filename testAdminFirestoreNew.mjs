import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, config.firestoreDatabaseId);

async function run() {
  const email = 'nhattank16.1_new@gmail.com';
  const cred = await createUserWithEmailAndPassword(auth, email, 'Password123!');
  console.log('Created admin:', cred.user.uid);
  
  const ref = doc(db, 'users', cred.user.uid);
  
  try {
    await setDoc(ref, {
      uid: cred.user.uid,
      email: email, // This email shouldn't match the hardcoded rule for super_admin! Let's test the rule.
      role: 'student',
      membership: 'free',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    console.log('Saved user to Firestore.');
  } catch (e) {
    console.error('Firestore Error:', e);
  }
  process.exit(0);
}

run().catch(console.error);
