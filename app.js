const SECTIONS = [
  { id: "major", name: "Major" },
  { id: "minor", name: "Minor" },
  { id: "md", name: "MD (Multidisciplinary)" },
  { id: "skill", name: "Skill" },
  { id: "evs", name: "Environmental Science" },
  { id: "education", name: "Education" },
  { id: "health", name: "Health & Wellness" }
];

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.BA_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let section = SECTIONS[0].id;
let cat = "all";
let isAdmin = false;
let items = [];

// ---------- sections & tabs ----------
function renderNav() {
  const nav = $("sections");
  nav.textContent = "";
  SECTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.textContent = s.name;
    if (s.id === section) b.className = "active";
    b.onclick = () => { section = s.id; renderNav(); load(); };
    nav.appendChild(b);
  });
  $("secTitle").textContent = SECTIONS.find((s) => s.id === section).name;
}

$("tabs").onclick = (e) => {
  if (e.target.tagName !== "BUTTON") return;
  cat = e.target.dataset.cat;
  [...$("tabs").children].forEach((b) => b.classList.toggle("active", b === e.target));
  draw();
};
$("search").oninput = draw;

// ---------- load & draw ----------
async function load() {
  $("list").innerHTML = '<p class="empty">Loading…</p>';
  const { data, error } = await sb.from("items").select("*").eq("section", section).order("created_at", { ascending: false });
  if (error) { $("list").innerHTML = ""; const p = document.createElement("p"); p.className = "empty"; p.textContent = "Could not load: " + error.message; $("list").appendChild(p); return; }
  items = data;
  draw();
}

function isImage(it) { return (it.mime || "").startsWith("image/"); }

function draw() {
  const q = $("search").value.trim().toLowerCase();
  const list = $("list");
  list.textContent = "";
  const shown = items.filter((it) =>
    (cat === "all" || it.category === cat) &&
    (!q || it.title.toLowerCase().includes(q) || (it.year || "").includes(q))
  );
  if (!shown.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "Nothing here yet."; list.appendChild(p); return; }

  shown.forEach((it) => {
    const card = document.createElement("div"); card.className = "card";

    let thumb;
    if (isImage(it)) { thumb = document.createElement("img"); thumb.src = it.url; thumb.alt = ""; thumb.loading = "lazy"; }
    else { thumb = document.createElement("div"); thumb.textContent = it.kind === "link" ? "🔗" : "📄"; }
    thumb.className = "thumb";

    const info = document.createElement("div"); info.className = "info";
    const t = document.createElement("b"); t.textContent = it.title;
    const meta = document.createElement("div"); meta.className = "meta";
    const badge = document.createElement("span"); badge.className = "badge";
    badge.textContent = it.category === "pyq" ? "Question paper" : "Notes";
    meta.appendChild(badge);
    if (it.year) meta.appendChild(document.createTextNode(it.year + " · "));
    meta.appendChild(document.createTextNode(new Date(it.created_at).toLocaleDateString()));
    const open = document.createElement("button"); open.className = "viewbtn"; open.textContent = "View";
    open.onclick = () => openViewer(it);
    info.append(t, meta, open);
    card.append(thumb, info);

    if (isAdmin) {
      const d = document.createElement("button"); d.className = "del"; d.textContent = "Delete";
      d.onclick = () => removeItem(it);
      card.appendChild(d);
    }
    list.appendChild(card);
  });
}

// ---------- in-app viewer ----------
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}
let viewToken = 0;

function driveEmbed(url) {
  const m = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null;
}

async function renderPdf(url, body, token) {
  const note = document.createElement("p");
  note.className = "empty"; note.textContent = "Loading PDF…";
  body.appendChild(note);
  try {
    const pdf = await pdfjsLib.getDocument(url).promise;
    note.remove();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(body.clientWidth - 16, 280);
    for (let i = 1; i <= pdf.numPages; i++) {
      if (token !== viewToken) return;
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * dpr });
      const c = document.createElement("canvas");
      c.width = vp.width; c.height = vp.height;
      body.appendChild(c);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    }
  } catch (err) {
    note.textContent = "Could not show this PDF here. Use “Open in new tab”.";
    if (!note.isConnected) body.appendChild(note);
  }
}

function openViewer(it) {
  const token = ++viewToken;
  $("vTitle").textContent = it.title;
  $("vNew").href = it.url;
  const body = $("vBody");
  body.textContent = "";
  if (isImage(it)) {
    const img = document.createElement("img"); img.src = it.url; img.alt = it.title; body.appendChild(img);
  } else if (it.kind === "file") {
    renderPdf(it.url, body, token);
  } else {
    const f = document.createElement("iframe");
    f.src = driveEmbed(it.url) || it.url; f.title = it.title; body.appendChild(f);
  }
  $("viewer").showModal();
}
function closeViewer() { viewToken++; $("viewer").close(); $("vBody").textContent = ""; }
$("vClose").onclick = closeViewer;

// ---------- admin auth ----------
async function refreshAuth() {
  const { data } = await sb.auth.getSession();
  isAdmin = !!data.session;
  $("uploadBox").hidden = !isAdmin;
  $("adminBtn").textContent = isAdmin ? "Admin ✓" : "Admin";
  draw();
}
$("adminBtn").onclick = () => { if (!isAdmin) $("loginDlg").showModal(); else $("uploadBox").scrollIntoView(); };
$("cancelLogin").onclick = () => $("loginDlg").close();
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("loginMsg").textContent = "Logging in…";
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
  if (error) { $("loginMsg").textContent = error.message; return; }
  $("loginMsg").textContent = ""; $("loginDlg").close(); $("password").value = ""; refreshAuth();
};
$("logoutBtn").onclick = async () => { await sb.auth.signOut(); refreshAuth(); };

// ---------- upload form ----------
$("mode").onchange = () => {
  const link = $("mode").value === "link";
  $("link").hidden = !link; $("file").hidden = link;
};
$("category").onchange = () => { $("year").hidden = $("category").value !== "pyq"; };
$("year").hidden = true;

$("uploadForm").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("msg"); msg.textContent = "Saving…";
  try {
    let url, kind, mime = null, path = null;
    if ($("mode").value === "file") {
      const f = $("file").files[0];
      if (!f) throw new Error("Choose a PDF or picture first.");
      if (f.size > 50 * 1024 * 1024) throw new Error("File is over 50 MB (free limit).");
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      path = `${section}/${Date.now()}-${safe}`;
      const up = await sb.storage.from("uploads").upload(path, f, { contentType: f.type });
      if (up.error) throw up.error;
      url = sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
      kind = "file"; mime = f.type;
    } else {
      url = $("link").value.trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("Link must start with http:// or https://");
      kind = "link";
    }
    const row = {
      section, category: $("category").value, title: $("title").value.trim(),
      year: $("category").value === "pyq" ? $("year").value.trim() : null,
      kind, url, file_path: path, mime
    };
    const ins = await sb.from("items").insert(row);
    if (ins.error) throw ins.error;
    msg.textContent = "Added ✓";
    $("uploadForm").reset(); $("year").hidden = true; $("link").hidden = true; $("file").hidden = false;
    load();
  } catch (err) { msg.textContent = "Error: " + err.message; }
};

async function removeItem(it) {
  if (!confirm(`Delete "${it.title}"?`)) return;
  if (it.file_path) await sb.storage.from("uploads").remove([it.file_path]);
  const { error } = await sb.from("items").delete().eq("id", it.id);
  if (error) alert(error.message); else load();
}

// ---------- start ----------
renderNav(); load(); refreshAuth();
sb.auth.onAuthStateChange(refreshAuth);
