"""Build lazy-loaded full-text readers from the 20 AURA handbook PDFs.

The PDFs remain canonical. This script removes only repeated running headers,
page numbers and the English brand strapline, then keeps the remaining text in
page order. Generated JSON is deterministic and safe to serve from the CDN.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from pypdf import PdfReader


CHAPTER_TITLES = {
    1: "Khởi đầu đúng",
    2: "Cơ thể sử dụng năng lượng",
    3: "Protein, carbohydrate và chất béo",
    4: "Vitamin, khoáng chất và nước",
    5: "Tiêu hóa và hấp thu",
    6: "Hormone, insulin và kiểm soát đường huyết",
    7: "Vì sao mỗi người giảm cân khác nhau",
    8: "Tôi cần ăn bao nhiêu?",
    9: "Xây thực đơn thực tế",
    10: "Theo dõi tiến độ và điều chỉnh",
    11: "Ăn trước, trong và sau tập",
    12: "Dinh dưỡng để phục hồi",
    13: "Dinh dưỡng giảm mỡ",
    14: "Dinh dưỡng tăng cơ, tăng cân",
    15: "Tái cấu trúc cơ thể",
    16: "Dinh dưỡng theo từng giai đoạn cuộc sống phụ nữ",
    17: "Dinh dưỡng khi có bệnh lý và tình trạng sức khỏe đặc biệt",
    18: "Đọc bằng chứng và tự bảo vệ trước thông tin dinh dưỡng",
    19: "Biến quyết định đúng thành thói quen bền vững",
    20: "Tự trở thành chuyên gia dinh dưỡng của chính mình",
}

EXPECTED_PAGE_COUNTS = [52, 48, 56, 63, 74, 82, 90, 96, 97, 90, 106, 100, 121, 126, 100, 116, 105, 105, 98, 98]
RUNNING_LINES = {
    "AURA FITNESS ACADEMY",
    "AURA FITNESS ACADEMY · STUDENT HANDBOOK",
    "Where Women Train with Confidence, Not Comparison.",
}


def chapter_number(path: Path) -> int:
    match = re.search(r"Chuong_(\d+)_", path.name, re.IGNORECASE)
    if not match:
        raise ValueError(f"Không đọc được số chương từ {path.name}")
    return int(match.group(1))


def is_heading(value: str) -> bool:
    if len(value) > 120 or value.endswith((".", ",", ";", ":")):
        return False
    letters = [char for char in value if char.isalpha()]
    if len(letters) < 3:
        return False
    return sum(char.isupper() for char in letters) / len(letters) >= 0.72


def clean_lines(text: str, chapter: int, page_number: int) -> list[str]:
    values: list[str] = []
    for raw in text.replace("\r", "\n").split("\n"):
        line = re.sub(r"[ \t]+", " ", raw).strip()
        if not line:
            values.append("")
            continue
        if page_number > 1 and line in RUNNING_LINES:
            continue
        if page_number > 1 and line == str(page_number):
            continue
        if page_number > 1 and re.fullmatch(rf"CHƯƠNG\s+{chapter}(?:\s*[·:.-].*)?", line, re.IGNORECASE):
            continue
        values.append(line)
    return values


def page_blocks(text: str, chapter: int, page_number: int) -> list[dict[str, str]]:
    lines = clean_lines(text, chapter, page_number)
    blocks: list[dict[str, str]] = []
    paragraph: list[str] = []

    def flush() -> None:
        if not paragraph:
            return
        joined = " ".join(paragraph)
        joined = re.sub(r"\s+", " ", joined).strip()
        if joined:
            blocks.append({"kind": "paragraph", "text": joined})
        paragraph.clear()

    index = 0
    while index < len(lines):
        line = lines[index]
        if not line:
            flush()
            index += 1
            continue
        if line in {"●", "•"}:
            flush()
            index += 1
            bullet_parts: list[str] = []
            while index < len(lines) and lines[index] and lines[index] not in {"●", "•"} and not is_heading(lines[index]):
                bullet_parts.append(lines[index])
                index += 1
            if bullet_parts:
                blocks.append({"kind": "bullet", "text": " ".join(bullet_parts)})
            continue
        if line.startswith(("● ", "• ")):
            flush()
            blocks.append({"kind": "bullet", "text": line[2:].strip()})
            index += 1
            continue
        if is_heading(line):
            flush()
            blocks.append({"kind": "heading", "text": line})
            index += 1
            continue
        paragraph.append(line)
        index += 1
    flush()
    return blocks


def build_chapter(path: Path) -> dict:
    chapter = chapter_number(path)
    reader = PdfReader(str(path))
    expected_pages = EXPECTED_PAGE_COUNTS[chapter - 1]
    if len(reader.pages) != expected_pages:
        raise ValueError(f"Chương {chapter}: cần {expected_pages} trang, nhận {len(reader.pages)}")

    pages = []
    source_characters = 0
    reader_characters = 0
    for page_index, page in enumerate(reader.pages):
        raw = page.extract_text() or ""
        source_characters += len(raw)
        blocks = page_blocks(raw, chapter, page_index + 1)
        reader_characters += sum(len(block["text"]) for block in blocks)
        pages.append({"number": page_index + 1, "blocks": blocks})

    if reader_characters < source_characters * 0.72:
        raise ValueError(f"Chương {chapter}: dữ liệu đọc bị hụt ({reader_characters}/{source_characters} ký tự)")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "schemaVersion": 1,
        "chapter": chapter,
        "title": CHAPTER_TITLES[chapter],
        "pageCount": len(pages),
        "wordCount": sum(len(block["text"].split()) for page in pages for block in page["blocks"]),
        "sourceCharacters": source_characters,
        "readerCharacters": reader_characters,
        "sourceSha256": digest,
        "sourceFile": path.name,
        "pages": pages,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", required=True)
    parser.add_argument("--output-dir", default="public/academy/full-reader")
    args = parser.parse_args()
    pdf_dir = Path(args.pdf_dir)
    output_dir = Path(args.output_dir)
    files = sorted(pdf_dir.glob("*.pdf"), key=chapter_number)
    if [chapter_number(path) for path in files] != list(range(1, 21)):
        raise ValueError("Thư mục nguồn phải có đúng một PDF cho mỗi chương từ 1 đến 20")

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for path in files:
        result = build_chapter(path)
        target = output_dir / f"chapter-{result['chapter']:02d}.json"
        target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        manifest.append({key: result[key] for key in ["chapter", "title", "pageCount", "wordCount", "sourceSha256", "sourceFile"]})
        print(f"Chương {result['chapter']:02d}: {result['pageCount']} trang · {result['wordCount']:,} từ · {target.stat().st_size:,} bytes")

    (output_dir / "manifest.json").write_text(
        json.dumps({"schemaVersion": 1, "chapters": manifest}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Hoàn tất {len(manifest)} chương tại {output_dir.resolve()}")


if __name__ == "__main__":
    main()
