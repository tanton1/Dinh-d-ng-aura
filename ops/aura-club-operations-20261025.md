# Aura Club admin operations, 25 October 2026

Scope: only the admin operations page. The existing learner and PT UI, navigation, points, catalog prices and membership lifecycle are preserved. Only admin/super_admin in the admin workspace replace the global footer while on admin-loyalty. Other roles retain their application dock.

## Design

Aura pink #EC2C76 and orange #FF7A45 remain in imagery and tier visualization. Paper #FFFFFF, canvas #F6F6F7, ink/action #262229 and line #E7E3E8 keep the operating controls quiet. Be Vietnam Pro throughout. Left-aligned headings and content. 44px minimum button targets with content-sized width.

Desktop: [Header] [Overview | Redeem | Members | Gifts | More] [Selected panel]
Mobile: [Header] [Selected panel] [Single fixed operations dock for admin]

Review: the previous evergreen concept did not preserve Aura's identity and was discarded after the user's correction. The final art represents real reward categories; no values, quantities or invented promotions are baked into the images. The three previous training/nutrition/community banners were removed. Only the selected operational tab reads data; recently loaded tab data is reused for up to 60 seconds. Financial mutations retain existing server validations.

## Banner assets

Generated with the built-in imagegen tool. Both selected source images are 1536 × 1024 PNG; project assets are WebP at 480 × 320 and 960 × 640, resized/encoded with Pillow without changing content.

- public/images/aura-club/rewards-gifts-{480,960}.webp
- public/images/aura-club/rewards-vouchers-{480,960}.webp

## Final prompts

1. Use case: product-mockup. Asset type: gift rewards banner for Aura Fitness / Aura Club, to sit inside its white admin interface. Create a NEW premium photorealistic commercial still life of a neatly folded white athletic T-shirt, a white sports shaker with a vivid Aura pink lid, and a small white gift box tied with a narrow orange ribbon. Strong Aura Fitness brand palette: white #FFFFFF dominant, vibrant pink #EC2C76 and orange #FF7A45 as intentional accents, charcoal small details. Bright crisp studio light, clean modern fitness brand, subtle pink and orange bounced light on a white seamless background, authentic textile and plastic texture. Landscape 1536x1024, objects centered and fully within central 80% for responsive crops, generous margins, camera slightly above front. NO green, sage, leaves, plants, beige or cream; NO people, lettering, currency, numbers, invented logos, watermark. Realistic gift catalog imagery; no decorative sparkles or confetti.

2. Use case: ads-marketing. Asset type: voucher redemption banner for Aura Fitness / Aura Club, coordinated with a white, pink and orange fitness brand. Create a NEW premium photorealistic commercial still life: two elegant rounded gift cards, one vivid Aura pink #EC2C76 and one white with an orange #FF7A45 edge, partially emerging from a pristine open white envelope, beside a short curled pink ribbon. Cards with subtle embossed curved line details, no writing. White #FFFFFF seamless studio surface, bright crisp softbox light, realistic tactile matte paper, soft pink-orange bounced light. Modern energetic wellness/fitness identity, not vintage, not green. Landscape 1536x1024, composition centered within central 80% with generous margins for responsive crops. NO green, sage, foliage, beige or cream, people, letters, numerals, currency, logos, watermark, confetti. Do not show any prices or promise a promotion.
