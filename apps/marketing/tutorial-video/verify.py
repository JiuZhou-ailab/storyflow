"""Check the delivered artifact, its media tracks and narration timing."""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-show_chapters',
    '-of', 'json', str(root / 'renders/storyflow-first-practice.mp4'),
]))
video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
assert (video['width'], video['height'], video['r_frame_rate']) == (2560, 1440, '30/1')
assert abs(float(probe['format']['duration']) - 180) < 0.1
assert any(s['codec_type'] == 'audio' for s in probe['streams'])
assert any(s['codec_type'] == 'subtitle' for s in probe['streams'])
assert len(probe['chapters']) == 6
previous_end = 0
for cue in json.loads((root / 'script.json').read_text()):
    assert previous_end <= cue['start'] < cue['start'] + cue['duration'] <= 180
    assert (root / cue['audio']).is_file()
    previous_end = cue['start'] + cue['duration']
print('PASS: 180s, 2560x1440, 30fps, audio, subtitles, 6 chapters, narration timing')
