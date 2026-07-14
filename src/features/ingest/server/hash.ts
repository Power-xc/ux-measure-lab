// SHA-256 hex digest for public site keys and pseudonymous ids.
// The raw site key is never stored (research-ingest.md §3.1·§4.5); only this
// hash is compared against `sites.key_hash`. anon_id is likewise stored hashed
// (research-ingest.md §3.2), so deletion requests hash the input before matching.
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
