const STORAGE_PROFILE = "madrasati_student_profile_v1";
const STORAGE_BOOKINGS = "madrasati_student_bookings_v1";
const STORAGE_REMINDER = "madrasati_student_reminder_v1";
const groups = [
  {id:1, day:"الجمعة", dayKey:"friday", start:"08:00", end:"10:00"},
  {id:2, day:"الجمعة", dayKey:"friday", start:"10:00", end:"12:00"},
  {id:3, day:"الجمعة", dayKey:"friday", start:"14:00", end:"16:00"},
  {id:4, day:"السبت", dayKey:"saturday", start:"08:00", end:"10:00"},
  {id:5, day:"السبت", dayKey:"saturday", start:"10:00", end:"12:00"}
];
const $ = (id) => document.getElementById(id);
let profile = null;
let bookings = [];
let toastTimer;

function loadState() {
  try { profile = JSON.parse(localStorage.getItem(STORAGE_PROFILE) || "null"); } catch { profile = null; }
  try { bookings = JSON.parse(localStorage.getItem(STORAGE_BOOKINGS) || "[]"); } catch { bookings = []; }
}
function saveBookings() { localStorage.setItem(STORAGE_BOOKINGS, JSON.stringify(bookings)); }
function showToast(message) {
  const toast = $("toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function showApp() {
  $("welcomeScreen").classList.add("hidden"); $("app").classList.remove("hidden");
  const fullName = `${profile.firstName} ${profile.lastName}`;
  $("headerName").textContent = fullName; $("welcomeName").textContent = profile.firstName;
  $("avatarInitials").textContent = profile.firstName.slice(0,1);
  $("profileSummary").textContent = `${fullName} · العمر ${profile.age} سنة`;
  $("reminderToggle").checked = localStorage.getItem(STORAGE_REMINDER) === "true";
  renderGroups(); renderBookings(); renderStats();
}
function showWelcome() { $("app").classList.add("hidden"); $("welcomeScreen").classList.remove("hidden"); }
$("profileForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const firstName = $("firstName").value.trim(), lastName = $("lastName").value.trim();
  const age = Number($("age").value);
  if (!firstName || !lastName || !Number.isInteger(age) || age < 15 || age > 18) {
    $("profileError").textContent = "يرجى إدخال الاسم واللقب، وأن يكون العمر بين 15 و18 سنة."; return;
  }
  profile = {firstName, lastName, age};
  localStorage.setItem(STORAGE_PROFILE, JSON.stringify(profile));
  $("profileError").textContent = ""; showApp();
});
function renderGroups() {
  const makeCard = g => `<article class="group-card">
    <div class="group-top"><span class="group-number">الفوج ${g.id}</span><span class="group-day">${g.day}</span></div>
    <h4>فوج البكالوريا ${g.id}</h4><div class="group-time">◷ ${g.start} — ${g.end}</div>
    <div class="group-bottom"><div class="price">300 <small>دج / الحصة</small></div>
    <button class="join-button" data-join="${g.id}" ${bookings.some(b=>b.groupId===g.id)?"disabled":""}>${bookings.some(b=>b.groupId===g.id)?"تم التسجيل":"اشترك في الحصة"}</button></div>
  </article>`;
  $("fridayGroups").innerHTML = groups.filter(g=>g.dayKey==="friday").map(makeCard).join("");
  $("saturdayGroups").innerHTML = groups.filter(g=>g.dayKey==="saturday").map(makeCard).join("");
  document.querySelectorAll("[data-join]").forEach(btn => btn.addEventListener("click", () => joinGroup(Number(btn.dataset.join))));
}
function algeriaNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone:"Africa/Algiers", weekday:"long", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).formatToParts(new Date());
  return Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
}
function canRegisterPreview() {
  const now = algeriaNow();
  const allowedDay = now.weekday === "Friday" || now.weekday === "Saturday";
  const minutes = Number(now.hour)*60 + Number(now.minute);
  return allowedDay && minutes >= 450 && minutes < 960;
}
function joinGroup(id) {
  const group = groups.find(g=>g.id===id);
  if (!group || bookings.some(b=>b.groupId===id)) return;
  // واجهة تجريبية فقط؛ القرار النهائي يجب أن يصدر من السيرفر بعد ربط API.
  if (!canRegisterPreview()) {
    showToast("التسجيل متاح يومي الجمعة والسبت فقط من 07:30 إلى 16:00 بتوقيت الجزائر."); return;
  }
  bookings.push({groupId:id, day:group.day, start:group.start, end:group.end, price:300, createdAt:new Date().toISOString(), status:"registered"});
  saveBookings(); renderGroups(); renderBookings(); renderStats();
  showToast(`تم تسجيلك بنجاح في الفوج ${id}.`);
}
function renderBookings() {
  const container = $("bookingList");
  if (!bookings.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">▤</div><strong>لا توجد اشتراكات بعد</strong><span>عندما تسجل في أحد الأفواج سيظهر هنا.</span></div>`; return;
  }
  container.innerHTML = bookings.map(b=>`<article class="booking-item"><div class="booking-date">▤</div><div class="booking-details"><strong>الأستاذ بومدين · الفوج ${b.groupId}</strong><p>${b.day} · ${b.start} إلى ${b.end} · 300 دج</p></div><span class="booking-status">تم التسجيل</span></article>`).join("");
}
function renderStats() {
  $("statBookings").textContent = bookings.length;
  $("statHours").textContent = bookings.reduce((sum,b)=>sum + ((Number(b.end.slice(0,2))*60+Number(b.end.slice(3))) - (Number(b.start.slice(0,2))*60+Number(b.start.slice(3))))/60,0);
  $("statCost").textContent = (bookings.length*300).toLocaleString("ar-DZ");
}
function navigate(target) {
  document.querySelectorAll(".page-section").forEach(section=>section.classList.toggle("hidden",section.id!==target));
  document.querySelectorAll(".nav-link").forEach(btn=>btn.classList.toggle("active",btn.dataset.target===target));
  const titles = {home:"الرئيسية","my-bookings":"اشتراكاتي",statistics:"إحصائياتي",settings:"الإعدادات"};
  $("pageHeading").textContent = titles[target] || "الرئيسية";
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll(".nav-link").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.target)));
document.querySelectorAll("[data-scroll]").forEach(btn=>btn.addEventListener("click",()=>{$("groups").scrollIntoView({behavior:"smooth"});}));
$("logoutBtn").addEventListener("click",()=>{localStorage.removeItem(STORAGE_PROFILE);profile=null;showWelcome();showToast("تم تسجيل الخروج من هذا الجهاز.");});
$("reminderToggle").addEventListener("change", async (event)=>{
  if (event.target.checked && "Notification" in window) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { event.target.checked=false; localStorage.setItem(STORAGE_REMINDER,"false"); showToast("لم يتم السماح بإشعارات المتصفح."); return; }
  }
  localStorage.setItem(STORAGE_REMINDER,String(event.target.checked));
  showToast(event.target.checked?"تم تفعيل إذن التذكيرات على هذا الجهاز.":"تم إيقاف التذكيرات.");
});
$("notificationButton").addEventListener("click",()=>showToast("لا توجد إشعارات جديدة حالياً."));
loadState();
if (profile && profile.firstName && profile.lastName && profile.age>=15 && profile.age<=18) showApp(); else showWelcome();
