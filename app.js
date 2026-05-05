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
const LEFT_SPOTS = Array.from({length: 34}, (_, i) => i + 1);
const ELECTRIC_SPOTS = [59, 65];
// Инвалидные места: 61,62,63,72,73,74,75
const DISABLED_SPOTS = [61, 62, 63, 72, 73, 74, 75];

// Группы для верхнего ряда: start, end, label
const TOP_GROUPS = [
  { start: 36, end: 41, label: "Парковка гостиничного оператора" },
  { start: 42, end: 60, label: "Парковка собственников апартаментов" },
  { start: 61, end: 63, label: "♿ Места для инвалидов (ГО)" },
  { start: 64, end: 71, label: "Парковка собственников апартаментов" },
  { start: 72, end: 72, label: "♿ ГО" },
  { start: 73, end: 91, label: "Парковка собственников апартаментов" }
];

let currentUser = null;
let currentRole = "viewer";
let parkingData = {};
let selectedSpot = null;

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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      currentRole = userDoc.data().role || "viewer";
    } else {
      await setDoc(doc(db, "users", user.uid), { email: user.email, role: "viewer" });
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

// === ОТРИСОВКА ===
function renderParking() {
  renderTopRow();
  renderLeftColumn();
}

function renderTopRow() {
  const container = document.getElementById("top-row-container");
  container.innerHTML = "";

  TOP_GROUPS.forEach((group, index) => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "top-group";

    // Подпись группы
    const labelDiv = document.createElement("div");
    labelDiv.className = "top-group-label";
    labelDiv.textContent = group.label;
    groupDiv.appendChild(labelDiv);

    // Контейнер для мест
    const spotsContainer = document.createElement("div");
    spotsContainer.className = "top-group-spots";
    for (let num = group.start; num <= group.end; num++) {
      spotsContainer.appendChild(createSpot(num));
    }
    groupDiv.appendChild(spotsContainer);

    container.appendChild(groupDiv);
  });
}

function renderLeftColumn() {
  const leftEl = document.getElementById("left-spots");
  leftEl.innerHTML = "";
  LEFT_SPOTS.forEach(num => leftEl.appendChild(createSpot(num)));
}

function createSpot(num) {
  const div = document.createElement("div");
  div.className = "spot";
  div.dataset.num = num;

  if (ELECTRIC_SPOTS.includes(num)) {
    div.classList.add("electric");
    div.innerHTML = `<span class="spot-icon">⚡</span><span class="spot-num">${num}</span>`;
  } else if (DISABLED_SPOTS.includes(num)) {
    div.classList.add("disabled");
    div.innerHTML = `<span class="spot-icon">♿</span><span class="spot-num">${num}</span>`;
  } else {
    div.innerHTML = `<span class="spot-num">${num}</span>`;
  }
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

function subscribeToParking() {
  onSnapshot(collection(db, "parking"), (snap) => {
    parkingData = {};
    snap.forEach(d => parkingData[d.id] = d.data());
    updateSpotStatuses();
  });
}

setInterval(updateSpotStatuses, 60 * 1000);

// === МОДАЛКА ===
function openModal(num) {
  selectedSpot = num;
  document.getElementById("modal-title").textContent = `Место №${num}`;
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
  if (data.until) {
    const d = new Date(data.until);
    const pad = n => String(n).padStart(2, "0");
    document.getElementById("until-input").value =
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    document.getElementById("until-input").value = "";
  }

  const isEditor = currentRole === "editor";
  document.getElementById("apart-input").disabled = !isEditor;
  document.getElementById("plate-input").disabled = !isEditor;
  document.getElementById("until-input").disabled = !isEditor;
  document.getElementById("save-btn").style.display = isEditor ? "inline-block" : "none";
  document.getElementById("clear-btn").style.display = isEditor && (data.apart || data.plate) ? "inline-block" : "none";

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
      apart, plate,
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.style.display === "flex") closeModal();
});