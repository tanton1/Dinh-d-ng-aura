with open('src/styles.css', 'r') as f:
    content = f.read()

import re

# Remove the previously added pseudo-element and z-index
content = re.sub(r'\.avatar-circle::before \{[^}]+\}', '', content)

old_css = """.avatar-circle {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ff4c4c, #ff1a8c);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 32px;
  font-weight: 700;
  box-shadow: 0 8px 16px rgba(255, 26, 140, 0.3);
  z-index: 1;
}"""

new_css = """.avatar-circle {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ff4c4c, #ff1a8c);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 32px;
  font-weight: 700;
  border: 3px solid white;
  background-clip: padding-box;
  box-shadow: 0 0 0 2px #ff7b54, 0 10px 25px rgba(255, 45, 145, 0.4);
}"""

content = content.replace(old_css, new_css)

with open('src/styles.css', 'w') as f:
    f.write(content)
