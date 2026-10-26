"""Import the six supplied Aura cookbooks without rewriting their recipes.

Usage: python scripts/import-aura-cookbook.py <directory-containing-six-pdfs>
Requires pypdf and Pillow. Generated assets are committed; no Python at runtime.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
CHAPTERS = [
    (1, 'B', 10, 'Bữa sáng', 'Bữa sáng từ bếp nhà'),
    (2, 'M', 14, 'Món chính', 'Món chính quen vị Việt'),
    (3, 'V', 8, 'Đậu & rau', 'Bữa ngon với đậu và rau'),
    (4, 'R', 10, 'Canh & rau', 'Thêm rau, thêm vị'),
    (5, 'S', 8, 'Bữa phụ & chút ngọt', 'Bữa phụ và chút ngọt'),
    (6, 'C', 10, 'Sốt & gia vị', 'Sốt ngon, món quen đổi vị'),
]


def compact(text):
    return re.sub(r'\s+', ' ', text).strip()


def between(text, start, end):
    return text.split(start, 1)[1].split(end, 1)[0].strip()


def notes(text):
    markers = ['Bếp mình mách bạn:', 'Đổi nguyên liệu:', 'Chia phần:',
               'Thành phần cần lưu ý:', 'Ghép món:', 'Mẹo bếp:']
    pattern = '(' + '|'.join(re.escape(m) for m in markers) + ')'
    chunks = re.split(pattern, text)
    result = {}
    for i in range(1, len(chunks), 2):
        value = re.split(r'\n(?:HƯỚNG DẪN|Một phần =|CÁCH TÍNH|AURA\s*/)', chunks[i + 1])[0]
        result[chunks[i][:-1]] = compact(value)
    return result


def normal_ingredients(text):
    block = between(text, 'KCAL ƯỚC TÍNH\n', '\nKcal cho')
    result, name = [], []
    for line in block.splitlines():
        line = line.strip()
        if re.match(r'^(?:\d|đủ dùng)', line):
            if not name:
                raise ValueError(f'Ingredient without a name: {line}')
            result.append({'name': compact(' '.join(name)), 'amount': line})
            name = []
        else:
            name.append(line)
    # V07 wraps the last quantity's "nước trụng bún" into a second line.
    if name == ['bún'] and result[-1]['amount'].endswith('nước trụng'):
        result[-1]['amount'] += ' bún'
        name = []
    if name:
        raise ValueError(f'Ingredient without amount: {name}')
    return result


def parse_steps(text, sauce=False):
    block = text.split('CÁCH LÀM', 1)[1]
    block = re.split(r'Bếp mình mách bạn:|Ghép món:', block)[0]
    if sauce:
        matches = re.findall(r'(?:^|\n)(\d{2})\s+(.+?)(?=\n\d{2}\s|\Z)', block, re.S)
        return [{'title': compact(body.split('.', 1)[0]), 'text': compact(body.split('.', 1)[1])}
                for _, body in matches]
    matches = re.findall(r'\n(\d{2})\n([^\n]+)\n(.+?)(?=\n\d{2}\n|\Z)', block, re.S)
    return [{'title': compact(title), 'text': compact(body)} for _, title, body in matches]


def main(source, data_only=False):
    public = ROOT / 'public' / 'cooking'
    data_dir = ROOT / 'src' / 'features' / 'cooking' / 'data'
    for folder in [public / 'images', public / 'sources', data_dir]:
        folder.mkdir(parents=True, exist_ok=True)
    chapters, recipes = [], []
    for number, prefix, count, label, title in CHAPTERS:
        candidates = list(source.glob(f'*_Chuong_{number:02}_*.pdf'))
        if len(candidates) != 1:
            raise ValueError(f'Expected one PDF for chapter {number}: {candidates}')
        file = candidates[0]
        reader = PdfReader(file)
        texts = [p.extract_text() for p in reader.pages]
        toc = dict(re.findall(rf'({prefix}\d{{2}})\s+(.+?)\n\d+\n', texts[1], re.S))
        if len(toc) != count:
            raise ValueError(f'Incomplete table of contents: {file.name}')
        pdf_path = f'cooking/sources/chapter-{number:02}.pdf'
        if not data_only:
            shutil.copyfile(file, ROOT / 'public' / pdf_path)
        chapters.append({
            'id': str(number), 'label': label, 'title': title, 'count': count,
            'pdf': pdf_path, 'methodPage': len(texts) - 2, 'safetyPage': len(texts) - 1,
            'sourceSha256': hashlib.sha256(file.read_bytes()).hexdigest(),
        })
        for index in range(count):
            code = f'{prefix}{index + 1:02}'
            page_index = 2 + index * (1 if number == 6 else 2)
            page = reader.pages[page_index]
            text = texts[page_index]
            method = text if number == 6 else texts[page_index + 1]
            layout_blocks = re.split(r'\n\s*\n', page.extract_text(extraction_mode='layout').strip())
            description = compact(layout_blocks[1])
            kcal = int(re.search(r'≈\s*(\d+) KCAL/PHẦN', text)[1])
            metadata = notes(method)
            if number == 6:
                ingredient_block = between(text, 'NGUYÊN LIỆU CHO 4 PHẦN\n', '\n≈')
                ingredient_lines = re.split(r'\n(?=[^\n]+ · )', ingredient_block)
                ingredients = [{'name': compact(line.split(' · ', 1)[0]),
                                'amount': compact(line.split(' · ', 1)[1])} for line in ingredient_lines]
                time_lines = re.findall(r'^(?:PHA|NẤU|CHUẨN BỊ|CB) [^\n]+', text, re.M)
                time_lines = [part.replace('CB ', 'CHUẨN BỊ ') for line in time_lines for part in line.split(' / ')]
                portion = re.search(r'Một phần =[^\n]+', text)[0]
                extra = text.split('CÁCH TÍNH', 1)[1].split('AURA', 1)[0].splitlines()[1:]
                time_note = compact(' '.join(extra)) if code in ['C09', 'C10'] else ''
                batch_kcal = int(re.search(r'≈ (\d+) KCAL/MẺ', text)[1])
            else:
                ingredients = normal_ingredients(text)
                time_lines = re.findall(r'^(?:CHUẨN BỊ|NẤU|NGÂM LẠNH|ĐÔNG LẠNH|KHÔNG CẦN NẤU)[^\n]*', text, re.M)
                footer = between(text, '\nKcal cho', '\nAURA')
                portion = 'Kcal cho ' + footer.split('Cách tính:', 1)[0].rstrip()
                time_note = compact(footer.split('\n', 1)[1]) if '\n' in footer else ''
                time_note = re.sub(r'^.*?Cách tính: trang \d+\.\s*', '', time_note)
                if time_note.startswith('Thời gian dự kiến;'):
                    time_note = ''
                batch_kcal = None
            steps = parse_steps(method, number == 6)
            if len(steps) != (3 if number == 6 else 4):
                raise ValueError(f'{code}: unexpected steps: {steps}')
            if not ingredients or not description or not time_lines or not metadata.get('Thành phần cần lưu ý'):
                raise ValueError(f'{code}: incomplete content')
            # The recipe-page photo is authoritative; chapter covers may depict another dish.
            if not data_only:
                photo = max(page.images, key=lambda image: image.image.width * image.image.height).image.convert('RGB')
                for size, suffix in [(1200, ''), (560, '-small')]:
                    output = photo.copy()
                    output.thumbnail((size, size))
                    output.save(public / 'images' / f'{code}{suffix}.webp', 'WEBP', quality=86)
            recipes.append({
                'id': code, 'chapterId': str(number), 'name': compact(toc[code]),
                'description': description, 'kcalPerServing': kcal, 'batchKcal': batch_kcal,
                'servings': 4 if number == 6 else 2,
                'timeLabels': [line[0] + line[1:].lower() for line in time_lines],
                'timeNote': time_note, 'portionNote': compact(portion),
                'ingredients': ingredients, 'steps': steps,
                'tip': metadata.get('Bếp mình mách bạn', metadata.get('Mẹo bếp', '')),
                'substitution': metadata.get('Đổi nguyên liệu', ''),
                'portionDetail': metadata.get('Chia phần', metadata.get('Ghép món', '')),
                'allergenNote': metadata['Thành phần cần lưu ý'],
                'requiresCooking': 'CẦN NẤU CÙNG MÓN' in text,
                'image': f'cooking/images/{code}.webp',
                'thumbnail': f'cooking/images/{code}-small.webp', 'sourcePage': page_index + 1,
            })
    if len(recipes) != 60:
        raise ValueError('Expected exactly 60 recipes')
    target = data_dir / 'cookbook.json'
    target.write_text(json.dumps({'version': 1, 'chapters': chapters, 'recipes': recipes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Imported {len(recipes)} recipes' + ('. Assets unchanged.' if data_only else ', 120 WebP assets and 6 unchanged PDFs.'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--data-only', action='store_true')
    args = parser.parse_args()
    main(args.source, args.data_only)
