# ECHO basic voice previews

These files are **not yet generated**. The character editor must not show
playback controls until the corresponding real audio files are committed.

To produce the ten fixed samples locally without paying a hosted TTS API:

```sh
python3 scripts/generate-basic-voice-previews.py --dry-run
python3 -m pip install kokoro soundfile
python3 scripts/generate-basic-voice-previews.py
```

This outputs `echo-f-01.wav` through `echo-f-05.wav` and
`echo-m-01.wav` through `echo-m-05.wav` in this folder.

The script uses the same short English phrase for each voice, with separate
American/British Kokoro pipelines. Review output quality and the applicable
model and voice licenses before distributing the WAV files. Publishing files
under Vite's public directory makes them accessible without inference or
per-listen API costs; bandwidth and hosting limits still apply.

Do not substitute text-to-speech audio from a different voice and do not
silently label an unavailable sample as playable. This batch tool does not
enable voice generation in chats, Spanish speech or character singing.
