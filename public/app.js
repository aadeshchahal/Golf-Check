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

// course selector: load the registry, render a chip per course (all selected
// by default), plus an "All" convenience chip.
const coursesEl = $("courses");
const allBtn = coursesEl.querySelector('button[data-course="all"]');
let courseChips = [];

function selectedCourseIds() {
  return courseChips.filter((b) => b.classList.contains("active")).map((b) => b.dataset.course);
}

function syncAllChip() {
  const all = courseChips.length > 0 && courseChips.every((b) => b.classList.contains("active"));
  allBtn.classList.toggle("active", all);
}

fetch("/api/courses")
  .then((r) => r.json())
  .then((list) => {
    for (const c of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.course = c.id;
      btn.textContent = c.name;
      btn.classList.add("active");
      coursesEl.appendChild(btn);
      courseChips.push(btn);
    }
    syncAllChip();
  })
  .catch(() => {});

coursesEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-course]");
  if (!btn) return;
  if (btn === allBtn) {
    for (const b of courseChips) b.classList.add("active");
  } else {
    // toggle, but never let the selection drop to zero
    if (btn.classList.contains("active") && selectedCourseIds().length === 1) return;
    btn.classList.toggle("active");
  }
  syncAllChip();
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

let currentStream = null;

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (currentStream) {
    currentStream.close();
    currentStream = null;
  }

  const params = new URLSearchParams({
    date: $("date").value,
    time: $("time").value,
    window: $("window").value,
    players: $("players").value,
    holes: String(holes),
  });

  // Only send `courses` when it's a strict subset; all-selected = search all.
  const selected = selectedCourseIds();
  if (selected.length && selected.length < courseChips.length) {
    params.set("courses", selected.join(","));
  }

  $("status").textContent = "Searching…";
  $("status").className = "status muted";
  $("results").hidden = true;
  $("courseStatus").innerHTML = "";

  const tbody = $("results").querySelector("tbody");
  tbody.innerHTML = "";

  let allTeeTimes = [];
  const courseStatuses = [];

  const es = new EventSource(`/api/availability?${params}`);
  currentStream = es;
  
  es.onmessage = (event) => {
    if (event.data === "[DONE]") {
      es.close();
      currentStream = null;
      const n = allTeeTimes.length;
      $("status").textContent = n
        ? `${n} tee time${n === 1 ? "" : "s"} found.`
        : "No tee times match those filters.";
      $("status").className = "status";
      $("results").hidden = n === 0;
      
      const rows = courseStatuses
        .map((c) => {
          if (c.ok) return `<li>${c.course}: ${c.teeTimes.length} match${c.teeTimes.length === 1 ? "" : "es"}</li>`;
          return `<li class="err">${c.course}: ${c.error}</li>`;
        })
        .join("");
      $("courseStatus").innerHTML = `<summary>Course status</summary><ul>${rows}</ul>`;
      return;
    }

    const c = JSON.parse(event.data);
    courseStatuses.push(c);
    
    if (c.ok && c.teeTimes.length > 0) {
      allTeeTimes.push(...c.teeTimes);
      allTeeTimes.sort((a, b) => a.localTime.localeCompare(b.localTime) || a.course.localeCompare(b.course));
      
      tbody.innerHTML = "";
      for (const t of allTeeTimes) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td data-label="Time">${fmtTime(t.localTime)}</td>
          <td data-label="Course">${t.course}</td>
          <td data-label="Holes">${t.holes}</td>
          <td data-label="Open spots"><span class="pill">${t.playersAvailable}</span></td>
          <td data-label="Price">${fmtPrice(t)}</td>
          <td><a class="book" href="${t.bookingUrl}" target="_blank" rel="noopener">Book ↗</a></td>`;
        tbody.appendChild(tr);
      }
      $("results").hidden = false;
      
      const n = allTeeTimes.length;
      $("status").textContent = `Searching… (${n} found so far)`;
    }
  };

  es.onerror = (err) => {
    es.close();
    currentStream = null;
    if (allTeeTimes.length === 0) {
      $("status").textContent = `Error connecting to stream.`;
      $("status").className = "status err";
    }
  };
});
