// two ways to sign: your wallet (any injected solana wallet) or devnet demo accounts kept in this browser.
// demo accounts are devnet only: throwaway keys, never hold real money with them.
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getMint } from "@solana/spl-token";
import type { Signer } from "./cheque.ts";

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode: lives for this tab only */ } },
};
const mem = new Map<string, string>();
const read = (k: string) => store.get(k) ?? mem.get(k) ?? null;
const write = (k: string, v: string) => { mem.set(k, v); store.set(k, v); };

export type Role = "writer" | "payee";
export function demoKey(role: Role): Keypair {
  const k = `dc:demo:${role}`, raw = read(k);
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const kp = Keypair.generate();
  write(k, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export const demoMint = () => read("dc:demo:mint");
export const setDemoMint = (m: string) => write("dc:demo:mint", m);
export const nextNo = () => { const n = Number(read("dc:no") ?? "0") + 1; write("dc:no", String(n)); return n; };

/** injected wallet, if the browser has one */
export function injected(): any | null {
  const w = window as any;
  return w.solana?.signTransaction ? w.solana : w.solflare?.signTransaction ? w.solflare : null;
}
export async function connectInjected(): Promise<Signer> {
  const p = injected();
  if (!p) throw new Error("no wallet found in this browser. use the demo accounts, or open this in your wallet's browser.");
  await p.connect();
  return { publicKey: new PublicKey(p.publicKey.toString()), signTransaction: p.signTransaction.bind(p), signAllTransactions: p.signAllTransactions.bind(p) };
}

/** our own devnet gas faucet (api/faucet.ts). true once the wallet has gas. */
export async function demoFaucet(conn: Connection, pubkey: string, f: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await f("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey }) });
    if (!r.ok) return false;
    const { sig } = (await r.json()) as { sig?: string };
    if (sig) await conn.confirmTransaction(sig, "confirmed");
    return true;
  } catch {
    return false;
  }
}

/** devnet: fund the demo writer, make a test dollar mint, give the payee gas. safe to call twice. */
export async function setupDemo(conn: Connection, say: (s: string) => void): Promise<string> {
  const writer = demoKey("writer"), payee = demoKey("payee");
  if ((await conn.getBalance(writer.publicKey)) < 0.2 * LAMPORTS_PER_SOL) {
    say("getting devnet gas for the demo…");
    if (!(await demoFaucet(conn, writer.publicKey.toBase58()))) {
      try {
        const sig = await conn.requestAirdrop(writer.publicKey, LAMPORTS_PER_SOL);
        await conn.confirmTransaction(sig, "confirmed");
      } catch {
        throw new Error(`both devnet faucets said no. send 0.5 devnet sol to ${writer.publicKey.toBase58()} from faucet.solana.com, then try again.`);
      }
    }
  }
  if ((await conn.getBalance(payee.publicKey)) < 0.01 * LAMPORTS_PER_SOL) {
    say("giving the payee a little gas…");
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: writer.publicKey, toPubkey: payee.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL })), [writer]);
  }
  let mint = demoMint();
  if (!mint) {
    say("making a test dollar token…");
    mint = (await createMint(conn, writer, writer.publicKey, null, 6)).toBase58();
    setDemoMint(mint);
  }
  const ata = await getOrCreateAssociatedTokenAccount(conn, writer, new PublicKey(mint), writer.publicKey);
  if (ata.amount < 100n * 1_000_000n) {
    say("minting 10,000 test dollars…");
    await mintTo(conn, writer, new PublicKey(mint), ata.address, writer, 10_000n * 1_000_000n);
  }
  return mint;
}

export async function tokenBalance(conn: Connection, owner: PublicKey, mint: string): Promise<bigint> {
  try {
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
    return (await getAccount(conn, getAssociatedTokenAddressSync(new PublicKey(mint), owner))).amount;
  } catch { return 0n; }
}
export async function decimalsOf(conn: Connection, mint: string): Promise<number> {
  return (await getMint(conn, new PublicKey(mint))).decimals;
}
