#!/usr/bin/env python3
"""Generate ECHO's fixed free-voice preview assets offline, without API keys.

Requires: Python 3.10+, pip install kokoro soundfile
Kokoro may download model weights on first use; review model/voice licensing
before publishing the resulting files. This is a maintainer-only batch task.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "echo" / "public" / "voice-previews"
TEXT = "Hey there! This is how I sound on ECHO. Nice to meet you."
VOICES = (
    ("echo-f-01", "af_heart", "a"),
    ("echo-f-02", "af_bella", "a"),
    ("echo-f-03", "af_nicole", "a"),
    ("echo-f-04", "bf_emma", "b"),
    ("echo-f-05", "bf_alice", "b"),
    ("echo-m-01", "am_adam", "a"),
    ("echo-m-02", "am_eric", "a"),
    ("echo-m-03", "am_liam", "a"),
    ("echo-m-04", "bm_daniel", "b"),
    ("echo-m-05", "bm_george", "b"),
)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Show planned outputs without loading Kokoro")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        print(json.dumps([{"id": id, "voice": voice, "path": str(OUTPUT / (id + ".wav"))}
                          for id, voice, _ in VOICES], indent=2))
        return
    try:
        import numpy as np
        import soundfile as sf
        from kokoro import KPipeline
    except ImportError as exc:
        raise SystemExit("Install offline dependencies: pip install kokoro soundfile") from exc
    OUTPUT.mkdir(parents=True, exist_ok=True)
    pipelines = {}
    for id, voice, language in VOICES:
        path = OUTPUT / (id + ".wav")
        if path.exists() and not args.overwrite:
            print(f"Skipping existing {path.name}")
            continue
        if language not in pipelines:
            pipelines[language] = KPipeline(lang_code=language)
        chunks = [audio for _, _, audio in pipelines[language](TEXT, voice=voice, speed=1.0)]
        if not chunks:
            raise RuntimeError(f"No audio returned for {id} ({voice})")
        samples = np.concatenate(chunks)
        sf.write(str(path), samples, 24000, subtype="PCM_16")
        print(f"Created {path.name}: {len(samples) / 24000:.2f}s")
    print("Preview assets ready. Review every voice before committing WAV files.")

if __name__ == "__main__":
    main()
