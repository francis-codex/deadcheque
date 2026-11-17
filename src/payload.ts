// what the qr on a printed cheque carries. no secrets: a cheque id is public on-chain anyway,
// and only the named payee's wallet can deposit it.
export type Cluster = "devnet" | "mainnet";
export interface ChequeRef { cluster: Cluster; id: string }

const PREFIX = "deadcheque:1:";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function encodeRef(r: ChequeRef): string {
  if (!B58.test(r.id)) throw new Error("bad cheque id");
  return `${PREFIX}${r.cluster}:${r.id}`;
}

/** accepts the raw qr text or a link with ?c=<id>&n=<cluster> */
export function decodeRef(text: string): ChequeRef {
  const t = text.trim();
  if (t.startsWith(PREFIX)) {
    const [cluster, id] = t.slice(PREFIX.length).split(":");
    if ((cluster === "devnet" || cluster === "mainnet") && B58.test(id)) return { cluster, id };
  }
  try {
    const u = new URL(t);
    const id = u.searchParams.get("c") ?? "", n = u.searchParams.get("n") ?? "devnet";
    if ((n === "devnet" || n === "mainnet") && B58.test(id)) return { cluster: n, id };
  } catch { /* not a url */ }
  throw new Error("this qr is not a dead cheque");
}

/** micr-style line for the bottom of the cheque: ⑈no⑈ ⑆id-head⑆ id-tail⑉ */
export function micrLine(no: number, id: string): string {
  return `⑈${String(no).padStart(6, "0")}⑈ ⑆${id.slice(0, 8)}⑆ ${id.slice(-8)}⑉`;
}
