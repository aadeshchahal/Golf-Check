// Minimal vanilla front-end: collect the form, hit /api/availability, render.
const $ = (id) => document.getElementById(id);
let holes = 18;

// default date = today
$("date").value = new Date().toISOString().slice(0, 10);

// time slider logic (6am to 8pm, 15 min increments)
const timeSlider = $("time-slider");
const timeDisplay = $("time-display");
const timeHidden = $("time");

function updateTimeDisplay() {
  const mins = parseInt(timeSlider.value, 10);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h <= 12 ? (h === 0 ? 12 : h) : h - 12;
  
  timeDisplay.textContent = `${h12}:${mm} ${ampm}`;
  timeHidden.value = `${hh}:${mm}`;
}

timeSlider.addEventListener("input", updateTimeDisplay);
updateTimeDisplay();

// 9/18 segmented toggle
$("holes").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-holes]");
  if (!btn) return;
  holes = Number(btn.dataset.holes);
  for (const b of $("holes").children) b.classList.toggle("active", b === btn);
});

function fmtPrice(t) {
  if (t.price == null) return "—";
  return `$${t.price.toFixed(0)} ${t.currency}`;
}

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = new URLSearchParams({
    date: $("date").value,
    time: $("time").value,
    window: $("window").value,
    players: $("players").value,
    holes: String(holes),
  });

  $("status").textContent = "Searching…";
  $("status").className = "status muted";
  $("results").hidden = true;
  $("courseStatus").innerHTML = "";

  let data;
  try {
    const res = await fetch(`/api/availability?${params}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  } catch (err) {
    $("status").textContent = `Error: ${err.message}`;
    $("status").className = "status err";
    return;
  }

  const tbody = $("results").querySelector("tbody");
  tbody.innerHTML = "";
  for (const t of data.teeTimes) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtTime(t.localTime)}</td>
      <td>${t.course}</td>
      <td>${t.holes}</td>
      <td><span class="pill">${t.playersAvailable}</span></td>
      <td>${fmtPrice(t)}</td>
      <td><a class="book" href="${t.bookingUrl}" target="_blank" rel="noopener">Book ↗</a></td>`;
    tbody.appendChild(tr);
  }

  const n = data.teeTimes.length;
  $("status").textContent = n
    ? `${n} tee time${n === 1 ? "" : "s"} found.`
    : "No tee times match those filters.";
  $("status").className = "status";
  $("results").hidden = n === 0;

  // per-course status (errors / counts) in a collapsible
  const rows = data.courses
    .map((c) => {
      if (c.ok) return `<li>${c.course}: ${c.teeTimes.length} match${c.teeTimes.length === 1 ? "" : "es"}</li>`;
      return `<li class="err">${c.course}: ${c.error}</li>`;
    })
    .join("");
  $("courseStatus").innerHTML = `<summary>Course status</summary><ul>${rows}</ul>`;
});
