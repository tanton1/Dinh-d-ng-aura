import fs from 'fs';
const file = 'src/firebaseSync.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace('time: string', 'time: string\n  createdAtTimestamp?: number');
content = content.replace("time: formattedTime,", "time: formattedTime,\n    createdAtTimestamp: r.createdAt?.toMillis ? r.createdAt.toMillis() : Date.now(),");
fs.writeFileSync(file, content);
