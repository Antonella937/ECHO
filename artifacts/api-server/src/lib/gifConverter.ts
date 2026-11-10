/** Local video-to-GIF conversion primitive. NOT connected to public routes or billing.
 * Requires ffmpeg installed in the runtime. Never executes a shell or fetches URLs.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VIDEO_PRIVATE_STORAGE_LIMITS } from "./videoPrivateStorage";

export type GifConversionOptions = {
  startSeconds:number;
  durationSeconds:number;
  width:320|480|640;
  fps:10|12|15;
};

export function validateGifConversionOptions(options:GifConversionOptions, sourceDuration:number) {
  const {startSeconds,durationSeconds,width,fps}=options;
  return Number.isFinite(startSeconds)&&startSeconds>=0
    && Number.isFinite(durationSeconds)&&durationSeconds>=1&&durationSeconds<=10
    && [320,480,640].includes(width)&&[10,12,15].includes(fps)
    && Number.isFinite(sourceDuration)&&sourceDuration>0
    && startSeconds+durationSeconds<=sourceDuration;
}

export async function convertLocalVideoBytesToGif(
  video:Buffer, mime:"video/mp4"|"video/webm",
  options:GifConversionOptions, sourceDuration:number,
):Promise<Buffer>{
  if(!validateGifConversionOptions(options,sourceDuration))throw new Error("GIF_OPTIONS_INVALID");
  if(!Buffer.isBuffer(video)||video.length===0||video.length>VIDEO_PRIVATE_STORAGE_LIMITS.maxVideoBytes)
    throw new Error("GIF_SOURCE_SIZE_INVALID");
  if(mime!=="video/mp4"&&mime!=="video/webm")throw new Error("GIF_SOURCE_MIME_INVALID");
  const directory=await mkdtemp(join(tmpdir(),"echo-gif-"));
  const input=join(directory,mime==="video/mp4"?"source.mp4":"source.webm");
  const output=join(directory,"result.gif");
  try{
    await writeFile(input,video,{flag:"wx",mode:0o600});
    const filter=`fps=${options.fps},scale=${options.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`;
    const args=["-hide_banner","-nostdin","-loglevel","error","-y",
      "-ss",String(options.startSeconds),"-t",String(options.durationSeconds),
      "-i",input,"-an","-vf",filter,"-loop","0",output];
    await new Promise<void>((resolve,reject)=>{
      const child=spawn("ffmpeg",args,{stdio:["ignore","ignore","ignore"],shell:false});
      const timeout=setTimeout(()=>child.kill("SIGKILL"),45_000);
      child.on("error",error=>{clearTimeout(timeout);reject(error);});
      child.on("close",code=>{clearTimeout(timeout);code===0?resolve():reject(new Error("GIF_CONVERSION_FAILED"));});
    });
    const result=await readFile(output);
    if(result.length===0||result.length>VIDEO_PRIVATE_STORAGE_LIMITS.maxGifBytes)
      throw new Error("GIF_OUTPUT_SIZE_INVALID");
    if(result.subarray(0,6).toString("ascii")!=="GIF89a"&&result.subarray(0,6).toString("ascii")!=="GIF87a")
      throw new Error("GIF_OUTPUT_FORMAT_INVALID");
    return result;
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
}
