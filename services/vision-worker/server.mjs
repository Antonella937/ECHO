import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { AutoProcessor, Florence2ForConditionalGeneration, RawImage, env } from '@huggingface/transformers';
import sharp from 'sharp';

const token = Buffer.from(process.env.ECHO_VISION_WORKER_TOKEN ?? '');
if (token.length < 32) throw new Error('ECHO_VISION_WORKER_TOKEN must contain at least 32 bytes');

if (process.env.ECHO_VISION_MODEL_DIR) {
  env.localModelPath = process.env.ECHO_VISION_MODEL_DIR;
  env.allowRemoteModels = false;
}

env.cacheDir = process.env.ECHO_VISION_CACHE_DIR ?? '/tmp/echo-vision-models';

const modelId = 'onnx-community/Florence-2-base-ft';
const task = '<MORE_DETAILED_CAPTION>';
const processor = await AutoProcessor.from_pretrained(modelId);
const model = await Florence2ForConditionalGeneration.from_pretrained(modelId, {
  device: 'cpu',
  dtype: 'q4',
  session_options: {
    intraOpNumThreads: 1,
    enableCpuMemArena: false,
    enableMemPattern: false,
    enableMemReuse: true,
  },
});

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxImageBytes = 15 * 1024 * 1024;
let busy = false;

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return reply(res, 200, { status: 'ready' });
  if (req.method !== 'POST' || req.url !== '/caption') return reply(res, 404, { error: 'NOT_FOUND' });

  const authorization = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.concat([Buffer.from('Bearer '), token]);
  if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected))
    return reply(res, 401, { error: 'UNAUTHORIZED' });

  const length = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(length) || length < 1 || length > maxImageBytes)
    return reply(res, 413, { error: 'INVALID_IMAGE_SIZE' });
  if (!imageTypes.has(req.headers['content-type']))
    return reply(res, 415, { error: 'INVALID_IMAGE_FORMAT' });
  if (busy) return reply(res, 503, { error: 'VISION_BUSY' });

  busy = true;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const normalized = await sharp(Buffer.concat(chunks), { limitInputPixels: 30_000_000 })
      .rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer();
    const image = await RawImage.fromBlob(new Blob([normalized], { type: 'image/jpeg' }));
    const inputs = await processor(image, processor.construct_prompts(task));
    const output = await model.generate({ ...inputs, max_new_tokens: 120 });
    const [decoded] = processor.batch_decode(output, { skip_special_tokens: false });
    const caption = processor.post_process_generation(decoded, task, image.size)[task];
    if (typeof caption !== 'string' || caption.trim().length < 8)
      return reply(res, 502, { error: 'INVALID_CAPTION' });
    return reply(res, 200, { caption });
  } catch {
    return reply(res, 502, { error: 'CAPTION_FAILED' });
  } finally {
    busy = false;
  }
}).listen(Number(process.env.PORT ?? 8080));
