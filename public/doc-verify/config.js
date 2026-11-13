/*
 * MST DocVerify — network configuration.
 *
 * Everything chain-specific lives here so the app stays a plain static site.
 * Values marked "CONFIRM" could not be checked against official MST docs when
 * this was written; set them to the published MST Testnet values.
 */
window.MSTDOC_CONFIG = {
  // Network the document records are written to.
  CHAIN_ID: 4545, // CONFIRM: MST Testnet chain id (MST Academy course material lists 4545).
  CHAIN_NAME: "MST Testnet",
  CURRENCY: { name: "MST", symbol: "MST", decimals: 18 },

  // Public JSON-RPC endpoint. Used to read records on the verification page
  // (no wallet needed) and to add the network to the issuer's wallet.
  // Leave empty to rely on the explorer API and the visitor's wallet instead.
  RPC_URL: "", // CONFIRM: e.g. "https://<mst-testnet-rpc-host>"

  // Block explorer. QR codes and links point here.
  EXPLORER_URL: "https://testnet.mstscan.com",
  // Explorer transaction page path; "{tx}" is replaced by the transaction hash.
  EXPLORER_TX_PATH: "/tx/{tx}",
  // Blockscout-style REST API on the explorer, tried when RPC_URL is empty
  // or unreachable. Set to false if the explorer has no such API.
  EXPLORER_API: true,

  // Where records are sent. Empty = the issuer's own address (a 0-value
  // self-transaction that only carries the record in its input data).
  ANCHOR_ADDRESS: "",

  // Absolute URL of verify.html once deployed, e.g.
  // "https://academy.example.com/doc-verify/verify.html". Empty = derived from
  // where the editor is opened (fine in production, not on localhost).
  VERIFY_PAGE_URL: "",

  // Lower-cased wallet addresses of official issuers. When non-empty the
  // verification page also says whether the record came from one of them.
  TRUSTED_ISSUERS: [],
};
