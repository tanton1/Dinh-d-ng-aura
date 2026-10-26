"""Read-only audit against the committed source PDFs, independent of the importer."""
import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageChops, ImageStat

root = Path(__file__).resolve().parents[1]
book = json.loads((root / 'src/features/cooking/data/cookbook.json').read_text(encoding='utf-8'))
normalize = lambda value: re.sub(r'\s+', ' ', value).strip()
checked = 0
checked_images = 0
max_image_rmse = 0
for chapter in book['chapters']:
    pdf = root / 'public' / chapter['pdf']
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == chapter['sourceSha256']
    reader = PdfReader(pdf)
    for recipe in [r for r in book['recipes'] if r['chapterId'] == chapter['id']]:
        source_page = reader.pages[recipe['sourcePage'] - 1]
        first = source_page.extract_text()
        method = first if chapter['id'] == '6' else reader.pages[recipe['sourcePage']].extract_text()
        source = normalize(first + method)
        source_index = normalize(reader.pages[1].extract_text())
        index_entry = f"{recipe['id']} {recipe['name']} {recipe['sourcePage']:02}"
        assert index_entry.casefold() in source_index.casefold(), (recipe['id'], 'name/page differs from source index')
        assert f"≈ {recipe['kcalPerServing']} KCAL/PHẦN" in normalize(first), (recipe['id'], 'serving kcal differs from source')
        assert re.search(rf"NGUYÊN LIỆU CHO {recipe['servings']} (NGƯỜI|PHẦN)", normalize(first)), (recipe['id'], 'servings differ from source')
        if recipe['batchKcal'] is not None:
            assert f"≈ {recipe['batchKcal']} KCAL/MẺ" in normalize(first), (recipe['id'], 'batch kcal differs from source')
        for label in recipe['timeLabels']:
            # Chapter 6 abbreviates "Chuẩn bị" to "CB" on two pages.
            assert label.casefold() in normalize(first).casefold().replace('cb ', 'chuẩn bị '), (recipe['id'], label)
        assert recipe['requiresCooking'] == ('CẦN NẤU CÙNG MÓN' in first), (recipe['id'], 'raw marinade flag differs from source')
        for value in [recipe['name'], recipe['description'], recipe['tip'], recipe['allergenNote'], recipe['substitution'], recipe['portionDetail'], recipe['portionNote'], recipe['timeNote']]:
            if value and value != recipe['name']:
                assert normalize(value) in source, (recipe['id'], value)
        for ingredient in recipe['ingredients']:
            assert normalize(ingredient['name']) in source, (recipe['id'], ingredient)
            assert normalize(ingredient['amount']) in source, (recipe['id'], ingredient)
        source_ingredients = first.split('NGUYÊN LIỆU CHO', 1)[1].split('\n', 1)[1]
        if chapter['id'] == '6':
            source_ingredients = source_ingredients.split('\n≈', 1)[0]
            imported_ingredients = ' '.join(f"{i['name']} · {i['amount']}" for i in recipe['ingredients'])
        else:
            source_ingredients = source_ingredients.split('KCAL ƯỚC TÍNH', 1)[1].split('\nKcal cho', 1)[0]
            imported_ingredients = ' '.join(f"{i['name']} {i['amount']}" for i in recipe['ingredients'])
        assert normalize(source_ingredients) == normalize(imported_ingredients), (recipe['id'], 'ingredient omitted/reordered')
        # Compare the ENTIRE source instruction block, not merely each extracted substring.
        source_steps = method.split('CÁCH LÀM', 1)[1].split('Bếp mình mách bạn:', 1)[0].split('Ghép món:', 1)[0]
        source_steps = source_steps.replace('Vào bếp thôi.', '').strip()
        imported_steps = ' '.join(f"{i+1:02} {s['title']}{'.' if chapter['id'] == '6' else ''} {s['text']}" for i, s in enumerate(recipe['steps']))
        assert normalize(source_steps) == normalize(imported_steps), (recipe['id'], 'instruction omitted/reordered')
        # Compare both delivered variants to the image embedded on this recipe's
        # own PDF page. A small pixel tolerance permits resizing/WebP compression
        # while detecting an accidentally reused cover or another recipe's photo.
        source_photo = max(source_page.images, key=lambda item: item.image.width * item.image.height).image.convert('RGB')
        for key, edge in [('image', 1200), ('thumbnail', 560)]:
            with Image.open(root / 'public' / recipe[key]) as delivered:
                assert max(delivered.size) <= edge, (recipe['id'], key, 'oversized image')
                assert abs(delivered.width / delivered.height - source_photo.width / source_photo.height) < 0.005, (recipe['id'], key, 'photo was cropped or stretched')
                reference = source_photo.resize(delivered.size, Image.Resampling.LANCZOS)
                rms = ImageStat.Stat(ImageChops.difference(reference, delivered.convert('RGB'))).rms
                rmse = (sum(value * value for value in rms) / 3) ** 0.5
                assert rmse < 12, (recipe['id'], key, 'photo differs from source', rmse)
                max_image_rmse = max(max_image_rmse, rmse)
                checked_images += 1
        checked += 1
assert checked == 60
assert checked_images == 120
print(f'PASS: {checked} recipes match source ingredients, full instructions, kcal, servings, times and notes; {checked_images} images match their recipe pages (max RMSE {max_image_rmse:.2f}/255); PDF hashes verified.')
