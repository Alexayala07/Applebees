// --------- Estado global ---------
const productosSeleccionados = [];
let ocrProcesado = false;
let filtroTexto = "";
let mediaStream = null; // para la cámara

// --------- Utilidades ---------
function norm(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function upsertProducto(nombre, cantidad = 1) {
  const idx = productosSeleccionados.findIndex(x => norm(x.nombre) === norm(nombre));
  if (idx >= 0) productosSeleccionados[idx].cantidad += cantidad;
  else productosSeleccionados.push({ nombre, cantidad });
}

function actualizarListaProductos() {
  const lista = document.getElementById('listaProductos');
  if (!lista) return;
  lista.innerHTML = "";
  productosSeleccionados.forEach((prod, i) => {
    const p = document.createElement('p');
    p.textContent = `• ${prod.nombre} (x${prod.cantidad})`;
    const quitar = document.createElement('button');
    quitar.textContent = "Quitar";
    quitar.onclick = () => { productosSeleccionados.splice(i, 1); actualizarListaProductos(); };
    p.appendChild(quitar);
    lista.appendChild(p);
  });
}

function setBloqueHabilitado(enabled) {
  const ids = [
    'inputTicketNumero','inputTicketFecha','nuevoProducto','nuevaCantidad',
    'btnAgregarProducto','buscarProducto','inputTicketTotal','btnRegistrarTicket'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

// --------- Catálogo base (ejemplos; reemplaza imágenes por tus assets) ---------
const catalogoProductos = [
  { name: "Hamburguesa Clásica", keywords: ["hamburguesa", "burger"], img: "https://picsum.photos/seed/burger/600/600" },
  { name: "Hamburguesa BBQ", keywords: ["hamburguesa bbq", "bbq burger", "bbq"], img: "https://picsum.photos/seed/bbq/600/600" },
  { name: "Hamburguesa Doble", keywords: ["hamburguesa doble", "double burger"], img: "https://picsum.photos/seed/double/600/600" },
  { name: "Papas Fritas", keywords: ["papas fritas", "french fries", "papas"], img: "https://picsum.photos/seed/fries/600/600" },
  { name: "Aros de Cebolla", keywords: ["aros de cebolla", "onion rings"], img: "https://picsum.photos/seed/onion/600/600" },
  { name: "Alitas BBQ", keywords: ["alitas", "alitas bbq", "wings"], img: "https://picsum.photos/seed/wings/600/600" },
  { name: "Pasta Alfredo", keywords: ["pasta alfredo", "alfredo"], img: "https://picsum.photos/seed/pasta/600/600" },
  { name: "Ensalada César", keywords: ["ensalada cesar", "cesar salad"], img: "https://picsum.photos/seed/salad/600/600" },
  { name: "Malteada Vainilla", keywords: ["malteada vainilla", "shake vainilla"], img: "https://picsum.photos/seed/milk1/600/600" },
  { name: "Malteada Chocolate", keywords: ["malteada chocolate", "shake chocolate"], img: "https://picsum.photos/seed/milk2/600/600" },
  { name: "Limonada", keywords: ["limonada", "lemonade"], img: "https://picsum.photos/seed/lemon/600/600" },
  { name: "Refresco", keywords: ["refresco", "soda", "coca", "pepsi"], img: "https://picsum.photos/seed/soda/600/600" },
  { name: "Brownie", keywords: ["brownie"], img: "https://picsum.photos/seed/brownie/600/600" },
];

// --------- Detección desde OCR ---------
function detectarProductosDesdeTexto(textoOCR) {
  const t = norm(textoOCR);
  const lineas = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const cantidadReg = /(?:\bx\s?(\d{1,2})\b)|^(?:\s*(\d{1,2}))\s/; // "x2" o "2 ..."

  catalogoProductos.forEach(item => {
    const kws = item.keywords.map(norm);
    let totalItem = 0;

    lineas.forEach(l => {
      if (kws.some(k => l.includes(k))) {
        let cant = 1;
        const m = l.match(cantidadReg);
        if (m) {
          cant = parseInt(m[1] || m[2] || "1", 10);
          if (!Number.isFinite(cant) || cant <= 0) cant = 1;
        }
        totalItem += cant;
      }
    });

    if (totalItem > 0) upsertProducto(item.name, totalItem);
  });

  actualizarListaProductos();
}

// --------- Render catálogo (grid + buscador) ---------
function filtrarCatalogo() {
  let items = catalogoProductos;
  if (filtroTexto.trim()) {
    const q = norm(filtroTexto);
    items = items.filter(p => norm(p.name).includes(q) || p.keywords.some(k => norm(k).includes(q)));
  }
  return items;
}

function renderProductos() {
  const grid = document.getElementById("productosGrid");
  if (!grid) return;
  const data = filtrarCatalogo();
  grid.innerHTML = "";

  if (data.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No se encontraron productos.";
    empty.style.opacity = 0.8;
    grid.appendChild(empty);
    return;
  }

  data.forEach(p => {
    const card = document.createElement("div");
    card.className = "prod-card";

    const img = document.createElement("img");
    img.className = "prod-img";
    img.alt = p.name;
    img.src = p.img;
    img.onerror = () => { img.src = "placeholder.png"; }; // tu placeholder local

    const name = document.createElement("div");
    name.className = "prod-name";
    name.textContent = p.name;

    card.appendChild(img);
    card.appendChild(name);

    card.addEventListener("click", () => {
      upsertProducto(p.name, 1);
      actualizarListaProductos();
      toast(`${p.name} agregado`);
    });

    grid.appendChild(card);
  });
}

// --------- OCR ---------
async function procesarTicketOCR() {
  const status = document.getElementById('ocrStatus');
  const fileInput = document.getElementById('ticketFile');
  const file = fileInput?.files?.[0];

  if (!file) {
    if (status) {
      status.textContent = "⚠️ Primero selecciona o toma una foto del ticket.";
      status.style.color = "orange";
    }
    return;
  }

  // Reset
  productosSeleccionados.length = 0;
  actualizarListaProductos();
  setBloqueHabilitado(false);
  ocrProcesado = false;
  if (status) {
    status.style.color = "#ffdfaa";
    status.textContent = "⏳ Procesando ticket... esto puede tardar unos segundos.";
  }

  try {
    const { data } = await Tesseract.recognize(file, 'spa', {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress && status) {
          status.textContent = `⏳ Procesando ticket... ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    const texto = data?.text || "";

    // Número de ticket (heurístico)
    const numMatch = texto.match(/\b(\d{5,})\b/);
    if (numMatch) {
      const elNum = document.getElementById('inputTicketNumero');
      if (elNum) elNum.value = numMatch[1];
    }

    // Fecha (dd/mm/aaaa o dd-mm-aa/aaaa)
    const fechaMatch = texto.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\b/);
    if (fechaMatch) {
      const f = fechaMatch[1].replace(/-/g,'/');
      const [d,m,y] = f.split('/');
      let yyyy = y; let mm = m; let dd = d;
      if (y.length === 2) yyyy = '20' + y;
      const iso = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
      const elFecha = document.getElementById('inputTicketFecha');
      if (elFecha && !Number.isNaN(Date.parse(iso))) elFecha.value = iso;
    }

    // Productos
    detectarProductosDesdeTexto(texto);

    // Total (toma el mayor monto con 2 decimales)
    const montos = [...texto.matchAll(/\b(\d{1,5}[.,]\d{2})\b/g)].map(m => parseFloat(m[1].replace(',','.')));
    if (montos.length) {
      const total = Math.max(...montos);
      const elTotal = document.getElementById('inputTicketTotal');
      if (elTotal) elTotal.value = total.toFixed(2);
    }

    setBloqueHabilitado(true);
    ocrProcesado = true;
    if (status) {
      status.style.color = "lightgreen";
      status.textContent = "✅ Ticket procesado. Revisa productos y completa los datos si algo faltó.";
    }
  } catch (err) {
    console.error(err);
    if (status) {
      status.style.color = "red";
      status.textContent = "❌ No se pudo leer el ticket. Intenta con una foto más clara y plana.";
    }
    setBloqueHabilitado(false);
    ocrProcesado = false;
  }
}

// --------- Registro final ---------
async function registrarTicketManual() {
  const validacion = document.getElementById('ticketValidacion');
  const foto = document.getElementById('ticketFile')?.files?.[0] || null;

  if (!foto || !ocrProcesado) {
    if (validacion) {
      validacion.textContent = "⚠️ Debes subir y procesar la foto del ticket primero.";
      validacion.style.color = "orange";
    }
    return;
  }

  const numero = document.getElementById('inputTicketNumero')?.value.trim();
  const fecha = document.getElementById('inputTicketFecha')?.value;
  const total = document.getElementById('inputTicketTotal')?.value;

  if (!numero || !fecha || !total || productosSeleccionados.length === 0) {
    if (validacion) {
      validacion.textContent = "⚠️ Completa número, fecha, total y verifica que haya productos.";
      validacion.style.color = "orange";
    }
    return;
  }

  // Aquí iría tu guardado real (Storage + Firestore)
  console.log({
    numero,
    fecha,
    total: parseFloat(total),
    productos: productosSeleccionados,
    foto
  });

  if (validacion) {
    validacion.textContent = "✅ Ticket registrado correctamente.";
    validacion.style.color = "lightgreen";
  }
}

// --------- Cámara ---------
function abrirCamara() {
  const modal = document.getElementById('cameraModal');
  const video = document.getElementById('cameraVideo');
  if (!modal || !video) return;

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false
  }).then(stream => {
    mediaStream = stream;
    video.srcObject = stream;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }).catch(err => {
    console.error(err);
    alert("No se pudo acceder a la cámara. Revisa permisos del navegador.");
  });
}

function cerrarCamara() {
  const modal = document.getElementById('cameraModal');
  const video = document.getElementById('cameraVideo');

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (video) video.srcObject = null;
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function capturarFoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  if (!video || !canvas) return;

  const w = video.videoWidth || 1080;
  const h = video.videoHeight || 1440; // vertical recomendado para tickets
  canvas.width = w; canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);

  canvas.toBlob(blob => {
    if (!blob) return;
    const file = new File([blob], `ticket_${Date.now()}.jpg`, { type: "image/jpeg" });
    const input = document.getElementById('ticketFile');

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;

    cerrarCamara();

    const st = document.getElementById('ocrStatus');
    if (st) {
      st.style.color = "#ffdfaa";
      st.textContent = "📷 Foto capturada. Ahora presiona 'Procesar ticket (OCR)'.";
    }
  }, "image/jpeg", 0.92);
}

// --------- Toast ---------
let toastTimeout;
function toast(msg) {
  clearTimeout(toastTimeout);
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimeout = setTimeout(() => el.remove(), 1600);
}

// --------- Init ---------
document.addEventListener('DOMContentLoaded', () => {
  // Botones principales
  document.getElementById('btnProcesarTicket')?.addEventListener('click', procesarTicketOCR);
  document.getElementById('btnRegistrarTicket')?.addEventListener('click', registrarTicketManual);
  document.getElementById('btnAgregarProducto')?.addEventListener('click', () => {
    const nombre = document.getElementById('nuevoProducto')?.value.trim();
    const cantidad = parseInt(document.getElementById('nuevaCantidad')?.value);
    if (!nombre || !cantidad || cantidad <= 0) return alert("🛑 Ingresa nombre y cantidad válida.");
    upsertProducto(nombre, cantidad);
    actualizarListaProductos();
    document.getElementById('nuevoProducto').value = "";
    document.getElementById('nuevaCantidad').value = "";
  });

  // Buscador de catálogo
  const inputBuscar = document.getElementById("buscarProducto");
  inputBuscar?.addEventListener("input", (e) => {
    filtroTexto = e.target.value || "";
    renderProductos();
  });

  // Cámara
  document.getElementById('btnAbrirCamara')?.addEventListener('click', abrirCamara);
  document.getElementById('btnCerrarCamara')?.addEventListener('click', cerrarCamara);
  document.getElementById('btnCapturar')?.addEventListener('click', capturarFoto);

  // Render inicial catálogo y bloqueo del formulario
  renderProductos();
  setBloqueHabilitado(false);
});
