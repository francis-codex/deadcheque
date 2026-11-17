import "./polyfill.ts";
import "./style.css";
import { Connection, PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Chequebook, RPC, fmtDate, type Cheque, type Signer, type Status } from "./cheque.ts";
import { encodeRef, decodeRef, micrLine } from "./payload.ts";
import { amountInWords, formatAmount, parseAmount } from "./words.ts";
import { demoKey, demoMint, setupDemo, connectInjected, injected, nextNo, tokenBalance, decimalsOf, type Role } from "./wallet.ts";

const CLUSTER = "devnet" as const;
const conn = new Connection(RPC[CLUSTER], "confirmed");
const book = new Chequebook(CLUSTER);
const $ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const view = $("#view");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const explorer = (kind: "address" | "tx", v: string) => `https://explorer.solana.com/${kind}/${v}?cluster=${CLUSTER}`;

// ---------- who is signing ----------
let signer: Signer = demoKey("writer");
let mode: Role | "wallet" = "writer";
const me = () => signer.publicKey.toBase58();
const decCache = new Map<string, number>();
const decimals = async (mint: string) => decCache.get(mint) ?? decCache.set(mint, await decimalsOf(conn, mint).catch(() => 6)).get(mint)!;

async function refreshBalance() {
  const mint = demoMint();
  const bal = $("#bal");
  if (!mint) { bal.innerHTML = `<button class="link" id="setup">set up demo</button>`; $("#setup").onclick = () => runSetup(); return; }
  const b = await tokenBalance(conn, signer.publicKey, mint);
  bal.textContent = `${short(me())} · $${formatAmount(b, await decimals(mint))}`;
}

