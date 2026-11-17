// devnet end to end: write two cheques, stop one, try an early deposit, deposit the other after its date.
// uses the solana cli keypair as the writer, a fresh keypair as the payee, and a throwaway test mint.
// run: npm run e2e   (needs ~0.1 devnet sol in ~/.config/solana/id.json)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import { Chequebook, RPC } from "../src/cheque.ts";
import { encodeRef, decodeRef } from "../src/payload.ts";
import { formatAmount } from "../src/words.ts";

const DEC = 6;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const conn = new Connection(RPC.devnet, "confirmed");
const writer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
const payee = Keypair.generate();
const book = new Chequebook("devnet");

log("writer", writer.publicKey.toBase58(), (await conn.getBalance(writer.publicKey)) / LAMPORTS_PER_SOL, "sol");
log("payee ", payee.publicKey.toBase58());

// gas for the payee's deposit
await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: writer.publicKey, toPubkey: payee.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL })), [writer]);

const mint = await createMint(conn, writer, writer.publicKey, null, DEC);
const writerAta = await getOrCreateAssociatedTokenAccount(conn, writer, mint, writer.publicKey);
await mintTo(conn, writer, mint, writerAta.address, writer, 1_000n * 10n ** BigInt(DEC));
log("test mint", mint.toBase58(), "minted 1,000 to writer");

const now = Math.floor(Date.now() / 1000);
const amountA = 125_500_000n, amountB = 40_000_000n;
const a = await book.write({ payee: payee.publicKey.toBase58(), mint: mint.toBase58(), amount: amountA, date: now + 75, no: 1, memo: "e2e: rent" }, writer);
log("wrote #000001", formatAmount(amountA, DEC), "->", a.id, "tx", a.tx);
const b = await book.write({ payee: payee.publicKey.toBase58(), mint: mint.toBase58(), amount: amountB, date: now + 86_400, no: 2, memo: "e2e: to stop" }, writer);
log("wrote #000002", formatAmount(amountB, DEC), "->", b.id);

// qr round trip
const ref = decodeRef(encodeRef({ cluster: "devnet", id: a.id }));
if (ref.id !== a.id) throw new Error("qr round trip failed");

const check = async (id: string, want: string) => {
  const c = await book.get(id);
  if (c.status !== want) throw new Error(`#${c.no}: want ${want}, got ${c.status}`);
  log(`#${String(c.no).padStart(6, "0")}`, c.status, "ok");
  return c;
};
await check(a.id, "post-dated");
await check(b.id, "post-dated");

// a stranger can't deposit, the payee can't deposit early
await book.deposit(a.id, payee).then(() => { throw new Error("early deposit went through"); }, (e) => log("early deposit refused:", e.message));
await book.deposit(a.id, writer).then(() => { throw new Error("wrong payee deposited"); }, (e) => log("wrong payee refused:", e.message));

const stopTx = await book.stop(b.id, writer);
log("stopped #000002 tx", stopTx);
await check(b.id, "stopped");

const wait = (await book.get(a.id)).date - Math.floor(Date.now() / 1000) + 5;
if (wait > 0) { log(`waiting ${wait}s for the cheque date`); await sleep(wait * 1000); }
// after the date it's the payee's. streamflow's crank often pays it out within seconds; if not, the payee deposits.
await sleep(3000);
const dep = await book.deposit(a.id, payee);
log(dep.tx ? `deposited #000001 tx ${dep.tx}` : "#000001 already cleared to the payee by the network");
await check(a.id, "cleared");
await book.stop(a.id, writer).then(() => { throw new Error("stopped a cleared cheque"); }, (e) => log("late stop refused:", e.message));

const payeeAta = await getOrCreateAssociatedTokenAccount(conn, payee, mint, payee.publicKey);
const bal = (await getAccount(conn, payeeAta.address)).amount;
log("payee balance", formatAmount(bal, DEC));
if (bal !== amountA) throw new Error(`payee got ${bal}, want ${amountA}`);
log("e2e passed");
