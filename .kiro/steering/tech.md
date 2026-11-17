# tech

- typescript, vite, no framework. node 24 runs `.ts` scripts directly.
- `@solana/web3.js` 1.x, `@solana/spl-token`, `@streamflow/stream` (devnet).
- money is bigint in base units everywhere. never floats.
- no secrets in the repo. demo keys live in the browser's localStorage, devnet only.
- `npm test` (vitest) and `npm run e2e` (devnet) must pass before a commit.
