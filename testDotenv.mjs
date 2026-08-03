import dotenv from 'dotenv';
const parsed = dotenv.config({ path: '.env' }).parsed;
console.log(parsed);
