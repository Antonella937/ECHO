import assert from "node:assert/strict";
import test from "node:test";
import {sendKindroidSceneGroupMessage,KindroidSceneSendError} from "../src/lib/scene-kindroid-group-send";
const group="A1C6M15BpSOmRC9Qi7m5";
test("uses the documented group endpoint and never a private Kin DM",async()=>{
  let calls=0;
  const request=(async(input:string|URL|Request,init?:RequestInit)=>{
    calls++;
    assert.equal(String(input),"https://api.kindroid.ai/v1/groupchats-user-message");
    assert.equal(init?.method,"POST");
    assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer test-key");
    assert.deepEqual(JSON.parse(String(init?.body)),{group_id:group,message:"*Nela walks in.*"});
    return new Response("",{status:200});
  }) as typeof fetch;
  await sendKindroidSceneGroupMessage(group,"  *Nela walks in.*  ","test-key",request);
  assert.equal(calls,1);
});
test("rejects bad input without calling Kindroid",async()=>{
  let calls=0;
  const request=(async()=>{calls++;return new Response("",{status:200});}) as typeof fetch;
  await assert.rejects(sendKindroidSceneGroupMessage("../bad","hello","test-key",request),KindroidSceneSendError);
  await assert.rejects(sendKindroidSceneGroupMessage(group," ","test-key",request),KindroidSceneSendError);
  assert.equal(calls,0);
});
test("does not retry a potentially delivered message after network failure",async()=>{
  let calls=0;
  const request=(async()=>{calls++;throw new Error("timeout");}) as typeof fetch;
  await assert.rejects(sendKindroidSceneGroupMessage(group,"hello","test-key",request),
    (error:unknown)=>error instanceof KindroidSceneSendError&&error.code==="KINDROID_SCENE_GROUP_SEND_UNCERTAIN");
  assert.equal(calls,1);
});

test("does not retry a rejected upstream write, including rate limits",async()=>{
  let calls=0;
  const request=(async()=>{calls++;return new Response("rate limit",{status:429});}) as typeof fetch;
  await assert.rejects(sendKindroidSceneGroupMessage(group,"hello","test-key",request),
    (error:unknown)=>error instanceof KindroidSceneSendError&&error.code==="KINDROID_RATE_LIMITED"&&error.status===429);
  assert.equal(calls,1);
});
test("does not send a message without credentials or with an oversized body",async()=>{
  let calls=0;
  const request=(async()=>{calls++;return new Response("",{status:200});}) as typeof fetch;
  await assert.rejects(sendKindroidSceneGroupMessage(group,"hello","",request),
    (error:unknown)=>error instanceof KindroidSceneSendError&&error.code==="KINDROID_KEY_MISSING");
  await assert.rejects(sendKindroidSceneGroupMessage(group,"x".repeat(5001),"test-key",request),
    (error:unknown)=>error instanceof KindroidSceneSendError&&error.code==="KINDROID_SCENE_MESSAGE_INVALID");
  assert.equal(calls,0);
});
