import test from "node:test";
import assert from "node:assert/strict";
import { kindroidPeerGroupProvider } from "../src/ai-engine/kindroid";

const groupId = "group12345678";
const kinId = "kin123456789";

test("group reply uses only group endpoints and never private send-message", async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-key";
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    return new Response(path.endsWith("get-turn") ? kinId : "A group reply", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await kindroidPeerGroupProvider(groupId, kinId, undefined, request).complete({
      system: "", context: "", outputSchema: {}, validate: () => undefined,
    });
    assert.deepEqual(calls.map(c => c.path), ["/v1/groupchats-get-turn", "/v1/groupchats-ai-response"]);
    assert.equal(calls[0].body.group_id, groupId);
    assert.equal(calls[1].body.ai_id, kinId);
    assert.match(result.text, /A group reply/);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test("a different Kin turn never triggers group generation or a private DM", async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-key";
  const paths: string[] = [];
  const request = (async (url: string | URL | Request) => {
    paths.push(new URL(String(url)).pathname);
    return new Response("differentKin123", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => kindroidPeerGroupProvider(groupId, kinId, undefined, request).complete({
      system: "", context: "", outputSchema: {}, validate: () => undefined,
    }), /KINDROID_GROUP_SPEAKER_MISMATCH/);
    assert.deepEqual(paths, ["/v1/groupchats-get-turn"]);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});
