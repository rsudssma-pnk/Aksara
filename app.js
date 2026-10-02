import {createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL="https://nbewlpbbvtwtuvamadle.supabase.co";
const SUPABASE_KEY="sb_publishable_mJDHfSdm6iabInDO1ItNdw_GPhLNuI0";
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY);

const state={page:"dashboard",q:"",pokja:"ALL",strength:"ALL",session:null,user:null,mode:"live"};
const data={pokja:[],eps:[],relations:[],matrix:null,readiness:[],summary:null,evidence:[]};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

async function loadMaster(){
  const [p,e,r,m]=await Promise.all([
    supabase.from("pokja").select("id,code,name,group_name,sort_order").eq("active",true).order("sort_order"),
    supabase.from("v_ep_master").select("id,code,title,description,source_page,source_version,pokja_code,pokja_name,group_name,standard_code,standard_title").order("code"),
    supabase.from("v_integration_explorer").select("source_ep,target_ep,strength,mandatory_status,relation_type,relation_type_name,rationale,evidence_text,source_page,target_page").eq("status","PUBLISHED").limit(5000),
    supabase.from("matrix_versions").select("version_no,status,effective_from,published_at").eq("status","PUBLISHED").order("published_at",{ascending:false}).limit(1)
  ]);
  for(const x of [p,e,r,m])if(x.error)throw x.error;
  data.pokja=p.data||[]; data.eps=e.data||[]; data.relations=r.data||[]; data.matrix=m.data?.[0]||null;
}
async function loadPrivate(){
  if(!state.session)return;
  const [s,rr,ev]=await Promise.all([
    supabase.from("v_dashboard_summary").select("*").maybeSingle(),
    supabase.from("v_ep_readiness").select("ep_id,code,pokja_id,required_evidence_total,required_evidence_complete,required_integration_total,required_integration_complete,configured,blockers,readiness_status"),
    supabase.from("evidence").select("id,primary_ep_id,title,document_number,document_date,revision_number,effective_from,effective_to,owner_unit,owner_name,status,current_version_id,created_at,updated_at").order("updated_at",{ascending:false}).limit(100)
  ]);
  if(s.error)throw s.error;if(rr.error)throw rr.error;if(ev.error)throw ev.error;
  data.summary=s.data||null;data.readiness=rr.data||[];data.evidence=ev.data||[];
}
function nav(){
  return [["dashboard","Dashboard"],["eps","EP Explorer"],["matrix","Integration Matrix"],["pokja","Pokja"],["evidence","Evidence Center"],["readiness","Readiness"]].map(([id,t])=>'<button class="navbtn '+(state.page===id?"active":"")+'" data-page="'+id+'">'+t+"</button>").join("");
}
function shell(c){
  return '<div class="shell"><aside class="side"><div class="brand">AKSARA<span>ACCREDITATION EVIDENCE &amp; INTEGRATION CENTER</span></div><div class="nav">'+nav()+'</div><div class="side-bottom"><div>RSUD Sultan Syarif Mohamad Alkadrie</div><div class="side-meta">KMK 1596/2024 • Evidence • Integration • Readiness</div><button id="auth" class="auth">'+(state.session?"Keluar":"Masuk / Supabase")+"</button></div></aside><main class="main">"+c+"</main></div>";
}
function header(t,s,b=""){
  return '<div class="top"><div><div class="eyebrow">Sistem Informasi Manajemen Akreditasi</div><h1>'+esc(t)+'</h1><div class="subtitle">'+esc(s)+"</div></div><div class="top-right">"+b+'<span class="badge '+(state.session?"live":"")+'">'+(state.session?"LIVE / AUTHENTICATED":"LIVE / PUBLIC MASTER")+"</span></div></div>";
}
function card(label,value,hint){return '<div class="card"><div class="metric-label">'+esc(label)+'</div><div class="metric">'+esc(value)+'</div><div class="hint">'+esc(hint||"")+"</div></div>";}
function dashboard(){
  const A=data.relations.filter(x=>x.strength==="A").length,B=data.relations.filter(x=>x.strength==="B").length,C=data.relations.filter(x=>x.strength==="C").length;
  const rs=data.summary||{};
  const configured=data.readiness.filter(x=>x.configured).length;
  return header("AKSARA","Sistem manajemen evidence dan integrasi akreditasi rumah sakit — sumber data master live dari Supabase.",'<span class="badge draft">Matrix '+esc(data.matrix?.version_no||"—")+" • PUBLISHED</span>")+
  '<div class="cards">'+card("Pokja",16,"Master kelompok standar")+card("Elemen Penilaian",221,"Master EP live")+card("Relasi lintas-Pokja",2074,"Integration Matrix live")+card("A / B / C",A+" / "+B+" / "+C,"Kekuatan relasi")+"</div>"+
  '<div class="cards" style="margin-top:14px">'+card("EP Ready",rs.ep_ready??0,"Per requirement & integration")+card("EP Partial",rs.ep_partial??0,"Perlu penyelesaian")+card("EP Blocked",rs.ep_blocked??0,"Blocker perlu ditindaklanjuti")+card("EP Configured",configured,"Sudah memiliki rule readiness")+"</div>"+
  '<div class="grid"><section class="section"><div class="section-head"><h2>Coverage per Pokja</h2><span class="muted">EP</span></div><div class="list">'+data.pokja.map(p=>'<div class="item"><div class="row"><b>'+esc(p.code)+'</b><span class="muted">'+data.eps.filter(e=>e.pokja_code===p.code).length+" EP</span></div><div class="bar"><span style="width:"+Math.round(data.eps.filter(e=>e.pokja_code===p.code).length/21*100)+"%"></span></div><div class="small">"+esc(p.name)+"</div></div>").join("")+"</div></section><section class="section"><div class="section-head"><h2>Smart Control</h2><span class="ok">●</span></div>"+
  '<div class="callout"><b>Live source of truth</b><span>Master EP dan Integration Matrix dibaca langsung dari Supabase.</span></div><div class="callout"><b>Evidence reusable</b><span>Satu aset dapat ditautkan ke banyak EP dan requirement.</span></div><div class="callout"><b>Explainable readiness</b><span>Status bukan skor survei; blocker dapat ditelusuri sampai sumbernya.</span></div><div class="callout"><b>Security boundary</b><span>Master publik read-only; evidence tetap private dan membutuhkan autentikasi + scope.</span></div></section></div>";
}
function epsPage(){
  const q=state.q.toLowerCase(),f=data.eps.filter(e=>(state.pokja==="ALL"||e.pokja_code===state.pokja)&&(!q||(e.code+" "+e.description+" "+e.standard_code).toLowerCase().includes(q)));
  return header("EP Explorer","221 Elemen Penilaian sebagai anchor Aksara.",'<span class="badge">'+f.length+" cocok</span>")+
  '<section class="section"><div class="toolbar"><input id="q" class="input" value="'+esc(state.q)+'" placeholder="Cari kode, standar, atau uraian EP…"><select id="pokja" class="select"><option value="ALL">Semua Pokja</option>'+data.pokja.map(p=>'<option value="'+esc(p.code)+'" '+(state.pokja===p.code?"selected":"")+'>'+esc(p.code)+" — "+esc(p.name)+"</option>").join("")+"</select></div><div class="table-wrap"><table class="table"><thead><tr><th>EP</th><th>Pokja</th><th>Standar</th><th>Uraian</th><th>Sumber</th></tr></thead><tbody>"+f.slice(0,1000).map(e=>'<tr><td><b>'+esc(e.code)+"</b></td><td><span class="pill">"+esc(e.pokja_code)+"</span></td><td>"+esc(e.standard_code)+"</td><td>"+esc(e.description)+"</td><td>KMK 1596/2024 • hlm. "+esc(e.source_page)+"</td></tr>").join("")+"</tbody></table></div></section>";
}
function matrixPage(){
  const q=state.q.toLowerCase(),f=data.relations.filter(r=>(state.strength==="ALL"||r.strength===state.strength)&&(!q||(r.source_ep+" "+r.target_ep+" "+(r.relation_type_name||"")+" "+(r.evidence_text||"")).toLowerCase().includes(q)));
  return header("Integration Matrix","2.074 relasi lintas-Pokja pada matrix 1.0.0. Status relation dimodelkan terpisah dari execution.",'<span class="badge draft">1.0.0 • PUBLISHED</span>')+
  '<section class="section"><div class="toolbar"><input id="q" class="input" value="'+esc(state.q)+'" placeholder="Cari source EP, target EP, relation, evidence…"><select id="strength" class="select"><option value="ALL">Semua kekuatan</option><option value="A" '+(state.strength==="A"?"selected":"")+">A — eksplisit</option><option value="B" "+(state.strength==="B"?"selected":"")+">B — operasional kuat</option><option value="C" "+(state.strength==="C"?"selected":"")+">C — fungsional</option></select></div><div class="table-wrap"><table class="table"><thead><tr><th>Source</th><th>Target</th><th>Strength</th><th>Mandatory</th><th>Jenis hubungan</th><th>Evidence</th></tr></thead><tbody>"+f.slice(0,1000).map(r=>'<tr><td><b>'+esc(r.source_ep)+"</b></td><td><b>"+esc(r.target_ep)+"</b></td><td><span class="pill "+String(r.strength).toLowerCase()+"">"+esc(r.strength)+"</span></td><td>"+esc(r.mandatory_status)+"</td><td>"+esc(r.relation_type_name||r.relation_type||"—")+"</td><td>"+esc(r.evidence_text||"—")+"</td></tr>").join("")+"</tbody></table></div><div class="footer">Menampilkan "+f.length+" dari 2.074 relasi.</div></section>";
}
function pokjaPage(){
  return header("16 Pokja","Kelompok standar menjadi scope navigasi dan authorization.",'<span class="badge">16</span>')+
  '<div class="cards">'+data.pokja.map(p=>'<div class="card"><div class="eyebrow">'+esc(p.group_name)+"</div><div class="pokja-code">"+esc(p.code)+"</div><div class="muted">"+esc(p.name)+"</div><div class="pokja-foot"><b>"+data.eps.filter(e=>e.pokja_code===p.code).length+"</b> EP</div></div>").join("")+"</div>";
}
function evidencePage(){
  if(!state.session)return header("Evidence Center","Evidence bersifat private dan membutuhkan autentikasi + scope.")+'<section class="section empty"><h2>Login diperlukan</h2><p class="muted">Master akreditasi tetap dapat ditinjau tanpa login. Upload, versioning, verification, dan private Storage memerlukan sesi pengguna yang memiliki scope Pokja.</p><button id="auth2" class="auth" style="max-width:240px">Masuk ke Evidence Center</button></section>';
  const epOptions=data.eps.slice(0,221).map(e=>'<option value="'+esc(e.id)+'">'+esc(e.code)+" — "+esc((e.description||"").slice(0,100))+"</option>").join("");
  return header("Evidence Center","Kelola evidence reusable, versioned, dan private.",'<span class="badge live">'+data.evidence.length+" item terakhir</span>")+
  '<div class="grid"><section class="section"><div class="section-head"><h2>Upload evidence</h2><span class="muted">Private Storage</span></div><div class="form"><label>EP anchor<select id="evidenceEp" class="select">'+epOptions+"</select></label><label>Judul evidence<input id="evidenceTitle" class="input" placeholder="Contoh: SK Direktur..."/></label><label>File<input id="evidenceFile" class="input" type="file"/></label><button id="uploadEvidence" class="auth" style="max-width:220px">Upload &amp; version 1</button><div id="uploadMsg" class="muted"></div></div></section><section class="section"><div class="section-head"><h2>Lifecycle</h2><span class="pill">RLS</span></div><div class="callout"><b>Reusable</b><span>Evidence dapat dilink ke banyak EP.</span></div><div class="callout"><b>Versioned</b><span>Versi lama tidak ditimpa.</span></div><div class="callout"><b>Auditable</b><span>Perubahan dicatat pada audit trail.</span></div></section></div>'+
  '<section class="section" style="margin-top:16px"><div class="section-head"><h2>Evidence terbaru</h2><span class="muted">'+data.evidence.length+" item</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Judul</th><th>Status</th><th>Owner</th><th>Periode berlaku</th><th>Updated</th></tr></thead><tbody>"+data.evidence.map(e=>'<tr><td><b>'+esc(e.title)+"</b></td><td>"+esc(e.status)+"</td><td>"+esc(e.owner_unit||e.owner_name||"—")+"</td><td>"+esc(e.effective_from||"—")+" → "+esc(e.effective_to||"—")+"</td><td>"+esc(new Date(e.updated_at).toLocaleString("id-ID"))+"</td></tr>").join("")+"</tbody></table></div></section>";
}
function readinessPage(){
  const counts={READY:0,PARTIAL:0,BLOCKED:0,NOT_CONFIGURED:0};data.readiness.forEach(x=>counts[x.readiness_status]=(counts[x.readiness_status]||0)+1);
  const blockers=data.readiness.filter(x=>x.readiness_status==="BLOCKED").slice(0,30);
  if(!state.session)return header("Readiness & Blockers","Engine internal yang dapat dijelaskan; autentikasi dibutuhkan untuk hasil per-Pokja.")+'<section class="section empty"><h2>Readiness private</h2><p class="muted">Dashboard public menampilkan master akreditasi. Hasil readiness bergantung pada evidence/verification internal dan karena itu tetap terproteksi.</p></section>';
  return header("Readiness & Blockers","Hasil kalkulasi internal dari requirement published dan matrix published.",'<span class="badge draft">INTERNAL ONLY</span>')+
  '<div class="cards">'+card("Ready",counts.READY, "EP")+card("Partial",counts.PARTIAL,"EP")+card("Blocked",counts.BLOCKED,"EP")+card("Not Configured",counts.NOT_CONFIGURED,"EP")+"</div>"+
  '<section class="section" style="margin-top:16px"><div class="notice">Readiness Aksara bukan penilaian resmi lembaga akreditasi. Status menjelaskan keadaan sistem saat ini dan menunjuk blocker yang dapat ditindaklanjuti.</div></section>'+
  '<section class="section" style="margin-top:16px"><div class="section-head"><h2>Top blockers</h2><span class="muted">'+blockers.length+" ditampilkan</span></div><div class="table-wrap"><table class="table"><thead><tr><th>EP</th><th>Status</th><th>Evidence</th><th>Integration</th><th>Blocker detail</th></tr></thead><tbody>"+blockers.map(x=>'<tr><td><b>'+esc(x.code)+"</b></td><td><span class="pill c">BLOCKED</span></td><td>"+esc(x.required_evidence_complete)+"/"+esc(x.required_evidence_total)+"</td><td>"+esc(x.required_integration_complete)+"/"+esc(x.required_integration_total)+"</td><td><pre style="white-space:pre-wrap;margin:0;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas">"+esc(JSON.stringify(x.blockers,null,2))+"</pre></td></tr>").join("")+"</tbody></table></div></section>";
}
function render(){
  let c=state.page==="dashboard"?dashboard():state.page==="eps"?epsPage():state.page==="matrix"?matrixPage():state.page==="pokja"?pokjaPage():state.page==="evidence"?evidencePage():readinessPage();
  $("#app").innerHTML=shell(c);
  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>{state.page=b.dataset.page;state.q="";render()});
  const q=$("#q");if(q)q.oninput=()=>{state.q=q.value;render();const nq=$("#q");if(nq){nq.focus();nq.setSelectionRange(state.q.length,state.q.length)}};
  const p=$("#pokja");if(p)p.onchange=()=>{state.pokja=p.value;render()};
  const s=$("#strength");if(s)s.onchange=()=>{state.strength=s.value;render()};
  const a=$("#auth");if(a)a.onclick=auth;
  const a2=$("#auth2");if(a2)a2.onclick=auth;
  const up=$("#uploadEvidence");if(up)up.onclick=uploadEvidence;
}
async function auth(){
  if(state.session){await supabase.auth.signOut();state.session=null;state.user=null;data.readiness=[];data.summary=null;data.evidence=[];render();return;}
  const email=prompt("Email Supabase");if(!email)return;const password=prompt("Password Supabase");if(!password)return;
  const r=await supabase.auth.signInWithPassword({email,password});if(r.error){alert("Login gagal: "+r.error.message);return;}
  state.session=r.data.session;state.user=r.data.user;try{await loadPrivate()}catch(e){alert("Login berhasil, tetapi data private belum dapat dimuat: "+e.message)}render();
}
async function uploadEvidence(){
  const msg=$("#uploadMsg"),ep=$("#evidenceEp")?.value,title=$("#evidenceTitle")?.value.trim(),file=$("#evidenceFile")?.files?.[0];
  if(!ep||!title||!file){if(msg)msg.textContent="Lengkapi EP, judul, dan file.";return;}
  if(file.size>100*1024*1024){if(msg)msg.textContent="File melebihi batas 100 MB.";return;}
  try{
    if(msg)msg.textContent="Membuat evidence…";
    const ins=await supabase.from("evidence").insert({primary_ep_id:ep,title,mime_type:file.type||"application/octet-stream",category:file.type,status:"DRAFT",created_by:state.user.id,updated_by:state.user.id}).select("id").single();
    if(ins.error)throw ins.error;
    const evidenceId=ins.data.id;const path="evidence/"+ep+"/"+evidenceId+"/"+Date.now()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const up=await supabase.storage.from("accreditation-evidence").upload(path,file,{upsert:false,contentType:file.type||"application/octet-stream"});
    if(up.error)throw up.error;
    const v=await supabase.from("evidence_versions").insert({evidence_id:evidenceId,version_no:1,storage_path:path,original_filename:file.name,size_bytes:file.size,mime_type:file.type,uploaded_by:state.user.id,scan_status:"NOT_SCANNED"}).select("id").single();
    if(v.error)throw v.error;
    const u=await supabase.from("evidence").update({current_version_id:v.data.id,status:"UPLOADED",updated_by:state.user.id}).eq("id",evidenceId);
    if(u.error)throw u.error;
    if(msg)msg.textContent="Berhasil. Evidence tersimpan sebagai version 1.";
    await loadPrivate();render();
  }catch(e){if(msg)msg.textContent="Gagal: "+e.message;}
}
(async()=>{
  $("#app").innerHTML='<div class="boot">Memuat AKSARA live…</div>';
  try{
    await loadMaster();
    const s=await supabase.auth.getSession();
    if(s.data.session){state.session=s.data.session;state.user=s.data.session.user;try{await loadPrivate()}catch{}}
    supabase.auth.onAuthStateChange(async(_event,session)=>{state.session=session;state.user=session?.user||null;if(session)try{await loadPrivate()}catch{}render()});
    render();
  }catch(e){$("#app").innerHTML='<main class="fatal"><h1>AKSARA</h1><p>'+esc(e.message)+'</p></main>'}
})();
