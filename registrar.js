// registrar.js — captura con cámara, OCR, puntos y guardado en Firestore + Storage
(() => {
  const el = id => document.getElementById(id);

  // ===== Firebase =====
  const db = firebase.firestore();
  // Opcional: persistencia offline
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  const storage = firebase.storage();

  // ===== Elementos UI =====
  const fileInput = el('ticketFile');
  const dropzone  = el('dropzone');

  const btnCam    = el('btnAbrirCamara');
  const modal     = el('cameraModal');
  const btnClose  = el('btnCerrarCamara');
  const video     = el('cameraVideo');
  const btnShot   = el('btnCapturar');

  const btnOCR    = el('btnProcesarTicket');
  const btnEditar = el('btnEditarManual');
  const ocrStatus = el('ocrStatus');

  const iNum   = el('inputTicketNumero');
  const iFecha = el('inputTicketFecha');
  const iTotal = el('inputTicketTotal');

  const listaProd = el('listaProductos');
  const nuevoProd = el('nuevoProducto');
  const nuevaCant = el('nuevaCantidad');
  const btnAdd    = el('btnAgregarProducto');

  const buscarProd = el('buscarProducto');
  const gridProd   = el('productosGrid');

  const btnRegistrar = el('btnRegistrarTicket');
  const msgTicket    = el('ticketValidacion');

  const tablaPuntosBody = el('tablaPuntos')?.querySelector('tbody');
  const totalPuntosEl   = el('totalPuntos');

  // ===== Estado =====
  let liveStream = null;
  let currentPreviewURL = null;
  let productos = [];
  let ocrWorker = null;

  // ===== Catálogo & puntos =====
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
  const getPuntosUnit = name => Number(PUNTOS_MAP[name] || 0);

  // ===== Utilidades UI =====
  const setStatus = (msg, type = '') => {
    ocrStatus.className = 'validacion-msg';
    if (type) ocrStatus.classList.add(type); // ok | err
    ocrStatus.textContent = msg || '';
  };
  const enableForm = on => {
    [iNum, iFecha, iTotal, nuevoProd, nuevaCant, btnAdd, buscarProd, btnRegistrar]
      .forEach(inp => inp && (inp.disabled = !on));
  };
  const setPreview = file => {
    if (currentPreviewURL) URL.revokeObjectURL(currentPreviewURL);
    const url = URL.createObjectURL(file);
    currentPreviewURL = url;
    dropzone.querySelectorAll('img.preview').forEach(n => n.remove());
    const img = document.createElement('img');
    img.className = 'preview';
    img.alt = 'Vista previa ticket';
    img.src = url;
    dropzone.appendChild(img);
  };
  const dataURLtoBlob = dataURL => {
    const [meta, b64] = dataURL.split(',');
    const mime = meta.split(':')[1].split(';')[0];
    const bin = atob(b64);
    const ab = new ArrayBuffer(bin.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < bin.length; i++) ia[i] = bin.charCodeAt(i);
    return new Blob([ab], { type: mime });
  };
  const setFileInputFromBlob = (blob, name = 'ticket.jpg') => {
    const file = new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    setPreview(file);
  };

  // ===== Productos (chips + catálogo) =====
  const upsertProducto = (nombre, cantidad = 1) => {
    nombre = String(nombre || '').trim();
    if (!nombre) return;
    const i = productos.findIndex(p => p.name.toLowerCase() === nombre.toLowerCase());
    if (i >= 0) productos[i].qty += cantidad;
    else productos.push({ name: nombre, qty: cantidad });
    renderProductos();
  };
  const renderProductos = () => {
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
  };
  const renderCatalogo = (filtro = '') => {
    const f = filtro.trim().toLowerCase();
    gridProd.innerHTML = '';
    CATALOGO.filter(n => n.toLowerCase().includes(f)).forEach(n => {
      const card = document.createElement('div');
      card.className = 'card-prod';
      card.innerHTML = `<span class="prod-name">${n}</span><button type="button" class="btn-primary" data-add="${n}">Agregar</button>`;
      gridProd.appendChild(card);
    });
  };

  // ===== Resumen de puntos =====
  const updatePuntosResumen = () => {
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
  };
  const getPuntosDetalle = () => {
    let total = 0;
    const detalle = productos.map(p => {
      const pts = getPuntosUnit(p.name);
      const sub = pts * p.qty;
      total += sub;
      return { producto: p.name, cantidad: p.qty, puntos_unitarios: pts, puntos_subtotal: sub };
    });
    return { total, detalle };
  };

  // ===== Cámara (abrir, cerrar, capturar) =====
  const openCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Tu navegador no soporta cámara. Usa Adjuntar foto.", "err");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      liveStream = stream;
      if (video) video.srcObject = stream;
      if (modal) { modal.setAttribute('aria-hidden', 'false'); modal.style.display = 'flex'; }
      setStatus("");
    } catch (error) {
      console.error("Error accediendo a la cámara:", error);
      setStatus("No se pudo acceder a la cámara. Revisa permisos del navegador.", "err");
      fileInput?.click();
    }
  };
  const stopCamera = () => {
    if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
    if (modal) { modal.setAttribute('aria-hidden', 'true'); modal.style.display = 'none'; }
  };
  const captureFrame = async () => {
    if (!video || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w; tempCanvas.height = h;
    tempCanvas.getContext("2d").drawImage(video, 0, 0, w, h);

    stopCamera();

    let finalDataURL;
    if (window.cv && window.cv.Mat) {
      try {
        finalDataURL = processImageWithOpenCV(tempCanvas);
      } catch (e) {
        console.warn("OpenCV falló, uso imagen original:", e);
        finalDataURL = tempCanvas.toDataURL("image/jpeg", 0.92);
      }
    } else {
      finalDataURL = tempCanvas.toDataURL("image/jpeg", 0.92);
    }

    const blob = dataURLtoBlob(finalDataURL);
    setFileInputFromBlob(blob, `ticket_${Date.now()}.jpg`);
    enableForm(true);
    setStatus("Foto capturada. Puedes editar o correr OCR.", "ok");
  };

  // ===== OpenCV: recorte/warp y mejora de contraste =====
  function processImageWithOpenCV(canvasElement) {
    const cv = window.cv;
    let src = cv.imread(canvasElement);
    let dst = new cv.Mat();
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let bestContour = null;
    let finalDataURL;

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blurred, canny, 75, 200, 3, false);
      cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0;
      for (let i = 0; i < contours.size(); ++i) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area < 15000) continue;
        const perimeter = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
        if (approx.rows === 4 && area > maxArea) {
          maxArea = area;
          if (bestContour) bestContour.delete();
          bestContour = approx;
        } else {
          approx.delete();
        }
      }

      let outCanvas;
      if (bestContour) {
        const pts = [];
        for (let i = 0; i < bestContour.rows; ++i) {
          pts.push({ x: bestContour.data32S[i * 2], y: bestContour.data32S[i * 2 + 1] });
        }
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
        outCanvas = canvasElement; // sin warp
      }

      finalDataURL = outCanvas.toDataURL("image/jpeg", 0.95);
    } finally {
      src.delete(); dst.delete(); gray.delete(); blurred.delete();
      canny.delete(); contours.delete(); hierarchy.delete();
      if (bestContour) bestContour.delete?.();
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

  // ===== OCR (Tesseract) =====
  async function ensureWorker() {
    if (ocrWorker) return ocrWorker;
    const { createWorker } = Tesseract;
    ocrWorker = await createWorker({
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
      logger: m => {
        if (m.status === 'recognizing text' && m.progress != null) {
          setStatus(`Reconociendo texto… ${Math.round(m.progress * 100)}%`);
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

    // Número de ticket
    let numero = null;
    const mNum = lower.match(/(?:folio|ticket|transacci[oó]n|orden)\D{0,8}(\d{4,})/i);
    if (mNum) numero = mNum[1];

    // Fecha -> yyyy-mm-dd
    let fecha = null;
    const fechas = lower.match(/(\b\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/);
    if (fechas) {
      let d = parseInt(fechas[1], 10), m = parseInt(fechas[2], 10), y = parseInt(fechas[3], 10);
      if (d <= 12 && m > 12) [d, m] = [m, d];
      const mm = String(m).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      fecha = `${y}-${mm}-${dd}`;
    }

    // Total
    let total = null;
    const allTotals = [...lower.matchAll(/total[^0-9]{0,10}\$?\s*([0-9]{1,4}[.,][0-9]{2})/g)];
    if (allTotals.length) total = allTotals[allTotals.length - 1][1].replace(',', '.');
    else {
      const nums = [...lower.matchAll(/([0-9]{1,4}[.,][0-9]{2})/g)];
      if (nums.length) total = nums[nums.length - 1][1].replace(',', '.');
    }

    // Productos
    const claves = [
      ["hamburguesa","Hamburguesa Clásica"],
      ["doble","Hamburguesa Doble"],
      ["combo","Combo Hamburguesa"],
      ["alitas","Alitas"],["boneless","Boneless"],
      ["papas","Papas a la Francesa"],["aros","Aros de Cebolla"],
      ["refresco","Refresco"],["malteada","Malteada"],["limonada","Limonada"],
      ["ensalada","Ensalada"],["postre","Postre"],["cerveza","Cerveza"]
    ];
    const productosDetectados = [];
    claves.forEach(([kw, nombre]) => {
      const count = (lower.match(new RegExp(`\\b${kw}\\b`, 'g')) || []).length;
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
      if (fecha)  iFecha.value = fecha; // yyyy-mm-dd
      if (total)  iTotal.value = parseFloat(total).toFixed(2);

      productos = [];
      productosDetectados.forEach(p => upsertProducto(p.name, p.qty));

      enableForm(true);
      setStatus("✓ Ticket procesado. Verifica/ajusta los campos.", "ok");
    } catch (e) {
      console.warn("OCR error:", e);
      setStatus(String(e?.message).includes('OCR_TIMEOUT')
        ? "OCR tardó demasiado. Edición manual habilitada."
        : "No pude leer el ticket. Intenta con más luz o edita manualmente.", "err");
      enableForm(true);
    }
  }

  // ===== Subida a Storage + guardado en Firestore =====
  const addMonths = (date, months) => {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  };

  async function subirImagenAStorage(file) {
    const safeName = (file.name || 'ticket.jpg').replace(/[^\w.\-]+/g, '_');
    const ref = storage.ref(`tickets/${Date.now()}_${safeName}`);
    await ref.put(file);
    return await ref.getDownloadURL();
  }

  async function registrarTicket() {
    const user = firebase.auth().currentUser;
    if (!user) {
      msgTicket.className = 'validacion-msg err';
      msgTicket.textContent = "Debes iniciar sesión para registrar.";
      return;
    }

    const numero   = (iNum.value || '').trim();
    const fechaStr = (iFecha.value || '').trim(); // YYYY-MM-DD
    const totalNum = parseFloat(iTotal.value || "0") || 0;

    if (!numero || !fechaStr || !totalNum) {
      msgTicket.className = 'validacion-msg err';
      msgTicket.textContent = "Faltan datos obligatorios: número, fecha y total.";
      return;
    }

    const { total: puntosTotal, detalle: puntosDetalle } = getPuntosDetalle();
    const fecha = new Date(`${fechaStr}T00:00:00`);
    const vencePuntos = addMonths(fecha, 6);

    // Subir imagen si se adjuntó
    let imagenURL = '';
    const file = fileInput.files?.[0] || null;
    try {
      btnRegistrar.disabled = true;
      if (file) {
        setStatus("Subiendo imagen…");
        imagenURL = await subirImagenAStorage(file);
      }

      const docData = {
        numero,
        fecha: firebase.firestore.Timestamp.fromDate(fecha),
        total: totalNum,
        productos: productos.map(p => ({ nombre: p.name, cantidad: p.qty })),
        puntos: { total: puntosTotal, detalle: puntosDetalle },
        vencePuntos: firebase.firestore.Timestamp.fromDate(vencePuntos),
        imagenURL,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      // Guardar bajo el usuario
      await db.collection('users').doc(user.uid).collection('tickets').add(docData);

      msgTicket.className = 'validacion-msg ok';
      msgTicket.textContent = `✅ Ticket registrado. Puntos: ${puntosTotal}`;
      setStatus("Registro completado.", "ok");

      // Navegar al panel
      setTimeout(() => { window.location.href = 'panel.html'; }, 1200);
    } catch (e) {
      console.error(e);
      msgTicket.className = 'validacion-msg err';
      msgTicket.textContent = "Error al guardar el ticket. Inténtalo de nuevo.";
      setStatus("Ocurrió un error al registrar el ticket.", "err");
    } finally {
      btnRegistrar.disabled = false;
    }
  }

  // ===== Eventos =====
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

  // Chips productos
  listaProd.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const name = btn.dataset.name;
    const idx = productos.findIndex(p => p.name === name);
    if (idx < 0) return;
    if (act === '+') productos[idx].qty++;
    if (act === '-' && productos[idx].qty > 1) productos[idx].qty--;
    if (act === 'x') productos.splice(idx, 1);
    renderProductos();
  });

  // Agregar manual
  btnAdd?.addEventListener('click', () => {
    const n = (nuevoProd.value || '').trim();
    const c = Math.max(1, parseInt(nuevaCant.value || "1", 10));
    if (n) upsertProducto(n, c);
    nuevoProd.value = ''; nuevaCant.value = '';
  });

  // Catálogo
  renderCatalogo('');
  buscarProd?.addEventListener('input', (e) => renderCatalogo(e.target.value));
  gridProd.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-add]');
    if (!btn) return;
    upsertProducto(btn.dataset.add, 1);
  });

  // Registrar
  btnRegistrar?.addEventListener('click', registrarTicket);

  // ===== Init =====
  // Inicia deshabilitado hasta que suban/tomen foto o elijan "Editar manualmente"
  enableForm(false);
  updatePuntosResumen();

  // Aviso HTTPS para cámara
  if ((!window.isSecureContext && location.hostname !== 'localhost') ||
      (location.protocol !== 'https:' && location.hostname !== 'localhost')) {
    setStatus("Para usar la cámara en móviles, abre el sitio con HTTPS.", "err");
  }
})();
