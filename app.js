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
const ELECTRIC_SPOTS = [59, 65];
const DISABLED_SPOTS = [61, 62, 63, 71, 72, 73, 74, 75];

// Группы для верхнего ряда
const TOP_GROUPS = [
  { start: 36, end: 41, label: "Парковка гостиничного оператора" },
  { start: 42, end: 60, label: "Парковка собственников апартаментов" },
  { start: 61, end: 63, label: "♿Места для инвалидов(ГО)" },
  { start: 64, end: 70, label: "Парковка собственников апартаментов" },
  { start: 71, end: 71, label: "♿(ГО)" },
  { start: 72, end: 82, label: "Парковка собственников апартаментов" },
  { start: 83, end: 91, label: "🏢 Парковка управляющей компании" }
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
  function adjustLabelsHeight() {
  const labels = document.querySelectorAll('.left-labels-column .vertical-label');
  const spotGroups = document.querySelectorAll('.spots-vertical .spot');
  
  if (labels.length === 4 && spotGroups.length === 34) {
    // Высота блока 28-34 (7 мест)
    const block1Height = 0;
    for (let i = 27; i < 34; i++) { // места 28-34 в индексах 27-33
      const spotHeight = spotGroups[i]?.offsetHeight || 32;
      block1Height += spotHeight + 2; // +2px за gap
    }
    if (block1Height) labels[0].style.height = (block1Height - 2) + 'px';
    
    // Высота блока 19-27 (9 мест)
    let block2Height = 0;
    for (let i = 18; i < 27; i++) {
      const spotHeight = spotGroups[i]?.offsetHeight || 32;
      block2Height += spotHeight + 2;
    }
    if (block2Height) labels[1].style.height = (block2Height - 2) + 'px';
    
    // Высота блока 10-18 (9 мест)
    let block3Height = 0;
    for (let i = 9; i < 18; i++) {
      const spotHeight = spotGroups[i]?.offsetHeight || 32;
      block3Height += spotHeight + 2;
    }
    if (block3Height) labels[2].style.height = (block3Height - 2) + 'px';
    
    // Высота блока 1-9 (9 мест)
    let block4Height = 0;
    for (let i = 0; i < 9; i++) {
      const spotHeight = spotGroups[i]?.offsetHeight || 32;
      block4Height += spotHeight + 2;
    }
    if (block4Height) labels[3].style.height = (block4Height - 2) + 'px';
  }
}

// Вызвать после рендера
setTimeout(adjustLabelsHeight, 100);
});

// === ОТРИСОВКА ===
function renderParking() {
  renderTopRow();
  renderLeftColumn();
}

function renderTopRow() {
  const container = document.getElementById("top-row-container");
  if (!container) return;
  container.innerHTML = "";

  TOP_GROUPS.forEach((group) => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "top-group";

    const labelDiv = document.createElement("div");
    labelDiv.className = "top-group-label";
    labelDiv.textContent = group.label;
    groupDiv.appendChild(labelDiv);

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
  const spotsColumn = document.getElementById("left-spots-column");
  if (!spotsColumn) return;
  spotsColumn.innerHTML = "";
  
  // Создаём контейнер для всех мест (один вертикальный столбец)
  const allSpotsContainer = document.createElement("div");
  allSpotsContainer.className = "spots-vertical";
  
  // ВАЖНО: добавляем места от 1 до 34 (1 будет первым в DOM, но CSS развернёт)
  // Благодаря flex-direction: column-reverse, место 1 окажется внизу, 34 наверху
  for (let num = 1; num <= 34; num++) {
    allSpotsContainer.appendChild(createSpot(num));
  }
  
  spotsColumn.appendChild(allSpotsContainer);
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
  } else if (num >= 83 && num <= 91) {
    div.classList.add("management");
    div.innerHTML = `<span class="spot-num">${num}</span>`;
  } else {
    div.innerHTML = `<span class="spot-num">${num}</span>`;
  }
  div.onclick = () => openModal(num);
  return div;
}

// === ОБНОВЛЕНИЕ СТАТУСОВ ===
function updateSpotStatuses() {
  document.querySelectorAll(".spot").forEach(el => {
    const num = parseInt(el.dataset.num);
    const data = parkingData[num];

    el.classList.remove("busy", "expired", "management-busy", "management-expired");
    el.removeAttribute("data-guest");

    const isManagement = (num >= 83 && num <= 91);
    
    if (data && (data.apart || data.plate)) {
      const now = new Date();
      const until = data.until ? new Date(data.until) : null;
      
      let isExpired = (until && until < now);
      
      if (isManagement) {
        if (isExpired) {
          el.classList.add("management-expired");
        } else {
          el.classList.add("management-busy");
        }
      } else {
        if (isExpired) {
          el.classList.add("expired");
        } else {
          el.classList.add("busy");
        }
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
  } else if (num >= 83 && num <= 91) {
    typeInfo.textContent = "🏢 Место управляющей компании";
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
