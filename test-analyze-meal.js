import fetch from 'node-fetch';

async function test() {
  const base64Pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const res = await fetch('http://localhost:3000/api/ai/analyze-meal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: base64Pixel,
      studentNote: "Ăn sáng",
      studentGoal: "Giảm cân",
      studentCondition: "Khỏe mạnh"
    })
  });
  const data = await res.json();
  console.log(data);
}
test();
