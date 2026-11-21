import assert from "node:assert/strict";
import test from "node:test";
import {isKindroidGroupSyncableEvent,sceneKindroidDeliveryKey} from "../src/lib/scene-kindroid-sync-policy";
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

test("delivery identity is stable for retries and isolated across scenes, groups and events",()=>{
  const first=sceneKindroidDeliveryKey("scene-a","A1C6M15BpSOmRC9Qi7m5","event-1");
  assert.ok(first?.startsWith("scene_delivery_"));
  assert.equal(first,sceneKindroidDeliveryKey("scene-a","A1C6M15BpSOmRC9Qi7m5","event-1"));
  assert.notEqual(first,sceneKindroidDeliveryKey("scene-b","A1C6M15BpSOmRC9Qi7m5","event-1"));
  assert.notEqual(first,sceneKindroidDeliveryKey("scene-a","anotherGroupId123","event-1"));
  assert.notEqual(first,sceneKindroidDeliveryKey("scene-a","A1C6M15BpSOmRC9Qi7m5","event-2"));
  assert.equal(sceneKindroidDeliveryKey("scene-a","../invalid","event-1"),null);
});
