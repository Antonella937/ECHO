import assert from "node:assert/strict";
import test from "node:test";
import {parseKindroidSceneGroupReply} from "../src/lib/scene-kindroid-reply";

test("extracts in-character narration from a Kindroid group draft",()=>{
  assert.equal(parseKindroidSceneGroupReply(JSON.stringify({
    action:"draft",situation:"dm",text:"*Mar looks up from her bass.* You heard him.",
    reason:"Kindroid group conversation"
  })),"*Mar looks up from her bass.* You heard him.");
});
test("refuses non-draft, invalid, blank or oversized group responses",()=>{
  for(const response of ["not json", "{}",'{"action":"ignore","text":"hello"}',
    '{"action":"draft","text":"   "}',JSON.stringify({action:"draft",text:"x".repeat(8001)})]){
    assert.equal(parseKindroidSceneGroupReply(response),null);
  }
});
