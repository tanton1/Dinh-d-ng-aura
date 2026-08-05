import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: sa.projectId,
    clientEmail: sa.clientEmail,
    privateKey: sa.privateKey
  })
});
const db = admin.firestore();
db.collection('users').get().then(snap => {
  snap.forEach(doc => console.log(doc.id, doc.data()));
  process.exit(0);
}).catch(console.error);
