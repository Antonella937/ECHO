/** Parse MPEG Layer III frames to validate duration without trusting text length.
 * Reject unsupported streams, malformed headers and truncated frames.
 */
export function mp3DurationSeconds(data: Buffer): number | null {
 let offset=0;
 if(data.length>=10 && data.toString("ascii",0,3)==="ID3"){
  const bytes=[data[6],data[7],data[8],data[9]];
  if(bytes.some(v=>v>127))return null;
  offset=10+((bytes[0]<<21)|(bytes[1]<<14)|(bytes[2]<<7)|bytes[3]);
  if(data[5]&0x10)offset+=10;
 }
 let frames=0,seconds=0;
 while(offset+4<=data.length){
  if(offset+128===data.length && data.toString("ascii",offset,offset+3)==="TAG")break;
  const header=data.readUInt32BE(offset);
  if(((header&0xffe00000)>>>0)!==0xffe00000)return null;
  const version=(header>>>19)&3,layer=(header>>>17)&3;
  const bitrateIndex=(header>>>12)&15,frequencyIndex=(header>>>10)&3;
  const padding=(header>>>9)&1;
  if(version===1 || layer!==1 || bitrateIndex===0 || bitrateIndex===15 || frequencyIndex===3)return null;
  const rateBase=[44100,48000,32000][frequencyIndex];
  const sampleRate=version===3?rateBase:version===2?rateBase/2:rateBase/4;
  const rates=version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:
    [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const bitrate=rates[bitrateIndex]*1000;
  const samples=version===3?1152:576;
  const frameSize=Math.floor((version===3?144:72)*bitrate/sampleRate)+padding;
  if(frameSize<4 || offset+frameSize>data.length)return null;
  seconds+=samples/sampleRate;
  frames++;offset+=frameSize;
  if(seconds>31)return seconds;
 }
 return frames>0 && offset===data.length?seconds:null;
}
