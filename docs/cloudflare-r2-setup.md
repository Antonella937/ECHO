# ECHO — Cloudflare R2 private storage setup

Status: **preparation only; no live provider switch**. Existing Supabase objects must remain readable. Do not delete the Supabase bucket or credentials before migration and verification.

## In Cloudflare
1. Open R2 Object Storage, create a **private** bucket named `echo-media` (or choose another bucket name).
2. Create an R2 API token scoped **only to that bucket** with Object Read & Write. Store the Access Key ID and Secret Access Key securely. Never paste credentials in GitHub or chat.
3. Record the 32-character Cloudflare Account ID.
4. For browser direct uploads using short-lived signed PUT URLs, configure bucket CORS to allow your **exact ECHO frontend origin**, method PUT, request header Content-Type. Do not use a wildcard origin and do not expose a public bucket URL.
5. Check Cloudflare's current R2 pricing, limits and billing before moving large files; free-tier availability is not a guarantee of zero cost.

## Render environment variables (API service, secret values)
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_BUCKET` (e.g. `echo-media`)
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`

The backend helper `src/lib/cloudflareR2.ts` validates this configuration and can sign private GET, HEAD and PUT requests with AWS Signature V4, without adding SDK dependencies.

## Safe cutover checklist
- [ ] Implement a provider-aware upload route and persist which provider owns each new object (do **not** infer it from user input).
- [ ] Keep authenticated owner and social-audience authorization in front of **all** downloads.
- [ ] Route old Supabase objects to Supabase, new objects to R2; preserve existing `/api/storage/objects/...` client URLs.
- [ ] Validate file type, actual magic bytes, size and upload claim before accepting R2 objects.
- [ ] Keep transcription, galleries, DMs, posts, generated media and voice references functional.
- [ ] Test uploads and downloads on mobile Safari and desktop, including 401/403 access denial and expired signed URLs.
- [ ] Migrate old files only after inventory, backups and checksums. Never remove originals before verifying references.
- [ ] Deploy the backend after tests pass, then switch new uploads with an explicit flag.

**Important:** merely adding the four environment variables does not activate R2. Current production upload routes still use Supabase until the provider-aware adapter and migration are completed. This is intentional to avoid breaking ECHO during setup.
