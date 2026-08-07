import re

with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace('import admin from "firebase-admin";',
'''import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";''')

content = content.replace('const db = admin.firestore();', 'const db = getFirestore();')
content = content.replace('createdAt: admin.firestore.FieldValue.serverTimestamp()', 'createdAt: FieldValue.serverTimestamp()')
content = content.replace('await admin.messaging().sendEachForMulticast(message);', 'await getMessaging().sendEachForMulticast(message);')

with open('server.ts', 'w') as f:
    f.write(content)
