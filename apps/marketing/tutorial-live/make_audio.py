"""Generate neural narration, provider-aligned subtitles and an original quiet music bed.
Run: NO_PROXY='*' no_proxy='*' uv run --with edge-tts --with numpy make_audio.py
"""
import asyncio
import json
import math
import subprocess
import wave
from pathlib import Path
import edge_tts
import numpy as np

P=Path(__file__).resolve().parent
E=json.loads((P/'edit.json').read_text())
VOICE='zh-CN-XiaoxiaoNeural'
SR=48000

def command(args):
    subprocess.run(args,check=True)

def seconds(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)]))

def write_wav(path, samples):
    a=np.asarray(samples)
    with wave.open(str(path),'wb') as out:
        out.setnchannels(1 if a.ndim==1 else a.shape[1]);out.setsampwidth(2);out.setframerate(SR)
        out.writeframes((np.clip(a,-1,1)*32767).astype('<i2').tobytes())

async def narrate():
    subtitles=[]
    for i,c in enumerate(E['cues']):
        stem=P/'assets/narration'/f'voice-{i:02}'
        mp3=stem.with_suffix('.mp3');meta=stem.with_suffix('.jsonl');receipt=stem.with_suffix('.json')
        request={'text':c['text'],'voice':VOICE,'rate':'-3%'}
        if not (receipt.exists() and json.loads(receipt.read_text())==request and mp3.exists()):
            await edge_tts.Communicate(c['text'],VOICE,rate=request['rate'],boundary='SentenceBoundary').save(str(mp3),str(meta))
            receipt.write_text(json.dumps(request,ensure_ascii=False,indent=2)+'\n')
        duration=seconds(mp3)
        next_start=E['cues'][i+1]['start'] if i+1<len(E['cues']) else E['duration']
        available=next_start-c['start']-.18
        rate=max(1,duration/available)
        assert rate<1.14, (i,'Shorten narration instead of rushing it',duration,available)
        wav=stem.with_suffix('.wav')
        command(['ffmpeg','-v','error','-y','-i',str(mp3),'-af',f'atempo={rate},loudnorm=I=-16:TP=-1.5:LRA=7','-ar',str(SR),'-ac','1',str(wav)])
        c['duration']=seconds(wav);c['audio']=str(wav.relative_to(P));c['voice']=VOICE
        rows=[json.loads(x) for x in meta.read_text().splitlines()]
        for r in rows:
            if r['type']!='SentenceBoundary':continue
            start=c['start']+r['offset']/1e7/rate
            end=min(c['start']+(r['offset']+r['duration'])/1e7/rate,c['start']+c['duration'])
            subtitles.append({'start':round(start,4),'end':round(end,4),'text':r['text']})
        print(f'voice {i}: {c["duration"]:.2f}s, timing factor {rate:.3f}',flush=True)
    for i,s in enumerate(subtitles):
        if i+1<len(subtitles):s['end']=min(s['end'],subtitles[i+1]['start'])
        assert 0<=s['start']<s['end']<=E['duration']
    (P/'subtitles.json').write_text(json.dumps(subtitles,ensure_ascii=False,indent=2)+'\n')
    (P/'edit.json').write_text(json.dumps(E,ensure_ascii=False,indent=2)+'\n')

asyncio.run(narrate())
# Original instrumental: sparse soft keys over warm sustained chords, no drums.
# No sampled recording, melody quotation or downloaded music.
n=SR*E['duration'];music=np.zeros((n,2));chords=[[50,57,61,64,69],[47,54,57,62,66],[43,50,54,57,62],[45,52,57,59,64]]
def note(midi,start,length,level,pan,pad=False):
    offset=round(start*SR);count=min(round(length*SR),n-offset)
    t=np.arange(count)/SR;freq=440*2**((midi-69)/12)
    if pad:
        sound=(np.sin(2*np.pi*freq*t)+.18*np.sin(2*np.pi*(freq*1.0015)*t))/1.18
        env=(1-np.exp(-t/1.4))*np.exp(-t/5)*np.minimum(1,(length-t)/1.5)
    else:
        sound=np.sin(2*np.pi*freq*t)*np.exp(-t/2.3)+.22*np.sin(2*np.pi*2*freq*t)*np.exp(-t/.65)+.06*np.sin(2*np.pi*3*freq*t)*np.exp(-t/.25)
        env=(1-np.exp(-t/.014))*np.minimum(1,(length-t)/.5)
    sound*=env*level
    music[offset:offset+count,0]+=sound*math.sqrt((1-pan)/2)
    music[offset:offset+count,1]+=sound*math.sqrt((1+pan)/2)
for bar in range(12):
    start=bar*20/3;chord=chords[bar%4]
    for j,midi in enumerate(chord[:4]):note(midi,start,8,.012,(j-1.5)/3,True)
    for j,index in enumerate([1,3,4,2]):note(chord[index]+12,start+.7+j*1.4,5,.042,(j-1.5)/4)
# Gentle fade in/out; the final track is normalized before ducking.
fade=np.minimum(1,np.arange(n)/SR/3)*np.minimum(1,(n-1-np.arange(n))/SR/5)
music*=fade[:,None];write_wav(P/'assets/narration/music-original.wav',music)
# Assemble narration without altering the original video timing.
voice=np.zeros(n)
for c in E['cues']:
    with wave.open(str(P/c['audio']),'rb') as f:
        assert f.getframerate()==SR and f.getnchannels()==1 and f.getsampwidth()==2
        a=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(float)/32768
    k=round(c['start']*SR);assert k+len(a)<=n;voice[k:k+len(a)]+=a
write_wav(P/'assets/narration/narration-full.wav',voice)
command(['ffmpeg','-v','error','-y','-i',str(P/'assets/narration/music-original.wav'),'-af','loudnorm=I=-35:TP=-9:LRA=5','-ar',str(SR),str(P/'assets/narration/music-quiet.wav')])
command(['ffmpeg','-v','error','-y','-i',str(P/'assets/narration/music-quiet.wav'),'-i',str(P/'assets/narration/narration-full.wav'),'-filter_complex','[0:a][1:a]sidechaincompress=threshold=0.025:ratio=3:attack=20:release=500:level_sc=1,apad=whole_dur=80,atrim=duration=80[bed]','-map','[bed]','-ar',str(SR),str(P/'assets/narration/music-ducked.wav')])
print('Prepared neural narration, aligned subtitles, original quiet music with speech ducking.')
