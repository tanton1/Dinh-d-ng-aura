import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const functions = getFunctions(app, 'asia-southeast1');
const listAcademyCourses = httpsCallable(functions, 'listAcademyCourses');

async function run() {
  try {
    const res = await listAcademyCourses({});
    console.log('listAcademyCourses result:', res.data);
  } catch (err) {
    console.error('listAcademyCourses error:', err);
  }
  process.exit(0);
}

run();
