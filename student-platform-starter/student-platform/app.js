
const API_BASE = "https://school-server.rfat27406.workers.dev";

const STORAGE_PROFILE = "madrasati_student_profile_v1";
const STORAGE_TOKEN = "madrasati_student_token_v1";
const STORAGE_REMINDER = "madrasati_student_reminder_v1";
const STORAGE_REGISTRATION = "madrasati_student_registration_v1";
let registrationPollTimer = null;

const $ = (id) => document.getElementById(id);
const readStoredJSON = (key, fallback = null) => {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { localStorage.removeItem(key); return fallback; }
};

let profile = null;
let token = localStorage.getItem(STORAGE_TOKEN);
let bookings = [];
let groups = [];
let dailyBookingLimit = { limit: 3, used: 0, remaining: 3 };
let toastTimer;
let reminderTimers = [];
let knownNotificationIds = new Set();
let notificationPollTimer = null;

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "تعذر الاتصال بالسيرفر.");
  }

  return data;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function saveProfile() {
  localStorage.setItem(STORAGE_PROFILE, JSON.stringify(profile));
}

function showWelcome() {
  $("app").classList.add("hidden");
  $("registrationWaitingPage")?.classList.add("hidden");
  $("welcomeScreen").classList.remove("hidden");
  $("profileForm")?.querySelector('[type="submit"]')?.removeAttribute("disabled");
}

async function showApp() {
  $("welcomeScreen").classList.add("hidden");
  $("app").classList.remove("hidden");

  const fullName = `${profile.firstName} ${profile.lastName}`;

  $("headerName").textContent = fullName;
  $("welcomeName").textContent = profile.firstName;
  $("avatarInitials").textContent = profile.firstName.slice(0, 1);
  $("profileSummary").textContent = `${fullName} · العمر ${profile.age} سنة`;

  $("reminderToggle").checked =
    localStorage.getItem(STORAGE_REMINDER) === "true";

  try {
    await loadGroups();
    await loadBookings();
    await loadDailyBookingLimit();
    await refreshNotifications(false);
    scheduleNotificationPolling();
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Service worker registration failed:", error));
    }
    renderGroups();
    renderBookings();
    renderStats();
  } catch (error) {
    showToast(error.message);
  }
}

function showRegistrationPending(registration, rejected = false) {
  $("app").classList.add("hidden");
  $("welcomeScreen").classList.add("hidden");
  const waiting = $("registrationWaitingPage");
  if (!waiting) return;
  waiting.classList.remove("hidden");
  const name = `${registration.first_name || ""} ${registration.last_name || ""}`.trim();
  waiting.innerHTML = rejected
    ? `<div class="welcome-card waiting-card"><div class="status-icon">!</div><span class="status-pill">تمت مراجعة الطلب</span><h2>لم تتم الموافقة على طلب التسجيل</h2><p>عذراً ${escapeHtml(name)}، لم تتم الموافقة على طلبك.</p><p class="form-error">${escapeHtml(registration.rejection_reason || "يمكنك إرسال طلب جديد.")}</p><button class="button button-primary button-wide" id="returnToRegistration">العودة إلى صفحة التسجيل</button></div>`
    : `<div class="welcome-card waiting-card"><div class="status-icon">⌛</div><span class="status-pill">قيد المراجعة</span><h2>صفحة الانتظار</h2><p>مرحباً ${escapeHtml(name)}، تم استلام طلبك بنجاح.</p><p>انتظر حتى تقوم الإدارة بتفعيل حسابك. بعد التفعيل ستنتقل تلقائياً إلى الصفحة الرئيسية.</p><p class="tiny-note">يتم تحديث حالة الطلب تلقائياً كل 15 ثانية.</p><button class="button button-wide" id="checkRegistrationNow">التحقق من الحالة الآن</button></div>`;
  $("returnToRegistration")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_REGISTRATION);
    if (registrationPollTimer) clearInterval(registrationPollTimer);
    registrationPollTimer = null;
    waiting.classList.add("hidden");
    showWelcome();
  });
  $("checkRegistrationNow")?.addEventListener("click", checkRegistrationStatus);
}

