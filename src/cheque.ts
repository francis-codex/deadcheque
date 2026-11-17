// the cheque <-> streamflow mapping. a dead cheque is a streamflow stream that:
//   - unlocks (almost) everything at one moment: the cheque date (start = cliff = date, cliffAmount = amount - 1,
//     the last base unit drips one second later because streamflow needs a non-zero rate)
//   - is "crossed": named payee only, neither side can transfer it
//   - can be stopped by the writer (cancel) before the date; after the date it is the payee's
import BN from "bn.js";
import { PublicKey, type Keypair } from "@solana/web3.js";
import { SolanaStreamClient, ICluster, StreamDirection, StreamType, type ICreateStreamData, type Stream } from "@streamflow/stream";
import type { Cluster } from "./payload.ts";

export type Status = "post-dated" | "clearable" | "cleared" | "stopped";
export type Signer = Keypair | { publicKey: PublicKey; signTransaction: any; signAllTransactions: any };

export interface ChequeInput {
  payee: string;       // payee wallet address
  mint: string;        // token mint (a dollar stablecoin on mainnet, a test mint on devnet)
  amount: bigint;      // base units
  date: number;        // unix seconds, must be in the future
  no: number;          // cheque number, printed on the cheque
  memo?: string;
}

export interface Cheque {
  id: string; no: number; memo: string; payer: string; payee: string; mint: string;
  amount: bigint; withdrawn: bigint; date: number; stoppedAt: number; status: Status;
}

const NAME_MAX = 64; // streamflow stores the stream name in 64 bytes

/** "#000042 rent for march" -> fits in 64 utf-8 bytes */
export function chequeName(no: number, memo = ""): string {
  let s = `#${String(no).padStart(6, "0")}${memo ? " " + memo.toLowerCase().trim() : ""}`;
  while (new TextEncoder().encode(s).length > NAME_MAX) s = s.slice(0, -1);
  return s;
}
export function parseName(name: string): { no: number; memo: string } {
  const m = /^#(\d{1,6})\s?(.*)$/.exec(name.replace(/\0/g, "").trim());
  return m ? { no: Number(m[1]), memo: m[2] } : { no: 0, memo: name.replace(/\0/g, "").trim() };
}

export function validate(i: ChequeInput, now = Math.floor(Date.now() / 1000)): void {
  try { new PublicKey(i.payee); } catch { throw new Error("payee is not a valid address"); }
  try { new PublicKey(i.mint); } catch { throw new Error("token mint is not a valid address"); }
  if (i.amount < 2n) throw new Error("amount is too small");
  if (i.date <= now + 30) throw new Error("date the cheque at least a minute ahead");
  if (!Number.isInteger(i.no) || i.no < 1 || i.no > 999_999) throw new Error("cheque number must be 1 to 999999");
}

/** pure: the streamflow create params for a cheque */
export function streamParams(i: ChequeInput): ICreateStreamData {
  return {
    recipient: i.payee,
    tokenId: i.mint,
    amount: new BN(i.amount.toString()),
    cliffAmount: new BN((i.amount - 1n).toString()),
    amountPerPeriod: new BN(1),
    period: 1,
    start: i.date,
    cliff: i.date,
    name: chequeName(i.no, i.memo),
    cancelableBySender: true,
    cancelableByRecipient: false,
    transferableBySender: false,
    transferableByRecipient: false,
    canTopup: false,
    canPause: false,
    canUpdateRate: false,
    automaticWithdrawal: false,
  };
}

/** pure: on-chain stream -> cheque status */
export function statusOf(s: Pick<Stream, "canceledAt" | "withdrawnAmount" | "depositedAmount" | "cliff">, now = Math.floor(Date.now() / 1000)): Status {
  if (s.canceledAt > 0) return "stopped";
  if (s.depositedAmount.gt(new BN(0)) && s.withdrawnAmount.gte(s.depositedAmount)) return "cleared";
  return now >= s.cliff ? "clearable" : "post-dated";
}

export function toCheque(id: string, s: Stream, now?: number): Cheque {
  const { no, memo } = parseName(s.name);
  return {
    id, no, memo, payer: s.sender, payee: s.recipient, mint: s.mint,
    amount: BigInt(s.depositedAmount.toString()), withdrawn: BigInt(s.withdrawnAmount.toString()),
    date: s.cliff, stoppedAt: s.canceledAt, status: statusOf(s, now),
  };
}

export const fmtDate = (unix: number) => new Date(unix * 1000).toDateString().toLowerCase();

export const RPC: Record<Cluster, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export class Chequebook {
  readonly client: SolanaStreamClient;
  readonly cluster: Cluster;
  constructor(cluster: Cluster, rpc = RPC[cluster]) {
    this.cluster = cluster;
    this.client = new SolanaStreamClient(rpc, cluster === "devnet" ? ICluster.Devnet : ICluster.Mainnet, "confirmed");
  }

  /** write (sign) a post-dated cheque. returns the cheque id (stream metadata address) */
  async write(i: ChequeInput, payer: Signer): Promise<{ id: string; tx: string }> {
    validate(i);
    const r = await this.client.create(streamParams(i), { sender: payer as any });
    return { id: r.metadataId, tx: r.txId };
  }

  async get(id: string): Promise<Cheque> {
    return toCheque(id, await this.client.getOne({ id }));
  }

  /** stop payment. only the writer, and only before the date: after it, the money is the payee's */
  async stop(id: string, payer: Signer): Promise<string> {
    const c = await this.get(id);
    if (c.status !== "post-dated") throw new Error(`can't stop a ${c.status} cheque`);
    if (c.payer !== payer.publicKey.toBase58()) throw new Error("only the writer can stop this cheque");
    return (await this.client.cancel({ id }, { invoker: payer as any })).txId;
  }

  /** deposit. only the named payee, only on or after the date. streamflow's crank may already have paid
   *  the cheque into the payee's wallet once it matured; then there is nothing to sign and we say so. */
  async deposit(id: string, payee: Signer): Promise<{ tx: string | null; cheque: Cheque }> {
    const c = await this.get(id);
    if (c.payee !== payee.publicKey.toBase58()) throw new Error("this cheque is crossed: only the named payee can deposit it");
    if (c.status === "cleared") return { tx: null, cheque: c };
    if (c.status === "stopped") throw new Error("payment on this cheque was stopped");
    if (c.status === "post-dated") throw new Error(`this cheque is dated ${fmtDate(c.date)}`);
    const tx = (await this.client.withdraw({ id }, { invoker: payee as any })).txId;
    return { tx, cheque: await this.get(id) };
  }

  /** cheques this wallet wrote (outgoing) or received (incoming), newest date first */
  async list(owner: string, direction: "outgoing" | "incoming"): Promise<Cheque[]> {
    const rows = await this.client.get({ address: owner, type: StreamType.All, direction: direction === "outgoing" ? StreamDirection.Outgoing : StreamDirection.Incoming });
    return rows
      .map(([id, s]) => toCheque(id, s))
      .filter((c) => c.no > 0) // only things this app wrote
      .sort((a, b) => b.date - a.date);
  }
}
