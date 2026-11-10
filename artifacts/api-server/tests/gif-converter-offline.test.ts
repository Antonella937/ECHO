import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGifConversionOptions, convertLocalVideoBytesToGif } from "../src/lib/gifConverter";

test("validates bounded GIF conversion settings without executing ffmpeg",()=>{
  assert.equal(validateGifConversionOptions({startSeconds:0,durationSeconds:3,width:480,fps:12},5),true);
  assert.equal(validateGifConversionOptions({startSeconds:4,durationSeconds:3,width:480,fps:12},5),false);
  assert.equal(validateGifConversionOptions({startSeconds:-1,durationSeconds:2,width:480,fps:12},5),false);
  assert.equal(validateGifConversionOptions({startSeconds:0,durationSeconds:11,width:480,fps:12},12),false);
  assert.equal(validateGifConversionOptions({startSeconds:0,durationSeconds:3,width:999 as 480,fps:12},5),false);
});
test("rejects invalid conversion before spawning ffmpeg",async()=>{
  await assert.rejects(
    convertLocalVideoBytesToGif(Buffer.from("not a video"),"video/mp4",
      {startSeconds:6,durationSeconds:4,width:480,fps:12},5),
    /GIF_OPTIONS_INVALID/,
  );
});
