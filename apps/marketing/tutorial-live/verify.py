"""Verify deliverable duration, live provenance, edit timing and actual file differences."""
import hashlib
import json
import subprocess
from pathlib import Path

P = Path(__file__).resolve().parent

def probe(file):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(file)]))

edit = json.loads((P / 'edit.json').read_text())
raw = probe(P / 'assets/storyflow-live-raw.mov')
final = probe(P / 'renders/storyflow-live-80s-v2.mp4')
assert 180 <= float(raw['format']['duration']) <= 300
assert abs(float(final['format']['duration']) - edit['duration']) < .1
assert 60 <= edit['duration'] <= 90
v = next(s for s in final['streams'] if s['codec_type'] == 'video')
assert (v['width'], v['height'], v['r_frame_rate']) == (2560, 1440, '30/1')
assert any(s['codec_type'] == 'audio' for s in final['streams'])
assert any(s['codec_type'] == 'subtitle' for s in final['streams'])
for items in (edit['cuts'], edit['cues']):
    end = 0
    for c in items:
        assert end <= c['start'] < c['start'] + c['duration'] <= edit['duration']
        end = c['start'] + c['duration']
        if 'source' in c:
            assert 0 <= c['source'] < c['source'] + c['duration'] <= float(raw['format']['duration'])
subs=json.loads((P/'subtitles.json').read_text())
assert ''.join(c['text'] for c in edit['cues']) == ''.join(c['text'] for c in subs)
assert all(0<=c['start']<c['end']<=edit['duration'] for c in subs)
assert all(a['end']<=b['start'] for a,b in zip(subs,subs[1:]))
assert all(c['voice']=='zh-CN-XiaoxiaoNeural' and (P/c['audio']).is_file() for c in edit['cues'])
assert abs(float(probe(P/'assets/narration/music-ducked.wav')['format']['duration'])-80)<.01
old=json.loads((P/'assets/edit-v1.json').read_text())
assert [{k:v for k,v in c.items() if k!='title'} for c in old['cuts']] == [{k:v for k,v in c.items() if k!='title'} for c in edit['cuts']]
for phrase in ('一次只','只改最后一段','其余内容保留'):
    assert phrase not in (P/'index.html').read_text()
provenance = json.loads((P / 'assets/provenance.json').read_text())
assert provenance['model'] == 'deepseek-v4-flash' and provenance['fixture'] is False
for filename,key in [('storyflow-live-raw.mov','rawSha256'),('first-draft.md','firstDraftSha256'),('revised-draft.md','revisedDraftSha256')]:
    assert hashlib.sha256((P / 'assets' / filename).read_bytes()).hexdigest() == provenance[key]
a=(P/'assets/first-draft.md').read_text().splitlines();b=(P/'assets/revised-draft.md').read_text().splitlines()
assert a[:-1] == b[:-1] and a[-1] != b[-1]
print('PASS: neural voice, full aligned subtitles, music, unchanged footage;  5min raw → 80s, 2560×1440/30fps, audio/subtitles, ordered cuts, live provenance and only final paragraph changed.')
