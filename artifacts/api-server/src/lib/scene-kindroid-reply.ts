import { z } from "zod";

/** Kindroid group provider returns an action envelope, not a scene {text} object.
 * Parse only a draft from the intended group transport. Never treat an error,
 * an empty response, or a non-draft action as a scene character's dialogue.
 */
const kindroidGroupDraft=z.object({
  action:z.literal("draft"),
  text:z.string().trim().min(1).max(8000),
}).passthrough();

export function parseKindroidSceneGroupReply(completionText:string):string|null{
  let value:unknown;
  try{value=JSON.parse(completionText);}catch{return null;}
  const parsed=kindroidGroupDraft.safeParse(value);
  return parsed.success?parsed.data.text:null;
}