async function registrationApi(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${readStoredJSON(STORAGE_REGISTRATION, {})?.token || ""}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "تعذر الاتصال بالسيرفر.");
  return data;
}

async function checkRegistrationStatus() {
  const saved = readStoredJSON(STORAGE_REGISTRATION);
  if (!saved?.token) return;
  try {
    const status = await registrationApi("/api/registration/status");
    const registration = status.registration;
    if (registration.status === "approved") {
      const claimed = await registrationApi("/api/registration/claim", { method: "POST" });
      token = claimed.access_token;
      profile = { firstName: claimed.student.first_name, lastName: claimed.student.last_name, age: claimed.student.age };
      localStorage.setItem(STORAGE_TOKEN, token);
      saveProfile();
      localStorage.removeItem(STORAGE_REGISTRATION);
      $("registrationWaitingPage")?.classList.add("hidden");
      if (registrationPollTimer) clearInterval(registrationPollTimer);
      registrationPollTimer = null;
      await showApp();
      showToast("تمت الموافقة على طلبك. مرحباً بك!");
      return;
    }
    if (registration.status === "rejected") {
      localStorage.removeItem(STORAGE_REGISTRATION);
      if (registrationPollTimer) clearInterval(registrationPollTimer);
      registrationPollTimer = null;
      $("registrationWaitingPage")?.classList.add("hidden");
      showWelcome();
      $("profileError").textContent =
        `تم رفض طلب التسجيل. ${registration.rejection_reason || "يمكنك مراجعة الإدارة أو إرسال طلب جديد."}`;
      return "rejected";
    }
    showRegistrationPending(registration, false);
    return registration.status;
  } catch (error) { console.warn("تعذر تحديث حالة طلب التسجيل:", error); }
}

