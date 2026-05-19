import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyClZAZqezdYTrR0k7aA-QWoJrL_6Ex04-I",
  authDomain: "albahotel-38d36.firebaseapp.com",
  projectId: "albahotel-38d36",
  storageBucket: "albahotel-38d36.firebasestorage.app",
  messagingSenderId: "98903143411",
  appId: "1:98903143411:web:f085c67febb25ecf325886",
  measurementId: "G-QM40D0T1H0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let allLogs = [];
let unsubscribeLogs = null;

const filterDateFrom = document.getElementById("filter-date-from");
const filterDateTo = document.getElementById("filter-date-to");
const filterUser = document.getElementById("filter-user");
const filterAction = document.getElementById("filter-action");
const filterSpot = document.getElementById("filter-spot");
const cardsContainer = document.getElementById("cards-container");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "superadmin") {
    alert("Доступ запрещён. Только для суперадминистратора.");
    window.location.href = "index.html";
    return;
  }
  startRealtimeLogs();
});

function formatUntil(untilISO) {
  if (!untilISO) return "—";
  const d = new Date(untilISO);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function filterLogs(log) {
  if (filterDateFrom.value && new Date(log.timestamp) < new Date(filterDateFrom.value)) return false;
  if (filterDateTo.value && new Date(log.timestamp) > new Date(filterDateTo.value)) return false;
  if (filterUser.value.trim() && !(log.user || "").toLowerCase().includes(filterUser.value.trim().toLowerCase())) return false;
  if (filterAction.value && log.action !== filterAction.value) return false;
  if (filterSpot.value && log.spotNum !== parseInt(filterSpot.value)) return false;
  return true;
}

function formatDetailBlock(apart, plate, until) {
  let html = '';
  if (apart) html += `<span class="detail-apart">ап.${apart}</span> `;
  if (plate) html += `<span class="detail-plate">г/н ${plate}</span> `;
  if (until) html += `<span class="detail-until">до ${formatUntil(until)}</span>`;
  else html += `<span class="detail-until">до —</span>`;
  return html;
}

function renderCards() {
  const filtered = allLogs.filter(filterLogs);
  cardsContainer.innerHTML = '';
  if (filtered.length === 0) {
    cardsContainer.innerHTML = '<div style="text-align:center; padding:40px;">Нет записей</div>';
    return;
  }
  filtered.forEach(log => {
    const card = document.createElement('div');
    card.className = 'log-card';
    const timestamp = new Date(log.timestamp).toLocaleString();
    const user = log.user || log.userId;
    let badgeClass = '';
    let actionText = '';
    if (log.action === 'create') { badgeClass = 'badge-create'; actionText = 'Создание'; }
    else if (log.action === 'update') { badgeClass = 'badge-update'; actionText = 'Изменение'; }
    else if (log.action === 'delete') { badgeClass = 'badge-delete'; actionText = 'Удаление'; }
    const spot = log.spotNum;
    let detailsHtml = '';
    if (log.action === 'delete') {
      const old = log.oldData || {};
      detailsHtml = `Было: ${formatDetailBlock(old.apart, old.plate, old.until)}`;
    } else if (log.action === 'create') {
      const newd = log.newData || {};
      detailsHtml = `Стало: ${formatDetailBlock(newd.apart, newd.plate, newd.until)}`;
    } else if (log.action === 'update') {
      const old = log.oldData || {};
      const newd = log.newData || {};
      detailsHtml = `${formatDetailBlock(old.apart, old.plate, old.until)} <span class="detail-arrow">→</span> ${formatDetailBlock(newd.apart, newd.plate, newd.until)}`;
    }
    card.innerHTML = `
      <div class="log-card-row"><span class="log-card-label">📅 Дата:</span><span class="log-card-value">${timestamp}</span></div>
      <div class="log-card-row"><span class="log-card-label">👤 Пользователь:</span><span class="log-card-value">${escapeHtml(user)}</span></div>
      <div class="log-card-row"><span class="log-card-label">⚡ Действие:</span><span class="log-card-value"><span class="badge ${badgeClass}">${actionText}</span></span></div>
      <div class="log-card-row"><span class="log-card-label">🅿️ Место:</span><span class="log-card-value">${spot}</span></div>
      <div class="log-card-row"><span class="log-card-label">📝 Детали:</span><span class="log-card-value">${detailsHtml}</span></div>
    `;
    cardsContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function startRealtimeLogs() {
  if (unsubscribeLogs) unsubscribeLogs();
  const q = query(collection(db, "parking_logs"), orderBy("timestamp", "desc"));
  unsubscribeLogs = onSnapshot(q, (snapshot) => {
    allLogs = [];
    snapshot.forEach(doc => allLogs.push(doc.data()));
    renderCards();
  }, (error) => {
    console.error(error);
    cardsContainer.innerHTML = '<div style="text-align:center; padding:40px;">Ошибка загрузки логов</div>';
  });
}

document.getElementById("apply-filters").onclick = () => renderCards();
document.getElementById("reset-filters").onclick = () => {
  filterDateFrom.value = "";
  filterDateTo.value = "";
  filterUser.value = "";
  filterAction.value = "";
  filterSpot.value = "";
  renderCards();
};