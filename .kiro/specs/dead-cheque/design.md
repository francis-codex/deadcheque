# design: dead cheque

## the trick

a cheque is a streamflow stream with all of the money released in one step on the date:

| cheque | stream field |
|---|---|
| date | `start = cliff = d` |
| amount | `cliffAmount = a − 1`, `amountPerPeriod = 1`, `period = 1` (the last base unit vests one second later) |
| crossed, a/c payee only | `transferableBySender = transferableByRecipient = false` |
| stop payment | `cancelableBySender = true`, everything else false |
| cheque number + memo | stream name `#000042 memo` (≤ 64 bytes) |

status comes from the stream: canceled → stopped, withdrawn = deposited → cleared, now ≥ d → clearable, else post-dated.

on devnet streamflow's crank pays the payee automatically about 2s after the date. so deposit is idempotent: it checks first and returns `{ tx: null }` when the network already cleared it.

## modules

- `src/words.ts`: amounts in figures and words, parse and format, bigint only.
- `src/payload.ts`: qr payload (`dc:devnet:<id>` or a `?c=` link), micr line.
- `src/cheque.ts`: `Chequebook` (write, get, stop, deposit, list) over `SolanaStreamClient`; pure helpers tested in `tests/core.test.ts`.
- `src/wallet.ts`: demo keys in localStorage, demo mint setup, the user's own injected wallet.
- `src/main.ts`: hash routes `#write`, `#book`, `#deposit`, `#c/<id>`; cheque rendering; qr read with jsqr.
- `src/polyfill.ts`: `Buffer` for web3.js in the browser.

## qr reading

draw the photo to a canvas at 1200px, then 800, then 1800, and run jsqr on each until one reads.
