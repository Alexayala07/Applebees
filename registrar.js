// registrar.js — Opción B FINAL
// Cámara móvil robusta + OCR + Puntos automáticos + Firestore + Logs
(() => {
  const $ = (id) => document.getElementById(id);

  // ===================== Firebase / Firestore =====================
  const db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  // Log de proyecto (depuración)
  console.log("Proyecto (registrar):", firebase.app().options.projectId);

  // ===================== Referencias UI (coinciden con tu HTML) =====================
  const fileInput    = $('ticketFile');
  const dropzone     = $('dropzone');
  const btnCam       = $('btnAbrirCamara');

  const modal        = $('cameraModal');
  const btnClose     = $('btnCerrarCamara');
  const video        = $('cameraVideo');
  const canvas       = $('cameraCanvas');
  const btnShot      = $('btnCapturar');

  const btnOCR       = $('btnProcesarTicket');
  const btnEditar    = $('btnEditarManual');
  const ocrStatus    = $('ocrStatus');

  const iNum         = $('inputTicketNumero');
  const iFecha       = $('inputTicketFecha');
  const iTotal       = $('inputTicketTotal');

  const listaProd    = $('listaProductos');
  const nuevoProd    = $('nuevoProducto');
  const nuevaCant    = $('nuevaCantidad');
  const btnAdd       = $('btnAgregarProducto');

  const buscarProd   = $('buscarProducto');
  const gridProd     = $('productosGrid');

  const btnRegistrar = $('btnRegistrarTicket');
  const msgTicket    = $('ticketValidacion');

  // (Opcional) tabla de puntos si existe en el HTML
  const tablaPuntosBody = ($('tablaPuntos')||{}).querySelector?.('tbody');
  const totalPuntosEl   = $('totalPuntos');

  // ===================== Estado =====================
  let liveStream = null;
  let currentPreviewURL = null;
  let productos = []; // [{ name, qty }]
  let ocrWorker = null;

  // ===================== Catálogo & Puntos =====================
  const CATALOGO = [
    "Hamburguesa Clásica","Hamburguesa Doble","Combo Hamburguesa",
    "Alitas","Boneless","Papas a la Francesa","Aros de Cebolla",
    "Refresco","Malteada","Limonada","Ensalada","Postre","Cerveza"
  ];
  const PUNTOS_MAP = Object.freeze({
    "Hamburguesa Clásica": 5, "Hamburguesa Doble": 7, "Combo Hamburguesa": 8,
    "Alitas": 5, "Boneless": 5, "Papas a la Francesa": 3, "Aros de Cebolla": 3,
    "Refresco": 3, "Malteada": 4, "Limonada": 3, "Ensalada": 4, "Postre": 4, "Cerveza": 3
  });
  const getPuntosUnit = (name) => Number(PUNTOS_MAP[name] || 0);

  // ===================== Utilidades UI =====================
  function setStatus(msg, type = '') {
    ocrStatus.className = 'validacion-msg';
    if (type) ocrStatus.classList.add(type);
    ocrStatus.textContent = msg || '';
  }

  // Opción B: habilitado/inhabilitado forzado (quita/pon el atributo HTML)
  function enableForm(enabled) {
    const ids = [
      'inputTicketNumero','inputTicketFecha','inputTicketTotal',
      'nuevoProducto','nuevaCantidad','btnAgregarProducto',
      'buscarProducto','btnRegistrarTicket'
    ];
    ids.forEach(id => {
      const node = $(id);
      if (!node) return;
      if (enabled) {
        node.disabled = false;
        node.removeAttribute('disabled');   // 👈 fuerza quitar el atributo
      } else {
        node.disabled = true;
        node.setAttribute('disabled', '');  // 👈 lo vuelve a poner si hace falta
      }
    });
  }

  // Rescate por si algún error impide habilitar el form
  function forceEnableForm() {
    try { enableForm(true); } catch(_) {}
  }
  document.addEventListener('DOMContentLoaded', forceEnableForm);
  setTimeout(forceEnableForm, 0);
  setTimeout(forceEnableForm, 300);

  function setPreview(file) {
    if (currentPreviewURL) URL.revokeObjectURL(currentPreviewURL);
    const url = URL.createObjectURL(file);
    currentPreviewURL = url;
    dropzone.querySelectorAll('img.preview').forEach(n => n.remove());
    const img = document.createElement('img');
    img.className = 'preview';
    img.alt = 'Vista previa ticket';
    img.src = url;
    dropzone.appendChild(img);
  }
  function dataURLtoBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = meta.split(':')[1].split(';')[0];
    const bin = atob(b64);
    const ab = new ArrayBuffer(bin.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < bin.length; i++) ia[i] = bin.charCodeAt(i);
    return new Blob([ab], { type: mime });
  }
  function setFileInputFromBlob(blob, name = 'ticket.jpg') {
    const file = new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    setPreview(file);
  }

  // ===================== Productos =====================
  function upsertProducto(nombre, cantidad = 1) {
    nombre = String(nombre||'').trim();
    if (!nombre) return;
    const i = productos.findIndex(p => p.name.toLowerCase() === nombre.toLowerCase());
    if (i >= 0) productos[i].qty += cantidad;
    else productos.push({ name: nombre, qty: cantidad });
    renderProductos();
  }
  function renderProductos() {
    listaProd.innerHTML = '';
    productos.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `
        <span>${p.name}</span>
        <span class="qty">
          <button type="button" data-act="-" data-name="${p.name}">−</button>
          <strong>${p.qty}</strong>
          <button type="button" data-act="+" data-name="${p.name}">+</button>
        </span>
        <button type="button" data-act="x" data-name="${p.name}">✕</button>
      `;
      listaProd.appendChild(chip);
    });
    updatePuntosResumen();
  }
  function renderCatalogo(filtro = '') {
    const f = filtro.trim().toLowerCase();
    gridProd.innerHTML = '';
    CATALOGO.filter(n=>n.toLowerCase().includes(f)).forEach(n => {
      const card = document.createElement('div');
      card.className = 'card-prod';
      card.innerHTML = `<span>${n}</span><button type="button" class="btn-primary" data-add="${n}">Agregar</button>`;
      gridProd.appendChild(card);
    });
  }

  // ===================== Puntos (resumen) =====================
  function updatePuntosResumen() {
    if (!tablaPuntosBody) return;
    tablaPuntosBody.innerHTML = '';
    let total = 0;
    productos.forEach(p => {
      const pts = getPuntosUnit(p.name);
      const sub = pts * p.qty;
      total += sub;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.name}</td><td>${p.qty}</td><td>${pts}</td><td>${sub}</td>`;
      tablaPuntosBody.appendChild(tr);
    });
    if (totalPuntosEl) totalPuntosEl.textContent = String(total);
  }
  function getPuntosDetalle(arr = productos) {
    let total = 0;
    const detalle = arr.map(p => {
      const pts = getPuntosUnit(p.name);
      const sub = pts * p.qty;
      total += sub;
      return { producto: p.name, cantidad: p.qty, puntos_unitarios: pts, puntos_subtotal: sub };
    });
    return { total, detalle };
  }

  // ===================== Cámara (móvil/desktop) =====================
  async function openCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Tu navegador no soporta cámara. Usa Adjuntar foto.", "err");
        return;
      }
      // iOS / Safari: autoplay requiere muted + playsinline
      video.muted = true;
      video.setAttribute('playsinline','true');

      const tries = [
        { video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio:false },
        { video: { facingMode: { ideal: "environment" },  width: { ideal: 1920 }, height: { ideal: 1080 } }, audio:false },
        { video: true, audio:false }
      ];

      let stream = null, lastErr = null;
      for (const c of tries) {
        try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
        catch (e) { lastErr = e; }
      }
      if (!stream) throw lastErr || new Error("No se pudo abrir la cámara");

      liveStream = stream;
      video.srcObject = stream;
      if (modal) { modal.setAttribute('aria-hidden','false'); modal.style.display = 'flex'; }
      // Asegura inicio del video (iOS)
      await video.play();
      setStatus('');
    } catch (error) {
      console.error("getUserMedia error:", error);
      let hint = "No se pudo acceder a la cámara. Revisa permisos del navegador.";
      if ((!window.isSecureContext && location.hostname !== 'localhost') ||
          (location.protocol !== 'https:' && location.hostname !== 'localhost')) {
        hint += " (En móviles necesitas HTTPS).";
      }
      setStatus(hint, "err");
      // Fallback al selector de archivo
      fileInput?.click();
    }
  }
  function stopCamera() {
    if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
    if (modal) { modal.setAttribute('aria-hidden','true'); modal.style.display = 'none'; }
  }
  async function captureFrame() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { setStatus("Cámara aún no lista. Intenta de nuevo.", "err"); return; }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w; tempCanvas.height = h;
    tempCanvas.getContext('2d').drawImage(video, 0, 0, w, h);

    stopCamera();

    let finalDataURL;
    if (window.cv && window.cv.Mat) {
      try { finalDataURL = processImageWithOpenCV(tempCanvas); }
      catch (e) { console.warn("OpenCV falló, uso original:", e); finalDataURL = tempCanvas.toDataURL("image/jpeg", 0.92); }
    } else {
      finalDataURL = tempCanvas.toDataURL("image/jpeg", 0.92);
    }

    const blob = dataURLtoBlob(finalDataURL);
    setFileInputFromBlob(blob, `ticket_${Date.now()}.jpg`);
    enableForm(true);
    setStatus("Foto capturada. Puedes editar o correr OCR.", "ok");
  }
  function processImageWithOpenCV(canvasElement) {
    const cv = window.cv;
    let src = cv.imread(canvasElement);
    let dst = new cv.Mat();
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let finalDataURL;

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blurred, canny, 75, 200, 3, false);
      cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0, bestContour = null;
      for (let i = 0; i < contours.size(); ++i) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area < 15000) continue;
        const perimeter = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
        if (approx.rows === 4 && area > maxArea) { maxArea = area; if (bestContour) bestContour.delete(); bestContour = approx; }
        else { approx.delete(); }
      }

      let outCanvas = document.createElement('canvas');
      if (bestContour) {
        const pts = [];
        for (let i = 0; i < bestContour.rows; ++i) pts.push({ x: bestContour.data32S[i*2], y: bestContour.data32S[i*2+1] });
        const [tl, tr, br, bl] = orderQuad(pts);

        const widthA  = Math.hypot(br.x - bl.x, br.y - bl.y);
        const widthB  = Math.hypot(tr.x - tl.x, tr.y - tl.y);
        const maxW    = Math.max(widthA, widthB);
        const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
        const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
        const maxH    = Math.max(heightA, heightB);

        const dSize = new cv.Size(Math.max(300, Math.floor(maxW)), Math.max(400, Math.floor(maxH)));
        const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [ tl.x,tl.y, tr.x,tr.y, br.x,br.y, bl.x,bl.y ]);
        const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [ 0,0, dSize.width-1,0, dSize.width-1,dSize.height-1, 0,dSize.height-1 ]);

        const M = cv.getPerspectiveTransform(srcCoords, dstCoords);
        cv.warpPerspective(src, dst, M, dSize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
        srcCoords.delete(); dstCoords.delete(); M.delete(); bestContour.delete();

        const showCanvas = document.createElement('canvas');
        cv.imshow(showCanvas, dst);
        const ctx = showCanvas.getContext('2d');
        ctx.filter = 'contrast(1.18) brightness(1.06) grayscale(1)';
        const tmp = document.createElement('canvas');
        tmp.width = showCanvas.width; tmp.height = showCanvas.height;
        tmp.getContext('2d').drawImage(showCanvas, 0, 0);
        ctx.drawImage(tmp, 0, 0);
        outCanvas = showCanvas;
      } else {
        outCanvas = canvasElement;
      }

      finalDataURL = outCanvas.toDataURL("image/jpeg", 0.95);
    } finally {
      src.delete(); dst.delete(); gray.delete(); blurred.delete();
      canny.delete(); contours.delete(); hierarchy.delete();
    }
    return finalDataURL;

    function orderQuad(pts) {
      const rect = new Array(4);
      const s = pts.map(p => p.x + p.y);
      const d = pts.map(p => p.y - p.x);
      rect[0] = pts[s.indexOf(Math.min(...s))]; // tl
      rect[2] = pts[s.indexOf(Math.max(...s))]; // br
      rect[1] = pts[d.indexOf(Math.min(...d))]; // tr
      rect[3] = pts[d.indexOf(Math.max(...d))]; // bl
      return rect;
    }
  }

  // ===================== OCR =====================
  async function ensureWorker() {
    if (ocrWorker) return ocrWorker;
    const { createWorker } = Tesseract;
    ocrWorker = await createWorker({
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
      logger: m => {
        if (m.status === 'recognizing text' && m.progress != null) {
          setStatus(`Reconociendo texto… ${Math.round(m.progress*100)}%`);
        }
      }
    });
    await ocrWorker.loadLanguage('spa+eng');
    await ocrWorker.initialize('spa+eng');
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    return ocrWorker;
  }
  function parseOCR(text) {
    const plain = text.replace(/\s+/g, ' ').trim();
    const lower = plain.toLowerCase();

    let numero = null;
    const mNum = lower.match(/(?:folio|ticket|transacci[oó]n|orden)\D{0,8}(\d{4,})/i);
    if (mNum) numero = mNum[1];

    let fecha = null;
    const fechas = lower.match(/(\b\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/);
    if (fechas) {
      let d = parseInt(fechas[1],10), m = parseInt(fechas[2],10), y = parseInt(fechas[3],10);
      if (d <= 12 && m > 12) [d,m] = [m,d];
      const mm = String(m).padStart(2,'0');
      const dd = String(d).padStart(2,'0');
      fecha = `${y}-${mm}-${dd}`;
    }

    let total = null;
    const allTotals = [...lower.matchAll(/total[^0-9]{0,10}\$?\s*([0-9]{1,4}[.,][0-9]{2})/g)];
    if (allTotals.length) total = allTotals[allTotals.length-1][1].replace(',','.');
    else {
      const nums = [...lower.matchAll(/([0-9]{1,4}[.,][0-9]{2})/g)];
      if (nums.length) total = nums[nums.length-1][1].replace(',','.');
    }

    const claves = [
      ["hamburguesa","Hamburguesa Clásica"], ["doble","Hamburguesa Doble"], ["combo","Combo Hamburguesa"],
      ["alitas","Alitas"],["boneless","Boneless"],["papas","Papas a la Francesa"],["aros","Aros de Cebolla"],
      ["refresco","Refresco"],["malteada","Malteada"],["limonada","Limonada"],
      ["ensalada","Ensalada"],["postre","Postre"],["cerveza","Cerveza"]
    ];
    const productosDetectados = [];
    claves.forEach(([kw, nombre]) => {
      const count = (lower.match(new RegExp(`\\b${kw}\\b`, 'g'))||[]).length;
      if (count > 0) productosDetectados.push({ name: nombre, qty: count });
    });

    return { numero, fecha, total, productosDetectados };
  }
  async function procesarTicket() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setStatus("Primero adjunta o toma la foto del ticket.", "err");
      return;
    }
    setStatus("Reconociendo texto… 0%");
    enableForm(false);
    msgTicket.textContent = '';

    try {
      const worker = await ensureWorker();
      const OCR_TIMEOUT_MS = 20000;
      const ocrPromise = worker.recognize(file).then(r => r.data);
      const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('OCR_TIMEOUT')), OCR_TIMEOUT_MS));
      const data = await Promise.race([ocrPromise, timeoutPromise]);

      const { numero, fecha, total, productosDetectados } = parseOCR(data.text || '');

      if (numero) iNum.value = numero;
      if (fecha)  iFecha.value = fecha;
      if (total)  iTotal.value = parseFloat(total).toFixed(2);

      productos = [];
      productosDetectados.forEach(p => upsertProducto(p.name, p.qty));

      setStatus("✓ Ticket procesado. Verifica/ajusta los campos.", "ok");
    } catch (e) {
      console.warn("OCR error:", e);
      setStatus(String(e?.message).includes('OCR_TIMEOUT')
        ? "OCR tardó demasiado. Edición manual habilitada."
        : "No pude leer el ticket. Intenta con más luz o edita manualmente.", "err");
    } finally {
      enableForm(true); // 👈 se re-habilita sí o sí
    }
  }

  // ===================== Guardar en Firestore (vence a 6 meses) =====================
  function addMonths(date, months) { const d = new Date(date.getTime()); d.setMonth(d.getMonth() + months); return d; }

  async function registrarTicket() {
    const user = firebase.auth().currentUser;
    if (!user) {
      msgTicket.className = 'validacion-msg err';
      msgTicket.textContent = "Debes iniciar sesión para registrar.";
      return;
    }

    const numero   = iNum.value.trim();
    const fechaStr = iFecha.value; // YYYY-MM-DD
    const totalNum = parseFloat(iTotal.value || "0") || 0;

    if (!numero || !fechaStr || !totalNum) {
      msgTicket.className = 'validacion-msg err';
      msgTicket.textContent = "Faltan datos obligatorios: número, fecha y total.";
      return;
    }

    const puntos = getPuntosDetalle(productos);
    const fecha = new Date(`${fechaStr}T00:00:00`);
    const vencePuntos = addMonths(fecha, 6);

    const docData = {
      numero,
      fecha: firebase.firestore.Timestamp.fromDate(fecha),
      total: totalNum,
      productos: productos.map(p => ({ nombre: p.name, cantidad: p.qty })),
      puntos, // { total, detalle[] }
      vencePuntos: firebase.firestore.Timestamp.fromDate(vencePuntos),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // 🔎 Logs de depuración
    console.log("== REGISTRAR ==");
    console.log("UID:", user.uid, "Proyecto:", firebase.app().options.projectId);
    console.log("Doc a guardar:", docData);

    try {
      await db.collection('users').doc(user.uid).collection('tickets').add(docData);
      msgTicket.className = 'validacion-msg ok';
      msgTicket.textContent = `✅ Ticket registrado. Puntos: ${puntos.total}`;
      setTimeout(() => { window.location.href = 'panel.html'; }, 1200);
    } catch (e) {
      console.error(e);
      msgTicket.className = 'validacion-msg err';
      msgTicket.textContent = "Error al guardar el ticket. Inténtalo de nuevo.";
    }
  }

  // ===================== Eventos =====================
  btnCam?.addEventListener('click', openCamera);
  btnClose?.addEventListener('click', stopCamera);
  btnShot?.addEventListener('click', captureFrame);

  fileInput?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) {
      setPreview(f);
      enableForm(true);
      setStatus("Imagen cargada. Puedes editar o usar OCR.", "ok");
    }
  });

  btnOCR?.addEventListener('click', procesarTicket);
  btnEditar?.addEventListener('click', () => {
    enableForm(true);
    setStatus("Edición manual habilitada.", "ok");
  });

  listaProd.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const name= btn.dataset.name;
    const idx = productos.findIndex(p => p.name === name);
    if (idx < 0) return;
    if (act === '+') productos[idx].qty++;
    if (act === '-' && productos[idx].qty > 1) productos[idx].qty--;
    if (act === 'x') productos.splice(idx,1);
    renderProductos();
  });

  btnAdd?.addEventListener('click', () => {
    const n = nuevoProd.value.trim();
    const c = Math.max(1, parseInt(nuevaCant.value||"1", 10));
    if (n) upsertProducto(n, c);
    nuevoProd.value = ''; nuevaCant.value = '';
  });

  buscarProd?.addEventListener('input', (e) => renderCatalogo(e.target.value));
  gridProd.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-add]');
    if (!btn) return;
    upsertProducto(btn.dataset.add, 1);
  });

  btnRegistrar?.addEventListener('click', registrarTicket);

  // ===================== Init =====================
  // Habilitado por defecto para permitir registro manual desde el inicio
  enableForm(true);
  renderCatalogo('');
  updatePuntosResumen();

  if ((!window.isSecureContext && location.hostname !== 'localhost') ||
      (location.protocol !== 'https:' && location.hostname !== 'localhost')) {
    setStatus("Para usar la cámara en móviles, abre el sitio con HTTPS.", "err");
  }
})();
