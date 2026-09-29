# Sounds

Drop your audio files here. The app silently skips missing files.

| Filename            | Plays when…                      |
| ------------------- | -------------------------------- |
| `victory.mp3`       | Focus session ends (celebration) |
| `break-start.mp3`   | Break phase begins               |
| `break-finished.wav` | Break ends (both timer modes)   |
| `session-start.mp3` | A new focus round starts         |
| `click.wav`         | UI button press                  |

Filenames are mapped explicitly in `src/lib/sounds.ts` (`FILES`), so formats
can be mixed — swap any of these for your own and update that map.

`click.wav` is a synthesized 35 ms tick, not a recording; replace it freely.

Free sources: freesound.org, pixabay.com/music, opengameart.org

`break-finished.wav` is an original synthesized two-note chime (0.85 seconds),
with no external recording or licence dependency. Regenerate it with Python's
standard library: `python3 client/scripts/generate-break-finished-sound.py`
from the repository root. It respects the app's sound toggle.
