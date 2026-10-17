const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.BA_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let sections = [];
let topId = null;   // selected main section
let subId = null;   // selected subject inside it (null = General)
let isAdmin = false;
let items = [];

const tops = () => sections.filter((s) => !s.parent_id);
const subsOf = (id) => sections.filter((s) => s.parent_id === id);
const nameOf = (id) => (sections.find((s) => s.id === id) || {}).name || "";
const targetId = () => subId || topId;
const isQP = () => /question/i.test(nameOf(topId));

function setList(text) {
  const list = $("list"); list.textContent = "";
  const p = document.createElement("p"); p.className = "empty"; p.textContent = text; list.appendChild(p);
}

// ---------- sections & subjects ----------
async function loadSections() {
  const { data, error } = await sb.from("sections").select("*").order("sort_order").order("created_at");
  if (error) { setList("Could not load sections: " + error.message); return; }
  sections = data;
  if (!sections.find((s) => s.id === topId)) { topId = tops()[0] ? tops()[0].id : null; subId = null; }
  if (subId && !sections.find((s) => s.id === subId)) subId = null;
  renderNav();
  await loadItems();
}

function chip(text, active, onclick, cls) {
  const b = document.createElement("button");
  b.textContent = text;
  if (active) b.classList.add("active");
  if (cls) b.classList.add(cls);
  b.onclick = onclick;
  return b;
}

function renderNav() {
  const nav = $("sections"); nav.textContent = "";
  tops().forEach((s) => nav.appendChild(chip(s.name, s.id === topId, () => { topId = s.id; subId = null; renderNav(); loadItems(); })));
  if (isAdmin) nav.appendChild(chip("+ Add section", false, addSection, "add"));

  const subs = $("subs"); subs.textContent = "";
  if (topId) {
    subs.appendChild(chip("General", subId === null, () => { subId = null; renderNav(); loadItems(); }));
    subsOf(topId).forEach((s) => subs.appendChild(chip(s.name, s.id === subId, () => { subId = s.id; renderNav(); loadItems(); })));
    if (isAdmin) subs.appendChild(chip("+ Add subject", false, addSubject, "add"));
  }
  const path = nameOf(topId) + (subId ? " › " + nameOf(subId) : "");
  $("secTitle").textContent = path;
  $("addingTo").textContent = "Adding to: " + path;
  $("year").hidden = !isQP();
  $("delNode").textContent = subId ? "Delete this subject" : "Delete this section";
}

async function addSection() {
  const name = (prompt("New section name (e.g. Law)") || "").trim();
  if (!name) return;
  const { data, error } = await sb.from("sections").insert({ name, sort_order: Date.now() }).select().single();
  if (error) { alert(error.message); return; }
  topId = data.id; subId = null;
  await loadSections();
}

async function addSubject() {
  const name = (prompt("New subject name inside " + nameOf(topId) + " (e.g. History)") || "").trim();
  if (!name) return;
  const { data, error } = await sb.from("sections").insert({ name, parent_id: topId, sort_order: Date.now() }).select().single();
  if (error) { alert(error.message); return; }
  subId = data.id;
  await loadSections();
}

async function deleteNode() {
  const id = targetId();
  if (!id) return;
  if (!confirm(`Delete "${nameOf(id)}" and everything inside it? This cannot be undone.`)) return;
  const ids = [id, ...subsOf(id).map((s) => s.id)];
  const { data } = await sb.from("items").select("file_path").in("section_id", ids);
  const paths = (data || []).map((r) => r.file_path).filter(Boolean);
  if (paths.length) await sb.storage.from("uploads").remove(paths);
  const { error } = await sb.from("sections").delete().eq("id", id);
  if (error) { alert(error.message); return; }
  if (id === topId) topId = null;
  subId = null;
  await loadSections();
}
$("delNode").onclick = deleteNode;

// ---------- items ----------
async function loadItems() {
  const id = targetId();
  if (!id) { items = []; setList("No sections yet."); return; }
  setList("Loading…");
  const { data, error } = await sb.from("items").select("*").eq("section_id", id).order("created_at", { ascending: false });
  if (error) { setList("Could not load: " + error.message); return; }
  items = data;
  draw();
}

