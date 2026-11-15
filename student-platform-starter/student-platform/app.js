
const API_BASE = "https://school-server.rfat27406.workers.dev";

const STORAGE_PROFILE = "madrasati_student_profile_v1";
const STORAGE_TOKEN = "madrasati_student_token_v1";
const STORAGE_REMINDER = "madrasati_student_reminder_v1";

const $ = (id) => document.getElementById(id);

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
  $("welcomeScreen").classList.remove("hidden");
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
    await loadTeachers();
    await loadBookings();
    await loadDailyBookingLimit();
    await refreshNotifications(false);
    scheduleNotificationPolling();
    scheduleSessionReminders();
    renderGroups();
    renderBookings();
    renderStats();
  } catch (error) {
    showToast(error.message);
  }
}

// إنشاء حساب التلميذ في قاعدة البيانات
$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const firstName = $("firstName").value.trim();
  const lastName = $("lastName").value.trim();
  const age = Number($("age").value);

  if (!firstName || !lastName ||
      !Number.isInteger(age) || age < 15 || age > 18) {
    $("profileError").textContent =
      "يرجى إدخال الاسم واللقب، وأن يكون العمر بين 15 و18 سنة.";
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

    profile = { firstName, lastName, age };
    token = data.access_token;

    localStorage.setItem(STORAGE_TOKEN, token);
    saveProfile();

    $("profileError").textContent = "";
    showToast("تم إنشاء حسابك بنجاح.");
    await showApp();

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
  const makeCard = g => {
    const alreadyBooked = bookings.some(
      b => b.groupId === g.id && b.sessionDate === nextSessionDate(g)
    );

    return `<article class="group-card">
      <div class="group-top">
        <span class="group-number">الفوج ${g.id}</span>
        <span class="group-day">${g.day}</span>
      </div>
      <h4>${escapeHtml(g.name || `فوج البكالوريا ${g.id}`)}</h4>
      <p class="group-teacher">${escapeHtml(g.teacherName)} · ${escapeHtml(g.subject)}</p>
      <div class="group-time">◷ ${g.start} — ${g.end}</div>
      <div class="group-bottom">
        <div class="price">${g.price}
          <small>دج / الحصة</small>
        </div>
        <button class="join-button" data-join="${g.id}"
          ${(alreadyBooked || dailyBookingLimit.remaining <= 0) ? "disabled" : ""}>
          ${alreadyBooked ? "تم التسجيل" : (dailyBookingLimit.remaining <= 0 ? "اكتمل حد اليوم" : "اشترك في الحصة")}
        </button>
      </div>
    </article>`;
  };

  $("fridayGroups").innerHTML = groups
    .filter(g => g.dayKey === "friday")
    .map(makeCard).join("");

  $("saturdayGroups").innerHTML = groups
    .filter(g => g.dayKey === "saturday")
    .map(makeCard).join("");

  document.querySelectorAll("[data-join]").forEach(btn => {
    btn.addEventListener("click", () =>
      joinGroup(Number(btn.dataset.join))
    );
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
      <span class="booking-status">تم التسجيل</span>
    </article>
  `).join("");
}

function renderStats() {
  $("statBookings").textContent = bookings.length;

  $("statHours").textContent = bookings.reduce((sum, b) => {
    const start = Number(b.start.slice(0, 2)) * 60 +
      Number(b.start.slice(3, 5));
    const end = Number(b.end.slice(0, 2)) * 60 +
      Number(b.end.slice(3, 5));
    return sum + (end - start) / 60;
  }, 0);

  $("statCost").textContent = bookings.reduce(
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

// تسجيل الخروج من هذا الجهاز
$("logoutBtn").addEventListener("click", () => {
  if (notificationPollTimer) clearInterval(notificationPollTimer);
  notificationPollTimer = null;
  knownNotificationIds.clear();
  localStorage.removeItem(STORAGE_PROFILE);
  localStorage.removeItem(STORAGE_TOKEN);
  profile = null;
  token = null;
  bookings = [];
  showWelcome();
  showToast("تم تسجيل الخروج من هذا الجهاز.");
});

$("reminderToggle").addEventListener("change", async (event) => {
  if (event.target.checked && "Notification" in window) {
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      event.target.checked = false;
      localStorage.setItem(STORAGE_REMINDER, "false");
      showToast("لم يتم السماح بإشعارات المتصفح.");
      return;
    }
  }

  localStorage.setItem(
    STORAGE_REMINDER,
    String(event.target.checked)
  );

  scheduleSessionReminders();
  showToast(
    event.target.checked
      ? "تم تفعيل التذكيرات أثناء بقاء المنصة مفتوحة."
      : "تم إيقاف التذكيرات."
  );
});

async function refreshNotifications(announceNew = false) {
  const data = await api("/api/notifications");
  const items = data.notifications || [];
  const fresh = items.filter(item => !knownNotificationIds.has(item.id));

  if (announceNew && fresh.length) {
    const newest = fresh[0];
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      new Notification(newest.title, {
        body: newest.message,
        tag: `admin-notification-${newest.id}`
      });
    } else {
      showToast(fresh.length === 1
        ? `إشعار جديد: ${newest.title}`
        : `لديك ${fresh.length} إشعارات جديدة.`);
    }
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

function scheduleSessionReminders() {
  reminderTimers.forEach(timer => clearTimeout(timer));
  reminderTimers = [];
  if (localStorage.getItem(STORAGE_REMINDER) !== "true" ||
      !("Notification" in window) || Notification.permission !== "granted") return;

  for (const booking of bookings) {
    const sessionStart = new Date(`${booking.sessionDate}T${booking.start}:00+01:00`);
    const reminderAt = sessionStart.getTime() - 30 * 60 * 1000;
    const delay = reminderAt - Date.now();
    // مؤقت محلي يعمل فقط ما دامت الصفحة مفتوحة؛ Web Push مطلوب للتذكير بعد إغلاقها.
    if (delay > 0 && delay <= 2147480000) {
      const timer = setTimeout(() => {
        new Notification("تذكير بموعد حصتك", {
          body: `لديك حصة ${booking.groupId} بعد 30 دقيقة.`,
          tag: `booking-${booking.id}`
        });
      }, delay);
      reminderTimers.push(timer);
    }
  }
}

// تشغيل التطبيق
async function startApp() {
  try {
    profile = JSON.parse(
      localStorage.getItem(STORAGE_PROFILE) || "null"
    );
  } catch {
    profile = null;
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
