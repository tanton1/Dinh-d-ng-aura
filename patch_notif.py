import re

with open('src/pages/student/ProfilePage.tsx', 'r') as f:
    content = f.read()

content = content.replace("import { PageHeader, Toggle } from '../../components/ui'",
"import { PageHeader, Toggle } from '../../components/ui'\nimport { requestFcmPermissionAndToken } from '../../services/fcmService'\nimport { useAuth } from '../../contexts/AuthContext'")

content = content.replace("  const [notificationValues, setNotificationValues] = useState",
"  const { user } = useAuth()\n  const [notificationValues, setNotificationValues] = useState")

notif_handler = """                onChange={async (enabled) => {
                  try {
                    setError(null)
                    setSavingNotification(true)
                    const next = { ...notificationValues, enabled }
                    setNotificationValues(next)
                    if (onSave) await onSave({ notificationSettings: next })
                    setSuccess(enabled ? 'Đã bật thông báo đẩy' : 'Đã tắt thông báo đẩy')
                  } catch (err: unknown) {
                    setError((err as Error).message)
                    setNotificationValues({ ...notificationValues, enabled: !enabled })
                  } finally {
                    setSavingNotification(false)
                    setTimeout(() => setSuccess(null), 3000)
                  }
                }}"""

new_notif_handler = """                onChange={async (enabled) => {
                  try {
                    setError(null)
                    setSavingNotification(true)
                    const next = { ...notificationValues, enabled }
                    setNotificationValues(next)
                    
                    if (enabled && user?.uid) {
                        await requestFcmPermissionAndToken(user.uid)
                    }
                    
                    if (onSave) await onSave({ notificationSettings: next })
                    setSuccess(enabled ? 'Đã bật thông báo đẩy' : 'Đã tắt thông báo đẩy')
                  } catch (err: unknown) {
                    setError((err as Error).message)
                    setNotificationValues({ ...notificationValues, enabled: !enabled })
                  } finally {
                    setSavingNotification(false)
                    setTimeout(() => setSuccess(null), 3000)
                  }
                }}"""
content = content.replace(notif_handler, new_notif_handler)

with open('src/pages/student/ProfilePage.tsx', 'w') as f:
    f.write(content)
