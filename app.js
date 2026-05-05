// === ИМПОРТЫ FIREBASE ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signInWithPopup,
  GoogleAuthProvider, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, deleteDoc, onSnapshot,
  collection, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === КОНФИГ FIREBASE ===
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

// === КОНФИГ ПАРКОВКИ ===
// Левый вертикальный ряд: 1–34 (нумерация снизу вверх)
const LEFT_SPOTS = Array.from({length: 34}, (_, i) => i + 1);
// Верхний горизонтальный ряд: 36–91
const TOP_SPOTS  = Array.from({length: 56}, (_, i) => i + 36);
// Электрозарядки (фиолетовые)
const ELECTRIC_SPOTS = [59, 65];
// Места для инвалидов (белые с ♿)
const DISABLED_SPOTS = [60, 61, 62, 63, 71, 72, 73, 74, 75];

// === СОСТОЯНИЕ ===
let currentUser = null;
let currentRole = "viewer"; // editor / viewer
let parkingData = {};       // { "1": {apart, plate, until, ...}, ... }
let selectedSpot = null;

// === ЭЛЕМЕНТЫ ===
const loginScreen = document.getElementById("login-screen");
const mainScreen  = document.getElementById("main-screen");
const loginError  = document.getElementById("login-error");
const modal       = document.getElementById("modal");

// === АВТОРИЗАЦИЯ ===
document.getElementById("login-btn").onclick = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    loginError.textContent = "Ошибка: " + e.message;
  }
};

document.getElementById("google-btn").onclick = async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    loginError.textContent = "Ошибка: " + e.message;
  }
};

document.getElementById("logout-btn").onclick = () => signOut(auth);

// При смене состояния авторизации
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;

    // Проверяем роль в коллекции users
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      currentRole = userDoc.data().role || "viewer";
    } else {
      // Первый вход — создаём как viewer
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        role: "viewer"
      });
      currentRole = "viewer";
    }

    loginScreen.style.display = "none";
    mainScreen.style.display = "block";
    document.getElementById("user-info").textContent = user.email;

    const roleEl = document.getElementById("user-role");
    roleEl.textContent = currentRole === "editor" ? "✏️ Редактор" : "👁 Просмотр";
    roleEl.className = currentRole;

    renderParking();
    subscribeToParking();
  } else {
    currentUser = null;
    loginScreen.style.display = "block";
    mainScreen.style.display = "none";
  }
});

// === ОТРИСОВКА ПАРКОВКИ ===
function renderParking() {
  // Верхний ряд (36–91)
  const topEl = document.getElementById("top-spots");
  topEl.innerHTML = "";
  TOP_SPOTS.forEach(num => topEl.appendChild(createSpot(num)));

  // Левый ряд (1–34) — column-reverse в CSS, поэтому добавляем по порядку
  const leftEl = document.getElementById("left-spots");
  leftEl.innerHTML = "";
  LEFT_SPOTS.forEach(num => leftEl.appendChild(createSpot(num)));
}

function createSpot(num) {
  const div = document.createElement("div");
  div.className = "spot";
  div.dataset.num = num;

  let icon = "";
  if (ELECTRIC_SPOTS.includes(num)) {
    div.classList.add("electric");
    icon = '<span class="spot-icon">⚡</span>';
  } else if (DISABLED_SPOTS.includes(num)) {
    div.classList.add("disabled");
    icon = '<span class="spot-icon">♿</span>';
  }

  div.innerHTML = `${icon}<span class="spot-num">${num}</span>`;
  div.onclick = () => openModal(num);
  return div;
}

