"""Extract stable start/end stills from an animated exercise GIF."""

from pathlib import Path
import sys

from PIL import Image


def save_frame(source: Image.Image, index: int, destination: Path) -> None:
    source.seek(index)
    frame = source.convert("RGBA")
    destination.parent.mkdir(parents=True, exist_ok=True)
    frame.save(destination, "WEBP", quality=90, method=6)


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: extract-exercise-gif-frames.py input.gif start.webp end.webp")

    source_path = Path(sys.argv[1])
    start_path = Path(sys.argv[2])
    end_path = Path(sys.argv[3])
    with Image.open(source_path) as image:
        frame_count = max(1, int(getattr(image, "n_frames", 1)))
        # ExerciseDB animations normally loop back to the opening pose. The
        # middle frame represents the opposite/end position more reliably than
        # the last frame, which is often visually identical to frame zero.
        save_frame(image, 0, start_path)
        save_frame(image, frame_count // 2, end_path)


if __name__ == "__main__":
    main()
