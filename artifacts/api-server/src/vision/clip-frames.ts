import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const run = promisify(execFile);

export async function clipContactSheet(bytes: Buffer, mimeType: string): Promise<Buffer> {
  const extension = mimeType === "image/gif" ? "gif" : mimeType === "video/webm" ? "webm" : "mp4";
  const directory = await mkdtemp(join(tmpdir(), "echo-vision-"));
  try {
    const input = join(directory, `clip.${extension}`);
    await writeFile(input, bytes);
    const { stdout } = await run(ffmpeg.path, [
      "-nostdin", "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe",
      ...(extension === "gif" ? ["-ignore_loop", "1"] : []),
      "-i", input,
      "-filter_threads", "1",
      "-vf", "select='eq(n,0)+gte(t-prev_selected_t,0.4+selected_n*0.5)',scale=400:400:force_original_aspect_ratio=decrease,setsar=1,tile=2x2:padding=4:margin=4",
      "-an", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ], { encoding: "buffer", timeout: 12_000, maxBuffer: 2 * 1024 * 1024 });
    if (!stdout.length) throw new Error("No decodable frames");
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
