# MST DocVerify

A static app (no build step, no backend) for issuing documents that can be checked against MST Blockchain.

- `index.html` is the editor. Upload a certificate (image or PDF), then drag the recipient name, signee name, signature, an optional stamp and the verification QR onto it. Register the record, then export a PNG or JPG, or copy the verification link.
- `verify.html` is the verification page. The QR opens it. It reads the record from MST Testnet, recomputes the fingerprint and shows **Verified** or **Not verified**, with a link to the transaction on testnet.mstscan.com.

When it is served from the Next.js app, it lives at `/doc-verify` (which redirects to `/doc-verify/index.html`). It also works on any static host.

## How a record works

1. The details (document ID, recipient, signee, title, issuer, issue date) are normalised and hashed with SHA-256. This hash is the fingerprint.
2. The details are encrypted with a random AES-256-GCM key.
3. The issuer's wallet sends a 0-value transaction. Its input data is the UTF-8 text
   `MSTDOC1:{"v":1,"h":<fingerprint>,"iv":…,"ct":<encrypted details>}`.
4. The QR and the verification link have the form `verify.html?tx=<hash>#k=<key>`. Browsers never send the `#k=` part to a server.
5. To verify, the page fetches the transaction, decrypts the details with the key, re-hashes them and compares the result with `h`. If a link has no key, the verifier types in the details printed on the document, and the page compares the hash of those instead.

## Configuration

Everything chain-specific is in `config.js`. Before going live:

- `CHAIN_ID`: set to the official MST Testnet chain ID. The default, 4545, comes from the course material.
- `RPC_URL`: set to a public MST Testnet RPC. The verification page uses it to read records without a wallet, and the editor uses it to add the network to a wallet.
- `EXPLORER_API`: the verification page falls back to the explorer's Blockscout-style `/api/v2/transactions/<hash>`. Set this to `false` if the explorer has no such API.
- `VERIFY_PAGE_URL`: set this if you create documents from somewhere other than the deployed site. Otherwise QR codes made on `localhost` will point to `localhost`.
- `TRUSTED_ISSUERS`: a list of issuer wallet addresses. When it is set, the verification page flags records from any other wallet.

To issue documents, you need a browser wallet (such as MetaMask or BridgeKey) holding testnet MST for gas.
