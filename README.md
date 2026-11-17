# dead cheque

cheques died because they bounce. this one can't.

write a post-dated cheque on solana. the money locks the moment you sign. on the date it unlocks for the payee, and until then you can stop payment. print it, hand it over, and the payee deposits it by taking a photo of the qr code.

built for kiroween (resurrection category): a dead payment instrument, brought back.

## how it works

every cheque is a [streamflow](https://streamflow.finance) escrow that releases all of its money in one step on the date:

- **post-dated**: the funds sit in escrow. nobody can touch them.
- **stop payment**: before the date, the writer can cancel and get everything back.
- **a/c payee only**: the escrow isn't transferable, so only the named payee can ever be paid.
- **good for payment**: on the date the funds unlock for the payee.
- **paid**: on devnet the network's crank pays the payee automatically a couple of seconds after the date. if the payee hits deposit after that, the app sees it's already paid and says so. if the crank hasn't run, deposit pays it out.

the printed cheque carries the amount in words, the memo, the writer's on-chain signature, the crossing, a micr line and a qr code pointing at the escrow.

## run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the core
npm run e2e        # writes, stops and clears real cheques on devnet
```

in the app, tap **set up demo**. you get a demo writer and payee with 10,000 test dollars on devnet. switch between them at the top right, or use your own wallet.

if the devnet faucet rate-limits you, the app shows the writer's address. send it 0.5 devnet sol from faucet.solana.com and tap again.

## built with kiro

`.kiro/specs/dead-cheque` has the requirements, design and tasks it was built from. `.kiro/steering` holds the product, tech and structure notes, and `.kiro/hooks` runs the tests on save and keeps the copy lowercase.

## license

mit