function note(msg: string, kind: "info" | "error" | "ok" = "info") {
  const n = $("#note");
  n.hidden = !msg; n.className = `note no-print ${kind}`; n.textContent = msg;
}
async function busy<T>(btn: HTMLButtonElement | null, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const was = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await fn(); }
  catch (e: any) { note(friendly(e), "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = was!; } }
}
function friendly(e: any): string {
  const m = String(e?.message ?? e);
  if (/insufficient (funds|lamports)|0x1\b/i.test(m)) return "not enough balance for this cheque (plus a small network fee).";
  if (/User rejected|rejected the request/i.test(m)) return "you cancelled in your wallet.";
  return m;
}

async function runSetup() {
  note("setting up the demo accounts on devnet…");
  await busy(null, "", async () => {
    await setupDemo(conn, (s) => note(s));
    note("demo ready: the writer has 10,000 test dollars.", "ok");
    await refreshBalance();
    route();
  });
}

$<HTMLSelectElement>("#acct").onchange = async (ev) => {
  const v = (ev.target as HTMLSelectElement).value as Role | "wallet";
  try {
    signer = v === "wallet" ? await connectInjected() : demoKey(v);
    mode = v;
    note("");
  } catch (e: any) {
    note(friendly(e), "error");
    (ev.target as HTMLSelectElement).value = mode;
  }
  await refreshBalance();
  route();
};
if (!injected()) $<HTMLOptionElement>('#acct option[value="wallet"]').disabled = true;

// ---------- the cheque itself ----------
const STAMP: Record<Status, string> = { "post-dated": "post-dated", clearable: "good for payment", cleared: "paid", stopped: "payment stopped" };

interface Face { no: number; payer: string; payee: string; amount: bigint; dec: number; date: number; memo: string; id?: string; status?: Status }

async function chequeHTML(f: Face): Promise<string> {
  const qr = f.id ? await QRCode.toDataURL(encodeRef({ cluster: CLUSTER, id: f.id }), { margin: 1, width: 220, color: { dark: "#14110f", light: "#00000000" } }) : "";
  return `
  <article class="cheque ${f.status ?? "draft"}">
    <div class="guilloche" aria-hidden="true"></div>
    <header>
      <div class="bank"><span class="mark">✠</span> dead cheque<small>settles on solana ${CLUSTER}</small></div>
      <div class="no">no. ${String(f.no).padStart(6, "0")}</div>
    </header>
    <div class="row date"><label>date</label><span class="line">${f.date ? fmtDate(f.date) : "—"}</span></div>
    <div class="row payee"><label>pay to the order of</label><span class="line mono">${f.payee ? esc(f.payee) : "—"}</span>
      <span class="box">$ ${formatAmount(f.amount, f.dec)}</span></div>
    <div class="row words"><span class="line">${f.amount ? esc(amountInWords(f.amount, f.dec)) : "—"}</span><label>dollars</label></div>
    <div class="row bottom">
      <div class="memo"><label>memo</label><span class="line">${esc(f.memo || "")}</span></div>
      <div class="sig"><span class="line mono">${f.payer ? short(f.payer) : ""}</span><label>signed on-chain by the writer</label></div>
    </div>
    <div class="crossed" aria-label="crossed: payee only">a/c payee only</div>
    ${qr ? `<img class="qr" src="${qr}" alt="qr code to deposit this cheque" />` : ""}
    <div class="micr">${f.id ? micrLine(f.no, f.id) : "⑈000000⑈ ⑆········⑆ ········⑉"}</div>
    ${f.status ? `<div class="stamp s-${f.status}">${STAMP[f.status]}</div>` : ""}
  </article>`;
}

// ---------- views ----------
function localInput(unix: number) {
  const d = new Date(unix * 1000); d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function viewWrite() {
  const mint = demoMint();
  if (!mint) {
    view.innerHTML = `<section class="card empty"><h1>write a cheque that can't bounce</h1>
      <p>the money is locked when you sign. the payee can deposit it on the date, and you can stop payment until then.</p>
      <button id="go" class="primary">set up the demo (devnet)</button></section>`;
    $("#go").onclick = () => runSetup();
    return;
  }
  const dec = await decimals(mint);
  const no = Number(sessionStorageGet("dc:draftNo") ?? 0) || nextNo();
  sessionStorageSet("dc:draftNo", String(no));
  view.innerHTML = `
  <section class="split">
    <form id="f" class="card form" autocomplete="off">
      <h1>write a cheque</h1>
      <label>pay to <input name="payee" placeholder="payee's solana address" required spellcheck="false" />
        <button type="button" class="link" id="usePayee">use the demo payee</button></label>
      <label>amount (test dollars) <input name="amount" inputmode="decimal" placeholder="125.50" required /></label>
      <label>date it for <input name="date" type="datetime-local" required value="${localInput(Date.now() / 1000 + 120)}" /></label>
      <label>memo <input name="memo" maxlength="40" placeholder="rent, march" /></label>
      <p class="fine">signing locks the amount on-chain. it unlocks for the payee on the date. you can stop payment any time before.</p>
      <button class="primary" id="sign">sign cheque</button>
    </form>
    <div id="preview" class="preview"></div>
  </section>`;
  const f = $<HTMLFormElement>("#f");
  const face = (): Face => {
    const d = new FormData(f);
    let amount = 0n; try { amount = parseAmount(String(d.get("amount") || "0"), dec); } catch { /* keep 0 while typing */ }
    const dt = String(d.get("date") || "");
    return { no, payer: me(), payee: String(d.get("payee") || "").trim(), amount, dec, date: dt ? Math.floor(new Date(dt).getTime() / 1000) : 0, memo: String(d.get("memo") || "").toLowerCase() };
  };
  const paint = async () => { $("#preview").innerHTML = await chequeHTML(face()); };
  f.oninput = paint; await paint();
  $("#usePayee").onclick = () => { (f.elements.namedItem("payee") as HTMLInputElement).value = demoKey("payee").publicKey.toBase58(); paint(); };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const x = face();
    await busy($<HTMLButtonElement>("#sign"), "signing…", async () => {
      const amount = parseAmount(String(new FormData(f).get("amount")), dec);
      const r = await book.write({ payee: x.payee, mint, amount, date: x.date, no, memo: x.memo }, signer);
      sessionStorageSet("dc:draftNo", "");
      note(`cheque no. ${String(no).padStart(6, "0")} signed. print it or send the photo to the payee.`, "ok");
      location.hash = `#c/${r.id}`;
    });
  };
}

async function viewCheque(id: string) {
  view.innerHTML = `<p class="loading">reading cheque…</p>`;
  let c: Cheque;
  try { c = await book.get(id); } catch { view.innerHTML = `<section class="card empty"><h1>no cheque here</h1><p>this code doesn't point to a dead cheque on ${CLUSTER}.</p></section>`; return; }
  const dec = await decimals(c.mint); void refreshBalance();
  const isPayer = c.payer === me(), isPayee = c.payee === me();
  view.innerHTML = `
  <section class="sheet">${await chequeHTML({ ...c, dec })}</section>
  <section class="actions no-print">
    <p class="status">${statusLine(c, dec)}</p>
    <div class="btns">
      <button id="print">print</button>
      ${isPayer && c.status === "post-dated" ? `<button id="stop" class="danger">stop payment</button>` : ""}
      ${isPayee && c.status === "clearable" ? `<button id="dep" class="primary">deposit now</button>` : ""}
      <a class="btn" href="${explorer("address", c.id)}" target="_blank" rel="noopener">view on explorer</a>
    </div>
  </section>`;
  $("#print").onclick = () => print();
  const stop = $<HTMLButtonElement>("#stop");
  if (stop) stop.onclick = () => busy(stop, "stopping…", async () => {
    const tx = await book.stop(c.id, signer);
    note(`payment stopped. ${formatAmount(c.amount, dec)} is back in your account.`, "ok");
    void tx; await refreshBalance(); viewCheque(id);
  });
  const dep = $<HTMLButtonElement>("#dep");
  if (dep) dep.onclick = () => busy(dep, "depositing…", async () => {
    const r = await book.deposit(c.id, signer);
    note(r.tx ? "deposited. the money is in your account." : "already paid into your account by the network.", "ok");
    await refreshBalance(); viewCheque(id);
  });
  if (c.status === "post-dated") tick(c.date, () => viewCheque(id));
}

function statusLine(c: Cheque, dec: number) {
  const amt = `$${formatAmount(c.amount, dec)}`;
  switch (c.status) {
    case "post-dated": return `${amt} locked for ${short(c.payee)} until ${fmtDate(c.date)}. <span id="count"></span>`;
    case "clearable": return `${amt} is good for payment. only ${short(c.payee)} can deposit it.`;
    case "cleared": return `paid: ${amt} went to ${short(c.payee)}.`;
    case "stopped": return `payment stopped on ${fmtDate(c.stoppedAt)}. the money went back to the writer.`;
  }
}

let timer = 0;
function tick(date: number, done: () => void) {
  clearInterval(timer);
  const run = () => {
    const left = date - Math.floor(Date.now() / 1000);
    const el = $("#count");
    if (!el) return clearInterval(timer);
    if (left <= 0) { clearInterval(timer); setTimeout(done, 4000); el.textContent = "maturing…"; return; }
    const d = Math.floor(left / 86400), h = Math.floor(left / 3600) % 24, m = Math.floor(left / 60) % 60, s = left % 60;
    el.textContent = `matures in ${d ? `${d}d ` : ""}${h ? `${h}h ` : ""}${m}m ${s}s`;
  };
  run(); timer = window.setInterval(run, 1000);
}

async function viewBook() {
  view.innerHTML = `<p class="loading">reading your chequebook…</p>`;
  const [out, inc] = await Promise.all([book.list(me(), "outgoing").catch(() => []), book.list(me(), "incoming").catch(() => [])]);
  const rows = async (cs: Cheque[], who: "payee" | "payer") => cs.length ? (await Promise.all(cs.map(async (c) => `
    <a class="row-item" href="#c/${c.id}">
      <span class="mono">no. ${String(c.no).padStart(6, "0")}</span>
      <span>${who === "payee" ? "to" : "from"} ${short(c[who])}${c.memo ? ` · ${esc(c.memo)}` : ""}</span>
      <span class="amt">$${formatAmount(c.amount, await decimals(c.mint))}</span>
      <span class="chip s-${c.status}">${c.status}</span>
      <span class="when">${fmtDate(c.date)}</span>
    </a>`))).join("") : `<p class="fine">none yet.</p>`;
  view.innerHTML = `
    <section class="card"><h1>written</h1>${await rows(out, "payee")}</section>
    <section class="card"><h1>received</h1>${await rows(inc, "payer")}</section>`;
}

function viewDeposit() {
  view.innerHTML = `
  <section class="card form">
    <h1>deposit a cheque</h1>
    <p>take a photo of the cheque, or pick one from your gallery. we read the code in the corner.</p>
    <label class="drop"><input type="file" id="photo" accept="image/*" capture="environment" /><span>take or choose a photo</span></label>
    <details><summary>or paste the code</summary>
      <form id="paste"><input name="code" placeholder="deadcheque:1:devnet:…" spellcheck="false" /><button>open</button></form>
    </details>
  </section>`;
  $<HTMLInputElement>("#photo").onchange = async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    note("reading the photo…");
    try { const ref = decodeRef(await readQR(file)); note(""); location.hash = `#c/${ref.id}`; }
    catch (e: any) { note(friendly(e), "error"); }
  };
  $<HTMLFormElement>("#paste").onsubmit = (ev) => {
    ev.preventDefault();
    try { location.hash = `#c/${decodeRef(String(new FormData(ev.target as HTMLFormElement).get("code"))).id}`; }
    catch (e: any) { note(friendly(e), "error"); }
  };
}

/** decode a qr from a photo. phone photos are big: scale down, then try a couple of sizes */
async function readQR(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  for (const max of [1200, 800, 1800]) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const hit = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" });
    if (hit?.data) return hit.data;
  }
  throw new Error("couldn't find the cheque's code in that photo. get the whole cheque in frame, in good light.");
}

function sessionStorageGet(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* fine */ } }

// ---------- router ----------
function route() {
  clearInterval(timer);
  const h = location.hash || "#write";
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", h.startsWith((a as HTMLAnchorElement).hash)));
  const m = /^#c\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(h);
  if (m) { try { new PublicKey(m[1]); return void viewCheque(m[1]); } catch { /* fall through */ } }
  if (h === "#book") return void viewBook();
  if (h === "#deposit") return void viewDeposit();
  return void viewWrite();
}
// deep link from a qr scanned with the phone camera: ?c=<id>
const q = new URLSearchParams(location.search).get("c");
if (q) { history.replaceState(null, "", location.pathname + `#c/${q}`); }
addEventListener("hashchange", route);
refreshBalance();
route();
