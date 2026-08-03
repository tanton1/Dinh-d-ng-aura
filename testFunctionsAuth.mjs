import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-southeast1');
const listAcademyCourses = httpsCallable(functions, 'listAcademyCourses');

async function run() {
  try {
    const cred = await signInWithEmailAndPassword(auth, 'testuser2_abc123@example.com', 'Password123!');
    console.log('Logged in as:', cred.user.uid);
    const res = await listAcademyCourses({});
    console.log('listAcademyCourses result:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('listAcademyCourses error:', err);
  }
  process.exit(0);
}

run();
