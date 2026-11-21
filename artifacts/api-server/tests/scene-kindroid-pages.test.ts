import { strict as assert } from "node:assert";
import { test } from "node:test";
import { KindroidSceneHistoryError, readKindroidScenePages } from "../src/lib/scene-kindroid-pages";

const group="A1C6M15BpSOmRC9Qi7m5";
const reply=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});
test("reads all group history pages with a cursor and without writes",async()=>{
  const urls:string[]=[];
  const request=(async(input:string|URL|Request)=>{
    const url=new URL(String(input)); urls.push(url.toString());
    return reply(url.searchParams.has("start_after_timestamp")
      ? {messages:[{id:"second"}],pagination:{hasMore:false,lastTimestamp:20}}
      : {messages:[{id:"first"}],pagination:{hasMore:true,lastTimestamp:20}});
  }) as typeof fetch;
  const messages=await readKindroidScenePages(group,"test-key",request);
  assert.equal(messages.length,2);
  assert.equal(urls.length,2);
  assert.equal(new URL(urls[1]).searchParams.get("start_after_timestamp"),"20");
});
test("rejects repeated pagination cursors",async()=>{
  const request=(async()=>reply({messages:[{id:"a"}],pagination:{hasMore:true,lastTimestamp:20}})) as typeof fetch;
  await assert.rejects(readKindroidScenePages(group,"test-key",request),
    (error:unknown)=>error instanceof KindroidSceneHistoryError && error.code==="KINDROID_SCENE_HISTORY_CURSOR_INVALID");
});
test("rejects unknown pagination rather than silently importing partial history",async()=>{
  const request=(async()=>reply({messages:[{id:"a"}]})) as typeof fetch;
  await assert.rejects(readKindroidScenePages(group,"test-key",request),
    (error:unknown)=>error instanceof KindroidSceneHistoryError && error.code==="KINDROID_SCENE_HISTORY_PAGINATION_UNKNOWN");
});
test("rejects histories beyond five pages without returning a partial result",async()=>{
  const request=(async()=>reply({messages:[{id:"a"}],pagination:{hasMore:true,lastTimestamp:++counter}})) as typeof fetch;
  let counter=0;
  await assert.rejects(readKindroidScenePages(group,"test-key",request),
    (error:unknown)=>error instanceof KindroidSceneHistoryError && error.code==="KINDROID_SCENE_HISTORY_PAGE_LIMIT");
});

test("rejects an oversized Kindroid history page",async()=>{
  const request=(async()=>reply({messages:Array.from({length:101},(_,i)=>({id:String(i)})),pagination:{hasMore:false}})) as typeof fetch;
  await assert.rejects(readKindroidScenePages(group,"test-key",request),
    (error:unknown)=>error instanceof KindroidSceneHistoryError && error.code==="KINDROID_SCENE_HISTORY_PAGE_TOO_LARGE");
});

test("preserves Kindroid rate-limit status without returning partial history",async()=>{
  const request=(async()=>new Response("rate limited",{status:429})) as typeof fetch;
  await assert.rejects(readKindroidScenePages(group,"test-key",request),
    (error:unknown)=>error instanceof KindroidSceneHistoryError && error.code==="KINDROID_RATE_LIMITED" && error.status===429);
});
test("rejects an empty continuation page",async()=>{
  let calls=0;
  const request=(async()=>{
    calls++;
    return reply(calls===1
      ? {messages:[{id:"first"}],pagination:{hasMore:true,lastTimestamp:10}}
      : {messages:[],pagination:{hasMore:true,lastTimestamp:11}});
  }) as typeof fetch;
  await assert.rejects(readKindroidScenePages(group,"test-key",request),
    (error:unknown)=>error instanceof KindroidSceneHistoryError && error.code==="KINDROID_SCENE_HISTORY_CURSOR_INVALID");
});