// === ОБНОВЛЕНИЕ СТАТУСОВ ===
function updateSpotStatuses() {
  document.querySelectorAll(".spot").forEach(el => {
    const num = el.dataset.num;
    const data = parkingData[num];

    el.classList.remove("busy", "expired");
    el.removeAttribute("data-guest");

    if (data && (data.apart || data.plate)) {
      const now = new Date();
      const until = data.until ? new Date(data.until) : null;

      if (until && until < now) {
        el.classList.add("expired");
      } else {
        el.classList.add("busy");
      }

      const parts = [];
      if (data.apart) parts.push("№" + data.apart);
      if (data.plate) parts.push(data.plate);
      let label = parts.join(" / ");
      if (until) {
        label += ` (до ${until.toLocaleString("ru-RU", {
          day: "2-digit", month: "2-digit",
          hour: "2-digit", minute: "2-digit"
        })})`;
      }
      el.dataset.guest = label;
    }
  });
}

// === ПОДПИСКА НА ИЗМЕНЕНИЯ ===
function subscribeToParking() {
  onSnapshot(collection(db, "parking"), (snap) => {
    parkingData = {};
    snap.forEach(d => parkingData[d.id] = d.data());
    updateSpotStatuses();
  });
}

// Каждую минуту перепроверяем "истёкшие" брони
setInterval(updateSpotStatuses, 60 * 1000);

// === МОДАЛКА ===
function openModal(num) {
  selectedSpot = num;
  document.getElementById("modal-title").textContent = `Место №${num}`;

  // Информация о типе места
  const typeInfo = document.getElementById("modal-spot-type");
  if (ELECTRIC_SPOTS.includes(Number(num))) {
    typeInfo.textContent = "⚡ Место для электрозарядки";
    typeInfo.classList.add("visible");
  } else if (DISABLED_SPOTS.includes(Number(num))) {
    typeInfo.textContent = "♿ Место для инвалидов";
    typeInfo.classList.add("visible");
  } else {
    typeInfo.textContent = "";
    typeInfo.classList.remove("visible");
  }

  const data = parkingData[num] || {};
  document.getElementById("apart-input").value = data.apart || "";
  document.getElementById("plate-input").value = data.plate || "";

  // datetime-local требует формат YYYY-MM-DDTHH:mm
  if (data.until) {
    const d = new Date(data.until);
    const pad = n => String(n).padStart(2, "0");
    document.getElementById("until-input").value =
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    document.getElementById("until-input").value = "";
  }

  // Права доступа
  const isEditor = currentRole === "editor";
  document.getElementById("apart-input").disabled = !isEditor;
  document.getElementById("plate-input").disabled = !isEditor;
  document.getElementById("until-input").disabled = !isEditor;
  document.getElementById("save-btn").style.display  = isEditor ? "inline-block" : "none";
  document.getElementById("clear-btn").style.display =
    isEditor && (data.apart || data.plate) ? "inline-block" : "none";

  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
  selectedSpot = null;
}

document.getElementById("close-btn").onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

// === СОХРАНЕНИЕ ===
document.getElementById("save-btn").onclick = async () => {
  if (!selectedSpot) return;
  if (currentRole !== "editor") {
    alert("У вас нет прав на редактирование");
    return;
  }

  const apart = document.getElementById("apart-input").value.trim();
  const plate = document.getElementById("plate-input").value.trim();
  const untilVal = document.getElementById("until-input").value;

  if (!apart && !plate) {
    alert("Укажите № апарта или гос. номер");
    return;
  }

  try {
    await setDoc(doc(db, "parking", String(selectedSpot)), {
      apart,
      plate,
      until: untilVal ? new Date(untilVal).toISOString() : null,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.email
    });
    closeModal();
  } catch (e) {
    alert("Ошибка сохранения: " + e.message);
  }
};

// === ОЧИСТКА ===
document.getElementById("clear-btn").onclick = async () => {
  if (!selectedSpot) return;
  if (currentRole !== "editor") return;
  if (!confirm(`Освободить место №${selectedSpot}?`)) return;

  try {
    await deleteDoc(doc(db, "parking", String(selectedSpot)));
    closeModal();
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

// Закрытие по Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.style.display === "flex") closeModal();
});
