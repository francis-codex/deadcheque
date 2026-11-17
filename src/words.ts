// amount in words, the way a cheque writes it: "one hundred twenty-five and 50/100"
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [bigint, string][] = [[1_000_000_000_000n, "trillion"], [1_000_000_000n, "billion"], [1_000_000n, "million"], [1_000n, "thousand"]];

function under1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) out.push(ONES[n]);
  return out.join(" ");
}

export function wholeToWords(n: bigint): string {
  if (n === 0n) return "zero";
  const out: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) { out.push(`${wholeToWords(n / size)} ${name}`); n %= size; }
  }
  if (n > 0n) out.push(under1000(Number(n)));
  return out.join(" ");
}

/** base units -> "one hundred twenty-five and 50/100" (cents rounded down) */
export function amountInWords(base: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = base / unit;
  const cents = decimals >= 2 ? (base % unit) / 10n ** BigInt(decimals - 2) : 0n;
  return `${wholeToWords(whole)} and ${cents.toString().padStart(2, "0")}/100`;
}

/** base units -> "1,250.50" */
export function formatAmount(base: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = (base / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = decimals >= 2 ? ((base % unit) / 10n ** BigInt(decimals - 2)).toString().padStart(2, "0") : "00";
  return `${whole}.${cents}`;
}

/** "1,250.5" -> base units. throws on junk or more precision than the mint has. */
export function parseAmount(text: string, decimals: number): bigint {
  const s = text.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("enter an amount like 125.50");
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) throw new Error(`at most ${decimals} decimal places`);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}