// إنشاء حساب التلميذ في قاعدة البيانات
$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const normalizeName = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const firstName = normalizeName($("firstName").value);
  const lastName = normalizeName($("lastName").value);
  const age = Number($("age").value);

  if (!firstName || !lastName || firstName.length > 40 || lastName.length > 40 ||
      !Number.isInteger(age) || age < 15 || age > 18) {
    $("profileError").textContent =
      "تحقق من الاسم واللقب (40 حرفاً كحد أقصى) ومن العمر (15 إلى 18 سنة).";
    return;
  }

  const submitButton = $("profileForm").querySelector('[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    const data = await api("/api/students", {
      method: "POST",
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        age
      })
    });

    localStorage.setItem(STORAGE_REGISTRATION, JSON.stringify({ token: data.request_token }));
    $("profileError").textContent = "";
    showRegistrationPending(data.request, false);
    showToast("تم إرسال طلبك إلى الإدارة للمراجعة.");
    if (registrationPollTimer) clearInterval(registrationPollTimer);
    registrationPollTimer = setInterval(checkRegistrationStatus, 15000);

  } catch (error) {
    $("profileError").textContent = error.message;
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

// جلب الأفواج من السيرفر
async function loadGroups() {
  const data = await api("/api/groups");

  groups = data.groups.map(g => ({
    id: Number(g.id),
    teacherId: g.teacher_id,
    name: g.name,
    day: g.weekday === "friday" ? "الجمعة" : "السبت",
    dayKey: g.weekday,
    start: g.start_time,
    end: g.end_time,
    price: Number(g.price_dzd),
    teacherName: g.teacher_name || "الأستاذ",
    subject: g.subject || ""
  }));
}

async function loadTeachers() {
  const data = await api("/api/teachers");
  const teachers = data.teachers || [];
  const container = $("teacherList");
  if (!container) return;
  $("teacherCount").textContent = teachers.length;
  container.innerHTML = teachers.map(t => {
    const teacherGroups = groups.filter(g => g.teacherId === t.id);
    return `<article class="teacher-card">
      <div class="teacher-avatar">${escapeHtml((t.name || "أ").slice(0,1))}</div>
      <div class="teacher-info"><h3>${escapeHtml(t.name)}</h3>
      <p>${escapeHtml(t.subject)} · ${escapeHtml(t.education_level)}</p>
      <div class="teacher-tags"><span>${teacherGroups.length} أفواج متاحة</span></div></div>
    </article>`;
  }).join("") || "<p>لا يوجد أساتذة متاحون حالياً.</p>";
}

// جلب اشتراكات التلميذ الحقيقية
async function loadBookings() {
  const data = await api("/api/bookings");

  bookings = data.bookings.map(b => ({
    id: b.id,
    groupId: Number(b.group_id),
    sessionDate: b.session_date,
    day: b.weekday === "friday" ? "الجمعة" : "السبت",
    start: b.start_time,
    end: b.end_time,
    price: Number(b.price_dzd),
    teacherName: b.teacher_name || "الأستاذ",
    groupName: b.group_name || `الفوج ${b.group_id}`,
    status: b.status,
    paymentStatus: b.payment_status
  }));
}

async function loadDailyBookingLimit() {
  dailyBookingLimit = await api("/api/bookings/daily-limit");
  const status = $("dailyBookingLimit");
  if (status) {
    status.textContent = `سجلت اليوم في ${dailyBookingLimit.used} من أصل 3 أفواج · المتبقي ${dailyBookingLimit.remaining}`;
  }
}

function renderGroups() {
  const makeDayContent = dayGroups => {
    const buckets = new Map();
    dayGroups.forEach(group => {
      const key = `${group.teacherName}|||${group.subject}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(group);
    });
    return [...buckets.entries()].map(([key, teacherGroups]) => {
      const [teacherName, subject] = key.split("|||");
      const cards = teacherGroups.map(g => {
        const alreadyBooked = bookings.some(
          b => b.groupId === g.id && b.sessionDate === nextSessionDate(g) && b.status !== "cancelled"
        );
        const windowOpen = isRegistrationWindowOpen();
        const unavailableReason = !windowOpen ? "التسجيل مغلق حالياً" : (dailyBookingLimit.remaining <= 0 ? "اكتمل حد اليوم" : "اشترك في الحصة");
        return `<article class="group-card">
          <div class="group-top"><span class="group-number">الفوج ${g.id}</span><span class="group-day">${g.day}</span></div>
          <h4>${escapeHtml(g.name || `الفوج ${g.id}`)}</h4>
          <div class="group-time">◷ ${g.start} — ${g.end}</div>
          <div class="group-bottom">
            <div class="price">${g.price}<small>دج / الحصة</small></div>
            <button class="join-button" data-join="${g.id}" ${(alreadyBooked || dailyBookingLimit.remaining <= 0 || !windowOpen) ? "disabled" : ""}>
              ${alreadyBooked ? "تم التسجيل" : unavailableReason}
            </button>
          </div>
        </article>`;
      }).join("");
      return `<section class="teacher-group-section">
        <div class="teacher-group-heading"><h4>${escapeHtml(teacherName)}</h4><span>${escapeHtml(subject || "المادة غير محددة")}</span></div>
        <div class="groups-grid">${cards}</div>
      </section>`;
    }).join("") || '<p class="empty-hint">لا توجد أفواج متاحة حالياً.</p>';
  };
  $("fridayGroups").innerHTML = makeDayContent(groups.filter(g => g.dayKey === "friday"));
  $("saturdayGroups").innerHTML = makeDayContent(groups.filter(g => g.dayKey === "saturday"));
  document.querySelectorAll("[data-join]").forEach(btn => {
    btn.addEventListener("click", () => joinGroup(Number(btn.dataset.join)));
  });
}

// حساب أقرب تاريخ قادم يوافق يوم الفوج
function nextSessionDate(group) {
  const now = new Date();

  const algeriaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const [year, month, day] = algeriaDate.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day, 12));

  const wantedDay = group.dayKey === "friday" ? 5 : 6;
  let difference = (wantedDay - current.getUTCDay() + 7) % 7;

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const time = Object.fromEntries(
    timeParts.filter(p => p.type !== "literal").map(p => [p.type, p.value])
  );

  const currentMinutes = Number(time.hour) * 60 + Number(time.minute);
  const startMinutes =
    Number(group.start.slice(0, 2)) * 60 +
    Number(group.start.slice(3, 5));

  if (difference === 0 && startMinutes <= currentMinutes) {
    difference = 7;
  }

  current.setUTCDate(current.getUTCDate() + difference);
  return current.toISOString().slice(0, 10);
}

// التسجيل الحقيقي في السيرفر
async function joinGroup(id) {
  const group = groups.find(g => g.id === id);
  if (!group) return;

  const btn = document.querySelector(`[data-join="${id}"]`);
  if (btn) btn.disabled = true;

  try {
    const sessionDate = nextSessionDate(group);

    await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        group_id: id,
        session_date: sessionDate
      })
    });

    await loadBookings();
    await loadDailyBookingLimit();
    scheduleSessionReminders();
    renderGroups();
    renderBookings();
    renderStats();

    showToast(`تم تسجيلك بنجاح في الفوج ${id}.`);

  } catch (error) {
    showToast(error.message);
    if (btn) btn.disabled = false;
  }
}

function renderBookings() {
  const container = $("bookingList");

  if (!bookings.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">▤</div>
        <strong>لا توجد اشتراكات بعد</strong>
        <span>عندما تسجل في أحد الأفواج سيظهر هنا.</span>
      </div>`;
    return;
  }

  container.innerHTML = bookings.map(b => `
    <article class="booking-item">
      <div class="booking-date">▤</div>
      <div class="booking-details">
        <strong>${escapeHtml(b.teacherName)} · ${escapeHtml(b.groupName)}</strong>
        <p>${b.sessionDate} · ${b.day} · ${b.start} إلى ${b.end} · ${b.price} دج</p>
      </div>
      <span class="booking-status ${b.status === "cancelled" ? "booking-status-cancelled" : ""}">${b.status === "cancelled" ? "ملغى" : b.status === "attended" ? "حضر" : b.status === "absent" ? "غائب" : "تم التسجيل"}</span>
    </article>
  `).join("");
}

function renderStats() {
  const activeBookings = bookings.filter(b => b.status !== "cancelled");
  $("statBookings").textContent = activeBookings.length;

  $("statHours").textContent = activeBookings.reduce((sum, b) => {
    const start = Number(b.start.slice(0, 2)) * 60 +
      Number(b.start.slice(3, 5));
    const end = Number(b.end.slice(0, 2)) * 60 +
      Number(b.end.slice(3, 5));
    return sum + (end - start) / 60;
  }, 0);

  $("statCost").textContent = activeBookings.reduce(
    (sum, b) => sum + b.price, 0
  ).toLocaleString("ar-DZ");
}

function navigate(target) {
  document.querySelectorAll(".page-section").forEach(section =>
    section.classList.toggle("hidden", section.id !== target)
  );

  document.querySelectorAll(".nav-link").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.target === target)
  );

  const titles = {
    home: "الرئيسية",
    "my-bookings": "اشتراكاتي",
    statistics: "إحصائياتي",
    settings: "الإعدادات"
  };

  $("pageHeading").textContent = titles[target] || "الرئيسية";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link").forEach(btn =>
  btn.addEventListener("click", () => navigate(btn.dataset.target))
);

document.querySelectorAll("[data-scroll]").forEach(btn =>
  btn.addEventListener("click", () => {
    $("groups").scrollIntoView({ behavior: "smooth" });
  })
);

// تم إخفاء/إزالة وظيفة تسجيل الخروج من واجهة التلميذ.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function enableRealPushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) {
    throw new Error("هذا المتصفح لا يدعم الإشعارات الفورية أو أن الموقع ليس HTTPS.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("لم تسمح بإظهار الإشعارات.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { publicKey } = await api("/api/push/public-key");
  if (!publicKey) throw new Error("مفتاح الإشعارات غير متوفر على الخادم.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }
  await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON())
  });
  return true;
}

