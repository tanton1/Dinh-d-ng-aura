import re

with open("server.ts", "r", encoding="utf-8") as f:
    code = f.read()

# Replace the part that handles imageUrl
old_handling = """
      // Check if imageBase64 is passed
      if (imageBase64 && typeof imageBase64 === 'string') {
        const match = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      } else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      }
"""

new_handling = """
      // Check if imageBase64 is passed
      if (imageBase64 && typeof imageBase64 === 'string') {
        const match = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      } else if (imageUrl && typeof imageUrl === 'string') {
        if (imageUrl.startsWith('data:')) {
          const match = imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2]
              }
            });
          }
        } else if (imageUrl.startsWith('http')) {
          // Fetch the image from URL and convert to base64
          try {
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const arrayBuffer = await imgRes.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
              parts.push({
                inlineData: {
                  mimeType,
                  data: buffer.toString('base64')
                }
              });
            } else {
              console.warn('Failed to fetch image URL:', imgRes.status);
            }
          } catch (fetchErr) {
            console.error('Error fetching image URL:', fetchErr);
          }
        }
      }
"""

code = code.replace(old_handling.strip(), new_handling.strip())

with open("server.ts", "w", encoding="utf-8") as f:
    f.write(code)

print("Patched server.ts imageUrl handling")
