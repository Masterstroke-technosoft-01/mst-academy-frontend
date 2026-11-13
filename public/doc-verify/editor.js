/* MST DocVerify — document editor. */
(function () {
  "use strict";
  const M = window.MSTDOC;
  const C = M.C;
  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }

  /* ================= state ================= */
  const FONTS = [
    { v: "Great Vibes", label: "Great Vibes (script)" },
    { v: "Dancing Script", label: "Dancing Script" },
    { v: "Playfair Display", label: "Playfair Display" },
    { v: "Cinzel", label: "Cinzel" },
    { v: "Inter", label: "Inter (sans)" },
    { v: "Georgia", label: "Georgia (serif)" },
  ];

  // Positions are fractions of the document: x, y = centre; w and size are
  // fractions of the document width, so layouts survive page/size changes.
  const ELEMENTS = [
    { id: "recipient", label: "Recipient name", kind: "text", field: "recipientName",
      d: { on: true, x: 0.5, y: 0.47, size: 0.06, font: "Great Vibes", color: "#1f2937", bold: false } },
    { id: "signature", label: "Signature", kind: "image", input: "sigInput",
      d: { on: false, x: 0.27, y: 0.74, w: 0.16, cutout: true } },
    { id: "signee", label: "Signee name", kind: "text", field: "signeeName",
      d: { on: true, x: 0.27, y: 0.82, size: 0.02, font: "Inter", color: "#111827", bold: true } },
    { id: "stamp", label: "Official stamp", tag: "optional", kind: "image", input: "stampInput",
      d: { on: false, x: 0.73, y: 0.76, w: 0.13, cutout: false, seal: "#1d4ed8" } },
    { id: "qr", label: "Verification QR", kind: "qr",
      d: { on: true, x: 0.89, y: 0.83, w: 0.1, color: "#000000" } },
    { id: "date", label: "Issue date", tag: "optional", kind: "text",
      d: { on: false, x: 0.73, y: 0.9, size: 0.016, font: "Inter", color: "#374151", bold: false } },
    { id: "docid", label: "Document ID", tag: "optional", kind: "text",
      d: { on: false, x: 0.5, y: 0.95, size: 0.012, font: "Inter", color: "#6b7280", bold: false } },
  ];
  const DEF = Object.fromEntries(ELEMENTS.map((e) => [e.id, e]));

  const state = {
    doc: null, // { name, fileHash, W, H, pdf?, page }
    els: Object.fromEntries(ELEMENTS.map((e) => [e.id, { ...e.d, src: null, raw: null, generated: false }])),
    selected: null,
    account: null,
    reg: null, // { tx, key, h, from, fields }
    busy: false,
  };

  /* ================= helpers ================= */
  function toast(msg, ms = 2600) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), ms);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function newDocId() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const r = crypto.getRandomValues(new Uint8Array(8));
    const s = Array.from(r, (b) => a[b % a.length]).join("");
    return "MST-" + s.slice(0, 4) + "-" + s.slice(4);
  }
  function today() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read that image."));
      i.src = src;
    });
  }
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  const FIELD_KEYS = ["recipientName", "signeeName", "title", "issuer", "issuedOn", "docId"];
  function getFields() {
    const o = {};
    for (const k of FIELD_KEYS) o[k] = $("f_" + k).value.trim().replace(/\s+/g, " ");
    return o;
  }

  function textFor(id) {
    const f = getFields();
    switch (id) {
      case "recipient": return f.recipientName || "Recipient Name";
      case "signee": return f.signeeName || "Signee Name";
      case "date": return f.issuedOn ? "Issued on " + fmtDate(f.issuedOn) : "Issued on —";
      case "docid": return "Document ID: " + f.docId;
    }
    return "";
  }
  function isPlaceholder(id) {
    const f = getFields();
    return (id === "recipient" && !f.recipientName) || (id === "signee" && !f.signeeName);
  }
  function fontCss(e, px) {
    return `${e.bold ? 700 : 400} ${px}px "${e.font}", Georgia, serif`;
  }

  /* ================= image processing ================= */
  // Makes near-white pixels transparent (for scanned signatures).
  async function cutout(src) {
    const img = await loadImage(src);
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      if (lum > 225) p[i + 3] = 0;
      else if (lum > 170) p[i + 3] = Math.min(p[i + 3], Math.round(((225 - lum) / 55) * 255));
    }
    g.putImageData(d, 0, 0);
    return c.toDataURL("image/png");
  }

  // Draws a round official seal from the issuer name.
  function sealDataURL(text, color) {
    const S = 600, c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    g.translate(S / 2, S / 2);
    g.strokeStyle = g.fillStyle = color;
    g.globalAlpha = 0.9;
    g.lineWidth = 14; g.beginPath(); g.arc(0, 0, 286, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 262, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 168, 0, Math.PI * 2); g.stroke();
    const label = (text || "Official Seal").toUpperCase().slice(0, 34);
    g.font = '700 52px "Cinzel", Georgia, serif';
    g.textAlign = "center"; g.textBaseline = "middle";
    const ring = 215;
    const total = Math.min(Math.PI * 1.55, (g.measureText(label).width + label.length * 6) / ring);
    let a = -Math.PI / 2 - total / 2;
    for (const ch of label) {
      const w = (g.measureText(ch).width + 6) / ring;
      g.save(); g.rotate(a + w / 2); g.translate(0, -ring); g.fillText(ch, 0, 0); g.restore();
      a += w;
    }
    g.font = '700 40px "Cinzel", Georgia, serif';
    g.save(); g.rotate(0); g.fillText("★  VERIFIED  ★", 0, 222); g.restore();
    // centre star
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 50 : 118, t = (i * Math.PI) / 5 - Math.PI / 2;
      g.lineTo(Math.cos(t) * r, Math.sin(t) * r);
    }
    g.closePath(); g.fill();
    return c.toDataURL("image/png");
  }

  /* ================= QR ================= */
  function qrValue() {
    if (!state.reg) return null;
    return $("qrTarget").value === "explorer" ? M.explorerTxUrl(state.reg.tx) : M.verifyUrl(state.reg.tx, state.reg.key);
  }
  function qrPreviewSrc() {
    const e = state.els.qr;
    return M.qrCanvas(qrValue() || "MST DocVerify - register to activate", 600, e.color).toDataURL();
  }

  /* ================= document loading ================= */
  const baseCanvas = $("baseCanvas");
  let pdfDoc = null;

  async function drawBase(source, w, h) {
    baseCanvas.width = w;
    baseCanvas.height = h;
    const g = baseCanvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(source, 0, 0, w, h);
  }

  async function renderPdfPage(n) {
    const page = await pdfDoc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 2480 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const tmp = document.createElement("canvas");
    tmp.width = Math.round(vp.width);
    tmp.height = Math.round(vp.height);
    const g = tmp.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, tmp.width, tmp.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    await drawBase(tmp, tmp.width, tmp.height);
    state.doc.W = tmp.width;
    state.doc.H = tmp.height;
    state.doc.page = n;
  }

  async function loadFile(file) {
    if (state.reg) return toast("Unlock the registered document before replacing it.");
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf && !file.type.startsWith("image/")) return toast("Please upload an image or a PDF.");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileHash = await M.sha256Hex(bytes);
      state.doc = { name: file.name, fileHash, W: 0, H: 0, page: 1 };
      $("pdfPageRow").style.display = "none";
      if (isPdf) {
        if (!window.pdfjsLib) throw new Error("PDF support failed to load. Check your connection.");
        pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (pdfDoc.numPages > 1) {
          $("pdfPage").innerHTML = Array.from({ length: pdfDoc.numPages }, (_, i) => `<option value="${i + 1}">Page ${i + 1} of ${pdfDoc.numPages}</option>`).join("");
          $("pdfPageRow").style.display = "flex";
        }
        await renderPdfPage(1);
      } else {
        pdfDoc = null;
        const img = await loadImage(URL.createObjectURL(file));
        const k = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight));
        state.doc.W = Math.round(img.naturalWidth * k);
        state.doc.H = Math.round(img.naturalHeight * k);
        await drawBase(img, state.doc.W, state.doc.H);
        URL.revokeObjectURL(img.src);
      }
      showStage();
    } catch (e) {
      console.error(e);
      state.doc = null;
      toast(e.message || "Could not open that file.");
    }
    refresh();
  }

  async function loadSample() {
    if (state.reg) return toast("Unlock the registered document before replacing it.");
    const W = 2400, H = 1700, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#fffdf7"); grad.addColorStop(1, "#f7f1e3");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#0a0a0a"; g.lineWidth = 26; g.strokeRect(60, 60, W - 120, H - 120);
    g.strokeStyle = "#e31e24"; g.lineWidth = 6; g.strokeRect(100, 100, W - 200, H - 200);
    g.strokeStyle = "#b8945a"; g.lineWidth = 2; g.strokeRect(120, 120, W - 240, H - 240);
    await document.fonts.load('700 120px "Cinzel"').catch(() => {});
    await document.fonts.load('500 48px "Playfair Display"').catch(() => {});
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#0a0a0a";
    g.font = '700 128px "Cinzel", Georgia, serif'; g.fillText("CERTIFICATE", W / 2, 360);
    g.font = '500 52px "Playfair Display", Georgia, serif'; g.fillStyle = "#e31e24";
    g.fillText("OF  ACHIEVEMENT", W / 2, 470);
    g.fillStyle = "#4b5563"; g.font = 'italic 44px "Playfair Display", Georgia, serif';
    g.fillText("This is proudly presented to", W / 2, 640);
    g.strokeStyle = "#b8945a"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W / 2 - 620, 900); g.lineTo(W / 2 + 620, 900); g.stroke();
    g.fillStyle = "#374151"; g.font = '400 38px "Playfair Display", Georgia, serif';
    g.fillText("for successfully completing the MST Blockchain Developer Program", W / 2, 1000);
    g.fillText("and demonstrating excellence in decentralised application development.", W / 2, 1060);
    g.strokeStyle = "#111827"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(400, 1335); g.lineTo(900, 1335); g.stroke();
    g.font = '600 26px Inter, sans-serif'; g.fillStyle = "#6b7280";
    g.fillText("AUTHORISED SIGNATORY", 650, 1460);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    await loadFile(new File([blob], "sample-certificate.png", { type: "image/png" }));
    if (!$("f_title").value) $("f_title").value = "Certificate of Achievement";
    if (!$("f_issuer").value) $("f_issuer").value = "MST Academy";
    Object.assign(state.els.recipient, { x: 0.5, y: 0.47 });
    Object.assign(state.els.signee, { x: 0.27, y: 0.825 });
    Object.assign(state.els.signature, { x: 0.27, y: 0.74 });
    refresh();
  }

  function showStage() {
    $("emptyStage").hidden = true;
    $("stage").hidden = false;
  }

  /* ================= element list (left panel) ================= */
  function buildList() {
    $("elList").innerHTML = ELEMENTS.map((d) => `
      <li class="el-item" data-id="${d.id}">
        <div class="el-head">
          <label class="switch" title="Show on document"><input type="checkbox" data-toggle="${d.id}"><span></span></label>
          <span class="name" data-select="${d.id}">${d.label}</span>
          ${d.tag ? `<span class="tag">${d.tag}</span>` : ""}
        </div>
        ${d.id === "signature" ? `<div class="el-extra row">
            <button class="btn sm grow" type="button" data-upload="signature">Upload signature</button>
          </div>` : ""}
        ${d.id === "stamp" ? `<div class="el-extra row">
            <button class="btn sm grow" type="button" data-upload="stamp">Upload stamp</button>
            <button class="btn sm grow" type="button" data-seal="1">Generate seal</button>
          </div>` : ""}
      </li>`).join("");
  }

  async function setImage(id, file) {
    try {
      const raw = await readAsDataURL(file);
      const e = state.els[id];
      e.raw = raw;
      e.generated = false;
      e.src = e.cutout ? await cutout(raw) : raw;
      e.on = true;
      state.selected = id;
      if (!state.doc) toast("Image added — upload a document to place it.");
    } catch (err) {
      toast(err.message);
    }
    refresh();
  }

  /* ================= stage elements ================= */
  const stage = $("stage");
  const nodes = {};

  function ensureNode(id) {
    if (nodes[id]) return nodes[id];
    const d = DEF[id];
    const n = document.createElement("div");
    n.className = "el " + d.kind;
    n.dataset.id = id;
    n.tabIndex = 0;
    n.setAttribute("role", "button");
    n.setAttribute("aria-label", d.label + " — drag to move, arrow keys to nudge");
    if (d.kind !== "text") {
      const img = document.createElement("img");
      img.alt = "";
      n.appendChild(img);
    }
    if (d.kind === "qr") {
      const o = document.createElement("div");
      o.className = "qr-overlay";
      o.textContent = "QR activates after registration";
      n.appendChild(o);
    }
    const h = document.createElement("div");
    h.className = "handle";
    h.dataset.handle = "1";
    n.appendChild(h);
    stage.appendChild(n);
    attachDrag(n);
    nodes[id] = n;
    return n;
  }

  let lastQrKey = "";
  function renderStage() {
    if (!state.doc) return;
    const sw = stage.clientWidth || 1;
    for (const d of ELEMENTS) {
      const e = state.els[d.id];
      const visible = e.on && (d.kind !== "image" || e.src);
      const n = ensureNode(d.id);
      n.style.display = visible ? "" : "none";
      if (!visible) continue;
      n.classList.toggle("selected", state.selected === d.id);
      n.style.left = e.x * 100 + "%";
      n.style.top = e.y * 100 + "%";
      if (d.kind === "text") {
        n.firstChild && n.firstChild.nodeType === 3 ? (n.firstChild.nodeValue = textFor(d.id)) : n.insertBefore(document.createTextNode(textFor(d.id)), n.firstChild);
        n.style.font = fontCss(e, e.size * sw);
        n.style.lineHeight = "1";
        n.style.color = e.color;
        n.style.opacity = isPlaceholder(d.id) ? 0.45 : 1;
        n.style.width = "";
      } else {
        n.style.width = e.w * 100 + "%";
        const img = n.querySelector("img");
        if (d.kind === "qr") {
          const key = (qrValue() || "") + e.color;
          if (key !== lastQrKey || !img.src) { img.src = qrPreviewSrc(); lastQrKey = key; }
          n.querySelector(".qr-overlay").style.display = state.reg ? "none" : "";
        } else if (img.getAttribute("src") !== e.src) img.src = e.src;
      }
    }
  }

  /* ---------- drag / resize ---------- */
  function attachDrag(n) {
    n.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const id = n.dataset.id;
      const e = state.els[id];
      const d = DEF[id];
      ev.preventDefault();
      n.focus({ preventScroll: true });
      select(id);
      const r = stage.getBoundingClientRect();
      const resizing = !!ev.target.dataset.handle;
      const s = { px: ev.clientX, py: ev.clientY, x: e.x, y: e.y, w: e.w, size: e.size, half: n.getBoundingClientRect().width / 2 };
      n.setPointerCapture(ev.pointerId);
      n.classList.add("dragging");
      const move = (m) => {
        const dx = m.clientX - s.px, dy = m.clientY - s.py;
        if (resizing) {
          const f = Math.max(0.15, (s.half + dx) / s.half);
          if (d.kind === "text") e.size = Math.min(0.3, Math.max(0.005, s.size * f));
          else e.w = Math.min(1, Math.max(0.03, s.w * f));
        } else {
          let x = s.x + dx / r.width, y = s.y + dy / r.height;
          const snapX = Math.abs(x - 0.5) * r.width < 6, snapY = Math.abs(y - 0.5) * r.height < 6;
          if (snapX) x = 0.5;
          if (snapY) y = 0.5;
          $("guideV").classList.toggle("on", snapX);
          $("guideH").classList.toggle("on", snapY);
          e.x = Math.min(1, Math.max(0, x));
          e.y = Math.min(1, Math.max(0, y));
        }
        renderStage();
        if (resizing) syncToolbarValues();
      };
      const up = () => {
        n.classList.remove("dragging");
        $("guideV").classList.remove("on");
        $("guideH").classList.remove("on");
        n.removeEventListener("pointermove", move);
        n.removeEventListener("pointerup", up);
        n.removeEventListener("pointercancel", up);
      };
      n.addEventListener("pointermove", move);
      n.addEventListener("pointerup", up);
      n.addEventListener("pointercancel", up);
    });
    n.addEventListener("keydown", (ev) => {
      const id = n.dataset.id, e = state.els[id];
      const step = (ev.shiftKey ? 10 : 1);
      const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (map[ev.key]) {
        ev.preventDefault();
        e.x = Math.min(1, Math.max(0, e.x + (map[ev.key][0] * step) / state.doc.W));
        e.y = Math.min(1, Math.max(0, e.y + (map[ev.key][1] * step) / state.doc.H));
        renderStage();
      } else if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        e.on = false;
        state.selected = null;
        refresh();
      }
    });
  }

  stage.addEventListener("pointerdown", (ev) => {
    if (ev.target === stage || ev.target === baseCanvas) { state.selected = null; refresh(); }
  });

  function select(id) {
    if (state.selected === id) return;
    state.selected = id;
    refresh();
  }

  /* ---------- toolbar (selected element) ---------- */
  function buildToolbar() {
    const tb = $("toolbar");
    const id = state.selected;
    if (!id || !state.els[id].on || !state.doc) {
      tb.innerHTML = `<span class="muted small">${state.doc ? "Select an element on the document to style it." : "Upload a document, then place elements on it."}</span>`;
      return;
    }
    const d = DEF[id], e = state.els[id];
    let h = `<span class="label">${d.label}</span>`;
    if (d.kind === "text") {
      h += `<select data-p="font" aria-label="Font">${FONTS.map((f) => `<option value="${f.v}" ${f.v === e.font ? "selected" : ""}>${f.label}</option>`).join("")}</select>
        <label>Size <input type="range" data-p="size" min="0.005" max="0.15" step="0.001" value="${e.size}"></label>
        <input type="color" data-p="color" value="${e.color}" aria-label="Colour">
        <button class="btn sm" type="button" data-act="bold" aria-pressed="${e.bold}"><b>B</b></button>`;
    } else {
      h += `<label>Size <input type="range" data-p="w" min="0.03" max="${d.kind === "qr" ? 0.4 : 0.8}" step="0.002" value="${e.w}"></label>`;
      if (id === "signature") h += `<label><input type="checkbox" data-p="cutout" ${e.cutout ? "checked" : ""}> Remove white background</label>
        <button class="btn sm" type="button" data-upload="signature">Replace</button>`;
      if (id === "stamp") h += `<label><input type="checkbox" data-p="cutout" ${e.cutout ? "checked" : ""} ${e.generated ? "disabled" : ""}> Remove white background</label>
        ${e.generated ? `<input type="color" data-p="seal" value="${e.seal}" aria-label="Seal colour">` : ""}
        <button class="btn sm" type="button" data-upload="stamp">Replace</button>`;
      if (d.kind === "qr") h += `<input type="color" data-p="color" value="${e.color}" aria-label="QR colour">`;
    }
    h += `<span class="spacer" style="flex:1"></span>
      <button class="btn sm" type="button" data-act="centre">Centre</button>
      <button class="btn sm" type="button" data-act="hide">Remove</button>`;
    tb.innerHTML = h;
  }
  function syncToolbarValues() {
    const id = state.selected;
    if (!id) return;
    const e = state.els[id];
    $("toolbar").querySelectorAll("input[type=range]").forEach((i) => (i.value = e[i.dataset.p]));
  }

  $("toolbar").addEventListener("input", async (ev) => {
    const p = ev.target.dataset.p;
    const id = state.selected;
    if (!p || !id) return;
    const e = state.els[id];
    if (ev.target.type === "checkbox") {
      e[p] = ev.target.checked;
      if (p === "cutout" && e.raw) e.src = e.cutout ? await cutout(e.raw) : e.raw;
    } else if (ev.target.type === "range") e[p] = parseFloat(ev.target.value);
    else e[p] = ev.target.value;
    if (p === "seal" && e.generated) e.src = sealDataURL($("f_issuer").value, e.seal);
    renderStage();
  });
  $("toolbar").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const id = state.selected, e = id && state.els[id];
    if (b.dataset.upload) return $(DEF[b.dataset.upload].input).click();
    if (!e) return;
    if (b.dataset.act === "bold") e.bold = !e.bold;
    if (b.dataset.act === "centre") e.x = 0.5;
    if (b.dataset.act === "hide") { e.on = false; state.selected = null; }
    refresh();
  });

  /* ================= wallet & registration ================= */
  const eth = () => window.ethereum;
  const chainHex = "0x" + C.CHAIN_ID.toString(16);

  async function connectWallet() {
    if (!eth()) {
      toast("No wallet found. Install MetaMask or BridgeKey to register documents.", 4000);
      return null;
    }
    const accts = await eth().request({ method: "eth_requestAccounts" });
    state.account = accts[0] || null;
    refresh();
    return state.account;
  }

  async function ensureChain() {
    const cur = await eth().request({ method: "eth_chainId" });
    if (parseInt(cur, 16) === C.CHAIN_ID) return;
    try {
      await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (e) {
      const code = e.code ?? (e.data && e.data.originalError && e.data.originalError.code);
      if (code !== 4902) throw e;
      if (!C.RPC_URL) throw new Error(`${C.CHAIN_NAME} (chain ${C.CHAIN_ID}) is not in your wallet. Add it in your wallet, or set RPC_URL in config.js so it can be added automatically.`);
      await eth().request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: chainHex, chainName: C.CHAIN_NAME, nativeCurrency: C.CURRENCY, rpcUrls: [C.RPC_URL], blockExplorerUrls: [C.EXPLORER_URL] }],
      });
    }
  }

  async function waitForReceipt(tx, onTick) {
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const rc = await eth().request({ method: "eth_getTransactionReceipt", params: [tx] }).catch(() => null);
      if (rc) return rc;
      onTick && onTick(Math.round((Date.now() - start) / 1000));
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }

  function setRegStatus(html, cls = "") {
    $("regStatus").innerHTML = html ? `<div class="status ${cls}">${html}</div>` : "";
  }

  async function register() {
    const f = getFields();
    if (!state.doc) return toast("Upload a document first.");
    if (!f.recipientName || !f.signeeName) return toast("Recipient and signee names are required.");
    state.busy = true;
    refresh();
    try {
      if (!state.account && !(await connectWallet())) throw new Error("Connect a wallet to continue.");
      setRegStatus('<span class="spinner"></span> Switching to ' + esc(C.CHAIN_NAME) + "…");
      await ensureChain();
      const fields = {
        docId: f.docId, recipientName: f.recipientName, signeeName: f.signeeName,
        title: f.title, issuer: f.issuer, issuedOn: f.issuedOn,
      };
      const h = await M.fieldsHash(fields);
      const secret = await M.encrypt({ fields, file: { name: state.doc.name, sha256: state.doc.fileHash }, createdAt: new Date().toISOString() });
      const data = M.encodePayload({ h, iv: secret.iv, ct: secret.ct });
      setRegStatus('<span class="spinner"></span> Confirm the transaction in your wallet…');
      const from = state.account;
      const tx = await eth().request({
        method: "eth_sendTransaction",
        params: [{ from, to: C.ANCHOR_ADDRESS || from, value: "0x0", data }],
      });
      setRegStatus(`<span class="spinner"></span> Waiting for confirmation… <div class="mono">${esc(tx)}</div>`);
      const rc = await waitForReceipt(tx, (s) =>
        setRegStatus(`<span class="spinner"></span> Waiting for confirmation… ${s}s <div class="mono">${esc(tx)}</div>`));
      if (rc && rc.status === "0x0") throw new Error("The transaction failed on chain.");
      state.reg = { tx, key: secret.key, h, from, fields, confirmed: !!rc };
      saveRecent();
      toast("Registered on " + C.CHAIN_NAME);
    } catch (e) {
      console.error(e);
      const msg = e.code === 4001 ? "You rejected the request in your wallet." : e.message || String(e);
      setRegStatus(esc(msg), "bad");
      state.busy = false;
      refresh(true);
      return;
    }
    state.busy = false;
    refresh();
  }

  function unlock() {
    if (!confirm("Edit the details? The current record stays on chain, but you will need to register again and the QR will change.")) return;
    state.reg = null;
    $("f_docId").value = newDocId();
    setRegStatus("");
    refresh();
  }

  /* ---------- recent (per-device convenience) ---------- */
  const RKEY = "mstdoc.recent";
  function readRecent() {
    try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch { return []; }
  }
  function saveRecent() {
    try {
      const r = readRecent();
      r.unshift({ tx: state.reg.tx, key: state.reg.key, name: state.reg.fields.recipientName, title: state.reg.fields.title, at: Date.now() });
      localStorage.setItem(RKEY, JSON.stringify(r.slice(0, 10)));
    } catch { /* storage unavailable */ }
  }
  function renderRecent() {
    const r = readRecent();
    $("recentPanel").hidden = !r.length;
    $("recentList").innerHTML = r.map((x) => `<li><span class="grow">${esc(x.name)}<br><span class="muted">${esc(x.title || "")} · ${new Date(x.at).toLocaleDateString()}</span></span>
      <a class="btn sm" href="${esc(M.verifyUrl(x.tx, x.key))}" target="_blank" rel="noopener">Verify</a></li>`).join("");
  }

  /* ================= export ================= */
  async function exportImage(type) {
    if (!state.doc) return;
    if (!state.reg && !confirm("This document is not registered yet, so its QR code will not verify. Export anyway?")) return;
    const { W, H } = state.doc;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.drawImage(baseCanvas, 0, 0);
    for (const d of ELEMENTS) {
      const e = state.els[d.id];
      if (!e.on) continue;
      if (d.kind === "text") {
        const px = e.size * W;
        await document.fonts.load(fontCss(e, px)).catch(() => {});
        if (isPlaceholder(d.id)) continue;
        g.font = fontCss(e, px);
        g.fillStyle = e.color;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(textFor(d.id), e.x * W, e.y * H);
      } else if (d.kind === "image") {
        if (!e.src) continue;
        const img = await loadImage(e.src);
        const w = e.w * W, h = (w * img.naturalHeight) / img.naturalWidth;
        g.drawImage(img, e.x * W - w / 2, e.y * H - h / 2, w, h);
      } else if (d.kind === "qr") {
        const w = Math.round(e.w * W);
        const q = M.qrCanvas(qrValue() || "MST DocVerify - unregistered", Math.max(w, 300), e.color);
        g.imageSmoothingEnabled = false;
        g.drawImage(q, e.x * W - w / 2, e.y * H - w / 2, w, w);
        g.imageSmoothingEnabled = true;
      }
    }
    const mime = type === "jpg" ? "image/jpeg" : "image/png";
    const blob = await new Promise((r) => c.toBlob(r, mime, 0.93));
    const a = document.createElement("a");
    const base = (getFields().recipientName || "document").replace(/[^\w-]+/g, "_");
    a.download = `${base}_${getFields().docId}.${type}`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function copyLink() {
    if (!state.reg) return;
    const url = M.verifyUrl(state.reg.tx, state.reg.key);
    try {
      await navigator.clipboard.writeText(url);
      toast("Verification link copied");
    } catch {
      prompt("Copy this verification link:", url);
    }
  }

  /* ================= refresh UI ================= */
  function refresh(keepStatus) {
    const f = getFields();
    const locked = !!state.reg;
    for (const k of ["recipientName", "signeeName", "title", "issuer", "issuedOn"]) $("f_" + k).disabled = locked;
    $("docDrop").style.opacity = locked ? 0.5 : 1;
    $("sampleBtn").disabled = locked;
    $("pdfPage").disabled = locked;

    // element list
    for (const d of ELEMENTS) {
      const li = $("elList").querySelector(`[data-id="${d.id}"]`);
      const e = state.els[d.id];
      li.classList.toggle("selected", state.selected === d.id);
      li.querySelector("[data-toggle]").checked = e.on && (d.kind !== "image" || !!e.src);
    }
    if (state.els.stamp.generated) state.els.stamp.src = sealDataURL(f.issuer, state.els.stamp.seal);

    // wallet
    $("walletBtn").textContent = state.account ? M.shortHex(state.account) : "Connect wallet";

    // steps
    const done = { doc: !!state.doc, fields: !!(f.recipientName && f.signeeName), wallet: !!state.account, reg: locked };
    let activeSet = false;
    $("regSteps").querySelectorAll("li").forEach((li) => {
      const s = li.dataset.s;
      li.className = done[s] ? "done" : !activeSet ? ((activeSet = true), "active") : "";
    });

    $("registerBtn").disabled = state.busy || locked || !done.doc || !done.fields;
    $("registerBtn").innerHTML = state.busy ? '<span class="spinner"></span> Registering…' : "Register on " + esc(C.CHAIN_NAME);
    $("registerBtn").hidden = locked;
    $("unlockBtn").hidden = !locked;
    if (locked) {
      const r = state.reg;
      setRegStatus(`<strong>✓ Registered${r.confirmed ? "" : " (awaiting confirmation)"}</strong>
        <div class="small" style="margin-top:4px">Transaction</div>
        <div class="mono"><a href="${esc(M.explorerTxUrl(r.tx))}" target="_blank" rel="noopener">${esc(r.tx)}</a></div>
        <div class="small" style="margin-top:4px">Fingerprint (SHA-256)</div><div class="mono">${esc(r.h)}</div>`, "ok");
    } else if (!state.busy && !keepStatus) setRegStatus("");

    $("qrHint").textContent = $("qrTarget").value === "explorer"
      ? "Scanners land on the raw transaction on testnet.mstscan.com. The explorer shows the stored record but cannot itself say Verified — use the verification page for that."
      : "Scanners land on a page that reads the record from MST Testnet, recomputes the fingerprint and shows Verified or Not verified, with a link to the transaction on testnet.mstscan.com.";

    $("pngBtn").disabled = $("jpgBtn").disabled = !state.doc;
    $("copyLinkBtn").disabled = !locked;
    const ex = $("explorerBtn");
    if (locked) { ex.href = M.explorerTxUrl(state.reg.tx); ex.removeAttribute("aria-disabled"); ex.style.pointerEvents = ""; ex.style.opacity = ""; }
    else { ex.removeAttribute("href"); ex.style.pointerEvents = "none"; ex.style.opacity = 0.45; }

    buildToolbar();
    renderStage();
    renderRecent();
  }

  /* ================= wiring ================= */
  function init() {
    $("netPill").textContent = `${C.CHAIN_NAME} · ${C.CHAIN_ID}`;
    $("f_issuedOn").value = today();
    $("f_docId").value = newDocId();
    buildList();

    const drop = $("docDrop");
    drop.addEventListener("click", () => !state.reg && $("docInput").click());
    drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), drop.click()));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); loadFile(e.dataTransfer.files[0]); });
    $("docInput").addEventListener("change", (e) => { loadFile(e.target.files[0]); e.target.value = ""; });
    $("pdfPage").addEventListener("change", async (e) => { await renderPdfPage(+e.target.value); refresh(); });
    $("sampleBtn").addEventListener("click", loadSample);

    $("sigInput").addEventListener("change", (e) => { e.target.files[0] && setImage("signature", e.target.files[0]); e.target.value = ""; });
    $("stampInput").addEventListener("change", (e) => { e.target.files[0] && setImage("stamp", e.target.files[0]); e.target.value = ""; });

    $("elList").addEventListener("change", (ev) => {
      const id = ev.target.dataset.toggle;
      if (!id) return;
      const e = state.els[id], d = DEF[id];
      if (ev.target.checked && d.kind === "image" && !e.src) {
        ev.target.checked = false;
        if (id === "stamp") { e.src = sealDataURL($("f_issuer").value, e.seal); e.generated = true; e.on = true; state.selected = id; return refresh(); }
        return $(d.input).click();
      }
      e.on = ev.target.checked;
      state.selected = e.on ? id : state.selected === id ? null : state.selected;
      refresh();
    });
    $("elList").addEventListener("click", (ev) => {
      const t = ev.target;
      if (t.dataset.upload) $(DEF[t.dataset.upload].input).click();
      else if (t.dataset.seal) {
        const e = state.els.stamp;
        e.src = sealDataURL($("f_issuer").value, e.seal); e.generated = true; e.raw = null; e.on = true;
        state.selected = "stamp"; refresh();
      } else if (t.dataset.select) {
        const e = state.els[t.dataset.select];
        if (e.on) { state.selected = t.dataset.select; refresh(); nodes[t.dataset.select] && nodes[t.dataset.select].focus(); }
      }
    });

    for (const k of FIELD_KEYS) $("f_" + k).addEventListener("input", () => refresh());

    $("walletBtn").addEventListener("click", () => connectWallet().catch((e) => toast(e.message)));
    $("registerBtn").addEventListener("click", register);
    $("unlockBtn").addEventListener("click", unlock);
    $("qrTarget").addEventListener("change", () => refresh());
    $("pngBtn").addEventListener("click", () => exportImage("png"));
    $("jpgBtn").addEventListener("click", () => exportImage("jpg"));
    $("copyLinkBtn").addEventListener("click", copyLink);

    if (eth()) {
      eth().request({ method: "eth_accounts" }).then((a) => { state.account = a[0] || null; refresh(); }).catch(() => {});
      eth().on && eth().on("accountsChanged", (a) => { state.account = a[0] || null; refresh(); });
    }
    new ResizeObserver(() => renderStage()).observe(stage);
    document.fonts && document.fonts.ready.then(() => renderStage());
    refresh();
  }

  init();
})();
