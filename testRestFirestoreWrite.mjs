import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
const idToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjIwY2FkODZkNzY5ZmFkZTViODkxNmQ5Y2U1MDc0YzgyMGYwNjdkNTIiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vZ2VuLWxhbmctY2xpZW50LTA4MTU5NjY5MDkiLCJhdWQiOiJnZW4tbGFuZy1jbGllbnQtMDgxNTk2NjkwOSIsImF1dGhfdGltZSI6MTc4NTc0NzAyNCwidXNlcl9pZCI6InZ1WnkzVnFCRlhUZmc1MU9rdDlrZm12UzkzcDEiLCJzdWIiOiJ2dVp5M1ZxQkZYVGZnNTFPa3Q5a2ZtdlM5M3AxIiwiaWF0IjoxNzg1NzQ3MDI0LCJleHAiOjE3ODU3NTA2MjQsImVtYWlsIjoidGVzdHVzZXIyX2FiYzEyM0BleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwiZmlyZWJhc2UiOnsiaWRlbnRpdGllcyI6eyJlbWFpbCI6WyJ0ZXN0dXNlcjJfYWJjMTIzQGV4YW1wbGUuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.TuNO6vsDxkeoC8YIoDPeXrH_gk50w2gn-roMt2kXdhcGbs1y8YyybFHL7fFDYT0aRuJA5EtZh2DqvigUTX122NwAeRa--l9VdXKWg1E5JoCz1E206WtSxXwpHBCD6HAz6TEjZVruo3GWY6y2Fk6RL59xW9bQCph7x1bS-uZh1I1Adex5TTegAty6x1rdkNspz2xtdrPl1LA7L-EuGqVCymRAoYKY_MKGa-kzpSuFqmjWhAqEmEJHDQnH03y9K5KZ9D5t1eMGwoHxnkAb_EWEFx_YY3mF99iWg-oqE-lozcy02RQk4kE_NQXvSD-Vt7oupiAoILl4VGMAUZ-vX54GDg';
const localId = 'vuZy3VqBFXTfg51Okt9kfmvS93p1';

async function run() {
  const dbUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7/documents/users/${localId}`;
  
  const fsRes = await fetch(dbUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        uid: { stringValue: localId },
        email: { stringValue: 'testuser2_abc123@example.com' },
        role: { stringValue: 'student' },
        membership: { stringValue: 'free' }
      }
    })
  });
  
  const fsData = await fsRes.json();
  console.log(fsData);
}

run().catch(console.error);
