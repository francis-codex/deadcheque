# requirements: dead cheque

a paper cheque, brought back from the dead, that can't bounce.

## user stories (ears)

1. **write.** when the writer signs a cheque for amount a, payee p and date d, the system shall lock a in escrow on solana, so the cheque cannot bounce.
2. **post-date.** while now < d, the system shall show the cheque as post-dated and shall not release funds to anyone.
3. **crossed.** the system shall make every cheque "a/c payee only": not transferable, payable only to p.
4. **stop payment.** while the cheque is post-dated, when the writer stops payment, the system shall return the whole amount to the writer and mark it stopped.
5. **no stop after the date.** when now ≥ d, the system shall not let the writer stop payment.
6. **deposit.** when now ≥ d and the payee deposits, the system shall send the amount to p. if the network has already cleared it, deposit shall succeed with no transaction.
7. **print.** the system shall render a printable cheque (date, payee, amount in figures and words, memo, signature, crossing, micr line) with a qr code that points to the on-chain cheque.
8. **deposit by photo.** when the payee uploads a photo of a printed cheque, the system shall read the qr code and open that cheque.
9. **chequebook.** the system shall list cheques written and received, with status: post-dated, good for payment, paid, payment stopped.
10. **demo.** the system shall run on devnet with a one-tap demo writer, demo payee and test dollars, and shall also accept the user's own wallet.

## non-goals (v0)

- mainnet, real dollars, fees.
- bouncing. the whole point is that it can't.
