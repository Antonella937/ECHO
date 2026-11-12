import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { suggestWorldJournal } from './worldJournalProposal';

type Message = {id:string;threadId:string;senderId:string;recipientId:string;text:string;hiddenForIds?:string[]};
type Character = {id:string;name?:string;archived?:boolean};
const inFlight = new Set<string>();

/** Best-effort, private draft proposal. Never blocks a DM or publishes knowledge. */
export async function checkWorldJournalAfterDm(ownerId:string, universeId:string,
  threadId:string, messages:Message[], characters:Character[]):Promise<void> {
  if (process.env.ECHO_WORLD_JOURNAL_AUTO_SUGGEST !== 'true') return;
  const key=ownerId+':'+universeId+':'+threadId;
  if(inFlight.has(key)) return;
  const active=new Set(characters.filter(c=>!c.archived).map(c=>c.id));
  const thread=messages.filter(m=>m.threadId===threadId && active.has(m.senderId) &&
    active.has(m.recipientId) && m.senderId!==m.recipientId &&
    m.text.trim().length>0 && (!m.hiddenForIds || m.hiddenForIds.length===0)).slice(-20);
  // Wait for a substantial conversation before spending any model quota.
  if(thread.length<8) return;
  const last=thread[thread.length-1];
  if(!last || thread.length%4!==0) return;
  inFlight.add(key);
  try {
    const recent=await db.execute(sql`SELECT id FROM echo_world_journals
      WHERE owner_id=${ownerId} AND universe_id=${universeId}
      AND source_reference LIKE ${'dm:'+threadId+':%'}
      AND created_at>now()-interval '6 hours' LIMIT 1`);
    if(recent.rows.length) return;
    const excerpt=thread.map(m=>`${m.senderId}: ${m.text.slice(0,300)}`).join('\n').slice(-6000);
    const candidate=await suggestWorldJournal(excerpt,characters.filter(c=>!c.archived)
      .map(c=>({id:c.id,name:c.name||c.id})));
    if(!candidate) return;
    await db.execute(sql`INSERT INTO echo_world_journals
      (owner_id,universe_id,title,content,category,truth_status,keywords,
       knowledge_scope,known_character_ids,source_type,source_reference,created_by,status)
      VALUES (${ownerId},${universeId},${candidate.title},${candidate.content},
       ${candidate.category},${candidate.truthStatus},
       ${candidate.keywords.length ? sql`ARRAY[${sql.join(candidate.keywords.map(k=>sql`${k}`),sql`,`)}]::text[]` : sql`ARRAY[]::text[]`},
       'nobody',ARRAY[]::text[],'ai_suggestion',${'dm:'+threadId+':'+last.id},
       ${ownerId},'draft')`);
  } catch(error) {
    console.warn('World Journal auto suggestion skipped', {reason:error instanceof Error?error.message.slice(0,100):'UNKNOWN'});
  } finally {inFlight.delete(key);}
}
