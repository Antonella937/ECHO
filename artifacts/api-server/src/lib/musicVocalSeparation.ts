/** fal.ai Demucs vocal isolation. Billable: never invoke without explicit consent. */
const MODEL="fal-ai/demucs";
const REQUEST_ID=/^[a-zA-Z0-9_-]{8,128}$/;
function auth(){const key=process.env.FAL_KEY?.trim();if(!key)throw new Error("FAL_KEY_MISSING");return {Authorization:`Key ${key}`,"Content-Type":"application/json"};}
export async function submitVocalSeparation(bytes:Buffer,mime:string):Promise<string>{
 if(bytes.length>10*1024*1024 || bytes.length===0)throw new Error("VOCAL_SEPARATION_SIZE_INVALID");
 if(!["audio/mpeg","audio/mp4","audio/wav"].includes(mime))throw new Error("VOCAL_SEPARATION_TYPE_INVALID");
 const response=await fetch(`https://queue.fal.run/${MODEL}`,{method:"POST",headers:auth(),
 body:JSON.stringify({audio_url:`data:${mime};base64,${bytes.toString("base64")}`,model:"htdemucs",stems:["vocals"],output_format:"mp3"}),
 signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`VOCAL_SEPARATION_SUBMIT_HTTP_${response.status}`);
 const payload=await response.json() as {request_id?:unknown};
 if(typeof payload.request_id!=="string" || !REQUEST_ID.test(payload.request_id))throw new Error("VOCAL_SEPARATION_REQUEST_INVALID");
 return payload.request_id;
}
export async function vocalSeparationResult(requestId:string):Promise<{status:"IN_QUEUE"|"IN_PROGRESS"}|{status:"COMPLETED";url:string}>{
 if(!REQUEST_ID.test(requestId))throw new Error("VOCAL_SEPARATION_REQUEST_INVALID");
 const status=await fetch(`https://queue.fal.run/${MODEL}/requests/${requestId}/status`,{headers:auth(),signal:AbortSignal.timeout(15000)});
 if(!status.ok)throw new Error(`VOCAL_SEPARATION_STATUS_HTTP_${status.status}`);
 const value=await status.json() as {status?:string};
 if(value.status==="IN_QUEUE"||value.status==="IN_PROGRESS")return {status:value.status};
 if(value.status!=="COMPLETED")throw new Error("VOCAL_SEPARATION_STATUS_UNKNOWN");
 const response=await fetch(`https://queue.fal.run/${MODEL}/requests/${requestId}`,{headers:auth(),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`VOCAL_SEPARATION_RESULT_HTTP_${response.status}`);
 const result=await response.json() as {vocals?:{url?:unknown}};
 const raw=result.vocals?.url;
 if(typeof raw!=="string")throw new Error("VOCAL_SEPARATION_VOCALS_MISSING");
 const url=new URL(raw);
 if(url.protocol!=="https:" || url.username || url.password || !["fal.media","fal.ai","fal.run"].some(h=>url.hostname===h||url.hostname.endsWith("."+h)))throw new Error("VOCAL_SEPARATION_URL_INVALID");
 return {status:"COMPLETED",url:raw};
}
