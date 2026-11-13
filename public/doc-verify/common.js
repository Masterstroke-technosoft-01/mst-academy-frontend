/*
 * MST DocVerify — shared helpers: hashing, encryption, on-chain payload
 * format, chain reads and QR rendering. Used by both the editor and the
 * verification page.
 *
 * Record format (transaction input data, UTF-8):
 *   MSTDOC1:{"v":1,"h":"<sha256 hex of canonical fields>","iv":"<b64url>","ct":"<b64url>"}
 *
 *   h  — fingerprint of the document's details, recomputed on verification.
 *   ct — the details themselves, AES-256-GCM encrypted. The key never goes
 *        on chain; it travels only in the verification link's #fragment
 *        (fragments are not sent to any server).
 */
(function () {
  "use strict";
  const C = window.MSTDOC_CONFIG;
  const te = new TextEncoder();
  const td = new TextDecoder();
  const PREFIX = "MSTDOC1:";

  /* ---------- encoding ---------- */
  function toHex(bytes) {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }
  function fromHex(hex) {
    hex = hex.replace(/^0x/i, "");
    if (hex.length % 2) throw new Error("Bad hex");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function b64u(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const s = atob(str);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }

  /* ---------- hashing ---------- */
  async function sha256Hex(data) {
    const buf = typeof data === "string" ? te.encode(data) : data;
    return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));
  }

  // Fields that make up a document's fingerprint, in fixed order.
  const FIELDS = [
    { key: "docId", label: "Document ID" },
    { key: "recipientName", label: "Recipient" },
    { key: "signeeName", label: "Signed by" },
    { key: "title", label: "Title" },
    { key: "issuer", label: "Issuing organisation" },
    { key: "issuedOn", label: "Issued on" },
  ];
  // Case-insensitive for words so a verifier can type what they read off
  // the document; whitespace is collapsed and Unicode normalised.
  const CASE_FOLD = new Set(["recipientName", "signeeName", "title", "issuer"]);
  function normalise(key, v) {
    let s = String(v ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
    if (CASE_FOLD.has(key)) s = s.toLowerCase();
    if (key === "docId") s = s.toUpperCase();
    return s;
  }
  function canonical(fields) {
    const o = {};
    for (const { key } of FIELDS) o[key] = normalise(key, fields[key]);
    return JSON.stringify(o);
  }
  function fieldsHash(fields) {
    return sha256Hex("MSTDOC1|" + canonical(fields));
  }

  /* ---------- encryption ---------- */
  async function encrypt(obj) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
    return { key: b64u(raw), iv: b64u(iv), ct: b64u(new Uint8Array(ct)) };
  }
  async function decrypt(keyB64, ivB64, ctB64) {
    const key = await crypto.subtle.importKey("raw", unb64u(keyB64), "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(ivB64) }, key, unb64u(ctB64));
    return JSON.parse(td.decode(pt));
  }

  /* ---------- payload ---------- */
  function encodePayload({ h, iv, ct }) {
    return "0x" + toHex(te.encode(PREFIX + JSON.stringify({ v: 1, h, iv, ct })));
  }
  function decodePayload(inputHex) {
    if (!inputHex || inputHex === "0x") throw new Error("This transaction carries no data.");
    let s;
    try {
      s = td.decode(fromHex(inputHex));
    } catch {
      throw new Error("This transaction's data is not a document record.");
    }
    if (!s.startsWith(PREFIX)) throw new Error("This transaction is not an MST document record.");
    const p = JSON.parse(s.slice(PREFIX.length));
    if (p.v !== 1 || !/^[0-9a-f]{64}$/.test(p.h)) throw new Error("Unsupported document record format.");
    return p;
  }

  /* ---------- links ---------- */
  function explorerTxUrl(tx) {
    return C.EXPLORER_URL.replace(/\/$/, "") + C.EXPLORER_TX_PATH.replace("{tx}", tx);
  }
  function explorerAddressUrl(addr) {
    return C.EXPLORER_URL.replace(/\/$/, "") + "/address/" + addr;
  }
  function verifyUrl(tx, key) {
    const base = C.VERIFY_PAGE_URL || new URL("verify.html", location.href).href.split(/[?#]/)[0];
    return base + "?tx=" + tx + (key ? "#k=" + key : "");
  }

  /* ---------- chain reads ---------- */
  async function rpc(url, method, params) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!r.ok) throw new Error("RPC HTTP " + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "RPC error");
    return j.result;
  }

  async function readViaRpc(call, hash) {
    const tx = await call("eth_getTransactionByHash", [hash]);
    if (!tx) return null;
    let status = "pending", timestamp = null;
    if (tx.blockNumber) {
      const rc = await call("eth_getTransactionReceipt", [hash]).catch(() => null);
      status = rc ? (rc.status === "0x1" ? "ok" : "failed") : "ok";
      const blk = await call("eth_getBlockByNumber", [tx.blockNumber, false]).catch(() => null);
      if (blk) timestamp = new Date(parseInt(blk.timestamp, 16) * 1000).toISOString();
    }
    return {
      from: tx.from, to: tx.to, input: tx.input,
      blockNumber: tx.blockNumber ? parseInt(tx.blockNumber, 16) : null,
      status, timestamp,
    };
  }

  // Tries, in order: configured RPC, explorer REST API, the visitor's wallet.
  async function fetchTransaction(hash) {
    const errors = [];
    if (C.RPC_URL) {
      try {
        const t = await readViaRpc((m, p) => rpc(C.RPC_URL, m, p), hash);
        if (t) return { ...t, source: "RPC" };
        errors.push("RPC: transaction not found");
      } catch (e) { errors.push("RPC: " + e.message); }
    }
    if (C.EXPLORER_API) {
      try {
        const r = await fetch(C.EXPLORER_URL.replace(/\/$/, "") + "/api/v2/transactions/" + hash, {
          headers: { accept: "application/json" },
        });
        if (r.status === 404) errors.push("Explorer: transaction not found");
        else if (!r.ok) errors.push("Explorer: HTTP " + r.status);
        else {
          const j = await r.json();
          return {
            from: j.from && j.from.hash, to: j.to && j.to.hash, input: j.raw_input,
            blockNumber: j.block ?? j.block_number ?? null,
            status: j.status === "ok" ? "ok" : j.status === "error" ? "failed" : j.status || "ok",
            timestamp: j.timestamp || null, source: "Explorer",
          };
        }
      } catch (e) { errors.push("Explorer: " + e.message); }
    }
    if (window.ethereum) {
      try {
        const eth = window.ethereum;
        const cid = await eth.request({ method: "eth_chainId" });
        if (parseInt(cid, 16) !== C.CHAIN_ID) errors.push("Wallet: connected to a different network");
        else {
          const t = await readViaRpc((m, p) => eth.request({ method: m, params: p }), hash);
          if (t) return { ...t, source: "Wallet" };
          errors.push("Wallet: transaction not found");
        }
      } catch (e) { errors.push("Wallet: " + e.message); }
    }
    if (!errors.length) errors.push("No way to read the chain is configured (set RPC_URL in config.js).");
    const err = new Error(errors.join(" · "));
    // A source that answered "not found" is authoritative; others may simply be unreachable.
    err.notFound = errors.some((e) => /not found/.test(e));
    throw err;
  }

  /* ---------- QR ---------- */
  // Renders text into a canvas with a white quiet zone. Needs qrcode-generator.
  function qrCanvas(text, px, dark = "#000000") {
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.max(1, Math.floor(px / (n + quiet * 2)));
    const size = cell * (n + quiet * 2);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, size, size);
    g.fillStyle = dark;
    for (let r = 0; r < n; r++)
      for (let k = 0; k < n; k++)
        if (qr.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    return c;
  }

  function shortHex(h, a = 6, b = 4) {
    return h && h.length > a + b + 2 ? h.slice(0, a + 2) + "…" + h.slice(-b) : h || "";
  }

  window.MSTDOC = {
    C, FIELDS, canonical, fieldsHash, sha256Hex, encrypt, decrypt,
    encodePayload, decodePayload, explorerTxUrl, explorerAddressUrl, verifyUrl,
    fetchTransaction, qrCanvas, shortHex, normalise,
  };
})();
