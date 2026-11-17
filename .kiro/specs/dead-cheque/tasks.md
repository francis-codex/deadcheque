# tasks

- [x] 1. words: amount in figures ↔ words, bigint safe (req 7)
- [x] 2. payload: qr encode/decode, micr line (req 7, 8)
- [x] 3. cheque core: stream params, name, validate, status (req 1–6)
- [x] 4. chequebook over streamflow devnet: write, get, stop, deposit (idempotent), list (req 1–6, 9)
- [x] 5. e2e on devnet: write → stop, write → wait → clear (`npm run e2e`)
- [x] 6. demo wallet: writer, payee, test mint; the user's own wallet (req 10)
- [x] 7. ui: write with live preview, cheque view, chequebook, deposit by photo (req 7–9)
- [x] 8. print css (req 7)
- [x] 9. unit tests (`npm test`)
- [ ] 10. deploy the static build
