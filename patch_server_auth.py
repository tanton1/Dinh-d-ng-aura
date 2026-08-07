import re

with open("server.ts", "r", encoding="utf-8") as f:
    code = f.read()

auth_middleware = """
  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!adminInitialized) {
      // Allow fallback for dev environment if admin not init, but ideally should fail.
      // We'll enforce auth checking if initialized, otherwise fail.
      return res.status(500).json({ success: false, error: 'Firebase Admin not initialized' });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Missing token' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      (req as any).user = decodedToken;
      next();
    } catch (error) {
      console.error('Error verifying token:', error);
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
    }
  };
"""

code = code.replace("app.post(\"/api/generateMealReview\", async (req, res) => {", auth_middleware + "\n  app.post(\"/api/generateMealReview\", requireAuth, async (req, res) => {")
code = code.replace("app.post(\"/api/ai/analyze-meal\", async (req, res) => {", "app.post(\"/api/ai/analyze-meal\", requireAuth, async (req, res) => {")
code = code.replace("app.post(\"/api/ai/coach-chat\", async (req, res) => {", "app.post(\"/api/ai/coach-chat\", requireAuth, async (req, res) => {")

# Fetch userProfile from Firestore instead of req.body for generateMealReview
review_body = """
      const { meal } = req.body;
      const uid = (req as any).user.uid;
      const userDoc = await getFirestore().collection('users').doc(uid).get();
      const userProfile = userDoc.exists ? userDoc.data() : null;
"""
code = re.sub(r'const { meal, userProfile } = req\.body;', review_body, code, count=1)

# Fetch userProfile from Firestore for coach-chat
chat_body = """
      const { message } = req.body;
      const uid = (req as any).user.uid;
      const userDoc = await getFirestore().collection('users').doc(uid).get();
      const userProfile = userDoc.exists ? userDoc.data() : null;
"""
code = re.sub(r'const { message, userProfile } = req\.body;', chat_body, code, count=1)

with open("server.ts", "w", encoding="utf-8") as f:
    f.write(code)

print("Patched server.ts")
