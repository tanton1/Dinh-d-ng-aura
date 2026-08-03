import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = initializeFirestore(app, {}, config.firestoreDatabaseId);

async function check() {
  console.log("Checking courses...");
  const coursesSnap = await getDocs(collection(db, 'courses'));
  console.log("Courses count:", coursesSnap.docs.length);
  coursesSnap.docs.forEach(d => {
    console.log(`- Course ID: ${d.id}`);
    console.log(`  title: ${d.data().title}`);
    console.log(`  status: ${d.data().status}`);
    console.log(`  schemaVersion: ${d.data().schemaVersion}`);
  });

  console.log("\nChecking users...");
  const usersSnap = await getDocs(collection(db, 'users'));
  console.log("Users count:", usersSnap.docs.length);
  usersSnap.docs.forEach(u => {
    console.log(`- User ID: ${u.id}, email: ${u.data().email}, role: ${u.data().role}`);
  });

  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
