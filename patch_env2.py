import re

with open('server.ts', 'r') as f:
    content = f.read()

target = '''    // Fallback parsing .env
    const getEnv = (key) => {
       if (process.env[key]) return process.env[key];
       try {
           const envFile = fs.readFileSync('.env', 'utf-8');
           const match = envFile.match(new RegExp(`^${key}=(.*)$`, 'm'));
           if (match) return match[1].trim();
       } catch(e) {}
       return '';
    };'''

new_get_env = '''    // Prioritize .env parsing
    const getEnv = (key) => {
       try {
           const envFile = fs.readFileSync('.env', 'utf-8');
           const match = envFile.match(new RegExp(`^${key}=(.*)$`, 'm'));
           if (match && match[1].trim() !== 'your_api_key' && !match[1].includes('your_')) {
               return match[1].trim();
           }
       } catch(e) {}
       return process.env[key] || '';
    };'''

content = content.replace(target, new_get_env)

with open('server.ts', 'w') as f:
    f.write(content)
