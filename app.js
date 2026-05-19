// === ИМПОРТЫ FIREBASE ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signInWithPopup,
  GoogleAuthProvider, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, deleteDoc, onSnapshot,
  collection, getDoc, addDoc
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

// === ЗВУКОВОЕ УВЕДОМЛЕНИЕ ===
let lastExpiredCount = 0;
let notificationInterval = null;
let audioContext = null;

function initAudioContext() {
  if (audioContext) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const unlock = () => {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
          console.log("AudioContext разблокирован");
          document.removeEventListener('click', unlock);
          document.removeEventListener('touchstart', unlock);
        });
      }
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
  } catch(e) {
    console.warn("Web Audio API не поддерживается");
  }
}

function playBeep() {
  if (currentRole !== 'editor' && currentRole !== 'curator' && currentRole !== 'superadmin') return;
  initAudioContext();
  if (!audioContext) {
    try {
      const audio = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZA==');
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch(e) {}
    return;
  }
  try {
    const ctx = audioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.3;
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
    oscillator.stop(ctx.currentTime + 0.5);
    if (ctx.state === 'suspended') ctx.resume();
  } catch(e) {
    console.warn("Ошибка воспроизведения звука", e);
  }
}

function checkExpiredSpotsAndNotify() {
  if (currentRole !== 'editor' && currentRole !== 'curator' && currentRole !== 'superadmin') return;
  const now = new Date();
  let expiredCount = 0;
  for (const spotNum in parkingData) {
    const data = parkingData[spotNum];
    if (data && data.until) {
      const untilDate = new Date(data.until);
      if (untilDate < now) expiredCount++;
    }
  }
  if (expiredCount > 0 && lastExpiredCount === 0) {
    playBeep();
    console.log(`🔔 Обнаружено ${expiredCount} просроченных мест`);
  }
  lastExpiredCount = expiredCount;
}

function startExpiredNotificationTimer() {
  if (notificationInterval) clearInterval(notificationInterval);
  notificationInterval = setInterval(() => {
    if (currentRole !== 'editor' && currentRole !== 'curator' && currentRole !== 'superadmin') return;
    let hasExpired = false;
    const now = new Date();
    for (const spotNum in parkingData) {
      const data = parkingData[spotNum];
      if (data && data.until && new Date(data.until) < now) {
        hasExpired = true;
        break;
      }
    }
    if (hasExpired) {
      playBeep();
      console.log("🔔 Напоминание: есть просроченные места");
    }
  }, 300000);
}

// === ФУНКЦИЯ ЛОГИРОВАНИЯ ===
async function addLog(action, spotNum, oldData, newData) {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "parking_logs"), {
      action,
      spotNum,
      oldData: oldData || null,
      newData: newData || null,
      user: currentUser.email,
      userId: currentUser.uid,
      userRole: currentRole,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error("Ошибка записи лога:", e);
  }
}

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

// === ПОДГОНКА ВЫСОТЫ ПОДПИСЕЙ ===
function adjustLabelsHeight() {
  const labels = document.querySelectorAll('.left-labels-column .vertical-label');
  const spotsContainer = document.querySelector('.spots-vertical');
  if (!labels.length || !spotsContainer) return;
  const spotElements = spotsContainer.querySelectorAll('.spot');
  if (spotElements.length !== 34) return;
  const getBlockHeight = (startIndex, count) => {
    let height = 0;
    for (let i = startIndex; i < startIndex + count; i++) {
      if (spotElements[i]) {
        height += spotElements[i].offsetHeight;
        if (i < startIndex + count - 1) height += 2;
      }
    }
    return height;
  };
  labels[0].style.height = getBlockHeight(27, 7) + 'px';
  labels[1].style.height = getBlockHeight(18, 9) + 'px';
  labels[2].style.height = getBlockHeight(9, 9) + 'px';
  labels[3].style.height = getBlockHeight(0, 9) + 'px';
}

// === ОТРИСОВКА ===
function renderParking() {
  renderTopRow();
  renderLeftColumn();
  setTimeout(adjustLabelsHeight, 50);
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
  const allSpotsContainer = document.createElement("div");
  allSpotsContainer.className = "spots-vertical";
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
        if (isExpired) el.classList.add("management-expired");
        else el.classList.add("management-busy");
      } else {
        if (isExpired) el.classList.add("expired");
        else el.classList.add("busy");
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
  checkExpiredSpotsAndNotify();
}

function subscribeToParking() {
  onSnapshot(collection(db, "parking"), (snap) => {
    parkingData = {};
    snap.forEach(d => parkingData[d.id] = d.data());
    updateSpotStatuses();
  });
}

setInterval(updateSpotStatuses, 60 * 1000);

