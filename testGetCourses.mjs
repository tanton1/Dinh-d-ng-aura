import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, collection, getDocs } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, config.firestoreDatabaseId);

async function run() {
  const snapshot = await getDocs(collection(db, 'courses'));
  console.log('Courses count in Firestore:', snapshot.docs.length);
  snapshot.docs.forEach(d => {
    console.log('Course ID:', d.id, 'Title:', d.data().title, 'Status:', d.data().status);
  });
  process.exit(0);
}

run().catch(console.error);
