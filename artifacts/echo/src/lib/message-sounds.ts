/** Original short chimes played as HTMLAudio media, matching ECHO's working music player on iOS. */
const KEY = 'echo:message-sounds';
export type SoundPreferences = { incoming: boolean; outgoing: boolean; notification: boolean; group: boolean };
const defaults: SoundPreferences = { incoming: true, outgoing: true, notification: true, group: true };
export function getSoundPreferences(): SoundPreferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return defaults; }
}
export function saveSoundPreferences(next: SoundPreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  window.dispatchEvent(new Event('echo:sound-preferences'));
}
type Kind = keyof SoundPreferences | 'creatorHub';
const tones: Record<Kind, number[]> = {
  incoming: [880, 1318.5], outgoing: [1046.5],
  group: [523.25, 783.99, 1046.5], notification: [1174.66, 1567.98],
  creatorHub: [659.25, 987.77, 1318.51],
};
const wavCache = new Map<Kind, string>();
function makeWav(kind: Kind): string {
  const existing = wavCache.get(kind);
  if (existing) return existing;
  const sampleRate = 22050;
  const step = 0.15;
  const length = Math.ceil(sampleRate * (tones[kind].length * step + 0.12));
  const bytes = new Uint8Array(44 + length * 2);
  const view = new DataView(bytes.buffer);
  const str = (offset: number, value: string) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  str(0,'RIFF'); view.setUint32(4,36+length*2,true); str(8,'WAVE');
  str(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
  view.setUint16(22,1,true); view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true);
  view.setUint16(34,16,true); str(36,'data'); view.setUint32(40,length*2,true);
  for(let i=0;i<length;i++){
    const time=i/sampleRate;
    let amplitude=0;
    tones[kind].forEach((freq,index)=>{
      const t=time-index*step;
      if(t<0||t>0.24)return;
      const envelope=Math.min(1,t/0.012)*Math.min(1,(0.24-t)/0.06);
      amplitude+=Math.sin(2*Math.PI*freq*t)*envelope*0.16;
    });
    view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,amplitude))*32767),true);
  }
  // A local Blob URL avoids a large base64 allocation on every notification.
  const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  wavCache.set(kind,url);
  return url;
}
const players = new Map<Kind, HTMLAudioElement>();
function player(kind: Kind) {
  let audio=players.get(kind);
  if(!audio){
    audio=new Audio(makeWav(kind));
    audio.preload='auto';
    audio.volume=0.85;
    players.set(kind,audio);
  }
  return audio;
}
export function unlockMessageAudio(): Promise<void> {
  // iOS unlock is performed by play() in the user's direct click/touch handler.
  return Promise.resolve();
}
export function playMessageSound(kind: Kind) {
  if (!getSoundPreferences()[kind==='creatorHub'?'notification':kind]) return;
  try {
    const audio=player(kind);
    audio.pause();
    audio.currentTime=0;
    void audio.play().catch(() => {
      // Browser media policy may reject autoplay until the user interacts.
    });
  } catch { /* Audio must never interrupt messaging. */ }
}
