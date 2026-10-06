(() => {
  'use strict';

  const CONFIG = Object.freeze({
    SUPABASE_URL: 'https://nbewlpbbvtwtuvamadle.supabase.co',
    SUPABASE_KEY: 'sb_publishable_mJDHfSdm6iabInDO1ItNdw_GPhLNuI0',
    SDK_VERSION: '2.117.2',
    API_PAGE_SIZE: 1000,
    UI_PAGE_SIZE: 100
  });

  const state = {
    page: 'dashboard',
    q: '',
    pokja: 'ALL',
    strength: 'ALL',
    epPage: 1,
    matrixPage: 1,
    session: null,
    user: null,
    loading: true
  };

  const data = {
    pokja: [],
    eps: [],
    relations: [],
    matrix: null,
    readiness: [],
    summary: null,
    evidence: [],
    errors: []
  };

  const app = document.getElementById('app');
  let sb = null;
  let filterTimer = null;

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[c]);
  const num = (value) => Number(value || 0).toLocaleString('id-ID');
  const dateTime = (value) => value ? new Date(value).toLocaleString('id-ID') : '—';

  function boot(title = 'Memuat AKSARA…', detail = 'Menyiapkan koneksi ke data akreditasi.') {
    app.innerHTML = '<div class="boot"><div class="spinner" aria-hidden="true"></div><div>' +
      esc(title) + '</div><small>' + esc(detail) + '</small></div>';
  }

  function fatal(error) {
    const message = error?.message || String(error || 'Kesalahan tidak diketahui.');
    app.innerHTML = '<main class="fatal"><div><div class="eyebrow">AKSARA</div>' +
      '<h1>Aplikasi belum dapat dimuat</h1><p>' + esc(message) +
      '</p><button class="button primary" id="fatalRetry">Coba lagi</button></div></main>';
    $('#fatalRetry')?.addEventListener('click', init);
  }

  function requireSdk() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase JS SDK gagal dimuat. Periksa koneksi CDN atau firewall jaringan.');
    }
  }

  async function fetchAll(queryFactory, label, pageSize = CONFIG.API_PAGE_SIZE, maxPages = 20) {
    const rows = [];
    for (let page = 0; page < maxPages; page += 1) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const result = await queryFactory().range(from, to);
      if (result.error) throw new Error(label + ': ' + result.error.message);
      const batch = result.data || [];
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
    throw new Error(label + ': jumlah data melebihi batas pagination.');
  }

  async function loadMaster() {
    data.errors = [];
    const tasks = [
      ['Pokja', () => fetchAll(
        () => sb.from('pokja')
          .select('id,code,name,group_name,sort_order')
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        'Pokja', 100
      )],
      ['EP', () => fetchAll(
        () => sb.from('v_ep_master')
          .select('id,code,title,description,source_page,source_version,pokja_code,pokja_name,group_name,standard_code,standard_title')
          .order('code', { ascending: true }),
        'EP', 500
      )],
      ['Integration Matrix', () => fetchAll(
        () => sb.from('v_integration_explorer')
          .select('source_ep,target_ep,strength,mandatory_status,relation_type,relation_type_name,rationale,evidence_text,source_page,target_page,status')
          .eq('status', 'PUBLISHED')
          .order('source_ep', { ascending: true }),
        'Integration Matrix', CONFIG.API_PAGE_SIZE
      )],
      ['Matrix version', async () => sb.from('matrix_versions')
        .select('version_no,status,effective_from,published_at')
        .eq('status', 'PUBLISHED')
        .order('published_at', { ascending: false })
        .limit(1)]
    ];

    const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
    results.forEach((result, index) => {
      const label = tasks[index][0];
      if (result.status === 'fulfilled') {
        if (label === 'Pokja') data.pokja = result.value || [];
        else if (label === 'EP') data.eps = result.value || [];
        else if (label === 'Integration Matrix') data.relations = result.value || [];
        else if (label === 'Matrix version') data.matrix = result.value.data?.[0] || null;
      } else {
        data.errors.push({ area: label, message: result.reason?.message || String(result.reason) });
      }
    });

    if (!data.pokja.length && !data.eps.length && !data.relations.length) {
      throw new Error(data.errors.map((e) => e.area + ': ' + e.message).join(' | ') || 'Master data tidak dapat diakses.');
    }
  }

  async function loadPrivate() {
    if (!state.session) return;
    const results = await Promise.allSettled([
      sb.from('v_dashboard_summary').select('*').maybeSingle(),
      fetchAll(
        () => sb.from('v_ep_readiness')
          .select('ep_id,code,pokja_id,required_evidence_total,required_evidence_complete,required_integration_total,required_integration_complete,configured,blockers,readiness_status')
          .order('code', { ascending: true }),
        'Readiness', 500
      ),
      sb.from('evidence')
        .select('id,primary_ep_id,title,document_number,document_date,revision_number,effective_from,effective_to,owner_unit,owner_name,status,current_version_id,created_at,updated_at')
        .order('updated_at', { ascending: false })
        .limit(100)
    ]);

    data.summary = results[0].status === 'fulfilled' ? (results[0].value.data || null) : null;
    data.readiness = results[1].status === 'fulfilled' ? (results[1].value || []) : [];
    data.evidence = results[2].status === 'fulfilled' ? (results[2].value.data || []) : [];

    results.filter((r) => r.status === 'rejected').forEach((r) => {
      data.errors.push({ area: 'Data privat', message: r.reason?.message || String(r.reason) });
    });
  }

  function metric(label, value, hint) {
    return '<div class="card"><div class="metric-label">' + esc(label) +
      '</div><div class="metric">' + esc(value) + '</div><div class="hint">' +
      esc(hint || '') + '</div></div>';
  }

  function nav() {
    return [
      ['dashboard', 'Dashboard'],
      ['eps', 'EP Explorer'],
      ['matrix', 'Integration Matrix'],
      ['pokja', 'Pokja'],
      ['evidence', 'Evidence Center'],
      ['readiness', 'Readiness']
    ].map(([id, label]) =>
      '<button class="navbtn ' + (state.page === id ? 'active' : '') +
      '" data-page="' + id + '">' + esc(label) + '</button>'
    ).join('');
  }

  function shell(content) {
    return '<div class="shell"><aside class="side"><div class="brand">AKSARA' +
      '<span>ACCREDITATION EVIDENCE &amp; INTEGRATION CENTER</span></div><nav class="nav">' +
      nav() + '</nav><div class="side-bottom"><div>RSUD Sultan Syarif Mohamad Alkadrie</div>' +
      '<div class="side-meta">KMK 1596/2024 • Evidence • Integration • Readiness</div>' +
      '<div class="side-meta">Supabase • SDK ' + esc(CONFIG.SDK_VERSION) + '</div>' +
      '<button id="auth" class="auth">' + (state.session ? 'Keluar' : 'Masuk / Supabase') +
      '</button></div></aside><main class="main">' + content + '</main></div>';
  }

  function header(title, subtitle, badge = '') {
    const warnings = data.errors.length
      ? '<span class="badge error"><span class="status-dot"></span>' + num(data.errors.length) + ' peringatan</span>'
      : '';
    return '<div class="top"><div><div class="eyebrow">Sistem Informasi Manajemen Akreditasi</div>' +
      '<h1>' + esc(title) + '</h1><div class="subtitle">' + esc(subtitle) +
      '</div></div><div class="top-right">' + badge + warnings +
      '<span class="badge ' + (state.session ? 'live' : '') + '"><span class="status-dot"></span>' +
      (state.session ? 'LIVE / AUTHENTICATED' : 'LIVE / PUBLIC MASTER') + '</span></div></div>';
  }

  function warningBox() {
    if (!data.errors.length) return '';
    return '<section class="section" style="margin-bottom:16px"><div class="error-box"><b>Perhatian</b>' +
      data.errors.map((e) => '<div>' + esc(e.area) + ': ' + esc(e.message) + '</div>').join('') +
      '<div style="margin-top:8px"><button class="button" id="retryMaster">Muat ulang master</button></div>' +
      '</div></section>';
  }

  function dashboard() {
    const a = data.relations.filter((x) => x.strength === 'A').length;
    const b = data.relations.filter((x) => x.strength === 'B').length;
    const c = data.relations.filter((x) => x.strength === 'C').length;
    const ready = data.summary?.ep_ready ?? data.readiness.filter((x) => x.readiness_status === 'READY').length;
    const partial = data.summary?.ep_partial ?? data.readiness.filter((x) => x.readiness_status === 'PARTIAL').length;
    const blocked = data.summary?.ep_blocked ?? data.readiness.filter((x) => x.readiness_status === 'BLOCKED').length;
    const configured = data.readiness.filter((x) => x.configured).length;

    const coverage = data.pokja.map((p) => {
      const count = data.eps.filter((e) => e.pokja_code === p.code).length;
      const width = Math.min(100, Math.round((count / 21) * 100));
      return '<div class="item"><div class="row"><b>' + esc(p.code) + '</b><span class="muted">' +
        num(count) + ' EP</span></div><div class="bar"><span style="width:' + width +
        '%"></span></div><div class="small">' + esc(p.name) + '</div></div>';
    }).join('');

    return header('AKSARA',
      'Sistem manajemen evidence dan integrasi akreditasi rumah sakit dengan sumber master live dari Supabase.',
      '<span class="badge draft">Matrix ' + esc(data.matrix?.version_no || '—') + ' • ' +
      esc(data.matrix?.status || '—') + '</span>') +
      warningBox() +
      '<div class="cards">' +
      metric('Pokja', num(data.pokja.length), 'Master kelompok standar') +
      metric('Elemen Penilaian', num(data.eps.length), 'Master EP live') +
      metric('Relasi lintas-Pokja', num(data.relations.length), 'Seluruh hasil pagination API') +
      metric('A / B / C', num(a) + ' / ' + num(b) + ' / ' + num(c), 'Kekuatan relasi') +
      '</div><div class="cards" style="margin-top:14px">' +
      metric('EP Ready', num(ready), 'Readiness internal') +
      metric('EP Partial', num(partial), 'Perlu penyelesaian') +
      metric('EP Blocked', num(blocked), 'Blocker perlu ditindaklanjuti') +
      metric('EP Configured', num(configured), 'Memiliki rule readiness') +
      '</div><div class="grid"><section class="section"><div class="section-head">' +
      '<h2>Coverage per Pokja</h2><span class="muted">' + num(data.eps.length) + ' EP</span></div>' +
      '<div class="list">' + (coverage || '<div class="empty muted">Belum ada data.</div>') +
      '</div></section><section class="section"><div class="section-head"><h2>Kontrol Sistem</h2>' +
      '<span class="pill ok">LIVE</span></div>' +
      '<div class="callout"><b>Source of truth</b><span>Master EP dan Integration Matrix berasal dari Supabase.</span></div>' +
      '<div class="callout"><b>Pagination aman</b><span>2.074 relasi tidak dipotong oleh limit default API.</span></div>' +
      '<div class="callout"><b>Security boundary</b><span>Master publik read-only; evidence dan readiness membutuhkan autentikasi.</span></div>' +
      '</section></div>';
  }

  function filteredEps() {
    const q = state.q.trim().toLowerCase();
    return data.eps.filter((e) => {
      const okPokja = state.pokja === 'ALL' || e.pokja_code === state.pokja;
      const haystack = [e.code, e.title, e.description, e.standard_code, e.standard_title].join(' ').toLowerCase();
      return okPokja && (!q || haystack.includes(q));
    });
  }

  function filteredRelations() {
    const q = state.q.trim().toLowerCase();
    return data.relations.filter((r) => {
      const okStrength = state.strength === 'ALL' || r.strength === state.strength;
      const haystack = [r.source_ep, r.target_ep, r.relation_type_name, r.relation_type, r.rationale, r.evidence_text].join(' ').toLowerCase();
      return okStrength && (!q || haystack.includes(q));
    });
  }

  function pager(prefix, page, totalPages, totalRows) {
    const prev = prefix + 'Prev';
    const next = prefix + 'Next';
    return '<div class="pager"><span class="footer">Halaman ' + num(page) + ' / ' +
      num(totalPages) + ' • ' + num(totalRows) + ' baris</span><div class="actions">' +
      '<button class="button" id="' + prev + '" ' + (page <= 1 ? 'disabled' : '') +
      '>Sebelumnya</button><button class="button" id="' + next + '" ' +
      (page >= totalPages ? 'disabled' : '') + '>Berikutnya</button></div></div>';
  }

  function epsPage() {
    const rows = filteredEps();
    const totalPages = Math.max(1, Math.ceil(rows.length / CONFIG.UI_PAGE_SIZE));
    state.epPage = Math.max(1, Math.min(state.epPage, totalPages));
    const start = (state.epPage - 1) * CONFIG.UI_PAGE_SIZE;
    const visible = rows.slice(start, start + CONFIG.UI_PAGE_SIZE);
    const body = visible.map((e) => '<tr><td class="code"><b>' + esc(e.code) + '</b></td><td>' +
      '<span class="pill">' + esc(e.pokja_code) + '</span></td><td>' + esc(e.standard_code || '—') +
      '</td><td>' + esc(e.title || '—') + '</td><td>' + esc(e.description || '—') +
      '</td><td>KMK 1596/2024 • hlm. ' + esc(e.source_page || '—') + '</td></tr>').join('');

    return header('EP Explorer', 'Eksplorasi Elemen Penilaian dan sumber dokumennya.',
      '<span class="badge">' + num(rows.length) + ' cocok</span>') + warningBox() +
      '<section class="section"><div class="toolbar"><input id="q" class="input" value="' +
      esc(state.q) + '" placeholder="Cari kode, judul, standar, atau uraian EP…"><select id="pokja" class="select">' +
      '<option value="ALL">Semua Pokja</option>' + data.pokja.map((p) =>
        '<option value="' + esc(p.code) + '" ' + (state.pokja === p.code ? 'selected' : '') +
        '>' + esc(p.code) + ' — ' + esc(p.name) + '</option>').join('') +
      '</select><button class="button" id="clearFilter">Reset</button></div><div class="table-wrap">' +
      '<table class="table"><thead><tr><th>EP</th><th>Pokja</th><th>Standar</th><th>Judul</th><th>Uraian</th><th>Sumber</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="6" class="empty muted">Tidak ada EP yang cocok.</td></tr>') +
      '</tbody></table></div>' + pager('ep', state.epPage, totalPages, rows.length) + '</section>';
  }

  function matrixPage() {
    const rows = filteredRelations();
    const totalPages = Math.max(1, Math.ceil(rows.length / CONFIG.UI_PAGE_SIZE));
    state.matrixPage = Math.max(1, Math.min(state.matrixPage, totalPages));
    const start = (state.matrixPage - 1) * CONFIG.UI_PAGE_SIZE;
    const visible = rows.slice(start, start + CONFIG.UI_PAGE_SIZE);
    const body = visible.map((r) => '<tr><td class="code"><b>' + esc(r.source_ep) + '</b></td><td class="code"><b>' +
      esc(r.target_ep) + '</b></td><td><span class="pill ' + String(r.strength || '').toLowerCase() +
      '">' + esc(r.strength || '—') + '</span></td><td>' + esc(r.mandatory_status || '—') +
      '</td><td>' + esc(r.relation_type_name || r.relation_type || '—') + '</td><td>' +
      esc(r.evidence_text || '—') + '</td></tr>').join('');

    return header('Integration Matrix', 'Pemetaan keterkaitan lintas-Pokja pada matrix terbit.',
      '<span class="badge draft">' + esc(data.matrix?.version_no || '—') + ' • ' +
      esc(data.matrix?.status || '—') + '</span>') + warningBox() +
      '<section class="section"><div class="toolbar"><input id="q" class="input" value="' +
      esc(state.q) + '" placeholder="Cari source EP, target EP, relation, evidence…"><select id="strength" class="select">' +
      '<option value="ALL">Semua kekuatan</option><option value="A" ' + (state.strength === 'A' ? 'selected' : '') +
      '>A — eksplisit</option><option value="B" ' + (state.strength === 'B' ? 'selected' : '') +
      '>B — operasional kuat</option><option value="C" ' + (state.strength === 'C' ? 'selected' : '') +
      '>C — fungsional</option></select><button class="button" id="clearFilter">Reset</button></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Source</th><th>Target</th><th>Strength</th><th>Status</th><th>Jenis hubungan</th><th>Evidence</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="6" class="empty muted">Tidak ada relasi yang cocok.</td></tr>') +
      '</tbody></table></div>' + pager('matrix', state.matrixPage, totalPages, rows.length) + '</section>';
  }

  function pokjaPage() {
    return header('Pokja', 'Kelompok standar menjadi scope navigasi dan authorization.',
      '<span class="badge">' + num(data.pokja.length) + ' Pokja</span>') + warningBox() +
      '<div class="cards">' + data.pokja.map((p) => '<div class="card"><div class="eyebrow">' +
      esc(p.group_name) + '</div><div class="metric" style="font-size:24px">' + esc(p.code) +
      '</div><div class="muted">' + esc(p.name) + '</div><div class="hint"><b>' +
      num(data.eps.filter((e) => e.pokja_code === p.code).length) + '</b> EP</div></div>').join('') +
      '</div>';
  }

  function evidencePage() {
    if (!state.session) {
      return header('Evidence Center', 'Evidence bersifat private dan membutuhkan autentikasi + scope.') +
        warningBox() + '<section class="section empty"><h2>Login diperlukan</h2>' +
        '<p class="muted">Master akreditasi tetap dapat ditinjau tanpa login. Upload dan lifecycle evidence memerlukan sesi pengguna.</p>' +
        '<button id="auth2" class="button primary">Masuk ke Evidence Center</button></section>';
    }
    const epOptions = data.eps.map((e) => '<option value="' + esc(e.id) + '">' +
      esc(e.code) + ' — ' + esc((e.title || e.description || '').slice(0, 100)) + '</option>').join('');
    const body = data.evidence.map((e) => '<tr><td><b>' + esc(e.title) + '</b></td><td>' +
      esc(e.status) + '</td><td>' + esc(e.owner_unit || e.owner_name || '—') +
      '</td><td>' + esc(e.effective_from || '—') + ' → ' + esc(e.effective_to || '—') +
      '</td><td>' + esc(dateTime(e.updated_at)) + '</td></tr>').join('');
    return header('Evidence Center', 'Kelola evidence reusable, versioned, private, dan auditable.',
      '<span class="badge live">' + num(data.evidence.length) + ' item</span>') +
      '<section class="section"><div class="grid" style="margin-top:0"><div><div class="section-head">' +
      '<h2>Upload evidence</h2><span class="pill">PRIVATE STORAGE</span></div><div class="form">' +
      '<label>EP anchor<select id="evidenceEp" class="select">' + epOptions + '</select></label>' +
      '<label>Judul evidence<input id="evidenceTitle" class="input" placeholder="Contoh: SK Direktur…"></label>' +
      '<label>File<input id="evidenceFile" class="input" type="file"></label>' +
      '<button id="uploadEvidence" class="button primary">Upload &amp; version 1</button><div id="uploadMsg" class="muted" role="status"></div>' +
      '</div></div><div><div class="section-head"><h2>Lifecycle</h2><span class="pill">RLS</span></div>' +
      '<div class="callout"><b>Reusable</b><span>Evidence dapat ditautkan ke banyak EP.</span></div>' +
      '<div class="callout"><b>Versioned</b><span>Versi lama tidak ditimpa.</span></div>' +
      '<div class="callout"><b>Auditable</b><span>Perubahan tercatat pada audit trail.</span></div></div></div></section>' +
      '<section class="section" style="margin-top:16px"><div class="section-head"><h2>Evidence terbaru</h2>' +
      '<span class="muted">' + num(data.evidence.length) + ' item</span></div><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Judul</th><th>Status</th><th>Owner</th><th>Periode berlaku</th><th>Updated</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5" class="empty muted">Belum ada evidence.</td></tr>') +
      '</tbody></table></div></section>';
  }

  function readinessPage() {
    if (!state.session) {
      return header('Readiness & Blockers', 'Engine internal yang dapat dijelaskan; autentikasi dibutuhkan untuk hasil per-Pokja.') +
        warningBox() + '<section class="section empty"><h2>Readiness private</h2>' +
        '<p class="muted">Hasil readiness bergantung pada evidence dan verification internal sehingga terproteksi.</p></section>';
    }
    const counts = { READY: 0, PARTIAL: 0, BLOCKED: 0, NOT_CONFIGURED: 0 };
    data.readiness.forEach((x) => { counts[x.readiness_status] = (counts[x.readiness_status] || 0) + 1; });
    const blockers = data.readiness.filter((x) => x.readiness_status === 'BLOCKED').slice(0, 50);
    return header('Readiness & Blockers', 'Hasil kalkulasi internal dari requirement dan matrix terbit.',
      '<span class="badge draft">INTERNAL ONLY</span>') + warningBox() +
      '<div class="cards">' + metric('Ready', num(counts.READY), 'EP') +
      metric('Partial', num(counts.PARTIAL), 'EP') + metric('Blocked', num(counts.BLOCKED), 'EP') +
      metric('Not Configured', num(counts.NOT_CONFIGURED), 'EP') + '</div>' +
      '<section class="section" style="margin-top:16px"><div class="notice">Readiness AKSARA bukan penilaian resmi lembaga akreditasi.</div></section>' +
      '<section class="section" style="margin-top:16px"><div class="section-head"><h2>Top blockers</h2>' +
      '<span class="muted">' + num(blockers.length) + ' ditampilkan</span></div><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>EP</th><th>Status</th><th>Evidence</th><th>Integration</th><th>Detail</th></tr></thead><tbody>' +
      (blockers.map((x) => '<tr><td class="code"><b>' + esc(x.code) + '</b></td><td><span class="pill c">BLOCKED</span></td><td>' +
      num(x.required_evidence_complete) + '/' + num(x.required_evidence_total) + '</td><td>' +
      num(x.required_integration_complete) + '/' + num(x.required_integration_total) + '</td><td><pre style="white-space:pre-wrap;margin:0;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas">' +
      esc(JSON.stringify(x.blockers || [], null, 2)) + '</pre></td></tr>').join('') ||
      '<tr><td colspan="5" class="empty muted">Tidak ada blocker.</td></tr>') +
      '</tbody></table></div></section>';
  }

  function currentView() {
    if (state.page === 'eps') return epsPage();
    if (state.page === 'matrix') return matrixPage();
    if (state.page === 'pokja') return pokjaPage();
    if (state.page === 'evidence') return evidencePage();
    if (state.page === 'readiness') return readinessPage();
    return dashboard();
  }

  function render() {
    app.innerHTML = shell(currentView());
    bind();
  }

  function bind() {
    document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
      state.page = button.dataset.page;
      state.q = '';
      state.epPage = 1;
      state.matrixPage = 1;
      render();
    }));

    const q = $('#q');
    if (q) q.addEventListener('input', () => {
      state.q = q.value;
      if (state.page === 'eps') state.epPage = 1;
      if (state.page === 'matrix') state.matrixPage = 1;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(render, 160);
    });

    $('#pokja')?.addEventListener('change', (e) => { state.pokja = e.target.value; state.epPage = 1; render(); });
    $('#strength')?.addEventListener('change', (e) => { state.strength = e.target.value; state.matrixPage = 1; render(); });
    $('#clearFilter')?.addEventListener('click', () => { state.q = ''; state.pokja = 'ALL'; state.strength = 'ALL'; state.epPage = 1; state.matrixPage = 1; render(); });
    $('#epPrev')?.addEventListener('click', () => { state.epPage -= 1; render(); });
    $('#epNext')?.addEventListener('click', () => { state.epPage += 1; render(); });
    $('#matrixPrev')?.addEventListener('click', () => { state.matrixPage -= 1; render(); });
    $('#matrixNext')?.addEventListener('click', () => { state.matrixPage += 1; render(); });
    $('#retryMaster')?.addEventListener('click', retryMaster);
    $('#auth')?.addEventListener('click', auth);
    $('#auth2')?.addEventListener('click', auth);
    $('#uploadEvidence')?.addEventListener('click', uploadEvidence);
  }

  async function retryMaster() {
    boot('Memuat ulang master…', 'Mengambil seluruh data dengan pagination.');
    try { await loadMaster(); render(); } catch (error) { fatal(error); }
  }

  async function auth() {
    if (state.session) {
      await sb.auth.signOut();
      state.session = null;
      state.user = null;
      data.summary = null;
      data.readiness = [];
      data.evidence = [];
      render();
      return;
    }
    const email = window.prompt('Email Supabase');
    if (!email) return;
    const password = window.prompt('Password Supabase');
    if (!password) return;
    const result = await sb.auth.signInWithPassword({ email, password });
    if (result.error) { window.alert('Login gagal: ' + result.error.message); return; }
    state.session = result.data.session;
    state.user = result.data.user;
    await loadPrivate();
    render();
  }

  function safeName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'evidence';
  }

  async function uploadEvidence() {
    const msg = $('#uploadMsg');
    const ep = $('#evidenceEp')?.value;
    const title = $('#evidenceTitle')?.value.trim();
    const file = $('#evidenceFile')?.files?.[0];
    const setMsg = (value, className = 'muted') => { if (msg) { msg.className = className; msg.textContent = value; } };

    if (!ep || !title || !file) { setMsg('Lengkapi EP, judul, dan file.'); return; }
    if (file.size > 100 * 1024 * 1024) { setMsg('File melebihi batas 100 MB.'); return; }
    if (!state.user?.id) { setMsg('Sesi login tidak tersedia. Silakan login ulang.', 'error-box'); return; }

    let evidenceId = null;
    let storagePath = null;

    try {
      setMsg('Membuat record evidence…');
      const inserted = await sb.from('evidence').insert({
        primary_ep_id: ep,
        title,
        mime_type: file.type || 'application/octet-stream',
        category: 'DOCUMENT',
        status: 'DRAFT',
        created_by: state.user.id,
        updated_by: state.user.id,
        metadata: { source: 'AKSARA web', original_size: file.size }
      }).select('id').single();

      if (inserted.error) throw inserted.error;
      evidenceId = inserted.data.id;
      storagePath = 'evidence/' + evidenceId + '/' + ep + '/' + Date.now() + '-' + safeName(file.name);

      setMsg('Mengunggah file ke private Storage…');
      const uploaded = await sb.storage.from('accreditation-evidence').upload(storagePath, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream'
      });
      if (uploaded.error) throw uploaded.error;

      setMsg('Mencatat version 1…');
      const version = await sb.from('evidence_versions').insert({
        evidence_id: evidenceId,
        version_no: 1,
        storage_path: storagePath,
        original_filename: file.name,
        size_bytes: file.size,
        mime_type: file.type || 'application/octet-stream',
        uploaded_by: state.user.id,
        scan_status: 'NOT_SCANNED'
      }).select('id').single();
      if (version.error) throw version.error;

      const updated = await sb.from('evidence').update({
        current_version_id: version.data.id,
        status: 'UPLOADED',
        updated_by: state.user.id
      }).eq('id', evidenceId);

      if (updated.error) throw updated.error;

      await loadPrivate();
      setMsg('Evidence berhasil disimpan sebagai version 1.', 'success-box');
      render();
    } catch (error) {
      setMsg('Gagal: ' + (error?.message || String(error)), 'error-box');
      if (storagePath) await sb.storage.from('accreditation-evidence').remove([storagePath]).catch(() => {});
      if (evidenceId) await sb.from('evidence').delete().eq('id', evidenceId).catch(() => {});
    }
  }

  async function init() {
    state.loading = true;
    boot();
    try {
      requireSdk();
      sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      await loadMaster();

      const session = await sb.auth.getSession();
      if (session.error) throw session.error;
      if (session.data.session) {
        state.session = session.data.session;
        state.user = session.data.session.user;
        await loadPrivate();
      }

      sb.auth.onAuthStateChange((_event, sessionState) => {
        setTimeout(async () => {
          state.session = sessionState;
          state.user = sessionState?.user || null;
          if (sessionState) await loadPrivate();
          else {
            data.summary = null;
            data.readiness = [];
            data.evidence = [];
          }
          render();
        }, 0);
      });

      state.loading = false;
      render();
    } catch (error) {
      state.loading = false;
      fatal(error);
    }
  }

  init();
})();