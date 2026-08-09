const fs = require('fs');
let code = fs.readFileSync('src/pages/student/ProfilePage.tsx', 'utf8');

code = code.replace(
  "onSignOut?: () => void | Promise<void>;",
  "onSignOut?: () => void | Promise<void>;\n  onEditProfile?: () => void;"
);

code = code.replace(
  "export default function ProfilePage({ fullProfile, displayName, email, membership, onSignOut }: ProfilePageProps) {",
  "export default function ProfilePage({ fullProfile, displayName, email, membership, onSignOut, onEditProfile }: ProfilePageProps) {"
);

code = code.replace(
  "<PageHeader title=\"Hồ sơ cá nhân\" description=\"Thông tin và chỉ số cơ thể của bạn\" />",
  "<PageHeader title=\"Hồ sơ cá nhân\" description=\"Thông tin và chỉ số cơ thể của bạn\" />\n            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>\n              <button className=\"primary-button\" onClick={onEditProfile} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Pencil size={18} /> Cập nhật hồ sơ (Onboarding)</button>\n            </div>"
);

fs.writeFileSync('src/pages/student/ProfilePage.tsx', code);
