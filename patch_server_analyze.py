import re

with open("server.ts", "r", encoding="utf-8") as f:
    code = f.read()

# Replace studentGoal and studentCondition extraction for analyze-meal
analyze_body = """
      const { imageBase64, imageUrl, studentNote } = req.body;
      const uid = (req as any).user.uid;
      const userDoc = await getFirestore().collection('users').doc(uid).get();
      const userProfile = userDoc.exists ? userDoc.data() : null;
      
      const goal = userProfile?.goal || userProfile?.goals?.[0] || 'lose-fat';
      const studentGoal = goal === 'lose-fat' ? 'Giảm mỡ thâm hụt calo' : goal === 'gain-muscle' ? 'Tăng cơ nạc thặng dư đạm' : 'Duy trì vóc dáng & sức khỏe';
      
      const sexStr = userProfile?.biologicalSex === 'female' ? 'Nữ' : userProfile?.biologicalSex === 'male' ? 'Nam' : 'Chưa rõ';
      const ageStr = userProfile?.age ? `${userProfile.age} tuổi` : 'Chưa rõ';
      const heightStr = userProfile?.heightCm ? `${userProfile.heightCm} cm` : 'Chưa rõ';
      const weightStr = userProfile?.weightKg ? `${userProfile.weightKg} kg` : 'Chưa rõ';
      const studentCondition = `Giới tính: ${sexStr}, Tuổi: ${ageStr}, Cao: ${heightStr}, Nặng: ${weightStr}`;
"""
code = re.sub(r'const { imageBase64, imageUrl, studentNote, studentGoal, studentCondition } = req\.body;', analyze_body, code, count=1)

with open("server.ts", "w", encoding="utf-8") as f:
    f.write(code)

print("Patched server.ts analyze-meal")