function addLogsButton() {
  if (document.getElementById("logs-link")) return;
  const headerRight = document.querySelector(".header-right");
  if (!headerRight) {
    setTimeout(addLogsButton, 100);
    return;
  }
  const link = document.createElement("a");
  link.id = "logs-link";
  link.textContent = "📋 Журнал изменений";
  link.href = "logs.html";
  link.target = "_blank";
  link.style.cssText = "background:#3b82f6; color:white; border:none; border-radius:8px; padding:8px 12px; cursor:pointer; text-decoration:none; display:inline-block;";
  headerRight.appendChild(link);
}

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
  
  const untilInput = document.getElementById("until-input");
  const unlimitedCheckbox = document.getElementById("unlimited-checkbox");
  const unlimitedContainer = document.getElementById("unlimited-container");
  
  // Определяем, может ли пользователь использовать чекбокс "без ограничения"
  const canUseUnlimited = (currentRole === "curator" || currentRole === "superadmin");
  
  // Показываем/скрываем чекбокс в зависимости от прав
  if (unlimitedContainer) {
    unlimitedContainer.style.display = canUseUnlimited ? "flex" : "none";
  }
  
  if (data.until && data.until !== "") {
    const d = new Date(data.until);
    const pad = n => String(n).padStart(2, "0");
    untilInput.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    unlimitedCheckbox.checked = false;
    untilInput.disabled = false;
  } else {
    untilInput.value = "";
    if (canUseUnlimited) {
      unlimitedCheckbox.checked = false;
      untilInput.disabled = false;
    } else {
      unlimitedCheckbox.checked = false; // чекбокс скрыт, но для редактора всегда false
      untilInput.disabled = false;
    }
  }

  if (!unlimitedCheckbox.hasListener && canUseUnlimited) {
    unlimitedCheckbox.addEventListener('change', function(e) {
      untilInput.disabled = e.target.checked;
      if (e.target.checked) untilInput.value = "";
    });
    unlimitedCheckbox.hasListener = true;
  }

  const isEditor = (currentRole === "editor" || currentRole === "curator" || currentRole === "superadmin");
  document.getElementById("apart-input").disabled = !isEditor;
  document.getElementById("plate-input").disabled = !isEditor;
  // Поле даты отключается только если чекбокс видим и отмечен, иначе всегда активно (для редактора чекбокса нет, значит поле активно)
  if (canUseUnlimited && unlimitedCheckbox.checked) {
    untilInput.disabled = true;
  } else {
    untilInput.disabled = !isEditor;
  }
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

document.getElementById("save-btn").onclick = async () => {
  if (!selectedSpot) return;
  if (currentRole !== "editor" && currentRole !== "curator" && currentRole !== "superadmin") {
    alert("У вас нет прав на редактирование");
    return;
  }
  
  const apart = document.getElementById("apart-input").value.trim();
  const plate = document.getElementById("plate-input").value.trim();
  const untilInput = document.getElementById("until-input");
  const unlimitedCheckbox = document.getElementById("unlimited-checkbox");
  const canUseUnlimited = (currentRole === "curator" || currentRole === "superadmin");
  
  let isUnlimited = false;
  if (canUseUnlimited) {
    isUnlimited = unlimitedCheckbox.checked;
  }
  const untilValue = untilInput.value.trim();
  
  if (!isUnlimited && !untilValue) {
    alert("Укажите дату и время освобождения или (если есть права) поставьте галочку 'Без ограничения по времени'");
    return;
  }
  
  if (!apart && !plate) {
    alert("Укажите № апарта или гос. номер");
    return;
  }
  
  let finalUntil = null;
  if (!isUnlimited && untilValue) {
    const parsedDate = new Date(untilValue);
    if (isNaN(parsedDate.getTime())) {
      alert("Некорректная дата и время");
      return;
    }
    finalUntil = parsedDate.toISOString();
  }
  
  const oldData = parkingData[selectedSpot] || null;
  const isNew = !oldData || (!oldData.apart && !oldData.plate);
  
  try {
    await setDoc(doc(db, "parking", String(selectedSpot)), {
      apart, plate,
      until: finalUntil,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.email
    });
    await addLog(
      isNew ? 'create' : 'update',
      selectedSpot,
      oldData,
      { apart, plate, until: finalUntil }
    );
    closeModal();
  } catch (e) {
    alert("Ошибка сохранения: " + e.message);
  }
};

document.getElementById("clear-btn").onclick = async () => {
  if (!selectedSpot) return;
  if (currentRole !== "editor" && currentRole !== "curator" && currentRole !== "superadmin") return;
  if (!confirm(`Освободить место №${selectedSpot}?`)) return;
  try {
    const oldData = parkingData[selectedSpot] || null;
    await deleteDoc(doc(db, "parking", String(selectedSpot)));
    await addLog('delete', selectedSpot, oldData, null);
    document.getElementById("until-input").value = "";
    const unlimitedCheckbox = document.getElementById("unlimited-checkbox");
    const canUseUnlimited = (currentRole === "curator" || currentRole === "superadmin");
    if (canUseUnlimited) {
      unlimitedCheckbox.checked = false;
    }
    document.getElementById("until-input").disabled = false;
    closeModal();
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.style.display === "flex") closeModal();
});

// === АВТОРИЗАЦИЯ И СТАРТ ===
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
    console.log("User role:", currentRole);

    loginScreen.style.display = "none";
    mainScreen.style.display = "block";
    document.getElementById("user-info").textContent = user.email;
    const roleEl = document.getElementById("user-role");
    if (currentRole === "superadmin") roleEl.textContent = "👑 SuperAdmin";
    else if (currentRole === "curator") roleEl.textContent = "🔧 Куратор";
    else if (currentRole === "editor") roleEl.textContent = "✏️ Редактор";
    else roleEl.textContent = "👁 Просмотр";
    roleEl.className = currentRole;

    if (currentRole === "superadmin") {
      addLogsButton();
    } else {
      const existingBtn = document.getElementById("logs-link");
      if (existingBtn) existingBtn.remove();
    }

    renderParking();
    subscribeToParking();
    startExpiredNotificationTimer();
  } else {
    currentUser = null;
    loginScreen.style.display = "block";
    mainScreen.style.display = "none";
    if (notificationInterval) clearInterval(notificationInterval);
  }
});