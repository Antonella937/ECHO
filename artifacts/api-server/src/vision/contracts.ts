import { z } from "zod";

const label = z.string().trim().min(1).max(120);
const shortText = z.string().trim().max(320);

export const VisionAnalysisSchema = z.object({
  sceneDescription: z.string().trim().min(8).max(1400),
  setting: shortText,
  objects: z.array(z.object({
    label,
    category: z.enum(["object", "person", "animal", "text", "setting", "other"]),
    attributes: z.array(shortText).max(8),
    position: z.enum(["foreground", "center", "background", "left", "right", "top", "bottom", "unknown"]),
    confidence: z.number().min(0).max(1),
  }).strict()).max(40),
  people: z.object({
    count: z.number().int().min(0).max(40),
    nonIdentifyingDetails: z.array(shortText).max(8),
  }).strict(),
  activities: z.array(shortText).max(20),
  dominantColors: z.array(label).max(12),
  visibleText: z.array(shortText).max(20),
  notableDetails: z.array(shortText).max(24),
  uncertainty: z.array(shortText).max(12),
}).strict();

export type VisionAnalysis = z.infer<typeof VisionAnalysisSchema>;

export type VisionEntityType = "post" | "story";

export interface VisionContext {
  /** Keys use `${entityType}:${entityId}:${mediaId}`; no media URLs or bytes. */
  analyses: Record<string, VisionAnalysis>;
  postSummaries: Record<string, VisionPostSummary>;
}

export interface VisionPostSummary {
  postId: string;
  caption: string;
  imageCount: number;
  unsupportedVideoCount: number;
  orderedItems: Array<{
    mediaId: string;
    position: number;
    description: string;
    objects: string[];
    colors: string[];
  }>;
  overallDescription: string;
}

export interface VisionAttempt {
  model: string;
  outcome: "accepted" | "rejected";
  errorCode: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null; cost: number | null };
}

export class VisionError extends Error {
  constructor(
    readonly code: string,
    readonly status = 502,
    readonly attempts: VisionAttempt[] = [],
  ) {
    super(code);
    this.name = "VisionError";
  }
}

export interface VisionUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
}

export interface VisionProvider {
  readonly name: string;
  analyze(input: {
    image: { mimeType: string; base64: string };
    prompt: string;
    validate: (text: string) => VisionAnalysis;
  }): Promise<{
    analysis: VisionAnalysis;
    provider: string;
    model: string;
    usage: VisionUsage;
    attempts: VisionAttempt[];
  }>;
}
