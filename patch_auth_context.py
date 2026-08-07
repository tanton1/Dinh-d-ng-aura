import re

with open('src/contexts/AuthContext.tsx', 'r') as f:
    content = f.read()

content = content.replace("        console.error('Error during signUp:', error);", "        // Firebase auth errors are handled in AuthPage")

with open('src/contexts/AuthContext.tsx', 'w') as f:
    f.write(content)
