import re

with open('src/pages/student/ProfilePage.tsx', 'r') as f:
    content = f.read()

content = content.replace('<PageHeader eyebrow="TÀI KHOẢN" title="Hồ sơ cá nhân" description="Quản lý thông tin, mục tiêu và trải nghiệm Aura của bạn." />', '')

with open('src/pages/student/ProfilePage.tsx', 'w') as f:
    f.write(content)
