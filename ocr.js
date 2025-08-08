const auth = firebase.auth();
const db = firebase.firestore();

async function leerTicket() {
  const file = document.getElementById("ticketImage").files[0];
  if (!file) return alert("Selecciona una imagen");

  const image = URL.createObjectURL(file);
  document.getElementById("ocrResult").innerText = "🕐 Escaneando ticket...";

  const { data: { text } } = await Tesseract.recognize(image, 'spa', {
    logger: m => console.log(m)
  });

  document.getElementById("ocrResult").innerText = text;

  const user = auth.currentUser;
  if (!user) return alert("Debes iniciar sesión");

  // 🧠 Extraer info (muy básico, se puede mejorar con regex)
  const ticketID = text.match(/Ticket\s*#?\s*(\d+)/i)?.[1] || "SIN-ID";
  const total = parseFloat(text.match(/\$([\d.]+)/)?.[1]) || 0;
  const fecha = new Date();

  // 🏅 Calcula puntos
  let puntos = 0;
  if (/hamburguesa/i.test(text)) puntos += 10;
  if (/café/i.test(text)) puntos += 3;
  if (/papas/i.test(text)) puntos += 2;

  // Validar que no sea duplicado
  const snapshot = await db.collection("tickets")
    .where("usuario", "==", user.uid)
    .where("ticketID", "==", ticketID)
    .get();

  if (!snapshot.empty) {
    return alert("❌ Este ticket ya fue escaneado.");
  }

  // Validar límite de 3 tickets al día
  const hoy = new Date().toDateString();
  const hoyTickets = await db.collection("tickets")
    .where("usuario", "==", user.uid)
    .get();

  const countHoy = hoyTickets.docs.filter(doc => {
    const f = doc.data().fecha?.toDate().toDateString();
    return f === hoy;
  }).length;

  if (countHoy >= 3) {
    return alert("⚠️ Ya escaneaste 3 tickets hoy.");
  }

  const fechaVence = new Date();
  fechaVence.setDate(fecha.getDate() + 180);

  // Guardar ticket
  await db.collection("tickets").add({
    usuario: user.uid,
    ticketID,
    fecha: firebase.firestore.Timestamp.fromDate(fecha),
    vence: firebase.firestore.Timestamp.fromDate(fechaVence),
    puntos,
    total,
    textoOCR: text
  });

  alert(`✅ Ticket guardado. Puntos ganados: ${puntos}`);
}
