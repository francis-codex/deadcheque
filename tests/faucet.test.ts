import { describe, it, expect } from "vitest";
import type { Connection } from "@solana/web3.js";
import { demoFaucet } from "../src/wallet.ts";

const conn = { confirmTransaction: async () => ({ value: { err: null } }) } as unknown as Connection;
const res = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("demo faucet", () => {
  it("true when the faucet sends gas", async () => {
    expect(await demoFaucet(conn, "x", res(200, { ok: true, sig: "s" }))).toBe(true);
  });
  it("true when the wallet already has gas", async () => {
    expect(await demoFaucet(conn, "x", res(200, { ok: true, skipped: true }))).toBe(true);
  });
  it("false on rate limit or empty faucet, so the airdrop fallback runs", async () => {
    expect(await demoFaucet(conn, "x", res(429, { error: "one top-up per 10 minutes" }))).toBe(false);
    expect(await demoFaucet(conn, "x", res(503, { error: "demo faucet empty" }))).toBe(false);
  });
  it("false when there is no api (local vite dev)", async () => {
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await demoFaucet(conn, "x", boom)).toBe(false);
  });
});

import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { b58decode, b58encode, transferMessage } from "../api/faucet.ts";

describe("hand-built faucet transfer", () => {
  it("base58 round-trips pubkeys", () => {
    const pk = Keypair.generate().publicKey;
    expect(b58encode(b58decode(pk.toBase58()))).toBe(pk.toBase58());
    expect(b58encode(pk.toBytes())).toBe(pk.toBase58());
  });
  it("matches web3.js's transfer message byte for byte", () => {
    const from = Keypair.generate().publicKey, to = Keypair.generate().publicKey;
    const blockhash = Keypair.generate().publicKey.toBase58();
    const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 300_000_000 }));
    const ours = transferMessage(from.toBytes(), to.toBytes(), new PublicKey(blockhash).toBytes(), 300_000_000);
    expect(Buffer.from(ours).equals(tx.serializeMessage())).toBe(true);
  });
});
