import re

with open('server.ts', 'r') as f:
    content = f.read()

old_init = """// Initialize Firebase Admin if Service Account is available or using default credentials
try {
  admin.initializeApp();
} catch (e) {
  console.warn("Firebase Admin init failed (might not have credentials):", e);
}"""

new_init = """// Initialize Firebase Admin if Service Account is available
let adminInitialized = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    adminInitialized = true;
  } else {
    console.warn("No FIREBASE_SERVICE_ACCOUNT_KEY found. Push notifications cron job will be disabled.");
  }
} catch (e) {
  console.warn("Firebase Admin init failed:", e);
}"""

content = content.replace(old_init, new_init)

old_cron = """  // Notification Cron Job
  setInterval(async () => {
    try {
      const db = getFirestore();"""

new_cron = """  // Notification Cron Job
  setInterval(async () => {
    if (!adminInitialized) return;
    try {
      const db = getFirestore();"""

content = content.replace(old_cron, new_cron)

with open('server.ts', 'w') as f:
    f.write(content)