async function disableRealPushNotifications() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  try {
    await api("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
  } finally {
    await subscription.unsubscribe();
  }
}

$("reminderToggle").addEventListener("change", async (event) => {
  const enabled = event.target.checked;
  event.target.disabled = true;
  try {
    if (enabled) {
      await enableRealPushNotifications();
      localStorage.setItem(STORAGE_REMINDER, "true");
      showToast("تم تفعيل الإشعارات الفورية وتذكير الحصة قبل 30 دقيقة.");
    } else {
      await disableRealPushNotifications();
      localStorage.setItem(STORAGE_REMINDER, "false");
      showToast("تم إيقاف الإشعارات على هذا الجهاز.");
    }
  } catch (error) {
    event.target.checked = !enabled;
    showToast(error.message || "تعذر إعداد الإشعارات.");
  } finally {
    event.target.disabled = false;
  }
});

async function refreshNotifications(announceNew = false) {
  const data = await api("/api/notifications");
  const items = data.notifications || [];
  const fresh = items.filter(item => !knownNotificationIds.has(item.id));

  if (announceNew && fresh.length) {
    const newest = fresh[0];
    showToast(fresh.length === 1
      ? `إشعار جديد: ${newest.title}`
      : `لديك ${fresh.length} إشعارات جديدة.`);
  }

  items.forEach(item => knownNotificationIds.add(item.id));
  return items;
}

