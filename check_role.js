import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));
console.log(sa.projectId);
