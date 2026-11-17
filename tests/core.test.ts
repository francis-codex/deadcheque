import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Keypair } from "@solana/web3.js";
import { amountInWords, formatAmount, parseAmount, wholeToWords } from "../src/words.ts";
import { encodeRef, decodeRef, micrLine } from "../src/payload.ts";
import { chequeName, parseName, validate, streamParams, statusOf } from "../src/cheque.ts";

const ID = Keypair.generate().publicKey.toBase58();
const NOW = 1_800_000_000;

describe("words", () => {
  it("writes whole numbers", () => {
    expect(wholeToWords(0n)).toBe("zero");
    expect(wholeToWords(21n)).toBe("twenty-one");
    expect(wholeToWords(1_000_001n)).toBe("one million one");
  });
  it("writes cheque amounts", () => expect(amountInWords(125_500_000n, 6)).toBe("one hundred twenty-five and 50/100"));
  it("formats", () => expect(formatAmount(1_250_500_000n, 6)).toBe("1,250.50"));
  it("parses", () => {
    expect(parseAmount("125.5", 6)).toBe(125_500_000n);
    expect(parseAmount("1,000", 6)).toBe(1_000_000_000n);
    expect(() => parseAmount("abc", 6)).toThrow();
    expect(() => parseAmount("1.0000001", 6)).toThrow();
  });
});

describe("qr payload", () => {
  it("round trips", () => expect(decodeRef(encodeRef({ cluster: "devnet", id: ID }))).toEqual({ cluster: "devnet", id: ID }));
  it("reads a link", () => expect(decodeRef(`https://x.test/?c=${ID}`)).toEqual({ cluster: "devnet", id: ID }));
  it("rejects anything else", () => {
    expect(() => decodeRef("hello")).toThrow("not a dead cheque");
    expect(() => decodeRef("deadcheque:1:testnet:" + ID)).toThrow();
  });
  it("micr line", () => expect(micrLine(42, ID)).toBe(`⑈000042⑈ ⑆${ID.slice(0, 8)}⑆ ${ID.slice(-8)}⑉`));
});

describe("cheque", () => {
  const base = { payee: ID, mint: ID, amount: 125_500_000n, date: NOW + 3600, no: 7, memo: "Rent" };
  it("names round trip", () => expect(parseName(chequeName(7, "Rent"))).toEqual({ no: 7, memo: "rent" }));
  it("names fit 64 bytes", () => expect(new TextEncoder().encode(chequeName(1, "x".repeat(200))).length).toBeLessThanOrEqual(64));
  it("validates", () => {
    expect(() => validate(base, NOW)).not.toThrow();
    expect(() => validate({ ...base, payee: "nope" }, NOW)).toThrow("payee");
    expect(() => validate({ ...base, amount: 1n }, NOW)).toThrow("small");
    expect(() => validate({ ...base, date: NOW + 10 }, NOW)).toThrow("date");
    expect(() => validate({ ...base, no: 0 }, NOW)).toThrow("number");
  });
  it("locks everything until the date, crossed, stoppable by writer only", () => {
    const p = streamParams(base);
    expect(p.cliff).toBe(base.date);
    expect(p.cliffAmount.add(p.amountPerPeriod).toString()).toBe(base.amount.toString());
    expect([p.cancelableBySender, p.cancelableByRecipient, p.transferableByRecipient, p.transferableBySender]).toEqual([true, false, false, false]);
  });
  it("status", () => {
    const s = { canceledAt: 0, withdrawnAmount: new BN(0), depositedAmount: new BN(100), cliff: NOW + 10 };
    expect(statusOf(s, NOW)).toBe("post-dated");
    expect(statusOf(s, NOW + 10)).toBe("clearable");
    expect(statusOf({ ...s, withdrawnAmount: new BN(100) }, NOW + 20)).toBe("cleared");
    expect(statusOf({ ...s, canceledAt: NOW + 5 }, NOW + 20)).toBe("stopped");
  });
});
