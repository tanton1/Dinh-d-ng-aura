with open('src/styles.css', 'r') as f:
    content = f.read()

import re

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
  border: 3px solid white;
  background-clip: padding-box;
  box-shadow: 0 0 0 2px #ff7b54, 0 10px 25px rgba(255, 45, 145, 0.4);
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
}

.avatar-circle::before {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ff7b54, #ff2d91);
  z-index: -1;
  box-shadow: 0 10px 25px rgba(255, 45, 145, 0.4);
  -webkit-mask: radial-gradient(circle, transparent 40px, black 41px);
  mask: radial-gradient(circle, transparent 40px, black 41px);
}"""

content = content.replace(old_css, new_css)

with open('src/styles.css', 'w') as f:
    f.write(content)
