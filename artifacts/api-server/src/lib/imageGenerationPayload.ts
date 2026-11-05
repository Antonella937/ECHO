import type { ImageGenerationStyle } from './imageGenerationProvider';

export interface ImageGenerationReference {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Buffer;
}
export interface PreparedImageMessage {
  role: 'user';
  content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

const supportedStyles: ReadonlySet<string> = new Set(['natural', 'phone', 'analog', 'editorial', 'cinematic']);

/**
 * Pure, network-free payload preparation for a multimodal provider.
 * Private storage paths and service-role credentials are never sent.
 * Model-specific capabilities and response parsing must be verified before activation.
 */
export function prepareImageMessage(prompt: string, style: ImageGenerationStyle, references: ImageGenerationReference[]): PreparedImageMessage {
  if (!prompt.trim() || prompt.length > 14000) throw Error('INVALID_IMAGE_PROMPT');
  if (!supportedStyles.has(style)) throw Error('INVALID_IMAGE_STYLE');
  if (references.length > 4) throw Error('TOO_MANY_IMAGE_REFERENCES');
  let totalBytes = 0;
  const content: PreparedImageMessage['content'] = [{ type: 'text', text: prompt }];
  for (const ref of references) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(ref.mimeType)) throw Error('INVALID_IMAGE_REFERENCE_TYPE');
    if (!ref.bytes.length || ref.bytes.length > 15_000_000) throw Error('INVALID_IMAGE_REFERENCE_SIZE');
    totalBytes += ref.bytes.length;
    if (totalBytes > 40_000_000) throw Error('IMAGE_REFERENCES_TOO_LARGE');
    content.push({
      type: 'image_url',
      image_url: { url: `data:${ref.mimeType};base64,${ref.bytes.toString('base64')}` },
    });
  }
  return { role: 'user', content };
}