function isImage(it) { return (it.mime || "").startsWith("image/"); }
function isVideo(it) { return (it.mime || "").startsWith("video/") || !!ytEmbed(it.url); }

function typeLabel(it) {
  if (isImage(it)) return "Picture";
  if (isVideo(it)) return "Video";
  if (it.kind === "link") return "Link";
  return "PDF";
}

function draw() {
  const list = $("list");
  list.textContent = "";
  if (!items.length) { setList("Nothing here yet."); return; }

  items.forEach((it) => {
    const card = document.createElement("div"); card.className = "card";

    let thumb;
    if (isImage(it)) { thumb = document.createElement("img"); thumb.src = it.url; thumb.alt = ""; thumb.loading = "lazy"; }
    else { thumb = document.createElement("div"); thumb.textContent = isVideo(it) ? "🎬" : it.kind === "link" ? "🔗" : "📄"; }
    thumb.className = "thumb";

    const info = document.createElement("div"); info.className = "info";
    const t = document.createElement("b"); t.textContent = it.title;
    const meta = document.createElement("div"); meta.className = "meta";
    const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = typeLabel(it);
    meta.appendChild(badge);
    if (it.year) meta.appendChild(document.createTextNode(it.year + " · "));
    meta.appendChild(document.createTextNode(new Date(it.created_at).toLocaleDateString()));
    const open = document.createElement("button"); open.className = "viewbtn"; open.textContent = isVideo(it) ? "Play" : "View";
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

function ytEmbed(url) {
  const m = (url || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
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
  } else if ((it.mime || "").startsWith("video/")) {
    const v = document.createElement("video"); v.src = it.url; v.controls = true; v.playsInline = true; body.appendChild(v);
  } else if (it.kind === "file") {
    renderPdf(it.url, body, token);
  } else {
    const f = document.createElement("iframe");
    f.src = ytEmbed(it.url) || driveEmbed(it.url) || it.url;
    f.title = it.title; f.allow = "autoplay; fullscreen"; f.allowFullscreen = true;
    body.appendChild(f);
  }
  $("viewer").showModal();
}
function closeViewer() { viewToken++; $("viewer").close(); $("vBody").textContent = ""; }
$("vClose").onclick = closeViewer;
$("viewer").addEventListener("close", () => { $("vBody").textContent = ""; });

// ---------- admin auth ----------
async function refreshAuth() {
  const { data } = await sb.auth.getSession();
  isAdmin = !!data.session;
  $("uploadBox").hidden = !isAdmin;
  $("adminBtn").textContent = isAdmin ? "Admin ✓" : "Admin";
  renderNav();
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

$("uploadForm").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("msg"); msg.textContent = "Saving…";
  try {
    const target = targetId();
    if (!target) throw new Error("Add a section first.");
    let url, kind, mime = null, path = null;
    if ($("mode").value === "file") {
      const f = $("file").files[0];
      if (!f) throw new Error("Choose a PDF, picture or video first.");
      if (f.size > 50 * 1024 * 1024) throw new Error("File is over 50 MB. For big videos, upload to YouTube (Unlisted) and paste the link.");
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      path = `${target}/${Date.now()}-${safe}`;
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
      section_id: target,
      category: isQP() ? "pyq" : "notes",
      title: $("title").value.trim(),
      year: isQP() ? ($("year").value.trim() || null) : null,
      kind, url, file_path: path, mime
    };
    const ins = await sb.from("items").insert(row);
    if (ins.error) throw ins.error;
    msg.textContent = "Added ✓";
    $("uploadForm").reset(); $("link").hidden = true; $("file").hidden = false;
    renderNav();
    loadItems();
  } catch (err) { msg.textContent = "Error: " + err.message; }
};

async function removeItem(it) {
  if (!confirm(`Delete "${it.title}"?`)) return;
  if (it.file_path) await sb.storage.from("uploads").remove([it.file_path]);
  const { error } = await sb.from("items").delete().eq("id", it.id);
  if (error) alert(error.message); else loadItems();
}

// ---------- start ----------
refreshAuth();
loadSections();
sb.auth.onAuthStateChange(refreshAuth);
