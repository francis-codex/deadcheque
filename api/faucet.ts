// devnet-only gas faucet for the demo. the public devnet faucet rate-limits judges,
// so this sends a small amount of devnet sol from a demo wallet held in FAUCET_SECRET_KEY.
// devnet sol has no value; the caps just stop one visitor draining it.
// no @solana/web3.js here: it fails to load in vercel functions (rpc-websockets / esm uuid),
// so the transfer is built by hand: plain json-rpc + node:crypto ed25519.
import { createPrivateKey, sign } from "node:crypto";

const LAMPORTS = 1_000_000_000;
const DRIP = 0.3 * LAMPORTS;        // enough for mint + stream fees
const SKIP_ABOVE = 0.2 * LAMPORTS;  // already funded, nothing to do
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number>(); // ip/pubkey -> last drip (per warm instance)

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
export function b58encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x !== 0) break; s = "1" + s; }
  return s;
}

/** legacy message for one SystemProgram.transfer(from -> to). */
export function transferMessage(from: Uint8Array, to: Uint8Array, blockhash: Uint8Array, lamports: number): Uint8Array {
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // Transfer
  dv.setBigUint64(4, BigInt(lamports), true);
  return Uint8Array.from([
    1, 0, 1,                  // 1 signer, 0 readonly signed, 1 readonly unsigned (system program)
    3, ...from, ...to, ...new Uint8Array(32),
    ...blockhash,
    1, 2, 2, 0, 1, 12, ...data, // 1 ix: program 2, accounts [0,1], 12 data bytes
  ]);
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.FAUCET_SECRET_KEY;
  if (!secret) return json({ error: "faucet not configured" }, 503);

  let to: Uint8Array, toStr: string;
  try {
    const { pubkey } = (await req.json()) as { pubkey?: string };
    toStr = String(pubkey);
    to = b58decode(toStr);
    if (to.length !== 32) throw new Error();
  } catch {
    return json({ error: "send { pubkey }" }, 400);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const now = Date.now();
  for (const k of [ip, toStr]) {
    if (k && now - (recent.get(k) ?? 0) < WINDOW_MS) return json({ error: "one top-up per 10 minutes" }, 429);
  }

  const url = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
  const bal = (k: string) => rpc<{ value: number }>(url, "getBalance", [k, { commitment: "confirmed" }]).then((r) => r.value);
  if ((await bal(toStr)) >= SKIP_ABOVE) return json({ ok: true, skipped: true });

  const sk = Uint8Array.from(JSON.parse(secret) as number[]);
  const from = sk.slice(32);
  if ((await bal(b58encode(from))) < DRIP + 10_000) return json({ error: "demo faucet empty" }, 503);

  const { value } = await rpc<{ value: { blockhash: string } }>(url, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const msg = transferMessage(from, to, b58decode(value.blockhash), DRIP);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(sk.slice(0, 32))]), format: "der", type: "pkcs8" });
  const sig = sign(null, msg, key);
  const tx = Buffer.concat([Buffer.from([1]), sig, Buffer.from(msg)]);
  const txSig = await rpc<string>(url, "sendTransaction", [tx.toString("base64"), { encoding: "base64", preflightCommitment: "confirmed" }]);

  if (ip) recent.set(ip, now);
  recent.set(toStr, now);
  return json({ ok: true, sig: txSig });
}
