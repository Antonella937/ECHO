import { test } from "node:test";
import assert from "node:assert/strict";
import { mp3DurationSeconds } from "../src/lib/mp3Duration";

function mp3(seconds:number) {
 const frame=Buffer.alloc(417);
 frame.writeUInt32BE(0xfffb9000,0); // MPEG1 Layer III, 128 kbps, 44.1kHz
 return Buffer.concat(Array.from({length:Math.ceil(seconds*44100/1152)},()=>frame));
}
test("valid short MP3 is accepted",()=>{
 const duration=mp3DurationSeconds(mp3(2));
 assert.ok(duration!==null && duration>=2 && duration<2.1);
});
test("30-second limit is measured from audio frames",()=>{
 assert.ok((mp3DurationSeconds(mp3(31))??0)>30);
});
test("rejects non-MP3 and truncated frames",()=>{
 assert.equal(mp3DurationSeconds(Buffer.from("not an mp3")),null);
 assert.equal(mp3DurationSeconds(mp3(2).subarray(0,100)),null);
});
test("rejects invalid MPEG headers",()=>{
 const data=mp3(1);data[1]=0;
 assert.equal(mp3DurationSeconds(data),null);
});
