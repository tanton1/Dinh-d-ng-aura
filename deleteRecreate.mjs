import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const apiKey = config.apiKey;

async function run() {
  const email = 'nhattank16.1@gmail.com';
  const password = 'Tan889603$';

  // Try to sign up, it might say EMAIL_EXISTS
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });

  const data = await res.json();
  if (!res.ok) {
     if (data.error.message === 'EMAIL_EXISTS') {
         console.log("Email exists. I will try to update the password using OOB code if possible, or we need to use Admin SDK. But admin SDK doesn't have Identity Toolkit enabled. We can try to send a password reset email.");
         
         const pRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ email, requestType: "PASSWORD_RESET" })
         });
         console.log("Password reset email sent:", await pRes.json());
     } else {
         console.error('Error:', data);
     }
  } else {
      console.log("User recreated:", data);
  }
}

run().catch(console.error);
