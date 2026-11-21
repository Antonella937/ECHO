import assert from "node:assert/strict";
import test from "node:test";
import {isKindroidGroupSyncableEvent} from "../src/lib/scene-kindroid-sync-policy";
const base={eventId:"event-1",actorId:"nela",text:"*Nela enters.*",visibility:"participants",audienceIds:[]};
const allowed=["nela","mar","noah"];
test("allows only unrestricted human scene events",()=>{
  assert.equal(isKindroidGroupSyncableEvent(base,"nela",allowed),true);
  assert.equal(isKindroidGroupSyncableEvent({...base,visibility:"public"},"nela",allowed),true);
});
test("never shares private or audience-restricted scene content",()=>{
  for(const candidate of [
    {...base,visibility:"private"},
    {...base,audienceIds:["mar"]},
    {...base,audienceIds:null},
    {...base,audienceIds:"[]"},
    {...base,visibility:"unknown"},
  ]) assert.equal(isKindroidGroupSyncableEvent(candidate,"nela",allowed),false);
});
test("rejects messages from Kins, outsiders and invalid content",()=>{
  for(const candidate of [
    {...base,actorId:"mar"},
    {...base,actorId:"outsider"},
    {...base,text:" "},
    {...base,text:"x".repeat(5001)},
    {...base,eventId:""},
  ]) assert.equal(isKindroidGroupSyncableEvent(candidate,"nela",allowed),false);
});
