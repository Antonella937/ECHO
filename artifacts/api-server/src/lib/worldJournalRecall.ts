import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Returns only approved facts visible to this specific character in this owner/universe.
 * Relevance ranking is deterministic, bounded and free of additional model calls.
 */
export async function relevantWorldJournals(ownerId: string, universeId: string, characterId: string, query: string) {
  if (!ownerId || !universeId || !characterId) return [];
  const rows = await db.execute(sql`SELECT title,content,truth_status,keywords,updated_at
    FROM echo_world_journals WHERE owner_id=${ownerId} AND universe_id=${universeId}
    AND status='published'
    AND EXISTS (SELECT 1 FROM echo_universes u WHERE u.owner_id=${ownerId}
      AND u.universe_id=${universeId} AND u.archived_at IS NULL AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(u.state->'characters')='array'
        THEN u.state->'characters' ELSE '[]'::jsonb END) ch
        WHERE ch->>'id'=${characterId} AND COALESCE((ch->>'archived')::boolean,false)=false))
    AND (knowledge_scope='everyone'
      OR (knowledge_scope='selected' AND ${characterId}=ANY(known_character_ids)))
    ORDER BY updated_at DESC LIMIT 200`);
  const terms = [...new Set((query.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []))]
    .filter(t=>!['this','that','with','what','about','para','como','esta','este','sobre','porque'].includes(t));
  return rows.rows.map(row=>{
    const title=String(row.title??'').slice(0,180);
    const content=String(row.content??'').slice(0,1800);
    const keywords=Array.isArray(row.keywords)?row.keywords.map(String):[];
    const haystack=[title,...keywords,content].join(' ').toLocaleLowerCase();
    const score=terms.reduce((sum,t)=>sum+(haystack.includes(t)?1:0),0);
    return {title,content,truthStatus:String(row.truth_status??'unknown'),score};
  }).filter(e=>e.score>0).sort((a,b)=>b.score-a.score).slice(0,5)
    .map(({title,content,truthStatus})=>({title,content,truthStatus}));
}
