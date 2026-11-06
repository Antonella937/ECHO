#!/usr/bin/env python3
"""Zero-cost, non-private speech synthesis smoke test for ECHO.

Only fixed, generic test text is permitted: generated WAVs are committed to a
PUBLIC repository. Never put character conversations or personal text here.
"""
from pathlib import Path
import argparse

VOICES = {
    "echo-f-01": ("af_heart", "a"), "echo-f-02": ("af_bella", "a"),
    "echo-f-03": ("af_nicole", "a"), "echo-f-04": ("bf_emma", "b"),
    "echo-f-05": ("bf_alice", "b"), "echo-m-01": ("am_adam", "a"),
    "echo-m-02": ("am_eric", "a"), "echo-m-03": ("am_liam", "a"),
    "echo-m-04": ("bm_daniel", "b"), "echo-m-05": ("bm_george", "b"),
}
TEXT = "Hey! This is a brand new voice message, generated just for this test. I'll remember what I said."
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts/echo/public/voice-tests"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice-id", choices=VOICES, required=True)
    args = parser.parse_args()
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline
    voice, language = VOICES[args.voice_id]
    pipeline = KPipeline(lang_code=language)
    chunks = [audio for _, _, audio in pipeline(TEXT, voice=voice, speed=1.0)]
    if not chunks:
        raise RuntimeError("Kokoro returned no audio")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / f"{args.voice_id}.wav"
    sf.write(target, np.concatenate(chunks), 24000, subtype="PCM_16")
    print(f"Created public, non-private test WAV: {target}")

if __name__ == "__main__":
    main()
