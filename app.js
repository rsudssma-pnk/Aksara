(() => {
  "use strict";

  const CONFIG = Object.freeze({
    URL: "https://nbewlpbbvtwtuvamadle.supabase.co",
    KEY: "sb_publishable_mJDHfSdm6iabInDO1ItNdw_GPhLNuI0",
    SDK: "2.117.2",
    LOGO: "assets/rsud-logo.png",
    BOOTSTRAP_URL: "https://nbewlpbbvtwtuvamadle.supabase.co/functions/v1/aksara-bootstrap-accounts?token=3TfmjP2qold_LK3zggck-CNm4XcGWvtfhqNwxLyUNJu8DuuUgYXB3f2_GehPJXdb"
  });

  const app = document.getElementById("app");
  const state = { page: "dashboard", q: "", pokja: "ALL", matrixPokja: "ALL", strength: "ALL", matrixPage: 1, epPage: 1, session: null, user: null, roles: [] };
  const data = { pokja: [], eps: [], relations: [], matrix: null, evidence: [], evidenceLinks: [], readiness: [], summary: null, driveBackups: [], errors: [] };
  let sb = null;
  let searchTimer = null;
  let realtimeChannel = null;
  let refreshInFlight = false;

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
  const fmt = (v) => Number(v || 0).toLocaleString("id-ID");
  const percent = (n, d) => d ? Math.round((n / d) * 1000) / 10 : 0;
  const date = (v) => v ? new Date(v).toLocaleDateString("id-ID") : "—";
  const datetime = (v) => v ? new Date(v).toLocaleString("id-ID") : "—";

  function boot(title = "Memuat AKSARA…", detail = "Menyiapkan data akreditasi.") {
    app.innerHTML = '<div class="boot"><div class="spinner"></div><div>' + esc(title) + '</div><small>' + esc(detail) + "</small></div>";
  }

  function fatal(e) {
    app.innerHTML = '<main class="fatal"><div><div class="eyebrow">AKSARA</div><h1>Halaman belum dapat dimuat</h1><p>' +
      esc(e?.message || String(e)) + '</p><button id="retry" class="button primary">Coba lagi</button></div></main>';
    $("#retry")?.addEventListener("click", init);
  }

  async function allRows(factory, label, pageSize) {
    const out = [];
    for (let page = 0; page < 20; page += 1) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const r = await factory().range(from, to);
      if (r.error) throw new Error(label + ": " + r.error.message);
      const rows = r.data || [];
      out.push(...rows);
      if (rows.length < pageSize) return out;
    }
    throw new Error(label + ": pagination melebihi batas aman.");
  }

  async function loadMaster() {
    data.errors = [];
    const jobs = [
      ["Pokja", () => allRows(() => sb.from("pokja").select("id,code,name,group_name,sort_order").eq("active", true).order("sort_order"), "Pokja", 100)],
      ["EP", () => allRows(() => sb.from("v_ep_master").select("id,code,title,description,source_page,source_version,pokja_code,pokja_name,group_name,standard_code,standard_title").order("code"), "EP", 500)],
      ["Matrix", () => allRows(() => sb.from("v_integration_explorer").select("source_ep,source_pokja,target_ep,target_pokja,strength,mandatory_status,coordination_required,relation_type,relation_type_name,rationale,evidence_text,source_page,target_page,status").eq("status", "PUBLISHED").order("source_ep"), "Integration Matrix", 1000)],
      ["Version", () => sb.from("matrix_versions").select("version_no,status,effective_from,published_at").eq("status", "PUBLISHED").order("published_at", { ascending: false }).limit(1)]
    ];
    const results = await Promise.allSettled(jobs.map((j) => j[1]()));
    results.forEach((r, i) => {
      const name = jobs[i][0];
      if (r.status === "rejected") data.errors.push({ area: name, message: r.reason?.message || String(r.reason) });
      else if (name === "Pokja") data.pokja = r.value || [];
      else if (name === "EP") data.eps = r.value || [];
      else if (name === "Matrix") data.relations = r.value || [];
      else if (name === "Version") data.matrix = r.value.data?.[0] || null;
    });
    if (!data.pokja.length || !data.eps.length) throw new Error("Master Pokja/EP tidak dapat diakses.");
  }

  async function loadPrivate() {
    if (!state.session) return;
    const results = await Promise.allSettled([
      sb.from("v_dashboard_summary").select("*").maybeSingle(),
      allRows(() => sb.from("v_ep_readiness").select("ep_id,code,pokja_id,required_evidence_total,required_evidence_complete,required_integration_total,required_integration_complete,configured,blockers,readiness_status").order("code"), "Readiness", 500),
      allRows(() => sb.from("evidence").select("id,primary_ep_id,title,document_number,document_date,revision_number,effective_from,effective_to,owner_unit,owner_name,status,current_version_id,created_at,updated_at").order("updated_at", { ascending: false }), "Evidence", 500),
      allRows(() => sb.from("evidence_ep_links").select("evidence_id,ep_id,link_type,active,linked_at"), "Evidence links", 500),
      sb.from("user_roles").select("role_id,active").eq("user_id", state.user.id)
    ]);

    data.summary = results[0].status === "fulfilled" ? (results[0].value.data || null) : null;
    data.readiness = results[1].status === "fulfilled" ? (results[1].value || []) : [];
    data.evidence = results[2].status === "fulfilled" ? (results[2].value || []) : [];
    data.evidenceLinks = results[3].status === "fulfilled" ? (results[3].value || []) : [];

    if (results[4].status === "fulfilled" && results[4].value.data?.length) {
      const ids = results[4].value.data.filter((r) => r.active).map((r) => r.role_id);
      if (ids.length) {
        const roles = await sb.from("roles").select("id,code,name").in("id", ids);
        state.roles = roles.data || [];
      }
    } else state.roles = [];

    results.forEach((r, i) => {
      if (r.status === "rejected") data.errors.push({ area: ["Dashboard", "Readiness", "Evidence", "Evidence links", "Role"][i], message: r.reason?.message || String(r.reason) });
    });

    const backup = await sb.from("evidence_drive_backups")
      .select("id,evidence_id,evidence_version_id,ep_id,pokja_code,drive_folder_path,drive_file_id,drive_url,status,last_error,synced_at")
      .order("created_at", { ascending: false }).limit(500);
    data.driveBackups = backup.data || [];
    if (backup.error) data.errors.push({ area: "Google Drive", message: backup.error.message });
  }

  async function refreshPrivateData() {
    if (!state.session || refreshInFlight) return;
    refreshInFlight = true;
    try {
      await loadPrivate();
      render();
    } finally {
      refreshInFlight = false;
    }
  }

  function setupRealtime() {
    if (!sb || !state.session) return;
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    realtimeChannel = sb.channel("aksara-live-" + state.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "evidence" }, () => refreshPrivateData())
      .on("postgres_changes", { event: "*", schema: "public", table: "evidence_versions" }, () => refreshPrivateData())
      .on("postgres_changes", { event: "*", schema: "public", table: "evidence_drive_backups" }, () => refreshPrivateData())
      .subscribe();
  }

  function hasRole(code) {
    return state.roles.some((r) => r.code === code);
  }

  function evidenceStats() {
    const valid = data.evidence.filter((e) => !!e.current_version_id && e.status !== "ARCHIVED" && e.status !== "REJECTED");
    const covered = new Map(valid.map((e) => [e.primary_ep_id, e.id]));
    data.evidenceLinks.filter((x) => x.active).forEach((x) => {
      if (valid.some((e) => e.id === x.evidence_id)) covered.set(x.ep_id, x.evidence_id);
    });

    const byPokja = {};
    data.pokja.forEach((p) => {
      const epRows = data.eps.filter((e) => e.pokja_code === p.code);
      const epIds = new Set(epRows.map((e) => e.id));
      const coveredEp = epRows.filter((e) => covered.has(e.id)).length;
      const assets = valid.filter((e) => epIds.has(e.primary_ep_id) || data.evidenceLinks.some((x) => x.active && x.evidence_id === e.id && epIds.has(x.ep_id))).length;
      const statuses = { UPLOADED: 0, VERIFIED: 0, NEEDS_REVIEW: 0, REVISE: 0, DRAFT: 0, REJECTED: 0 };
      valid.forEach((e) => {
        const belongs = epIds.has(e.primary_ep_id) || data.evidenceLinks.some((x) => x.active && x.evidence_id === e.id && epIds.has(x.ep_id));
        if (belongs && statuses[e.status] !== undefined) statuses[e.status] += 1;
      });
      byPokja[p.code] = { total: epRows.length, covered: coveredEp, assets, percentage: percent(coveredEp, epRows.length), statuses };
    });

    const synced = data.driveBackups.filter((x) => x.status === "SYNCED").length;
    return { assets: valid.length, coveredEP: covered.size, percentage: percent(covered.size, data.eps.length), byPokja, driveSynced: synced };
  }

  function nav() {
    const items = [["dashboard", "Dashboard"], ["eps", "EP Explorer"], ["matrix", "Integration Matrix"], ["pokja", "Pokja"], ["evidence", "Evidence Center"], ["readiness", "Readiness"]];
    if (hasRole("SUPER_ADMIN")) items.push(["accounts", "Manajemen Akun"]);
    return items.map(([id, label]) => '<button class="navbtn ' + (state.page === id ? "active" : "") + '" data-page="' + id + '">' + esc(label) + "</button>").join("");
  }

  function shell(content) {
    const user = state.user?.email || "Public Access";
    const role = state.roles.map((r) => r.name || r.code).join(" • ") || "Pengunjung";
    return '<div class="app-shell"><aside class="sidebar"><div class="side-brand"><div class="logo-frame side-logo-frame"><img src="' +
      CONFIG.LOGO + '" class="side-logo" alt="Logo RSUD Kota Pontianak"></div><div><div class="side-title">AKSARA</div><div class="side-sub">Evidence &amp; Integration Center</div></div></div>' +
      '<div class="side-hospital">RSUD Sultan Syarif Mohamad Alkadrie<br><span>Kota Pontianak</span></div><nav class="nav">' + nav() + '</nav>' +
      '<div class="side-user"><div class="user-dot">' + esc(user.slice(0, 1).toUpperCase()) + '</div><div class="user-text"><b>' + esc(user) + '</b><span>' + esc(role) +
      '</span></div></div><button id="auth" class="auth">' + (state.session ? "Keluar" : "Masuk") + '</button>' +
      (!state.session ? '<button id="bootstrap" class="setup-link">Aktifkan akun awal</button>' : '') +
      '<div class="side-foot">KMK 1596/2024 • 16 Pokja • 221 EP • 2.074 relasi</div></aside><main class="main">' + content + "</main></div>";
  }

  function header(kicker, title, subtitle, action) {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(kicker) + '</div><h1>' + esc(title) +
      '</h1><p class="subtitle">' + esc(subtitle) + '</p></div><div class="head-actions">' + (action || '') +
      '<span class="badge ' + (state.session ? "live" : "") + '"><span class="status-dot"></span>' +
      (state.session ? "Terhubung" : "Publik") + "</span></div></div>";
  }

  function warnings() {
    if (!data.errors.length) return "";
    return '<div class="error-box"><b>Perhatian</b>' + data.errors.map((x) => '<div>' + esc(x.area) + ": " + esc(x.message) + "</div>").join("") + "</div>";
  }

  function metricCard(label, value, hint, icon) {
    return '<div class="metric-card"><div class="metric-icon">' + icon + '</div><div><div class="metric-label">' + esc(label) +
      '</div><div class="metric-value">' + esc(value) + '</div><div class="metric-hint">' + esc(hint) + "</div></div></div>";
  }

  function dashboard() {
    const s = evidenceStats();
    const A = data.relations.filter((r) => r.strength === "A").length;
    const B = data.relations.filter((r) => r.strength === "B").length;
    const C = data.relations.filter((r) => r.strength === "C").length;
    const ready = data.readiness.filter((r) => r.readiness_status === "READY").length;
    const partial = data.readiness.filter((r) => r.readiness_status === "PARTIAL").length;
    const blocked = data.readiness.filter((r) => r.readiness_status === "BLOCKED").length;

    const coverageRows = data.pokja.map((p) => {
      const x = s.byPokja[p.code];
      return '<tr><td><b>' + esc(p.code) + '</b><div class="muted tiny">' + esc(p.name) + '</div></td><td>' +
        fmt(x.total) + '</td><td>' + fmt(x.covered) + '</td><td>' + fmt(x.assets) + '</td><td><div class="progress"><span style="width:' +
        x.percentage + '%"></span></div><b>' + x.percentage + '%</b></td><td><span class="tiny">U ' + x.statuses.UPLOADED +
        ' • V ' + x.statuses.VERIFIED + ' • R ' + x.statuses.REVISE + "</span></td></tr>";
    }).join("");

    return header("Dashboard", "Pusat Kendali Akreditasi", "Pantau EP, evidence, integrasi, dan readiness dari satu tampilan.",
      '<span class="badge draft">Matrix ' + esc(data.matrix?.version_no || "—") + "</span>") + warnings() +
      '<section class="hero"><div class="hero-copy"><div class="hero-kicker">AKSARA • ACCREDITATION CONTROL</div><h2>Evidence yang terhubung, progres yang terukur.</h2>' +
      '<p>Satu workspace untuk menelusuri EP, mengelola bukti, melihat relasi lintas-Pokja, dan memantau blocker.</p><div class="hero-actions">' +
      '<button class="button ghost" data-page="evidence">Kelola Evidence</button><button class="button ghost" data-page="matrix">Buka Matrix</button></div></div>' +
      '<div class="hero-logo"><div class="logo-frame hero-logo-frame"><img src="' + CONFIG.LOGO + '" alt="Logo RSUD Kota Pontianak"></div></div></section>' +
      '<div class="metrics">' + metricCard("Pokja", fmt(data.pokja.length), "Kelompok standar aktif", "▦") +
      metricCard("Elemen Penilaian", fmt(data.eps.length), "Master EP", "✓") +
      metricCard("Integration Matrix", fmt(data.relations.length), "Relasi lintas-Pokja", "↔") +
      metricCard("Evidence", state.session ? fmt(s.assets) : "Login", state.session ? s.percentage + "% EP coverage" : "Masuk untuk statistik internal", "⬆") + "</div>" +
      '<div class="section-grid"><section class="section"><div class="section-head"><div><h3>Coverage Evidence per Pokja</h3><p>EP tercakup dihitung dari evidence primer + evidence yang ditautkan secara aktif.</p></div>' +
      '<span class="pill ok">' + (state.session ? s.percentage + "% overall" : "Private") + '</span></div><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Pokja</th><th>EP</th><th>Tercakup</th><th>Asset</th><th>Coverage</th><th>Status</th></tr></thead><tbody>' +
      (state.session ? coverageRows : '<tr><td colspan="6" class="empty">Login diperlukan untuk statistik evidence.</td></tr>') + "</tbody></table></div></section>" +
      '<section class="section"><div class="section-head"><div><h3>Ringkasan Integrasi</h3><p>Distribusi strength pada matrix terbit.</p></div></div>' +
      '<div class="mini-chart"><div><b>A</b><span>' + fmt(A) + '</span></div><div><b>B</b><span>' + fmt(B) + '</span></div><div><b>C</b><span>' + fmt(C) + "</span></div></div>" +
      '<div class="readiness-strip"><div><b>' + fmt(ready) + '</b><span>Ready</span></div><div><b>' + fmt(partial) + '</b><span>Partial</span></div><div><b>' +
      fmt(blocked) + '</b><span>Blocked</span></div></div>' + (state.session ? '<div class="notice" style="margin-top:12px">Google Drive synced: ' + fmt(s.driveSynced) + " file</div>" :
      '<div class="notice" style="margin-top:12px">Readiness dan sinkronisasi Drive tersedia setelah login.</div>') + "</section></div>";
  }

  function epsPage() {
    const q = state.q.trim().toLowerCase();
    const rows = data.eps.filter((e) => {
      const p = state.pokja === "ALL" || e.pokja_code === state.pokja;
      const hay = [e.code, e.title, e.description, e.standard_code, e.standard_title].join(" ").toLowerCase();
      return p && (!q || hay.includes(q));
    });
    const total = Math.max(1, Math.ceil(rows.length / 75));
    state.epPage = Math.min(Math.max(1, state.epPage), total);
    const pageRows = rows.slice((state.epPage - 1) * 75, state.epPage * 75);
    const body = pageRows.map((e) => '<tr><td class="code"><b>' + esc(e.code) + '</b></td><td><span class="pill">' + esc(e.pokja_code) +
      '</span></td><td>' + esc(e.standard_code || "—") + '</td><td><b>' + esc(e.title || "—") + '</b><div class="muted">' +
      esc(e.description || "—") + '</div></td><td>KMK 1596/2024 • hlm. ' + esc(e.source_page || "—") + "</td></tr>").join("");
    return header("Master EP", "EP Explorer", "Telusuri 221 Elemen Penilaian.", '<span class="badge">' + fmt(rows.length) + " cocok</span>") + warnings() +
      '<section class="section"><div class="toolbar"><input id="q" class="input" value="' + esc(state.q) + '" placeholder="Cari kode, judul, standar…"><select id="pokja" class="select"><option value="ALL">Semua Pokja</option>' +
      data.pokja.map((p) => '<option value="' + esc(p.code) + '" ' + (state.pokja === p.code ? "selected" : "") + '>' + esc(p.code) + " — " + esc(p.name) + "</option>").join("") +
      '</select><button id="clear" class="button">Reset</button></div><div class="table-wrap"><table class="table"><thead><tr><th>EP</th><th>Pokja</th><th>Standar</th><th>Uraian</th><th>Sumber</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5" class="empty">Tidak ada data.</td></tr>') + '</tbody></table></div><div class="pager"><span>Halaman ' + state.epPage + " / " + total + " • " + fmt(rows.length) +
      ' EP</span><div class="actions"><button id="epPrev" class="button" ' + (state.epPage <= 1 ? "disabled" : "") + '>Sebelumnya</button><button id="epNext" class="button" ' +
      (state.epPage >= total ? "disabled" : "") + '>Berikutnya</button></div></div></section>';
  }

  function matrixPage() {
    const selected = state.matrixPokja || "ALL";
    const q = state.q.trim().toLowerCase();
    const rows = data.relations.filter((r) => {
      const p = selected === "ALL" || r.source_pokja === selected || r.target_pokja === selected;
      const s = state.strength === "ALL" || r.strength === state.strength;
      const hay = [r.source_ep, r.source_pokja, r.target_ep, r.target_pokja, r.relation_type, r.relation_type_name, r.rationale, r.evidence_text].join(" ").toLowerCase();
      return p && s && (!q || hay.includes(q));
    });
    const total = Math.max(1, Math.ceil(rows.length / 50));
    state.matrixPage = Math.min(Math.max(1, state.matrixPage), total);
    const outward = selected === "ALL" ? 0 : rows.filter((r) => r.source_pokja === selected).length;
    const inward = selected === "ALL" ? 0 : rows.filter((r) => r.target_pokja === selected).length;
    const shown = rows.slice((state.matrixPage - 1) * 50, state.matrixPage * 50);
    const body = shown.map((r) => '<tr><td><b class="code">' + esc(r.source_ep) + '</b><div class="muted tiny">' + esc(r.source_pokja || "—") + '</div></td>' +
      '<td><b class="code">' + esc(r.target_ep) + '</b><div class="muted tiny">' + esc(r.target_pokja || "—") + '</div></td><td><span class="pill ' +
      String(r.strength || "").toLowerCase() + '">' + esc(r.strength || "—") + '</span>' + (r.coordination_required ? '<div class="ok tiny">Koordinasi wajib</div>' : "") +
      '</td><td><b>' + esc(r.relation_type_name || r.relation_type || "—") + '</b><div class="muted tiny">' + esc(r.relation_type || "") + '</div></td>' +
      '<td><b>Mengapa terhubung</b><div>' + esc(r.rationale || "Belum ada uraian") + '</div><div class="detail-box"><b>Checklist / evidence</b><span>' +
      esc(r.evidence_text || "Belum ada keterangan") + '</span></div></td><td><span class="pill">' + esc(r.mandatory_status || "—") + '</span></td>' +
      '<td class="tiny">Source hlm. ' + esc(r.source_page || "—") + '<br>Target hlm. ' + esc(r.target_page || "—") + '</td></tr>').join("");
    return header("Cross-Pokja", "Integration Matrix", "Pilih satu Pokja untuk melihat hanya relasi yang masuk/keluar Pokja tersebut. Setiap relasi menampilkan alasan, checkpoint evidence, strength, status, dan sumber halaman.",
      '<span class="badge draft">' + esc(data.matrix?.version_no || "—") + "</span>") + warnings() +
      '<section class="section"><div class="matrix-focus"><div><div class="eyebrow">POKJA TERPILIH</div><h2>' + esc(selected === "ALL" ? "Semua Pokja" : selected) +
      '</h2><p>' + esc(selected === "ALL" ? "Seluruh relasi matrix terbit." : (data.pokja.find((p) => p.code === selected)?.name || "")) +
      '</p></div><div class="focus-stat"><b>' + fmt(rows.length) + '</b><span>relasi</span></div><div class="focus-stat"><b>' + fmt(outward) +
      '</b><span>keluar</span></div><div class="focus-stat"><b>' + fmt(inward) + '</b><span>masuk</span></div></div><div class="toolbar">' +
      '<select id="matrixPokja" class="select"><option value="ALL">Semua Pokja</option>' + data.pokja.map((p) =>
      '<option value="' + esc(p.code) + '" ' + (selected === p.code ? "selected" : "") + '>' + esc(p.code) + " — " + esc(p.name) + "</option>").join("") +
      '</select><select id="strength" class="select"><option value="ALL">Semua strength</option><option value="A" ' + (state.strength === "A" ? "selected" : "") +
      '>A — eksplisit</option><option value="B" ' + (state.strength === "B" ? "selected" : "") + '>B — operasional kuat</option><option value="C" ' +
      (state.strength === "C" ? "selected" : "") + '>C — fungsional</option></select><input id="q" class="input" value="' + esc(state.q) +
      '" placeholder="Cari EP, alasan, relation, evidence…"><button id="clear" class="button">Reset</button></div><div class="table-wrap"><table class="table matrix-table">' +
      '<thead><tr><th>Source EP / Pokja</th><th>Target EP / Pokja</th><th>Strength</th><th>Jenis Hubungan</th><th>Penjelasan &amp; Evidence</th><th>Status</th><th>Sumber</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="empty">Tidak ada relasi pada filter ini.</td></tr>') + '</tbody></table></div><div class="pager"><span>Halaman ' + state.matrixPage + " / " + total +
      " • " + fmt(rows.length) + ' relasi</span><div class="actions"><button id="matrixPrev" class="button" ' + (state.matrixPage <= 1 ? "disabled" : "") +
      '>Sebelumnya</button><button id="matrixNext" class="button" ' + (state.matrixPage >= total ? "disabled" : "") + '>Berikutnya</button></div></div></section>';
  }

  function pokjaPage() {
    const s = evidenceStats();
    return header("Kelompok Standar", "Pokja", "Ringkasan beban kerja, evidence, dan coverage setiap kelompok.",
      '<span class="badge">' + fmt(data.pokja.length) + " Pokja</span>") + warnings() +
      '<div class="pokja-grid">' + data.pokja.map((p) => {
        const x = s.byPokja[p.code];
        return '<div class="pokja-card"><div class="pokja-top"><span class="eyebrow">' + esc(p.group_name) + '</span><span class="pill">' + esc(p.code) +
          '</span></div><h3>' + esc(p.name) + '</h3><div class="pokja-stats"><b>' + fmt(x.total) + '</b><span>EP</span><b>' + (state.session ? x.percentage + "%" : "—") +
          '</b><span>Coverage</span></div><div class="progress"><span style="width:' + (state.session ? x.percentage : 0) + '%"></span></div><div class="tiny muted" style="margin-top:8px">Upload ' +
          x.statuses.UPLOADED + " • Verified " + x.statuses.VERIFIED + " • Revise " + x.statuses.REVISE + "</div></div>";
      }).join("") + "</div>";
  }

  function evidencePage() {
    if (!state.session) return header("Repository Internal", "Evidence Center", "Evidence bersifat private dan membutuhkan autentikasi.") +
      '<section class="section empty"><div class="logo-frame empty-logo-frame"><img src="' + CONFIG.LOGO + '" class="empty-logo" alt=""></div><h2>Login diperlukan</h2><p>Masuk menggunakan akun Pokja atau Superadmin.</p><button id="auth2" class="button primary">Masuk</button></section>';
    const epOptions = data.eps.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.code) + " — " + esc((e.title || e.description || "").slice(0, 100)) + "</option>").join("");
    const body = data.evidence.map((e) => {
      const b = data.driveBackups.find((x) => x.evidence_id === e.id);
      const drive = b?.status === "SYNCED" ? '<a href="' + esc(b.drive_url || "#") + '" target="_blank" rel="noopener">Drive ↗</a>' :
        (b?.status === "FAILED" ? '<span class="status status-revise">Gagal</span>' : '<span class="muted">—</span>');
      return '<tr><td><b>' + esc(e.title) + '</b><div class="tiny muted">' + esc(e.document_number || "") + '</div></td><td><span class="status status-' +
        String(e.status || "DRAFT").toLowerCase() + '">' + esc(e.status) + '</span></td><td>' + esc(e.owner_unit || e.owner_name || "—") +
        '</td><td>' + esc(date(e.effective_from)) + " → " + esc(date(e.effective_to)) + '</td><td>' + drive + '</td><td>' + esc(datetime(e.updated_at)) + "</td></tr>";
    }).join("");
    return header("Repository Internal", "Evidence Center", "Upload ke Supabase Private Storage dan sinkronisasi backup ke Google Drive.",
      '<span class="badge live">' + fmt(data.evidence.length) + " asset</span>") + warnings() +
      '<section class="section"><div class="upload-grid"><div class="form"><label>EP anchor<select id="evidenceEp" class="select">' + epOptions +
      '</select></label><label>Judul evidence<input id="evidenceTitle" class="input" placeholder="Contoh: SK Direktur Nomor …"></label><label>File<input id="evidenceFile" class="input" type="file" ' +
      'accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"></label><button id="upload" class="button primary">Upload + Backup Drive</button><div id="uploadMsg" role="status" class="muted"></div></div>' +
      '<div class="info-panel"><div class="info-item"><b>Supabase</b><span>Primary repository, private + versioned.</span></div><div class="info-item"><b>Google Drive</b><span>Backup otomatis ke Pokja / EP.</span></div>' +
      '<div class="info-item"><b>Folder</b><span>Pokja dipetakan otomatis dari EP dropdown.</span></div><div class="info-item"><b>Recovery</b><span>Backup secondary; upload utama tetap tersimpan jika Drive sedang gagal.</span></div></div></div></section>' +
      '<section class="section" style="margin-top:16px"><div class="section-head"><div><h3>Evidence Terbaru</h3><p>Daftar sesuai scope user.</p></div></div><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Judul</th><th>Status</th><th>Owner</th><th>Berlaku</th><th>Drive</th><th>Diperbarui</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="6" class="empty">Belum ada evidence.</td></tr>') + '</tbody></table></div></section>';
  }

  function readinessPage() {
    if (!state.session) return header("Internal Analytics", "Readiness", "Status kesiapan internal dan blocker EP.") +
      '<section class="section empty"><h2>Login diperlukan</h2><p>Data readiness internal dilindungi oleh RLS.</p></section>';
    const c = { READY: 0, PARTIAL: 0, BLOCKED: 0, NOT_CONFIGURED: 0 };
    data.readiness.forEach((r) => c[r.readiness_status] = (c[r.readiness_status] || 0) + 1);
    const blockers = data.readiness.filter((r) => r.readiness_status === "BLOCKED").slice(0, 60);
    const body = blockers.map((r) => '<tr><td class="code"><b>' + esc(r.code) + '</b></td><td><span class="pill c">BLOCKED</span></td><td>' +
      fmt(r.required_evidence_complete) + "/" + fmt(r.required_evidence_total) + '</td><td>' + fmt(r.required_integration_complete) + "/" +
      fmt(r.required_integration_total) + '</td><td><pre>' + esc(JSON.stringify(r.blockers || [], null, 2)) + "</pre></td></tr>").join("");
    return header("Internal Analytics", "Readiness & Blockers", "Prioritaskan EP yang masih tertinggal.",
      '<span class="badge draft">INTERNAL</span>') + warnings() + '<div class="metrics">' + metricCard("Ready", fmt(c.READY), "EP", "✓") +
      metricCard("Partial", fmt(c.PARTIAL), "EP", "◐") + metricCard("Blocked", fmt(c.BLOCKED), "EP", "!") + metricCard("Not Configured", fmt(c.NOT_CONFIGURED), "EP", "○") + '</div>' +
      '<section class="section" style="margin-top:16px"><div class="notice">Readiness AKSARA adalah kontrol internal, bukan skor resmi lembaga akreditasi.</div></section>' +
      '<section class="section" style="margin-top:16px"><div class="section-head"><div><h3>Top Blockers</h3><p>Daftar prioritas.</p></div></div><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>EP</th><th>Status</th><th>Evidence</th><th>Integration</th><th>Detail</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5" class="empty">Tidak ada blocker.</td></tr>') + '</tbody></table></div></section>';
  }

  function accountsPage() {
    if (!hasRole("SUPER_ADMIN")) return header("Access Control", "Manajemen Akun", "Halaman Superadmin.") +
      '<section class="section empty"><h2>Akses ditolak</h2><p>Role SUPER_ADMIN diperlukan.</p></section>';
    return header("Access Control", "Manajemen Akun", "Akun default dibuat melalui Supabase Auth; password tidak disimpan pada frontend.",
      '<span class="badge">SUPERADMIN</span>') + '<section class="section"><div class="notice">Akun Pokja menggunakan username seperti <b>pmkp</b> dan password awal <b>123456</b>. Ganti password setelah login pertama.</div>' +
      '<div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Username</th><th>Pokja</th><th>Role</th><th>Scope</th></tr></thead><tbody>' +
      data.pokja.map((p) => '<tr><td class="code"><b>' + esc(p.code.toLowerCase()) + '</b></td><td>' + esc(p.code) + " — " + esc(p.name) +
      '</td><td>POKJA_COORDINATOR</td><td>View • Upload • Review • Manage</td></tr>').join("") +
      '<tr><td class="code"><b>superadmin</b></td><td>Semua Pokja</td><td>SUPER_ADMIN</td><td>Full access</td></tr></tbody></table></div></section>';
  }

  function render() {
    const content = state.page === "eps" ? epsPage() : state.page === "matrix" ? matrixPage() : state.page === "pokja" ? pokjaPage() :
      state.page === "evidence" ? evidencePage() : state.page === "readiness" ? readinessPage() : state.page === "accounts" ? accountsPage() : dashboard();
    app.innerHTML = shell(content);
    bind();
  }

  function bind() {
    document.querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", () => {
      state.page = b.dataset.page; state.q = ""; state.matrixPage = 1; state.epPage = 1; render();
    }));
    const q = $("#q");
    if (q) q.addEventListener("input", () => {
      state.q = q.value;
      if (state.page === "eps") state.epPage = 1;
      if (state.page === "matrix") state.matrixPage = 1;
      clearTimeout(searchTimer); searchTimer = setTimeout(render, 140);
    });
    $("#pokja")?.addEventListener("change", (e) => { state.pokja = e.target.value; state.epPage = 1; render(); });
    $("#matrixPokja")?.addEventListener("change", (e) => { state.matrixPokja = e.target.value; state.matrixPage = 1; state.q = ""; render(); });
    $("#strength")?.addEventListener("change", (e) => { state.strength = e.target.value; state.matrixPage = 1; render(); });
    $("#clear")?.addEventListener("click", () => { state.q = ""; state.strength = "ALL"; if (state.page === "matrix") state.matrixPokja = ""; else state.pokja = "ALL"; state.epPage = 1; state.matrixPage = 1; render(); });
    $("#epPrev")?.addEventListener("click", () => { state.epPage--; render(); });
    $("#epNext")?.addEventListener("click", () => { state.epPage++; render(); });
    $("#matrixPrev")?.addEventListener("click", () => { state.matrixPage--; render(); });
    $("#matrixNext")?.addEventListener("click", () => { state.matrixPage++; render(); });
    $("#auth")?.addEventListener("click", auth);
    $("#auth2")?.addEventListener("click", auth);
    $("#bootstrap")?.addEventListener("click", bootstrapAccounts);
    $("#upload")?.addEventListener("click", uploadEvidence);
  }

  async function bootstrapAccounts() {
    try {
      boot("Aktifkan akun awal…", "Membuat Superadmin + 16 akun Pokja.");
      const response = await fetch(CONFIG.BOOTSTRAP_URL, { method: "GET", mode: "cors", cache: "no-store" });
      const raw = await response.text();
      let payload = null; try { payload = JSON.parse(raw); } catch (_) {}
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || raw || ("HTTP " + response.status));
      window.alert("17 akun AKSARA berhasil diaktifkan. Username Pokja menggunakan kode Pokja, password awal 123456.");
      render();
    } catch (e) {
      window.alert("Aktivasi akun gagal: " + (e?.message || String(e)));
      render();
    }
  }

  async function auth() {
    if (state.session) {
      await sb.auth.signOut();
      state.session = null; state.user = null; state.roles = [];
      data.summary = null; data.readiness = []; data.evidence = []; data.evidenceLinks = []; data.driveBackups = [];
      render(); return;
    }
    const input = window.prompt("Username (contoh: pmkp atau superadmin)");
    if (!input) return;
    const password = window.prompt("Password");
    if (!password) return;
    const normalized = input.trim().toLowerCase();
    const email = normalized.includes("@") ? normalized : normalized + "@aksara.local";
    const result = await sb.auth.signInWithPassword({ email, password });
    if (result.error) {
      const known = ["superadmin","tkrs","kps","mfk","pmkp","mrmik","ppi","ppk","akp","hpk","pp","pap","pab","pkpo","ke","skp","prognas"];
      if (known.includes(normalized)) {
        const activate = window.confirm("Login belum berhasil. Akun default mungkin belum dibuat. Aktifkan sekarang?");
        if (activate) await bootstrapAccounts();
      } else {
        window.alert("Login gagal: " + result.error.message);
      }
      return;
    }
    state.session = result.data.session; state.user = result.data.user;
    await loadPrivate(); setupRealtime(); render();
  }

  function safeName(name) {
    return String(name || "evidence").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "evidence";
  }

  async function uploadEvidence() {
    const msg = $("#uploadMsg");
    const setMsg = (text, cls) => { if (msg) { msg.textContent = text; msg.className = cls || "muted"; } };
    const epId = $("#evidenceEp")?.value;
    const title = $("#evidenceTitle")?.value.trim();
    const file = $("#evidenceFile")?.files?.[0];
    const ep = data.eps.find((e) => e.id === epId);

    if (!epId || !title || !file) return setMsg("Lengkapi EP, judul, dan file.");
    if (file.size > 100 * 1024 * 1024) return setMsg("File melebihi batas 100 MB.");
    if (!ep) return setMsg("EP tidak ditemukan pada master.");
    if (!state.user?.id) return setMsg("Sesi login tidak tersedia.", "error-box");

    let evidenceId = null;
    let storagePath = null;
    try {
      setMsg("Membuat record evidence…");
      const ins = await sb.from("evidence").insert({
        primary_ep_id: epId, title, mime_type: file.type || "application/octet-stream",
        category: "DOCUMENT", status: "DRAFT", created_by: state.user.id, updated_by: state.user.id,
        metadata: { source: "AKSARA web", original_filename: file.name, size: file.size }
      }).select("id").single();
      if (ins.error) throw ins.error;
      evidenceId = ins.data.id;

      storagePath = "evidence/" + evidenceId + "/" + epId + "/" + Date.now() + "-" + safeName(file.name);
      setMsg("Mengunggah ke Supabase Private Storage…");
      const up = await sb.storage.from("accreditation-evidence").upload(storagePath, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (up.error) throw up.error;

      setMsg("Menyimpan version 1…");
      const ver = await sb.from("evidence_versions").insert({
        evidence_id: evidenceId, version_no: 1, storage_path: storagePath, original_filename: file.name,
        size_bytes: file.size, mime_type: file.type || "application/octet-stream", uploaded_by: state.user.id, scan_status: "NOT_SCANNED"
      }).select("id").single();
      if (ver.error) throw ver.error;

      const upd = await sb.from("evidence").update({ current_version_id: ver.data.id, status: "UPLOADED", updated_by: state.user.id }).eq("id", evidenceId);
      if (upd.error) throw upd.error;

      setMsg("Mencadangkan ke Google Drive…");
      const backup = await sb.functions.invoke("aksara-drive-backup", {
        body: {
          evidence_id: evidenceId,
          evidence_version_id: ver.data.id,
          storage_path: storagePath,
          ep_id: epId,
          ep_code: ep.code,
          pokja_code: ep.pokja_code,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream"
        }
      });

      await loadPrivate();
      render();

      if (backup.error || backup.data?.ok === false) {
        window.alert("Evidence Supabase berhasil. Backup Google Drive belum berhasil: " + (backup.data?.error || backup.error?.message || "unknown error"));
      } else {
        window.alert("Evidence berhasil diupload dan dibackup ke Google Drive / " + ep.pokja_code + " / EP " + ep.code + ".");
      }
    } catch (e) {
      setMsg("Gagal: " + (e?.message || String(e)), "error-box");
      if (storagePath) await sb.storage.from("accreditation-evidence").remove([storagePath]).catch(() => {});
      if (evidenceId) await sb.from("evidence").delete().eq("id", evidenceId).catch(() => {});
    }
  }

  async function init() {
    boot();
    try {
      if (!window.supabase?.createClient) throw new Error("Supabase JS SDK tidak termuat.");
      sb = window.supabase.createClient(CONFIG.URL, CONFIG.KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      await loadMaster();

      const current = await sb.auth.getSession();
      if (current.error) throw current.error;

      if (current.data.session) {
        state.session = current.data.session;
        state.user = current.data.session.user;
        await loadMaster();
        await loadPrivate();
        if (!hasRole("SUPER_ADMIN") && data.pokja.length === 1) state.matrixPokja = data.pokja[0].code;
        else if (hasRole("SUPER_ADMIN")) state.matrixPokja = "ALL";
        setupRealtime();
      }

      sb.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(async () => {
          state.session = session;
          state.user = session?.user || null;

          if (session) {
            try {
              await loadMaster();
              await loadPrivate();
              if (hasRole("SUPER_ADMIN")) state.matrixPokja = "ALL";
              else if (data.pokja.length === 1) state.matrixPokja = data.pokja[0].code;
              setupRealtime();
            } catch (e) {
              data.errors.push({ area: "Auth", message: e.message });
            }
          } else {
            if (realtimeChannel) {
              sb.removeChannel(realtimeChannel);
              realtimeChannel = null;
            }
            state.roles = [];
            state.matrixPokja = "ALL";
            data.summary = null;
            data.readiness = [];
            data.evidence = [];
            data.evidenceLinks = [];
            data.driveBackups = [];
            try { await loadMaster(); } catch (_) {}
          }
          render();
        }, 0);
      });

      render();
    } catch (e) {
      fatal(e);
    }
  }

  window.addEventListener("focus", () => refreshPrivateData());
  window.setInterval(() => refreshPrivateData(), 60000);
  init();
})();