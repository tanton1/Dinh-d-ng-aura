import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const apiKey = config.apiKey;

async function run() {
  const email = 'testuser2_abc123@example.com';
  const password = 'Password123!';

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });

  const data = await res.json();
  console.log(data);
}

run().catch(console.error);
