import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  const email = 'nhattank16.1@gmail.com';
  const password = 'Tan889603$';
  
  let user;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    user = cred.user;
    console.log('Signed in successfully');
  } catch(e) {
    throw e;
  }

  console.log('User ID:', user.uid);

  const userDocRef = doc(db, 'users', user.uid);
  await setDoc(userDocRef, {
    uid: user.uid,
    email,
    role: 'super_admin',
    createdAt: new Date(),
    membership: 'pro'
  }, { merge: true });

  console.log('Admin permissions granted in Firestore.');
  
  const adminDocRef = doc(db, 'adminUsers', user.uid);
  await setDoc(adminDocRef, {
    email,
    role: 'super_admin',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  process.exit(0);
}

run().catch(console.error);
