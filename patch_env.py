import re

with open('server.ts', 'r') as f:
    content = f.read()

get_env = """  app.get('/firebase-messaging-sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    
    // Fallback parsing .env
    const getEnv = (key) => {
       if (process.env[key]) return process.env[key];
       try {
           const envFile = fs.readFileSync('.env', 'utf-8');
           const match = envFile.match(new RegExp(`^${key}=(.*)$`, 'm'));
           if (match) return match[1].trim();
       } catch(e) {}
       return '';
    };

    res.send(`
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "${getEnv('VITE_FIREBASE_API_KEY')}",
  authDomain: "${getEnv('VITE_FIREBASE_AUTH_DOMAIN')}",
  projectId: "${getEnv('VITE_FIREBASE_PROJECT_ID')}",
  storageBucket: "${getEnv('VITE_FIREBASE_STORAGE_BUCKET')}",
  messagingSenderId: "${getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID')}",
  appId: "${getEnv('VITE_FIREBASE_APP_ID')}"
});
"""

target = """  app.get('/firebase-messaging-sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "${process.env.VITE_FIREBASE_API_KEY}",
  authDomain: "${process.env.VITE_FIREBASE_AUTH_DOMAIN}",
  projectId: "${process.env.VITE_FIREBASE_PROJECT_ID}",
  storageBucket: "${process.env.VITE_FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${process.env.VITE_FIREBASE_MESSAGING_SENDER_ID}",
  appId: "${process.env.VITE_FIREBASE_APP_ID}"
});
"""

content = content.replace(target, get_env)

with open('server.ts', 'w') as f:
    f.write(content)
