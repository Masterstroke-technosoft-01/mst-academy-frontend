/* MST DocVerify — verification page. */
(function () {
  "use strict";
  const M = window.MSTDOC;
  const C = M.C;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TX_RE = /^0x[0-9a-fA-F]{64}$/;

  let record = null; // { tx, chain, payload }

  function verdict(kind, title, text) {
    const v = $("verdict");
    v.className = "verdict " + (kind || "");
    $("vIcon").innerHTML = { ok: "✓", bad: "✕", warn: "!", load: '<span class="spinner"></span>' }[kind] || "🔍";
    $("vTitle").textContent = title;
    $("vText").innerHTML = text;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(/T/.test(iso) ? iso : iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }

  function parseInput(s) {
    s = s.trim();
    if (TX_RE.test(s)) return { tx: s, key: null };
    try {
      const u = new URL(s);
      const tx = u.searchParams.get("tx") || (u.pathname.match(/0x[0-9a-fA-F]{64}/) || [])[0];
      const key = new URLSearchParams(u.hash.slice(1)).get("k");
      if (tx && TX_RE.test(tx)) return { tx, key };
    } catch { /* not a URL */ }
    return null;
  }

  function showChain(tx, chain, issuerTrusted) {
    $("chainCard").hidden = false;
    $("explorerLink").href = M.explorerTxUrl(tx);
    const rows = [
      ["Network", `${esc(C.CHAIN_NAME)} (chain ${C.CHAIN_ID})`],
      ["Transaction", `<a class="mono" href="${esc(M.explorerTxUrl(tx))}" target="_blank" rel="noopener">${esc(tx)}</a>`],
    ];
    if (chain) {
      rows.push(["Issued by wallet", `<a class="mono" href="${esc(M.explorerAddressUrl(chain.from))}" target="_blank" rel="noopener">${esc(chain.from)}</a>` +
        (C.TRUSTED_ISSUERS.length ? (issuerTrusted ? '<span class="badge ok">Trusted issuer</span>' : '<span class="badge bad">Unknown issuer</span>') : "")]);
      if (chain.blockNumber != null) rows.push(["Block", esc(chain.blockNumber)]);
      if (chain.timestamp) rows.push(["Recorded at", esc(new Date(chain.timestamp).toLocaleString())]);
      rows.push(["Status", chain.status === "ok" ? "Confirmed" : esc(chain.status)]);
      if (record && record.payload) rows.push(["Stored fingerprint", `<span class="mono">${esc(record.payload.h)}</span>`]);
      rows.push(["Read via", esc(chain.source)]);
    }
    $("chain").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  function showDetails(fields, file) {
    $("detailsCard").hidden = false;
    const rows = M.FIELDS.filter((f) => fields[f.key]).map((f) => [f.label, f.key === "issuedOn" ? fmtDate(fields[f.key]) : fields[f.key]]);
    if (file && file.name) rows.push(["Original file", file.name]);
    $("details").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  }

  function buildManual(prefill) {
    $("manualCard").hidden = false;
    $("manualFields").innerHTML = M.FIELDS.map((f) => `
      <label class="field"><span>${esc(f.label)}${["docId", "recipientName", "signeeName"].includes(f.key) ? " *" : ""}</span>
        <input type="${f.key === "issuedOn" ? "date" : "text"}" name="${f.key}" value="${esc((prefill && prefill[f.key]) || "")}" ${f.key === "docId" ? 'placeholder="MST-XXXX-XXXX"' : ""}></label>`).join("");
  }

  async function run(tx, key) {
    record = null;
    ["detailsCard", "manualCard", "chainCard"].forEach((id) => ($(id).hidden = true));
    $("manualResult").innerHTML = "";
    verdict("load", "Checking MST Blockchain…", "Reading the record for this document.");

    let chain;
    try {
      chain = await M.fetchTransaction(tx);
    } catch (e) {
      showChain(tx, null);
      if (e.notFound) return verdict("bad", "Not verified", `No transaction with this hash exists on ${esc(C.CHAIN_NAME)}.`);
      return verdict("warn", "Could not reach the blockchain", `The record could not be read right now. You can check it directly on the explorer.<br><span class="small">${esc(e.message)}</span>`);
    }
    const trusted = C.TRUSTED_ISSUERS.length ? C.TRUSTED_ISSUERS.includes(String(chain.from).toLowerCase()) : null;

    let payload;
    try {
      if (chain.status === "failed") throw new Error("This transaction failed on chain, so it does not record anything.");
      payload = M.decodePayload(chain.input);
    } catch (e) {
      showChain(tx, chain, trusted);
      return verdict("bad", "Not verified", esc(e.message));
    }
    record = { tx, chain, payload };
    showChain(tx, chain, trusted);

    if (!key) {
      buildManual();
      return verdict("warn", "Record found — check the details",
        "This link has no decryption key, so the details cannot be shown. Enter what is printed on the document below to compare its fingerprint with the blockchain.");
    }

    let secret;
    try {
      secret = await M.decrypt(key, payload.iv, payload.ct);
    } catch {
      buildManual();
      return verdict("bad", "Not verified", "The key in this link does not unlock this record. The link may have been altered.");
    }
    const h = await M.fieldsHash(secret.fields || {});
    showDetails(secret.fields || {}, secret.file);
    if (h !== payload.h) {
      return verdict("bad", "Not verified", "The details do not match the fingerprint stored on chain.");
    }
    const f = secret.fields;
    const issuerNote = trusted === false ? " <strong>Note: the issuing wallet is not on the list of trusted issuers.</strong>" : "";
    verdict(trusted === false ? "warn" : "ok", "Verified",
      `This ${esc(f.title || "document")} for <strong>${esc(f.recipientName)}</strong>, signed by <strong>${esc(f.signeeName)}</strong>, matches its record on ${esc(C.CHAIN_NAME)}.` +
      " Make sure the details below match the document in front of you." + issuerNote);
  }

  $("manualForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!record) return;
    const fd = new FormData(ev.target);
    const fields = Object.fromEntries(M.FIELDS.map((f) => [f.key, fd.get(f.key) || ""]));
    const h = await M.fieldsHash(fields);
    const ok = h === record.payload.h;
    $("manualResult").innerHTML = ok
      ? '<div class="status ok"><strong>✓ Verified.</strong> These details match the fingerprint stored on MST Blockchain.</div>'
      : `<div class="status bad"><strong>✕ Not verified.</strong> These details do not match the record. Check every field, including the document ID, date and any empty fields.<div class="small mono" style="margin-top:6px">Computed: ${esc(h)}</div></div>`;
    if (ok) verdict("ok", "Verified", "The details you entered match the fingerprint stored on MST Blockchain.");
  });

  $("lookupForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const p = parseInput($("lookupInput").value);
    if (!p) return verdict("bad", "That doesn't look right", "Paste a verification link or a 66-character transaction hash starting with 0x.");
    const url = new URL(location.href);
    url.search = "?tx=" + p.tx;
    url.hash = p.key ? "k=" + p.key : "";
    history.replaceState(null, "", url);
    run(p.tx, p.key);
  });

  $("netPill").textContent = `${C.CHAIN_NAME} · ${C.CHAIN_ID}`;
  const tx = new URLSearchParams(location.search).get("tx");
  const key = new URLSearchParams(location.hash.slice(1)).get("k");
  if (tx) {
    $("lookupInput").value = tx;
    if (TX_RE.test(tx)) run(tx, key);
    else verdict("bad", "Not verified", "The transaction hash in this link is malformed.");
  }
})();
