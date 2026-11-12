import { createHash, createHmac } from "node:crypto";

/** Cloudflare R2 S3-compatible signing. No public bucket or browser credentials. */
export type R2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};
const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
export function configuredR2(): R2Config | null {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const all = [accountId,bucket,accessKeyId,secretAccessKey];
  if(all.every(value=>!value))return null;
  if(all.some(value=>!value))throw new Error("R2_CONFIGURATION_INCOMPLETE");
  if(!/^[a-f0-9]{32}$/i.test(accountId!) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket!))throw new Error("R2_CONFIGURATION_INVALID");
  return {accountId:accountId!,bucket:bucket!,accessKeyId:accessKeyId!,secretAccessKey:secretAccessKey!};
}
export function signR2Request(config:R2Config,method:"GET"|"PUT"|"HEAD",objectKey:string,expiresSeconds=300,now=new Date()):string {
  if(!/^(uploads|r2)\/[A-Za-z0-9/_-]+$/.test(objectKey))throw new Error("R2_INVALID_OBJECT_KEY");
  if(!Number.isInteger(expiresSeconds)||expiresSeconds<1||expiresSeconds>3600)throw new Error("R2_INVALID_EXPIRY");
  const date=now.toISOString().replace(/[:-]|\.\d{3}/g,"");
  const day=date.slice(0,8);
  const host=`${config.accountId}.r2.cloudflarestorage.com`;
  const path="/"+[config.bucket,...objectKey.split("/")].map(encode).join("/");
  const scope=`${day}/auto/s3/aws4_request`;
  const entries=[
    ["X-Amz-Algorithm","AWS4-HMAC-SHA256"],
    ["X-Amz-Credential",`${config.accessKeyId}/${scope}`],
    ["X-Amz-Date",date],
    ["X-Amz-Expires",String(expiresSeconds)],
    ["X-Amz-SignedHeaders","host"],
  ];
  const query=entries.map(([key,value])=>`${encode(key)}=${encode(value)}`).sort().join("&");
  const canonical=`${method}\n${path}\n${query}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign=`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hex(canonical)}`;
  const signingKey=hmac(hmac(hmac(hmac("AWS4"+config.secretAccessKey,day),"auto"),"s3"),"aws4_request");
  const signature=createHmac("sha256",signingKey).update(stringToSign).digest("hex");
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
