"""Generate the original break-finished chime using only the standard library."""
from math import exp, pi, sin
from pathlib import Path
import struct
import wave

SAMPLE_RATE = 22050
DURATION = 0.85
NOTES = ((0.0, 659.25), (0.22, 783.99))
output = Path(__file__).resolve().parents[1] / "public/sounds/break-finished.wav"
frames = bytearray()
for index in range(round(SAMPLE_RATE * DURATION)):
    time = index / SAMPLE_RATE
    sample = 0.0
    for start, frequency in NOTES:
        age = time - start
        if age < 0:
            continue
        envelope = min(1.0, age / 0.008) * exp(-9 * age)
        tone = sin(2 * pi * frequency * age) + 0.15 * sin(4 * pi * frequency * age)
        sample += 0.35 * envelope * tone
    # Fade the final tail to zero to avoid a click at the end of the file.
    sample *= min(1.0, (DURATION - time) / 0.025)
    frames.extend(struct.pack("<h", round(max(-1, min(1, sample)) * 32767)))

with wave.open(str(output), "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(SAMPLE_RATE)
    audio.writeframes(frames)
print(f"Generated {output.name}: {DURATION}s mono PCM at {SAMPLE_RATE} Hz")
