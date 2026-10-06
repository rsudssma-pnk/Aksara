(() => {
  "use strict";

  const CONFIG = Object.freeze({
    URL: "https://nbewlpbbvtwtuvamadle.supabase.co",
    KEY: "sb_publishable_mJDHfSdm6iabInDO1ItNdw_GPhLNuI0",
    SDK: "2.117.2",
    PAGE: 1000,
    TABLE_PAGE: 75,
    LOGO: "assets/rsud-logo.png"
  });

  const app = document.getElementById("app");
  const state = {
    page: "dashboard",
    q: "",
    pokja: "ALL",
    strength: "ALL",
    epPage: 1,
    matrixPage: 1,
    session: null,
    user: null,
    roles: []
  };
  const data = {
    pokja: [],
    eps: [],
    relations: [],
    matrix: null,
    evidence: [],
    readiness: [],
    summary: null,
    errors: []
  };

  let supabase = null;
  let searchTimer = null;

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", """: "&quot;", "'": "&#039;"
  })[c]);
  const fmt = (v) => Number(v || 0).toLocaleString("id-ID");
  const pct = (n, d) => d ? Math.round((n / d) * 1000) / 10 : 0;
  const date = (v) => v ? new Date(v).toLocaleDateString("id-ID") : "—";
  const datetime = (v) => v ? new Date(v).toLocaleString("id-ID") : "—";

  function boot(title = "Memuat AKSARA…", detail = "Menyiapkan data akreditasi.") {
    app.innerHTML = '<div class="boot"><div class="spinner"></div><div>' + esc(title) +
      '</div><small>' + esc(detail) + "</small></div>";
  }

  function fatal(error) {
    const message = error?.message || String(error || "Kesalahan tidak diketahui.");
    app.innerHTML = '<main class="fatal"><div><div class="eyebrow">AKSARA</div>' +
      '<h1>Halaman belum dapat dimuat</h1><p>' + esc(message) +
      '</p><button class="button primary" id="retry">Coba lagi</button></div></main>';
    $("#retry")?.addEventListener("click", init);
  }

  async function allRows(factory, label, size = CONFIG.PAGE) {
    const out = [];
    for (let page = 0; page < 20; page++) {
      const from = page * size;
      const to = from + size - 1;
      const r = await factory().range(from, to);
      if (r.error) throw new Error(label + ": " + r.error.message);
      const rows = r.data || [];
      out.push(...rows);
      if (rows.length < size) return out;
    }
    throw new Error(label + ": pagination melebihi batas aman.");
  }

  async function loadMaster() {
    data.errors = [];
    const jobs = [
      ["Pokja", () => allRows(
        () => supabase.from("pokja").select("id,code,name,group_name,sort_order").eq("active", true).order("sort_order"),
        "Pokja", 100
      )],
      ["EP", () => allRows(
        () => supabase.from("v_ep_master").select(
          "id,code,title,description,source_page,source_version,pokja_code,pokja_name,group_name,standard_code,standard_title"
        ).order("code"),
        "EP", 500
      )],
      ["Matrix", () => allRows(
        () => supabase.from("v_integration_explorer").select(
          "source_ep,target_ep,strength,mandatory_status,relation_type,relation_type_name,rationale,evidence_text,source_page,target_page,status"
        ).eq("status", "PUBLISHED").order("source_ep"),
        "Integration Matrix", 1000
      )],
      ["Version", () => supabase.from("matrix_versions")
        .select("version_no,status,effective_from,published_at")
        .eq("status", "PUBLISHED").order("published_at", { ascending: false }).limit(1)]
    ];

    const results = await Promise.allSettled(jobs.map((x) => x[1]()));
    results.forEach((r, i) => {
      const name = jobs[i][0];
      if (r.status === "rejected") data.errors.push({ area: name, message: r.reason?.message || String(r.reason) });
      else if (name === "Pokja") data.pokja = r.value || [];
      else if (name === "EP") data.eps = r.value || [];
      else if (name === "Matrix") data.relations = r.value || [];
      else if (name === "Version") data.matrix = r.value.data?.[0] || null;
    });

    if (!data.pokja.length && !data.eps.length) throw new Error(data.errors.map((e) => e.message).join(" | ") || "Master data kosong.");
  }

  async function loadPrivate() {
    if (!state.session) return;
    const results = await Promise.allSettled([
      supabase.from("v_dashboard_summary").select("*").maybeSingle(),
      allRows(() => supabase.from("v_ep_readiness")
        .select("ep_id,code,pokja_id,required_evidence_total,required_evidence_complete,required_integration_total,required_integration_complete,configured,blockers,readiness_status")
        .order("code"), "Readiness", 500),
      allRows(() => supabase.from("evidence")
        .select("id,primary_ep_id,title,document_number,document_date,revision_number,effective_from,effective_to,owner_unit,owner_name,status,current_version_id,created_at,updated_at")
        .order("updated_at", { ascending: false }), "Evidence", 500),
      supabase.from("user_roles").select("role_id,active").eq("user_id", state.user.id),
    ]);

    data.summary = results[0].status === "fulfilled" ? (results[0].value.data || null) : null;
    data.readiness = results[1].status === "fulfilled" ? (results[1].value || []) : [];
    data.evidence = results[2].status === "fulfilled" ? (results[2].value || []) : [];

    if (results[3].status === "fulfilled" && results[3].value.data?.length) {
      const ids = results[3].value.data.map((x) => x.role_id);
      const rr = await supabase.from("roles").select("id,code,name").in("id", ids);
      state.roles = rr.data || [];
    } else {
      state.roles = [];
    }

    results.forEach((r, i) => {
      if (r.status === "rejected") data.errors.push({ area: ["Dashboard", "Readiness", "Evidence", "Role"][i], message: r.reason?.message || String(r.reason) });
    });
  }

  function hasRole(code) {
    return state.roles.some((r) => r.code === code);
  }

  function evidenceStats() {
    const valid = data.evidence.filter((e) => !!e.current_version_id);
    const epSet = new Set(valid.map((e) => e.primary_ep_id));
    const byPokja = {};
    data.pokja.forEach((p) => {
      const eps = data.eps.filter((e) => e.pokja_code === p.code);
      const covered = eps.filter((e) => epSet.has(e.id)).length;
      const assets = valid.filter((e) => eps.some((x) => x.id === e.primary_ep_id)).length;
      byPokja[p.code] = {
        total: eps.length,
        covered,
        assets,
        percentage: pct(covered, eps.length)
      };
    });
    return {
      assets: valid.length,
      coveredEP: epSet.size,
      percentage: pct(epSet.size, data.eps.length),
      byPokja
    };
  }

  function nav() {
    const items = [
      ["dashboard", "Dashboard"],
      ["eps", "EP Explorer"],
      ["matrix", "Integration Matrix"],
      ["pokja", "Pokja"],
      ["evidence", "Evidence Center"],
      ["readiness", "Readiness"]
    ];
    if (hasRole("SUPER_ADMIN")) items.push(["accounts", "Manajemen Akun"]);
    return items.map(([id, label]) =>
      '<button class="navbtn ' + (state.page === id ? "active" : "") +
      '" data-page="' + id + '">' + esc(label) + "</button>"
    ).join("");
  }

  function shell(content) {
    const roleText = state.roles.length ? state.roles.map((r) => r.name || r.code).join(" • ") : "Pengunjung";
    return '<div class="app-shell"><aside class="sidebar"><div class="side-brand">' +
      '<img src="' + CONFIG.LOGO + '" class="side-logo" alt="Logo RSUD Kota Pontianak">' +
      '<div><div class="side-title">AKSARA</div><div class="side-sub">Evidence &amp; Integration Center</div></div></div>' +
      '<div class="side-hospital">RSUD Sultan Syarif Mohamad Alkadrie<br><span>Kota Pontianak</span></div>' +
      '<nav class="nav">' + nav() + '</nav>' +
      '<div class="side-user"><div class="user-dot">' + esc((state.user?.email || "P").slice(0,1).toUpperCase()) +
      '</div><div class="user-text"><b>' + esc(state.user?.email || "Public Access") + '</b><span>' + esc(roleText) +
      '</span></div></div><button id="auth" class="auth">' + (state.session ? "Keluar" : "Masuk") + "</button>" +
      '<div class="side-foot">KMK 1596/2024 • 221 EP • 2.074 relasi</div></aside><main class="main">' + content + "</main></div>";
  }

  function header(kicker, title, subtitle, actions = "") {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(kicker) + '</div><h1>' +
      esc(title) + '</h1><p class="subtitle">' + esc(subtitle) + '</p></div><div class="head-actions">' +
      actions + '<span class="badge ' + (state.session ? "live" : "") + '"><span class="status-dot"></span>' +
      (state.session ? "Terhubung" : "Publik") + "</span></div></div>";
  }

  function warnings() {
    if (!data.errors.length) return "";
    return '<div class="error-box"><b>Perhatian</b>' + data.errors.map((e) =>
      '<div>' + esc(e.area) + ": " + esc(e.message) + "</div>").join("") + "</div>";
  }

  function metricCard(label, value, hint, icon) {
    return '<div class="metric-card"><div class="metric-icon">' + icon + '</div><div><div class="metric-label">' +
      esc(label) + '</div><div class="metric-value">' + esc(value) + '</div><div class="metric-hint">' +
      esc(hint) + "</div></div></div>";
  }

  function dashboard() {
    const es = evidenceStats();
    const A = data.relations.filter((r) => r.strength === "A").length;
    const B = data.relations.filter((r) => r.strength === "B").length;
    const C = data.relations.filter((r) => r.strength === "C").length;
    const ready = state.session ? data.readiness.filter((r) => r.readiness_status === "READY").length : 0;
    const partial = state.session ? data.readiness.filter((r) => r.readiness_status === "PARTIAL").length : 0;
    const blocked = state.session ? data.readiness.filter((r) => r.readiness_status === "BLOCKED").length : 0;

    const rows = data.pokja.map((p) => {
      const s = es.byPokja[p.code];
      return '<tr><td><b>' + esc(p.code) + '</b><div class="muted tiny">' + esc(p.name) + '</div></td>' +
        '<td>' + fmt(s.total) + '</td><td>' + fmt(s.covered) + '</td><td>' + fmt(s.assets) + '</td>' +
        '<td><div class="progress"><span style="width:' + s.percentage + '%"></span></div><b>' +
        s.percentage + '%</b></td></tr>';
    }).join("");

    return header("Dashboard", "Pusat Kendali Akreditasi", "Pantau kesiapan EP, evidence, integrasi lintas-Pokja, dan progres setiap unit secara otomatis.",
      '<span class="badge draft">Matrix ' + esc(data.matrix?.version_no || "—") + "</span>") + warnings() +
      '<section class="hero"><div class="hero-copy"><div class="hero-kicker">AKSARA • ACCREDITATION CONTROL</div>' +
      '<h2>Evidence yang terhubung, progres yang terukur.</h2><p>Gunakan satu ruang kerja untuk mengecek EP, menyimpan evidence, menelusuri relasi lintas-Pokja, dan melihat blocker readiness.</p>' +
      '<div class="hero-actions"><button class="button primary" data-page="evidence">Kelola Evidence</button><button class="button ghost" data-page="matrix">Buka Integration Matrix</button></div></div>' +
      '<div class="hero-logo"><img src="' + CONFIG.LOGO + '" alt="Logo RSUD Kota Pontianak"></div></section>' +
      '<div class="metrics">' +
      metricCard("Pokja", fmt(data.pokja.length), "Kelompok standar aktif", "▦") +
      metricCard("Elemen Penilaian", fmt(data.eps.length), "Anchor akreditasi", "✓") +
      metricCard("Integration Matrix", fmt(data.relations.length), "Relasi lintas-Pokja", "↔") +
      metricCard("Evidence terupload", state.session ? fmt(es.assets) : "Login", state.session ? es.percentage + "% EP sudah memiliki evidence" : "Masuk untuk melihat progres evidence", "⬆") +
      "</div>' +
      '<div class="section-grid"><section class="section"><div class="section-head"><div><h3>Coverage Evidence per Pokja</h3><p>Persentase dihitung otomatis: EP dengan evidence aktif ÷ total EP Pokja.</p></div>' +
      '<span class="pill ok">' + (state.session ? es.percentage + "% overall" : "Data internal") + "</span></div>" +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Pokja</th><th>Total EP</th><th>EP + Evidence</th><th>Asset</th><th>Coverage</th></tr></thead><tbody>' +
      (state.session ? rows : '<tr><td colspan="5" class="empty">Login untuk menampilkan statistik evidence internal.</td></tr>') +
      '</tbody></table></div></section>' +
      '<section class="section"><div class="section-head"><div><h3>Komposisi Integrasi</h3><p>Status hubungan tetap A/B/C sesuai matrix.</p></div><span class="pill">PUBLISHED</span></div>' +
      '<div class="mini-chart"><div><b>A</b><span>' + fmt(A) + '</span></div><div><b>B</b><span>' + fmt(B) + '</span></div><div><b>C</b><span>' + fmt(C) + '</span></div></div>' +
      (state.session ? '<div class="readiness-strip"><div><b>' + fmt(ready) + '</b><span>Ready</span></div><div><b>' + fmt(partial) + '</b><span>Partial</span></div><div><b>' + fmt(blocked) + '</b><span>Blocked</span></div></div>' : '<div class="notice">Readiness internal tampil setelah autentikasi.</div>') +
      '</section></div>';
  }

  function epsPage() {
    const q = state.q.trim().toLowerCase();
    const rows = data.eps.filter((e) => {
      const okP = state.pokja === "ALL" || e.pokja_code === state.pokja;
      const hay = [e.code, e.title, e.description, e.standard_code, e.standard_title].join(" ").toLowerCase();
      return okP && (!q || hay.includes(q));
    });
    const total = Math.max(1, Math.ceil(rows.length / CONFIG.TABLE_PAGE));
    state.epPage = Math.min(Math.max(1, state.epPage), total);
    const start = (state.epPage - 1) * CONFIG.TABLE_PAGE;
    const body = rows.slice(start, start + CONFIG.TABLE_PAGE).map((e) =>
      '<tr><td class="code"><b>' + esc(e.code) + '</b></td><td><span class="pill">' + esc(e.pokja_code) +
      '</span></td><td>' + esc(e.standard_code || "—") + '</td><td><b>' + esc(e.title || "—") +
      '</b><div class="muted">' + esc(e.description || "—") + '</div></td><td>KMK 1596/2024 • hlm. ' +
      esc(e.source_page || "—") + "</td></tr>").join("");
    return header("Master EP", "EP Explorer", "Cari dan telusuri 221 Elemen Penilaian dengan sumber dokumen.", '<span class="badge">' + fmt(rows.length) + " cocok</span>") +
      warnings() + '<section class="section"><div class="toolbar"><input id="q" class="input" placeholder="Cari kode, judul, standar, atau uraian…" value="' +
      esc(state.q) + '"><select id="pokja" class="select"><option value="ALL">Semua Pokja</option>' +
      data.pokja.map((p) => '<option value="' + esc(p.code) + '" ' + (state.pokja === p.code ? "selected" : "") + '>' +
      esc(p.code) + " — " + esc(p.name) + "</option>").join("") + '</select><button class="button" id="clear">Reset</button></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>EP</th><th>Pokja</th><th>Standar</th><th>Uraian</th><th>Sumber</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5" class="empty">Tidak ada data.</td></tr>') + '</tbody></table></div>' +
      '<div class="pager"><span>Halaman ' + state.epPage + " / " + total + '</span><div class="actions"><button class="button" id="epPrev" ' +
      (state.epPage <= 1 ? "disabled" : "") + '>Sebelumnya</button><button class="button" id="epNext" ' +
      (state.epPage >= total ? "disabled" : "") + '>Berikutnya</button></div></div></section>';
  }

  function matrixPage() {
    const q = state.q.trim().toLowerCase();
    const rows = data.relations.filter((r) => {
      const ok = state.strength === "ALL" || r.strength === state.strength;
      const hay = [r.source_ep, r.target_ep, r.relation_type, r.relation_type_name, r.rationale, r.evidence_text].join(" ").toLowerCase();
      return ok && (!q || hay.includes(q));
    });
    const total = Math.max(1, Math.ceil(rows.length / CONFIG.TABLE_PAGE));
    state.matrixPage = Math.min(Math.max(1, state.matrixPage), total);
    const start = (state.matrixPage - 1) * CONFIG.TABLE_PAGE;
    const body = rows.slice(start, start + CONFIG.TABLE_PAGE).map((r) =>
      '<tr><td class="code"><b>' + esc(r.source_ep) + '</b></td><td class="code"><b>' + esc(r.target_ep) +
      '</b></td><td><span class="pill ' + String(r.strength || "").toLowerCase() + '">' + esc(r.strength || "—") +
      '</span></td><td>' + esc(r.mandatory_status || "—") + '</td><td>' + esc(r.relation_type_name || r.relation_type || "—") +
      '</td><td>' + esc(r.evidence_text || "—") + "</td></tr>").join("");
    return header("Cross-Pokja", "Integration Matrix", "Telusuri seluruh relasi lintas-Pokja dan evidence yang terkait.",
      '<span class="badge draft">' + esc(data.matrix?.version_no || "—") + "</span>") + warnings() +
      '<section class="section"><div class="toolbar"><input id="q" class="input" placeholder="Cari source, target, relation, evidence…" value="' +
      esc(state.q) + '"><select id="strength" class="select"><option value="ALL">Semua kekuatan</option><option value="A" ' +
      (state.strength === "A" ? "selected" : "") + '>A — eksplisit</option><option value="B" ' + (state.strength === "B" ? "selected" : "") +
      '>B — operasional kuat</option><option value="C" ' + (state.strength === "C" ? "selected" : "") + '>C — fungsional</option></select>' +
      '<button class="button" id="clear">Reset</button></div><div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Source</th><th>Target</th><th>Strength</th><th>Status</th><th>Jenis</th><th>Evidence</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="6" class="empty">Tidak ada relasi yang cocok.</td></tr>') + '</tbody></table></div>' +
      '<div class="pager"><span>Halaman ' + state.matrixPage + " / " + total + " • " + fmt(rows.length) +
      ' relasi</span><div class="actions"><button class="button" id="matrixPrev" ' + (state.matrixPage <= 1 ? "disabled" : "") +
      '>Sebelumnya</button><button class="button" id="matrixNext" ' + (state.matrixPage >= total ? "disabled" : "") +
      '>Berikutnya</button></div></div></section>';
  }

  function pokjaPage() {
    const es = evidenceStats();
    return header("Kelompok Standar", "Pokja", "Ringkasan beban kerja dan coverage evidence per kelompok.",
      '<span class="badge">' + fmt(data.pokja.length) + " Pokja</span>") + warnings() +
      '<div class="pokja-grid">' + data.pokja.map((p) => {
        const s = es.byPokja[p.code];
        return '<div class="pokja-card"><div class="pokja-top"><span class="eyebrow">' + esc(p.group_name) +
          '</span><span class="pill">' + esc(p.code) + '</span></div><h3>' + esc(p.name) + '</h3><div class="pokja-stats">' +
          '<b>' + fmt(s.total) + '</b><span>EP</span><b>' + (state.session ? s.percentage + "%" : "—") +
          '</b><span>Evidence</span></div><div class="progress"><span style="width:' + (state.session ? s.percentage : 0) + '%"></span></div></div>';
      }).join("") + "</div>";
  }

  function evidencePage() {
    if (!state.session) return header("Repository Internal", "Evidence Center", "Kelola evidence reusable, versioned, private, dan auditable.") +
      '<section class="section empty"><img src="' + CONFIG.LOGO + '" class="empty-logo" alt=""><h2>Login diperlukan</h2><p>Evidence rumah sakit tidak dibuka untuk publik. Gunakan akun Pokja atau Superadmin.</p><button id="auth2" class="button primary">Masuk ke AKSARA</button></section>';

    const options = data.eps.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.code) + " — " + esc((e.title || e.description || "").slice(0, 110)) + "</option>").join("");
    const body = data.evidence.map((e) => '<tr><td><b>' + esc(e.title) + '</b><div class="muted tiny">' + esc(e.document_number || "") + '</div></td>' +
      '<td><span class="status status-' + String(e.status || "DRAFT").toLowerCase() + '">' + esc(e.status) + '</span></td><td>' +
      esc(e.owner_unit || e.owner_name || "—") + '</td><td>' + esc(date(e.effective_from)) + " → " + esc(date(e.effective_to)) +
      '</td><td>' + esc(datetime(e.updated_at)) + "</td></tr>").join("");

    return header("Repository Internal", "Evidence Center", "Simpan bukti, versi, metadata, dan status verifikasi dalam satu alur.",
      '<span class="badge live">' + fmt(data.evidence.length) + " asset</span>") +
      warnings() + '<section class="section"><div class="section-head"><div><h3>Upload Evidence</h3><p>File disimpan pada private Storage.</p></div></div>' +
      '<div class="upload-grid"><div class="form"><label>EP anchor<select id="evidenceEp" class="select">' + options +
      '</select></label><label>Judul evidence<input id="evidenceTitle" class="input" placeholder="Contoh: SK Direktur Nomor …"></label>' +
      '<label>File<input id="evidenceFile" class="input" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"></label>' +
      '<button id="upload" class="button primary">Upload &amp; Version 1</button><div id="uploadMsg" role="status"></div></div>' +
      '<div class="info-panel"><div class="info-item"><b>Reusable</b><span>Evidence dapat ditautkan ke EP terkait.</span></div><div class="info-item"><b>Versioned</b><span>Versi lama dipertahankan.</span></div><div class="info-item"><b>Auditable</b><span>Perubahan mengikuti audit trail.</span></div><div class="info-item"><b>Protected</b><span>RLS + private Storage.</span></div></div></div></section>' +
      '<section class="section" style="margin-top:16px"><div class="section-head"><div><h3>Evidence Terbaru</h3><p>Daftar sesuai scope user yang sedang login.</p></div></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Judul</th><th>Status</th><th>Owner</th><th>Berlaku</th><th>Diperbarui</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5" class="empty">Belum ada evidence.</td></tr>') + '</tbody></table></div></section>';
  }

  function readinessPage() {
    if (!state.session) return header("Internal Analytics", "Readiness", "Status kesiapan internal dan blocker setiap EP.") +
      '<section class="section empty"><h2>Login diperlukan</h2><p>Readiness berisi data internal dan hanya ditampilkan setelah autentikasi.</p></section>';
    const c = { READY: 0, PARTIAL: 0, BLOCKED: 0, NOT_CONFIGURED: 0 };
    data.readiness.forEach((r) => { c[r.readiness_status] = (c[r.readiness_status] || 0) + 1; });
    const blockers = data.readiness.filter((r) => r.readiness_status === "BLOCKED").slice(0, 50);
    const body = blockers.map((r) => '<tr><td class="code"><b>' + esc(r.code) + '</b></td><td><span class="pill c">BLOCKED</span></td>' +
      '<td>' + fmt(r.required_evidence_complete) + "/" + fmt(r.required_evidence_total) + '</td><td>' +
      fmt(r.required_integration_complete) + "/" + fmt(r.required_integration_total) + '</td><td><pre>' +
      esc(JSON.stringify(r.blockers || [], null, 2)) + "</pre></td></tr>").join("");
    return header("Internal Analytics", "Readiness & Blockers", "Engine explainable yang membantu prioritas tindak lanjut.",
      '<span class="badge draft">INTERNAL</span>') + warnings() +
      '<div class="metrics">' + metricCard("Ready", fmt(c.READY), "EP", "✓") + metricCard("Partial", fmt(c.PARTIAL), "EP", "◐") +
      metricCard("Blocked", fmt(c.BLOCKED), "EP", "!") + metricCard("Not Configured", fmt(c.NOT_CONFIGURED), "EP", "○") + '</div>' +
      '<section class="section" style="margin-top:16px"><div class="notice">Readiness AKSARA adalah kontrol internal; bukan skor penilaian resmi lembaga akreditasi.</div></section>' +
      '<section class="section" style="margin-top:16px"><div class="section-head"><div><h3>Top Blockers</h3><p>Prioritas yang dapat ditindaklanjuti.</p></div></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>EP</th><th>Status</th><th>Evidence</th><th>Integration</th><th>Detail</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5" class="empty">Tidak ada blocker.</td></tr>') + '</tbody></table></div></section>';
  }

  function accountsPage() {
    if (!hasRole("SUPER_ADMIN")) return header("Access Control", "Manajemen Akun", "Halaman khusus Superadmin.") +
      '<section class="section empty"><h2>Akses ditolak</h2><p>Anda tidak memiliki role SUPER_ADMIN.</p></section>';
    return header("Access Control", "Manajemen Akun", "Daftar akun operasional per Pokja. Password tidak disimpan di frontend.",
      '<span class="badge">SUPERADMIN</span>') + '<section class="section"><div class="notice">Akun Auth harus dikelola melalui Supabase Auth. AKSARA tidak pernah menaruh password di source code publik.</div>' +
      '<div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Username</th><th>Pokja</th><th>Role</th><th>Scope</th><th>Status</th></tr></thead><tbody>' +
      data.pokja.map((p) => '<tr><td class="code"><b>' + esc(p.code.toLowerCase()) + '</b></td><td>' + esc(p.code) + " — " + esc(p.name) +
      '</td><td>POKJA_COORDINATOR</td><td>View • Upload • Review • Manage</td><td><span class="pill">Provisioning</span></td></tr>').join("") +
      '<tr><td class="code"><b>superadmin</b></td><td>Semua Pokja</td><td>SUPER_ADMIN</td><td>Full access</td><td><span class="pill ok">SUPERADMIN</span></td></tr>' +
      '</tbody></table></div></section>';
  }

  function render() {
    let content = state.page === "eps" ? epsPage() :
      state.page === "matrix" ? matrixPage() :
      state.page === "pokja" ? pokjaPage() :
      state.page === "evidence" ? evidencePage() :
      state.page === "readiness" ? readinessPage() :
      state.page === "accounts" ? accountsPage() : dashboard();
    app.innerHTML = shell(content);
    bind();
  }

  function bind() {
    document.querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", () => {
      state.page = b.dataset.page; state.q = ""; state.epPage = 1; state.matrixPage = 1; render();
    }));
    const q = $("#q");
    if (q) q.addEventListener("input", () => {
      state.q = q.value;
      if (state.page === "eps") state.epPage = 1;
      if (state.page === "matrix") state.matrixPage = 1;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 120);
    });
    $("#pokja")?.addEventListener("change", (e) => { state.pokja = e.target.value; state.epPage = 1; render(); });
    $("#strength")?.addEventListener("change", (e) => { state.strength = e.target.value; state.matrixPage = 1; render(); });
    $("#clear")?.addEventListener("click", () => { state.q = ""; state.pokja = "ALL"; state.strength = "ALL"; state.epPage = 1; state.matrixPage = 1; render(); });
    $("#epPrev")?.addEventListener("click", () => { state.epPage--; render(); });
    $("#epNext")?.addEventListener("click", () => { state.epPage++; render(); });
    $("#matrixPrev")?.addEventListener("click", () => { state.matrixPage--; render(); });
    $("#matrixNext")?.addEventListener("click", () => { state.matrixPage++; render(); });
    $("#auth")?.addEventListener("click", auth);
    $("#auth2")?.addEventListener("click", auth);
    $("#upload")?.addEventListener("click", uploadEvidence);
    $("#retryMaster")?.addEventListener("click", retryMaster);
  }

  async function retryMaster() {
    boot("Memuat master…", "Mengambil seluruh data.");
    try { await loadMaster(); render(); } catch (e) { fatal(e); }
  }

  async function auth() {
    if (state.session) {
      await supabase.auth.signOut();
      state.session = null; state.user = null; state.roles = []; data.evidence = []; data.readiness = []; data.summary = null;
      render(); return;
    }
    const username = window.prompt("Username (contoh: pmkp)");
    if (!username) return;
    const password = window.prompt("Password");
    if (!password) return;
    const normalized = username.trim().toLowerCase();
    const email = normalized.includes("@") ? normalized : normalized + "@aksara.local";
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      window.alert("Login gagal: " + result.error.message);
      return;
    }
    state.session = result.data.session; state.user = result.data.user;
    await loadPrivate(); render();
  }

  function safeName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "evidence";
  }

  async function uploadEvidence() {
    const msg = $("#uploadMsg");
    const setMsg = (t, cls = "muted") => { if (msg) { msg.className = cls; msg.textContent = t; } };
    const ep = $("#evidenceEp")?.value;
    const title = $("#evidenceTitle")?.value.trim();
    const file = $("#evidenceFile")?.files?.[0];

    if (!ep || !title || !file) return setMsg("Lengkapi EP, judul, dan file.");
    if (file.size > 100 * 1024 * 1024) return setMsg("File melebihi batas 100 MB.");
    if (!state.user?.id) return setMsg("Sesi pengguna tidak tersedia.", "error-box");

    let evidenceId = null;
    let path = null;
    try {
      setMsg("Membuat record evidence…");
      const ins = await supabase.from("evidence").insert({
        primary_ep_id: ep, title, mime_type: file.type || "application/octet-stream",
        category: "DOCUMENT", status: "DRAFT", created_by: state.user.id, updated_by: state.user.id,
        metadata: { source: "AKSARA web", original_filename: file.name, size: file.size }
      }).select("id").single();
      if (ins.error) throw ins.error;
      evidenceId = ins.data.id;
      path = "evidence/" + evidenceId + "/" + ep + "/" + Date.now() + "-" + safeName(file.name);

      setMsg("Mengunggah file…");
      const up = await supabase.storage.from("accreditation-evidence").upload(path, file, {
        upsert: false, contentType: file.type || "application/octet-stream"
      });
      if (up.error) throw up.error;

      setMsg("Menyimpan version 1…");
      const ver = await supabase.from("evidence_versions").insert({
        evidence_id: evidenceId, version_no: 1, storage_path: path,
        original_filename: file.name, size_bytes: file.size,
        mime_type: file.type || "application/octet-stream", uploaded_by: state.user.id, scan_status: "NOT_SCANNED"
      }).select("id").single();
      if (ver.error) throw ver.error;

      const upd = await supabase.from("evidence").update({
        current_version_id: ver.data.id, status: "UPLOADED", updated_by: state.user.id
      }).eq("id", evidenceId);
      if (upd.error) throw upd.error;

      await loadPrivate();
      render();
      window.alert("Evidence berhasil diupload sebagai Version 1.");
    } catch (e) {
      setMsg("Gagal: " + (e?.message || String(e)), "error-box");
      if (path) await supabase.storage.from("accreditation-evidence").remove([path]).catch(() => {});
      if (evidenceId) await supabase.from("evidence").delete().eq("id", evidenceId).catch(() => {});
    }
  }

  async function init() {
    boot();
    try {
      if (!window.supabase?.createClient) throw new Error("Supabase JS SDK tidak termuat.");
      supabase = window.supabase.createClient(CONFIG.URL, CONFIG.KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      await loadMaster();
      const current = await supabase.auth.getSession();
      if (current.error) throw current.error;
      if (current.data.session) {
        state.session = current.data.session; state.user = current.data.session.user;
        await loadPrivate();
      }
      supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(async () => {
          state.session = session; state.user = session?.user || null;
          if (session) { try { await loadPrivate(); } catch (e) { data.errors.push({ area: "Auth", message: e.message }); } }
          else { state.roles = []; data.evidence = []; data.readiness = []; data.summary = null; }
          render();
        }, 0);
      });
      render();
    } catch (e) {
      fatal(e);
    }
  }

  init();
})();