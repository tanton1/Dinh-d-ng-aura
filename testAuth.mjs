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
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/invalid-login-credentials') {
      console.log('Creating user...');
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      user = cred.user;
      console.log('User created:', user.uid);
    } else {
      throw e;
    }
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
  process.exit(0);
}

run().catch(console.error);