function scheduleNotificationPolling() {
  if (notificationPollTimer) clearInterval(notificationPollTimer);
  // يجلب الإشعارات الجديدة كل دقيقة ما دام فضاء التلميذ مفتوحاً.
  notificationPollTimer = setInterval(async () => {
    if (!token || !profile) return;
    try {
      await refreshNotifications(true);
    } catch (error) {
      console.warn("تعذر تحديث الإشعارات:", error);
    }
  }, 60000);
}

function showNotificationCenter(items) {
  document.getElementById("studentNotificationsOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "studentNotificationsOverlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:#0b1734aa;display:grid;place-items:center;padding:18px;";
  const cards = items.length ? items.slice(0, 30).map(item => `
    <article style="padding:14px;border:1px solid #e5eaf2;border-radius:14px;background:#fff;margin-top:10px">
      <b style="display:block;color:#17233d">${escapeHtml(item.title)}</b>
      <p style="white-space:pre-wrap;line-height:1.8;color:#53627b;margin:8px 0">${escapeHtml(item.message)}</p>
      <small style="color:#8290a8">${escapeHtml(item.created_at || "")}</small>
    </article>
  `).join("") : '<p style="color:#718096;text-align:center;padding:24px">لا توجد إشعارات حالياً.</p>';
  overlay.innerHTML = `
    <section style="width:min(620px,100%);max-height:80vh;overflow:auto;background:#f7f9fd;border-radius:20px;padding:20px;box-shadow:0 24px 80px #0004">
      <header style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <h2 style="margin:0;color:#17233d;font-size:19px">مركز الإشعارات</h2>
        <button type="button" id="closeStudentNotifications" style="border:0;background:#e8edf6;border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer">إغلاق</button>
      </header>
      ${cards}
    </section>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", event => {
    if (event.target === overlay || event.target.id === "closeStudentNotifications") overlay.remove();
  });
}

$("notificationButton").addEventListener("click", async () => {
  try {
    const items = await refreshNotifications(false);
    showNotificationCenter(items);
  } catch (error) {
    showToast(error.message);
  }
});


// تشغيل التطبيق
async function startApp() {
  try {
    profile = readStoredJSON(STORAGE_PROFILE);
  } catch {
    profile = null;
  }

  const pendingRegistration = readStoredJSON(STORAGE_REGISTRATION);
  if (pendingRegistration?.token) {
    const registrationStatus = await checkRegistrationStatus();
    if (registrationStatus === "pending" && localStorage.getItem(STORAGE_REGISTRATION)) {
      registrationPollTimer = setInterval(checkRegistrationStatus, 15000);
    }
    return;
  }
  if (!profile || !token) {
    showWelcome();
    return;
  }

  try {
    await api("/api/me");
    await showApp();
  } catch (error) {
    localStorage.removeItem(STORAGE_PROFILE);
    localStorage.removeItem(STORAGE_TOKEN);
    profile = null;
    token = null;
    showWelcome();
    showToast("انتهت جلسة الدخول. يرجى إنشاء الحساب من جديد.");
  }
}

startApp();

setInterval(async () => {
  if (!token || $("app")?.classList.contains("hidden")) return;
  try {
    await loadDailyBookingLimit();
    renderGroups();
  } catch (error) {
    console.warn("تعذر تحديث حالة نافذة التسجيل:", error);
  }
}, 60000);
