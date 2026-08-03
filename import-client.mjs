import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, writeBatch, doc } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, config.firestoreDatabaseId);

const records = JSON.parse(fs.readFileSync('data/nutrition/viendinhduong.records.json', 'utf-8'));

async function run() {
  try {
    const cred = await signInWithEmailAndPassword(auth, 'nhattank16.1@gmail.com', '12345678');
    console.log('Logged in user:', cred.user.uid);
    let written = 0;
    const BATCH_SIZE = 400;
    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
      const batch = writeBatch(db);
      const slice = records.slice(offset, offset + BATCH_SIZE);
      for (const record of slice) {
        batch.set(doc(db, 'nutritionCatalog', record.id), {
          ...record,
          _importedAt: new Date().toISOString()
        });
      }
      await batch.commit();
      written += slice.length;
      console.log(`Wrote ${written}/${records.length}`);
    }
    console.log('Import complete.');
  } catch (err) {
    console.error('Import error:', err);
  }
  process.exit(0);
}

run();
