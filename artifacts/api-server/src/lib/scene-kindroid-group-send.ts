/** Kindroid's documented group-only user-message transport. Never use /send-message. */
export class KindroidSceneSendError extends Error {
  constructor(readonly code:string,readonly status:number){super(code);}
}
export async function sendKindroidSceneGroupMessage(
  groupId:string,message:string,apiKey:string,request:typeof fetch=fetch,
):Promise<void>{
  if(!/^[A-Za-z0-9_-]{8,160}$/.test(groupId)) throw new KindroidSceneSendError("KINDROID_GROUP_ID_INVALID",400);
  if(!message.trim() || message.length>5000) throw new KindroidSceneSendError("KINDROID_SCENE_MESSAGE_INVALID",400);
  if(!apiKey) throw new KindroidSceneSendError("KINDROID_KEY_MISSING",503);
  let response:Response;
  try{
    response=await request("https://api.kindroid.ai/v1/groupchats-user-message",{
      method:"POST",
      headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify({group_id:groupId,message:message.trim()}),
      signal:AbortSignal.timeout(90000),
    });
  }catch{
    // A timed-out write may already have reached Kindroid. Never auto-retry.
    throw new KindroidSceneSendError("KINDROID_SCENE_GROUP_SEND_UNCERTAIN",502);
  }
  if(!response.ok) throw new KindroidSceneSendError(
    response.status===429?"KINDROID_RATE_LIMITED":"KINDROID_SCENE_GROUP_SEND_FAILED",
    response.status===429?429:502);
}
