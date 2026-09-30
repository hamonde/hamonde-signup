// ============================================================
// 設定區：設定好 Supabase 後，DEMO_MODE 改成 false 並填入下面兩個值
// ============================================================
const CONFIG = {
  DEMO_MODE: false,
  SUPABASE_URL: 'https://hbduagmuevfzlypckouq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_cLhra1M543iJgTPTzTTwhg_ZfqANPvS',
  CAFE_NAME: 'HAMONDE CAFE 愛蒙娣咖啡',   // 後台與預設頁面用
};

// ============================================================
// 品牌：配色、LOGO、字體。要加第三個品牌就在這裡多一筆
// ============================================================
const BRANDS = {
  hamonde: {
    name:'HAMONDE CAFE 愛蒙娣咖啡',
    logo:'assets/hamonde-logo.png', logoH:86, hero:true, logoHasName:true, page:'',
    font:'"Fraunces"',
    theme:{ ink:'#2A211A', paper:'#F4ECDE', card:'#FFFDF9', line:'#E4D8C4',
            muted:'#8B7B67', accent:'#A8342A', 'accent-ink':'#7C241C',
            go:'#3F7D53', stop:'#9C3328', brand2:'#1D3557' },
  },
  qiankun: {
    name:'乾坤堂　QIAN KUN TANG',
    logo:'assets/qiankun-logo.png', logoH:112, hero:true, logoHasName:true, page:'q.html',
    font:'"Noto Serif TC"',
    theme:{ ink:'#1A1A1A', paper:'#F3F1EA', card:'#FFFFFF', line:'#DCD8CC',
            muted:'#7A7568', accent:'#26426B', 'accent-ink':'#172E4D',
            go:'#4A6B52', stop:'#9C3328', brand2:'#B08D57' },
  },
};
// 這一頁屬於哪個品牌（由 index.html / q.html 各自宣告）
const DEFAULT_BRAND=(typeof PAGE_BRAND!=='undefined' && BRANDS[PAGE_BRAND]) ? PAGE_BRAND : 'hamonde';

function brandOf(key){ return BRANDS[key] || BRANDS[DEFAULT_BRAND]; }

// 套用品牌：替換 CSS 變數即可，版型完全不用動
function applyBrand(key){
  const b=brandOf(key), root=document.documentElement;
  Object.entries(b.theme).forEach(([k,v])=> root.style.setProperty('--'+k, v));
  root.style.setProperty('--font-head', b.font);
  document.title=b.name.split('　')[0]+' 活動報名';
  return b;
}

// 品牌標頭（hero＝直式大 LOGO，用於書法字這類高比例圖）
function brandHeader(key){
  const b=brandOf(key);
  // LOGO 本身已含品牌名時就不再重複一行文字
  const label=b.logoHasName?'':`<span class="bname">${esc(b.name)}</span>`;
  return b.hero
    ? `<div class="brand hero"><img src="${b.logo}" alt="${esc(b.name)}" style="height:${b.logoH}px">${label}</div>`
    : `<div class="brand"><img src="${b.logo}" alt="${esc(b.name)}" style="height:${b.logoH}px">
       <span>${esc(b.name)}</span></div>`;
}

const DEFAULT_SUCCESS = '已完成該次會員活動報名，請留意 LINE 訊息以確認資訊。';

// 後台帳號固定網域：登入時只需輸入 @ 前面的帳號
const ADMIN_DOMAIN = '@hamonde.com';

// ============================================================
// 後端：demo（記憶體）與 supabase（真資料庫）兩種實作，介面相同
// ============================================================
let backend;

function makeSupabaseBackend(){
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return {
    demo:false,
    async getEvent(slug){ const {data}=await sb.rpc('get_event',{p_slug:slug}); return data; },
    async verifyMember(ident){ const {data}=await sb.rpc('verify_member',{p_ident:ident}); return data||{ok:false}; },
    async register(slug,ident,name,phone,slotId,party,parts){ const {data,error}=await sb.rpc('register_for_event',
      {p_slug:slug,p_ident:ident,p_name:name,p_phone:phone,
       p_slot_id:slotId||null,p_party:party||1,
       p_participants:(parts&&parts.length)?parts:null}); if(error) throw error; return data; },
    async signIn(email,pw){ const {error}=await sb.auth.signInWithPassword({email,password:pw}); if(error) throw error; },
    async signOut(){ await sb.auth.signOut(); },
    async session(){ const {data}=await sb.auth.getSession(); return data.session; },
    async listEvents(){ const {data}=await sb.from('events').select('*').order('created_at',{ascending:false});
      const out=[]; for(const e of (data||[])){
        const {data:rs}=await sb.from('registrations').select('party_size,slot_id').eq('event_id',e.id);
        const regs=rs||[]; const people=regs.reduce((a,r)=>a+(r.party_size||1),0);
        let slots=[];
        if(e.has_slots){
          const {data:sl}=await sb.from('event_slots').select('*').eq('event_id',e.id)
            .order('sort').order('starts_at');
          slots=(sl||[]).map(x=>({...x,
            taken:regs.filter(r=>r.slot_id===x.id).reduce((a,r)=>a+(r.party_size||1),0)}));
        }
        out.push({...e, registered:people, groups:regs.length, slots}); } return out; },
    async createEvent(ev,slots){ const {data,error}=await sb.from('events').insert(ev).select().single();
      if(error) throw error;
      if(slots&&slots.length){
        const rows=slots.map((x,i)=>({event_id:data.id,starts_at:x.starts_at,quota:x.quota,sort:i}));
        const {error:e2}=await sb.from('event_slots').insert(rows);
        if(e2){ await sb.from('events').delete().eq('id',data.id); throw e2; }
      }
      return data; },
    async setOpen(id,open){ await sb.from('events').update({is_open:open}).eq('id',id); },
    async updateEvent(id,patch){ const {data,error}=await sb.from('events').update(patch).eq('id',id).select();
      if(error) throw error;
      if(!data||!data.length) throw new Error('沒有更新到任何資料，請確認登入狀態。'); return data[0]; },
    async updateSlot(id,patch){ const {error}=await sb.from('event_slots').update(patch).eq('id',id);
      if(error) throw error; },
    async addSlots(eventId,rows){ if(!rows.length) return;
      const {error}=await sb.from('event_slots').insert(rows.map(x=>({event_id:eventId,...x})));
      if(error) throw error; },
    async deleteSlot(id){ const {error}=await sb.from('event_slots').delete().eq('id',id);
      if(error) throw error; },
    async deleteEvent(id){ const {data,error}=await sb.from('events').delete().eq('id',id).select();
      if(error) throw error;
      if(!data||!data.length) throw new Error('沒有刪除任何資料，請確認登入狀態與權限。'); },
    async listRegs(eventId){ const {data}=await sb.from('registrations')
      .select('*, participants(*)').eq('event_id',eventId).order('created_at');
      return (data||[]).map(r=>({...r,
        participants:(r.participants||[]).sort((a,b)=>a.sort-b.sort)})); },
    async listSlots(eventId){ const {data}=await sb.from('event_slots').select('*')
      .eq('event_id',eventId).order('sort').order('starts_at'); return data||[]; },
    async listMembers(){ const {data}=await sb.from('members').select('*').order('created_at',{ascending:false}); return data||[]; },
    async addMember(mem){ const {data,error}=await sb.from('members').insert(mem).select().single(); if(error) throw error; return data; },
    async setMemberActive(id,active){ await sb.from('members').update({active}).eq('id',id); },
    async deleteMember(id){ await sb.from('members').delete().eq('id',id); },
  };
}

function makeDemoBackend(){
  const digits=s=>String(s||'').replace(/[^0-9]/g,'');
  const members=[
    {id:'m1', code:null, phone:'0912-000-111', name:'王小明', active:true},
    {id:'m2', code:null, phone:'0922-000-222', name:'林美美', active:true},
    {id:'m3', code:null, phone:'0955-000-555', name:'陳美麗', active:true},
    {id:'m4', code:null, phone:'0933-000-333', name:'王大同', active:false},
  ];
  const events=[
    {id:'d1',slug:'coffee01',title:'手沖咖啡體驗課',description:'跟著店長從選豆到手沖，帶走一包專屬配方豆。\n適合完全新手，現場備有點心。',
      event_date:new Date(Date.now()+7*864e5).toISOString(), quota:8, is_open:true, members_only:true, success_message:DEFAULT_SUCCESS, created_at:new Date().toISOString()},
    {id:'d2',slug:'latte99',title:'拉花小聚（已結束）',description:'上一場的拉花練習聚會。',
      event_date:new Date(Date.now()-3*864e5).toISOString(), quota:6, is_open:false, members_only:true, success_message:DEFAULT_SUCCESS, created_at:new Date(Date.now()-10*864e5).toISOString()},
  ];
  const day=new Date(Date.now()+10*864e5); day.setHours(0,0,0,0);
  const at=(h,m)=>{const d=new Date(day); d.setHours(h,m,0,0); return d.toISOString();};
  const lecDay=new Date(Date.now()+14*864e5); lecDay.setHours(19,30,0,0);
  events.push({id:'d4',slug:'lecture1',title:'乾坤堂　秋季講堂',
    description:'本期主題：安身立命與日常修持。\n地點：乾坤堂二樓講堂。',
    event_date:lecDay.toISOString(), quota:40, is_open:true, members_only:false,
    brand:'qiankun', has_slots:false, allow_party:false, max_party:1,
    collect_contact:false, participant_fields:['name','gender'],
    success_message:'已完成報名，講堂席位已為您保留，感謝您的參與。',
    created_at:new Date().toISOString()});
  events.push({id:'d5',slug:'ritual9',title:'乾坤堂　祈福法會',
    description:'需填寫完整參與者資料以製作疏文。',
    event_date:new Date(Date.now()+21*864e5).toISOString(), quota:60, is_open:true, members_only:false,
    brand:'qiankun', has_slots:false, allow_party:false, max_party:1,
    collect_contact:false, participant_fields:['name','gender','birth_year','address'],
    success_message:'已完成報名，感謝您的參與。', created_at:new Date().toISOString()});
  events.push({id:'d3',slug:'tasting7',title:'週末杯測體驗（分時段）',
    description:'每場約 40 分鐘，可攜伴同行。',
    event_date:day.toISOString(), quota:12, is_open:true, members_only:true,
    has_slots:true, allow_party:true, max_party:4,
    success_message:DEFAULT_SUCCESS, created_at:new Date().toISOString()});
  const slots=[
    {id:'s1',event_id:'d3',starts_at:at(10,0),quota:4,sort:0},
    {id:'s2',event_id:'d3',starts_at:at(11,0),quota:4,sort:1},
    {id:'s3',event_id:'d3',starts_at:at(14,0),quota:4,sort:2},
  ];
  const regs=[
    {id:'r1',event_id:'d1',slot_id:null,party_size:1,name:'王小明',phone:'0912-000-111',created_at:new Date().toISOString()},
    {id:'r2',event_id:'d1',slot_id:null,party_size:1,name:'林美美',phone:'0922-000-222',created_at:new Date().toISOString()},
    {id:'r3',event_id:'d3',slot_id:'s1',party_size:3,name:'陳美麗',phone:'0955-000-555',created_at:new Date().toISOString()},
  ];
  const find=s=>events.find(e=>e.slug===s);
  const cnt=id=>regs.filter(r=>r.event_id===id).reduce((a,r)=>a+(r.party_size||1),0);
  const scnt=id=>regs.filter(r=>r.slot_id===id).reduce((a,r)=>a+(r.party_size||1),0);
  const slotsOf=id=>slots.filter(x=>x.event_id===id).sort((a,b)=>a.sort-b.sort);
  const isMember=ident=>{ const s=(ident||'').trim(), d=digits(ident);
    return members.find(m=>m.active&&((m.code&&m.code===s)||(d&&digits(m.phone)===d))); };
  return {
    demo:true,
    async getEvent(slug){ const e=find(slug); if(!e) return {not_found:true};
      const sl=e.has_slots?slotsOf(e.id).map(x=>({id:x.id,starts_at:x.starts_at,
        available:(x.quota-scnt(x.id))>0})):null;
      const end=e.event_date?new Date(new Date(e.event_date).getTime()+(e.has_slots?864e5:0)):null;
      return {title:e.title,description:e.description,event_date:e.event_date,is_open:e.is_open,
        members_only:e.members_only!==false, success_message:e.success_message||DEFAULT_SUCCESS,
        brand:e.brand||DEFAULT_BRAND, participant_fields:e.participant_fields||[],
        collect_contact:e.collect_contact!==false,
        has_slots:!!e.has_slots, allow_party:!!e.allow_party, max_party:Math.max(e.max_party||1,1),
        slots:sl,
        expired:!!(end&&new Date()>end),
        available:e.has_slots?(sl||[]).some(x=>x.available):Math.max(e.quota-cnt(e.id),0)>0}; },
    async verifyMember(ident){ return {ok:!!isMember(ident)}; },
    async register(slug,ident,name,phone,slotId,party,parts){ const e=find(slug); if(!e) return {ok:false,reason:'not_found'};
      const end=e.event_date?new Date(new Date(e.event_date).getTime()+(e.has_slots?864e5:0)):null;
      if(!e.is_open||(end&&new Date()>end)) return {ok:false,reason:'closed'};
      const wantC=(e.collect_contact!==false)||e.members_only!==false;
      if(wantC && !String(phone||'').trim()) return {ok:false,reason:'invalid'};
      const pflds=e.participant_fields||[];
      const needP=pflds.length>0;
      const useBirth=pflds.includes('birth_year');
      const nname=t=>String(t||'').replace(/\s+/g,'').toLowerCase();
      const pkey=x=>nname(x.name)+'|'+(useBirth?String(x.birth_year||''):String(x.gender||'').trim().toLowerCase());
      let pt;
      if(needP){
        if(!parts||!parts.length) return {ok:false,reason:'need_participants'};
        for(const x of parts) for(const k of pflds){
          if(k==='birth_year'){ if(!/^\d{1,3}$/.test(String(x.birth_year||''))) return {ok:false,reason:'invalid_participant'}; }
          else if(!String(x[k]||'').trim()) return {ok:false,reason:'invalid_participant'};
        }
        // (a) 同一次送出裡重複
        const seen=new Set();
        for(const x of parts){
          const k=pkey(x);
          if(seen.has(k)) return {ok:false,reason:'duplicate_participant',who:String(x.name).trim(),same_form:true};
          seen.add(k);
        }
        // (b) 這場活動已經有同一個人
        const existing=new Set();
        regs.filter(r=>r.event_id===e.id).forEach(r=>(r.participants||[]).forEach(q=>existing.add(pkey(q))));
        for(const x of parts){
          if(existing.has(pkey(x)))
            return {ok:false,reason:'duplicate_participant',who:String(x.name).trim(),same_form:false};
        }
        pt=parts.length;
      }else{
        pt=Math.max(parseInt(party,10)||1,1);
        if(!e.allow_party) pt=1;
        if(pt>Math.max(e.max_party||1,1)) return {ok:false,reason:'party_too_big'};
      }
      let storeName=name;
      if(e.members_only!==false){ const m=isMember(ident); if(!m) return {ok:false,reason:'not_member'}; storeName=m.name; }
      else if(needP) storeName=String(parts[0].name||'').trim();
      else if(!name) return {ok:false,reason:'invalid'};
      const d=digits(phone);
      if(d && regs.some(r=>r.event_id===e.id && digits(r.phone)===d)) return {ok:false,reason:'duplicate'};
      const storePhone=String(phone||'').trim()||null;
      if(e.has_slots){
        const sl=slots.find(x=>x.id===slotId && x.event_id===e.id);
        if(!sl) return {ok:false,reason:'need_slot'};
        if(scnt(sl.id)+pt>sl.quota) return {ok:false,reason:'full'};
      }else if(cnt(e.id)+pt>e.quota) return {ok:false,reason:'full'};
      regs.push({id:'r'+Date.now(),event_id:e.id,slot_id:e.has_slots?slotId:null,party_size:pt,
        name:storeName,phone:storePhone,created_at:new Date().toISOString(),
        participants:needP?parts.map((x,i)=>({...x,sort:i})):[]});
      return {ok:true}; },
    async signIn(){}, async signOut(){}, async session(){ return {demo:true}; },
    async listEvents(){ return events.slice().reverse().map(e=>({...e, registered:cnt(e.id),
      groups:regs.filter(r=>r.event_id===e.id).length,
      slots:e.has_slots?slotsOf(e.id).map(x=>({...x,taken:scnt(x.id)})):[]})); },
    async createEvent(ev,sl){ const e={id:'d'+Date.now(),slug:Math.random().toString(36).slice(2,10),
      is_open:true,created_at:new Date().toISOString(),...ev}; events.push(e);
      (sl||[]).forEach((x,i)=>slots.push({id:'s'+Date.now()+'_'+i,event_id:e.id,
        starts_at:x.starts_at,quota:x.quota,sort:i}));
      return e; },
    async setOpen(id,open){ const e=events.find(x=>x.id===id); if(e)e.is_open=open; },
    async updateEvent(id,patch){ const e=events.find(x=>x.id===id); if(!e) throw new Error('找不到活動');
      Object.assign(e,patch); return e; },
    async updateSlot(id,patch){ const x=slots.find(y=>y.id===id); if(x) Object.assign(x,patch); },
    async addSlots(eventId,rows){ rows.forEach((x,i)=>slots.push({id:'s'+Date.now()+'_'+i,
      event_id:eventId, starts_at:x.starts_at, quota:x.quota, sort:x.sort||0})); },
    async deleteSlot(id){ const i=slots.findIndex(x=>x.id===id); if(i>=0) slots.splice(i,1); },
    async deleteEvent(id){ const i=events.findIndex(x=>x.id===id); if(i>=0)events.splice(i,1);
      for(let j=regs.length-1;j>=0;j--) if(regs[j].event_id===id) regs.splice(j,1);
      for(let j=slots.length-1;j>=0;j--) if(slots[j].event_id===id) slots.splice(j,1); },
    async listRegs(eventId){ return regs.filter(r=>r.event_id===eventId); },
    async listSlots(eventId){ return slotsOf(eventId); },
    async listMembers(){ return members.slice(); },
    async addMember(mem){ const m={id:'m'+Date.now(), member_code:null, active:true, ...mem}; members.unshift(m); return m; },
    async setMemberActive(id,active){ const m=members.find(x=>String(x.id)===String(id)); if(m)m.active=active; },
    async deleteMember(id){ const i=members.findIndex(x=>String(x.id)===String(id)); if(i>=0)members.splice(i,1); },
  };
}

// ============================================================
// 小工具
// ============================================================
const app=document.getElementById('app');
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDate=d=>d?new Date(d).toLocaleString('zh-TW',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'時間未定';
const fmtDay=d=>d?new Date(d).toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric'}):'日期未定';
const fmtTime=d=>d?new Date(d).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}):'';
// 時段型活動只顯示日期，不顯示時間點
const fmtWhen=info=>info.has_slots?fmtDay(info.event_date):fmtDate(info.event_date);
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),1800); }
// 報名連結要指向該品牌自己的頁面，連結預覽（LINE／FB）才會顯示正確的標題與 LOGO
function regLink(slug, brand){
  const dir=location.pathname.replace(/[^/]*$/, '');
  return location.origin+dir+(brandOf(brand).page||'')+'?e='+slug;
}

// 可逐位收集的參與者欄位
const PFIELDS={
  name:      {label:'姓名',     ph:'參與者姓名'},
  gender:    {label:'性別',     opts:['男','女','其他']},
  birth_year:{label:'出生年次', ph:'民國年，例 75', tip:'民國年次'},
  address:   {label:'居住地址', ph:'例：台中市西區…'},
};

// 產生一位參與者的輸入列
function participantRow(fields, idx){
  const f=k=>{
    const d=PFIELDS[k];
    if(k==='gender') return `<div class="pf"><label>${d.label}</label>
      <select data-k="gender"><option value="">請選擇</option>
      ${d.opts.map(o=>`<option>${o}</option>`).join('')}</select></div>`;
    if(k==='birth_year') return `<div class="pf"><label>${d.label}</label>
      <input data-k="birth_year" inputmode="numeric" maxlength="3" placeholder="${d.ph}"></div>`;
    return `<div class="pf ${k==='address'?'wide':''}"><label>${d.label}</label>
      <input data-k="${k}" placeholder="${d.ph}"></div>`;
  };
  return `<div class="prow" data-i="${idx}">
    <div class="prowh"><span>參與者 ${idx+1}</span>
      <button type="button" class="pdel" title="移除">✕</button></div>
    <div class="pgrid">${fields.map(f).join('')}</div>
  </div>`;
}

// ============================================================
// 客人報名頁
// ============================================================
async function renderRegister(slug){
  app.innerHTML=`<div class="brand"></div><div class="card">載入中…</div>`;
  const info=await backend.getEvent(slug);
  const bkey=(info && info.brand) || DEFAULT_BRAND;
  applyBrand(bkey);
  app.innerHTML=brandHeader(bkey)+`<div class="card">載入中…</div>`;
  const card=app.querySelector('.card');

  if(!info || info.not_found){
    card.innerHTML=`<div class="state"><div class="icon">🔍</div><h2>找不到這個活動</h2>
      <p>連結可能不正確，或活動已被移除。</p></div>`; return; }

  if(!info.is_open || info.expired || !info.available){
    card.innerHTML=`<span class="pill closed">已關閉</span>
      <h1 style="margin-top:12px">${esc(info.title)}</h1>
      <div class="date">🗓 ${esc(fmtWhen(info))}</div>
      <div class="state"><div class="icon">☕</div><h2>報名已關閉</h2>
      <p>這場活動的報名已結束，感謝關注，敬請期待下次活動！</p></div>`; return; }

  const mo=info.members_only;
  const slots=info.has_slots?(info.slots||[]):[];
  const pf=(info.participant_fields||[]).filter(k=>PFIELDS[k]);
  const needP=pf.length>0;
  // 限會員一定要手機（會員身分靠手機辨識）；其餘看活動設定
  const wantContact=mo || info.collect_contact!==false;
  const maxParty=(!needP&&info.allow_party)?Math.max(info.max_party||1,1):1;
  card.innerHTML=`
    <h1>${esc(info.title)}</h1>
    <div class="date">🗓 ${esc(fmtWhen(info))}</div>
    ${info.description?`<p class="desc">${esc(info.description)}</p>`:''}
    <div class="statusbar">
      <span class="pill go">開放報名中</span>
      ${mo?'<span class="pill">限會員</span>':''}
    </div>
    ${info.has_slots?`<label>選擇時段</label>
      <div class="slotpick" id="slotpick">
        ${slots.map(x=>`<button type="button" class="slotbtn${x.available?'':' full'}"
          data-id="${x.id}"${x.available?'':' disabled'}>${esc(fmtTime(x.starts_at))}${x.available?'':'<span>額滿</span>'}</button>`).join('')}
      </div>`:''}
    ${maxParty>1?`<label for="pt">參與人數</label>
      <select id="pt">${Array.from({length:maxParty},(_,i)=>
        `<option value="${i+1}">${i+1} 位${i?'（含同行者）':''}</option>`).join('')}</select>`:''}
    ${needP?`<label>參與者資料</label>
      <div id="plist">${participantRow(pf,0)}</div>
      <button type="button" class="addp" id="addp">＋ 新增一位參與者</button>
      ${wantContact?`<label for="p" style="margin-top:18px">聯絡電話</label>
        <input id="p" placeholder="0912-345-678" inputmode="tel" autocomplete="tel">`:''}`
     :mo?`<label for="p">會員手機號碼</label>
        <input id="p" placeholder="輸入你的會員手機號碼" inputmode="tel" autocomplete="tel">
        <div class="mchk" id="mchk"></div>`
       :`<label for="n">姓名</label><input id="n" placeholder="怎麼稱呼你？" autocomplete="name">
        <label for="p">聯絡電話</label><input id="p" placeholder="0912-345-678" inputmode="tel" autocomplete="tel">`}
    <div class="err" id="err"></div>
    <button class="btn" id="go">送出報名</button>`;

  const err=card.querySelector('#err'), btn=card.querySelector('#go');

  let pickedSlot=null;
  if(info.has_slots){
    const box=card.querySelector('#slotpick');
    if(!slots.length) err.textContent='這場活動尚未開放時段，請稍後再試。';
    box.querySelectorAll('.slotbtn:not(.full)').forEach(b=> b.onclick=()=>{
      box.querySelectorAll('.slotbtn').forEach(x=>x.classList.remove('on'));
      b.classList.add('on'); pickedSlot=b.dataset.id; err.textContent='';
    });
  }

  const plist=card.querySelector('#plist');
  const renumber=()=>{
    [...plist.querySelectorAll('.prow')].forEach((r,i)=>{
      r.dataset.i=i; r.querySelector('.prowh span').textContent='參與者 '+(i+1);
      r.querySelector('.pdel').style.visibility = plist.querySelectorAll('.prow').length>1?'visible':'hidden';
    });
  };
  const wireRow=row=>{ row.querySelector('.pdel').onclick=()=>{
    if(plist.querySelectorAll('.prow').length<=1) return;
    row.remove(); renumber(); }; };
  if(needP){
    plist.querySelectorAll('.prow').forEach(wireRow); renumber();
    card.querySelector('#addp').onclick=()=>{
      const n=plist.querySelectorAll('.prow').length;
      plist.insertAdjacentHTML('beforeend', participantRow(pf,n));
      wireRow(plist.lastElementChild); renumber();
      plist.lastElementChild.querySelector('input,select')?.focus();
    };
  }

  // 讀出參與者資料
  const readParticipants=()=>[...plist.querySelectorAll('.prow')].map(r=>{
    const o={}; r.querySelectorAll('[data-k]').forEach(el=>o[el.dataset.k]=el.value.trim()); return o; });

  if(mo && card.querySelector('#mchk')){
    const p=card.querySelector('#p'), mchk=card.querySelector('#mchk');
    p.addEventListener('blur', async()=>{
      const v=p.value.trim();
      if(!v){ mchk.textContent=''; mchk.className='mchk'; return; }
      const r=await backend.verifyMember(v);
      if(r.ok){ mchk.textContent='✓ 會員資格確認'; mchk.className='mchk ok'; }
      else{ mchk.textContent='查無會員資料，此活動僅限會員報名'; mchk.className='mchk no'; }
    });
  }

  function handleResult(r){
    if(!r.ok && r.reason==='duplicate_participant'){
      err.textContent = r.same_form
        ? `「${r.who}」在這次填寫中重複出現了，請檢查參與者名單。`
        : `「${r.who}」已經報名過這場活動了，無法重複報名。`;
      btn.disabled=false; btn.textContent='再試一次';
      return;
    }
    if(r.ok){
      const sl=slots.find(x=>x.id===pickedSlot);
      const party=needP ? plist.querySelectorAll('.prow').length
                  : (card.querySelector('#pt') ? parseInt(card.querySelector('#pt').value,10) : 1);
      card.innerHTML=`<div class="state"><div class="icon">🎉</div><h2>報名成功！</h2>
        <p>${esc(info.success_message||DEFAULT_SUCCESS)}</p>
        <div class="pill" style="margin-top:14px">${esc(info.title)}</div>
        <div class="okinfo">🗓 ${esc(fmtWhen(info))}${sl?'　🕘 '+esc(fmtTime(sl.starts_at)):''}${party>1?'　👥 '+party+' 位':''}</div>
        </div>`;
    }else{
      const map={full:info.has_slots
          ?'這個時段的名額不夠了 😢 請改選其他時段，或減少參與人數。'
          :'太可惜，名額不夠了 😢 請試著減少參與人數。',
        closed:'這場活動已經關閉了。',
        not_found:'找不到活動。', invalid:'資料不完整，請再檢查。',
        need_slot:'請先選擇一個時段。',
        need_participants:'請至少填寫一位參與者的資料。',
        invalid_participant:'參與者資料不完整，請檢查每一位的必填欄位。',
        party_too_big:'超過每組可報名的人數上限。',
        not_member:'查無會員資料，此活動僅限會員報名。',
        duplicate:'這支手機已經報名過這場活動囉，一場活動只能報名一個時段。'};
      err.textContent=map[r.reason]||'報名失敗，請稍後再試。';
      btn.disabled=false; btn.textContent='再試一次';
      if(r.reason==='full') setTimeout(()=>renderRegister(slug),1200);
    }
  }

  btn.onclick=async()=>{
    err.textContent='';
    const pEl=card.querySelector('#p');
    const phone=pEl?pEl.value.trim():'';
    const ptEl=card.querySelector('#pt');
    const party=ptEl?parseInt(ptEl.value,10)||1:1;
    if(info.has_slots && !pickedSlot){ err.textContent='請先選擇一個時段。'; return; }

    let parts=null;
    if(needP){
      parts=readParticipants();
      for(let i=0;i<parts.length;i++){
        for(const k of pf){
          if(k==='birth_year'){
            const v=parts[i].birth_year;
            if(!/^\d{1,3}$/.test(v)||+v<1||+v>200){
              err.textContent=`參與者 ${i+1} 的出生年次請填民國年（例：75）。`; return; }
          }else if(!parts[i][k]){
            err.textContent=`請填寫參與者 ${i+1} 的${PFIELDS[k].label}。`; return; }
        }
      }
    }
    try{
      if(mo){
        if(!phone){ err.textContent='請輸入你的會員手機號碼。'; return; }
        btn.disabled=true; btn.textContent='確認中…';
        const v=await backend.verifyMember(phone);
        if(!v.ok){ err.textContent='查無會員資料，此活動僅限會員報名。'; btn.disabled=false; btn.textContent='再試一次'; return; }
        btn.textContent='報名中…';
        const r=await backend.register(slug, phone, '', phone, pickedSlot, party, parts);
        handleResult(r);
      }else{
        const name=needP?'':card.querySelector('#n').value.trim();
        if(wantContact&&!phone){ err.textContent=needP?'請填寫聯絡電話。':'請填寫姓名和電話。'; return; }
        if(!needP&&!name){ err.textContent='請填寫姓名。'; return; }
        btn.disabled=true; btn.textContent='報名中…';
        const r=await backend.register(slug, '', name, phone, pickedSlot, party, parts);
        handleResult(r);
      }
    }catch(e){ err.textContent='連線出問題，請稍後再試。'; btn.disabled=false; btn.textContent='再試一次'; }
  };
}

// ============================================================
// 後台
// ============================================================
async function renderAdmin(){
  const sess=await backend.session();
  if(!sess){ return renderLogin(); }
  app.innerHTML=`<div class="brand"><img src="${brandOf(DEFAULT_BRAND).logo}" alt="" style="height:26px"><span>${esc(CONFIG.CAFE_NAME)}・後台</span></div>
    ${backend.demo?'<div class="banner">🔧 示範模式：資料存在瀏覽器記憶體，重新整理會還原。設定好 Supabase 後即為正式資料。</div>':''}
    <div class="tabs2">
      <button class="t2 on" data-t="events">活動總覽</button>
      <button class="t2" data-t="new">新增活動</button>
      <button class="t2" data-t="members">會員</button>
    </div>
    <div id="panel"></div>
    ${backend.demo?'':'<button class="btn ghost" id="out" style="margin-top:16px">登出</button>'}`;
  const out=app.querySelector('#out'); if(out) out.onclick=async()=>{ await backend.signOut(); renderLogin(); };
  const tabs=app.querySelectorAll('.t2');
  tabs.forEach(b=> b.onclick=()=> switchTab(b.dataset.t));
  switchTab('events');
}

// 切換後台分頁（也供建立活動後自動跳回總覽用）
function switchTab(name){
  const tabs=app.querySelectorAll('.t2');
  tabs.forEach(x=> x.classList.toggle('on', x.dataset.t===name));
  if(name==='new') renderNewEventPanel();
  else if(name==='members') renderMembersPanel();
  else renderEventsPanel();
}

function renderEventsPanel(){
  const panel=app.querySelector('#panel');
  panel.innerHTML=`<div id="list"></div>`;
  refreshList();
}

function renderNewEventPanel(){
  const panel=app.querySelector('#panel');
  panel.innerHTML=`
    <div class="card">
      <h1 style="font-size:20px">建立新活動</h1>
      <label>活動類型（選一個範本，下面仍可個別調整）</label>
      <div class="presets" id="presets">
        ${Object.entries(PRESETS).map(([k,v])=>`<button type="button" class="pst" data-k="${k}">
          <span class="pstb" style="background:${BRANDS[v.brand].theme.accent}"></span>
          <span class="pstt">${esc(v.label)}</span><span class="pstd">${esc(v.hint)}</span></button>`).join('')}
      </div>
      <label for="br">品牌</label>
      <select id="br">${Object.entries(BRANDS).map(([k,b])=>
        `<option value="${k}">${esc(b.name)}</option>`).join('')}</select>
      <label for="t">活動名稱</label><input id="t" placeholder="例：週末手沖咖啡體驗課">
      <label class="chk"><input type="checkbox" id="hs"> 開放時段讓客人選（活動只顯示日期）</label>
      <div class="row" id="single">
        <div><label for="d">活動時間</label><input id="d" type="datetime-local"></div>
        <div><label for="q">名額</label><input id="q" type="number" min="1" value="10"></div>
      </div>
      <div id="slotmode" hidden>
        <label for="dd">活動日期</label><input id="dd" type="date">
        <div class="genbox">
          <div class="genttl">快速產生時段</div>
          <div class="row">
            <div><label for="gs">開始</label><input id="gs" type="time" value="10:00"></div>
            <div><label for="ge">結束</label><input id="ge" type="time" value="17:00"></div>
          </div>
          <div class="row">
            <div><label for="gi">每場間隔（分鐘）</label><input id="gi" type="number" min="5" step="5" value="60"></div>
            <div><label for="gq">每場名額</label><input id="gq" type="number" min="1" value="4"></div>
          </div>
          <button type="button" class="mini" id="gen">產生時段</button>
        </div>
        <label>時段清單（可個別調整或刪除）</label>
        <div id="slotlist"></div>
        <button type="button" class="addslot" id="addslot">＋ 手動加一個時段</button>
      </div>
      <label class="chk"><input type="checkbox" id="ap"> 可攜伴（客人能選參與人數）</label>
      <div id="partybox" hidden><label for="mp">每組人數上限</label>
        <input id="mp" type="number" min="2" max="20" value="4"></div>
      <label style="margin-top:16px">要逐位收集的參與者資料</label>
      <div class="pfpick" id="pfpick">
        ${Object.entries(PFIELDS).map(([k,d])=>`<label class="pfchk">
          <input type="checkbox" data-pf="${k}"${k==='name'?'':''}> ${esc(d.label)}</label>`).join('')}
      </div>
      <div class="pfnote" id="pfnote">不勾選＝只計算人數，不收集個別資料。</div>
      <label class="chk" id="ccbox"><input type="checkbox" id="cc" checked> 收集聯絡電話</label>
      <label class="chk" id="mobox"><input type="checkbox" id="mo" checked> 限會員報名（客人需通過手機驗證）</label>
      <label for="ds">活動說明</label><textarea id="ds" placeholder="時間、地點、費用、注意事項…"></textarea>
      <label for="sm">報名成功顯示文字（客人送出後看到，可每場不同）</label>
      <textarea id="sm">已完成該次會員活動報名，請留意 LINE 訊息以確認資訊。</textarea>
      <button class="btn" id="create">建立並產生報名連結</button>
      <div class="err" id="cerr"></div>
    </div>`;
  app.querySelector('#create').onclick=createEvent;
  wireEventForm(panel);
}


async function renderMembersPanel(){
  const panel=app.querySelector('#panel');
  panel.innerHTML=`
    <div class="card">
      <h1 style="font-size:20px">新增會員</h1>
      <div class="row">
        <div><label for="mn">姓名</label><input id="mn" placeholder="會員姓名"></div>
        <div><label for="mp">手機號碼</label><input id="mp" placeholder="0912-345-678" inputmode="tel"></div>
      </div>
      <button class="btn" id="addm">新增會員</button>
      <div class="err" id="merr"></div>
    </div>
    <div class="listhead"><h2>會員名單</h2></div>
    <input id="msearch" placeholder="🔍 搜尋姓名或手機">
    <div id="mlist" style="margin-top:8px">載入中…</div>`;
  const members=await backend.listMembers();
  const norm=x=>String(x||'').replace(/[^0-9]/g,'');
  const draw=(kw)=>{
    kw=(kw||'').trim(); const kd=norm(kw);
    const rows=members.filter(m=> !kw || (m.name&&m.name.includes(kw)) || (kd&&norm(m.phone).includes(kd)));
    const box=panel.querySelector('#mlist');
    if(!rows.length){ box.innerHTML='<p style="color:var(--muted)">找不到會員</p>'; return; }
    box.innerHTML=rows.map(m=>`<div class="mrow ${m.active?'':'off'}" data-id="${m.id}">
        <div><div class="mname">${esc(m.name)}${m.active?'':' <span class="pill closed" style="font-size:11px">停用</span>'}</div>
          <div class="mph">${esc(m.phone||'')}</div></div>
        <div class="mact"><button data-a="tg">${m.active?'停用':'啟用'}</button><button data-a="del">刪除</button></div>
      </div>`).join('');
    box.querySelectorAll('.mrow').forEach(row=>{
      const m=members.find(x=>String(x.id)===String(row.dataset.id));
      row.querySelector('[data-a="tg"]').onclick=async()=>{ await backend.setMemberActive(m.id,!m.active); m.active=!m.active; draw(panel.querySelector('#msearch').value); };
      row.querySelector('[data-a="del"]').onclick=async()=>{ if(!confirm('確定刪除「'+m.name+'」？'))return; await backend.deleteMember(m.id); const i=members.indexOf(m); if(i>=0)members.splice(i,1); draw(panel.querySelector('#msearch').value); };
    });
  };
  draw('');
  panel.querySelector('#msearch').oninput=e=>draw(e.target.value);
  panel.querySelector('#addm').onclick=async()=>{
    const name=panel.querySelector('#mn').value.trim();
    const phone=panel.querySelector('#mp').value.trim();
    const err=panel.querySelector('#merr'); err.textContent='';
    if(!name||!phone){ err.textContent='請填姓名和手機。'; return; }
    if(members.some(m=>norm(m.phone)===norm(phone))){ err.textContent='這支手機已經是會員了。'; return; }
    try{ const nm=await backend.addMember({name,phone}); members.unshift(nm);
      panel.querySelector('#mn').value=''; panel.querySelector('#mp').value=''; toast('已新增會員'); draw(panel.querySelector('#msearch').value); }
    catch(e){ err.textContent='新增失敗，請稍後再試。'; }
  };
}

function renderLogin(){
  app.innerHTML=`<div class="brand"><img src="${brandOf(DEFAULT_BRAND).logo}" alt="" style="height:26px"><span>${esc(CONFIG.CAFE_NAME)}・後台</span></div>
    <div class="card"><h1 style="font-size:20px">管理者登入</h1>
    <label for="em">帳號</label>
    <div class="suffixed"><input id="em" type="text" autocomplete="username"
      autocapitalize="off" autocorrect="off" spellcheck="false"><span class="sfx">${ADMIN_DOMAIN}</span></div>
    <label for="pw">密碼</label><input id="pw" type="password" autocomplete="current-password">
    <div class="err" id="lerr"></div>
    <button class="btn" id="login">登入</button></div>`;
  app.querySelector('#login').onclick=async()=>{
    const acct=app.querySelector('#em').value.trim().replace(/@+$/,'');
    const email=acct.includes('@') ? acct : acct+ADMIN_DOMAIN;
    try{ await backend.signIn(email, app.querySelector('#pw').value); renderAdmin(); }
    catch(e){ app.querySelector('#lerr').textContent='登入失敗，請確認帳號密碼。'; }
  };
}

// 四種活動範本：一鍵設定好所有開關，之後仍可個別微調
const PRESETS={
  h_self:{ label:'HAMONDE・會員本人', hint:'指定時間，限會員本人，1 人',
    brand:'hamonde', has_slots:false, allow_party:false, max_party:1,
    members_only:true, contact:true, fields:[] },
  h_party:{ label:'HAMONDE・會員報名', hint:'客人選時段，可帶同行者',
    brand:'hamonde', has_slots:true, allow_party:true, max_party:4,
    members_only:true, contact:true, fields:[] },
  q_lecture:{ label:'乾坤堂・講堂報名', hint:'指定時間，收姓名與性別',
    brand:'qiankun', has_slots:false, allow_party:false, max_party:1,
    members_only:false, contact:false, fields:['name','gender'] },
  q_other:{ label:'乾坤堂・其他活動', hint:'指定時間，收完整參與者資料',
    brand:'qiankun', has_slots:false, allow_party:false, max_party:1,
    members_only:false, contact:false, fields:['name','gender','birth_year','address'] },
};

// ============================================================
// 編輯活動
// 已經有人報名之後，會改變報名規則的結構性設定就鎖住，
// 避免既有報名資料與新規則對不起來
// ============================================================
function toLocalInput(iso, dateOnly){
  if(!iso) return '';
  const d=new Date(iso), p=n=>String(n).padStart(2,'0');
  const day=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  return dateOnly ? day : `${day}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildEditor(box, e){
  const locked=(e.registered||0)>0;      // 已有人報名
  const slots=e.slots||[];
  box.innerHTML=`
    <div class="edt">
      <div class="edth">編輯活動</div>
      ${locked?`<div class="edtlock">已經有 ${e.registered} 人報名，
        因此「時間模式、限會員、攜伴、收集欄位、聯絡方式」等會改變報名規則的設定已鎖定。
        要調整這些必須另外開一場新活動。</div>`:''}

      <label>活動名稱</label><input class="e-t" value="${esc(e.title||'')}">
      <label>活動說明</label><textarea class="e-ds">${esc(e.description||'')}</textarea>

      <div class="row">
        <div><label>${e.has_slots?'活動日期':'活動時間'}</label>
          <input class="e-d" type="${e.has_slots?'date':'datetime-local'}"
            value="${toLocalInput(e.event_date, e.has_slots)}"></div>
        ${e.has_slots?'':`<div><label>名額</label>
          <input class="e-q" type="number" min="1" value="${e.quota}"></div>`}
      </div>

      <label>品牌</label>
      <select class="e-br">${Object.entries(BRANDS).map(([k,b])=>
        `<option value="${k}"${(e.brand||DEFAULT_BRAND)===k?' selected':''}>${esc(b.name)}</option>`).join('')}</select>
      <div class="edtnote">換品牌會改變報名連結指向的頁面，記得重新複製連結分享。</div>

      <label>報名成功顯示文字</label>
      <textarea class="e-sm">${esc(e.success_message||DEFAULT_SUCCESS)}</textarea>

      ${e.has_slots?`<label style="margin-top:16px">時段</label>
        <div class="e-slots">${slots.map(x=>`
          <div class="eslot" data-id="${x.id}" data-taken="${x.taken||0}">
            <input type="time" class="es-t" value="${toLocalInput(x.starts_at).slice(11,16)}">
            <input type="number" class="es-q" min="${Math.max(x.taken||0,1)}" value="${x.quota}">
            <span class="sunit">人</span>
            <span class="es-n">${(x.taken||0)?`已報 ${x.taken}`:'尚無報名'}</span>
            <button type="button" class="sdel"${(x.taken||0)?' disabled title="已有人報名，不能刪除"':' title="刪除這個時段"'}>✕</button>
          </div>`).join('')}</div>
        <button type="button" class="addslot e-addslot">＋ 新增一個時段</button>`:''}

      <div class="err e-err"></div>
      <div class="edtbtns">
        <button type="button" class="mini2 e-save">儲存修改</button>
        <button type="button" class="mini2 ghost e-cancel">取消</button>
      </div>
    </div>`;

  const $=q=>box.querySelector(q), err=$('.e-err');

  // 時段的新增與刪除
  if(e.has_slots){
    const list=$('.e-slots');
    const wire=row=>{
      const b=row.querySelector('.sdel');
      if(b.disabled) return;
      b.onclick=()=>{ row.dataset.removed='1'; row.style.display='none'; };
    };
    list.querySelectorAll('.eslot').forEach(wire);
    $('.e-addslot').onclick=()=>{
      const row=document.createElement('div');
      row.className='eslot'; row.dataset.new='1'; row.dataset.taken='0';
      row.innerHTML=`<input type="time" class="es-t" value="10:00">
        <input type="number" class="es-q" min="1" value="4">
        <span class="sunit">人</span><span class="es-n">新增</span>
        <button type="button" class="sdel" title="移除">✕</button>`;
      wire(row); list.appendChild(row);
    };
  }

  $('.e-cancel').onclick=()=>{ box.hidden=true; box.innerHTML=''; };

  $('.e-save').onclick=async()=>{
    err.textContent='';
    const title=$('.e-t').value.trim();
    if(!title){ err.textContent='請填活動名稱。'; return; }
    const dv=$('.e-d').value;
    if(e.has_slots && !dv){ err.textContent='請選擇活動日期。'; return; }

    const patch={
      title, description:$('.e-ds').value.trim(),
      brand:$('.e-br').value,
      success_message:$('.e-sm').value.trim()||DEFAULT_SUCCESS,
      event_date: dv ? new Date(e.has_slots ? dv+'T00:00:00' : dv).toISOString() : null,
    };

    // 整理時段
    let keep=[], add=[], del=[];
    if(e.has_slots){
      const rows=[...box.querySelectorAll('.eslot')];
      for(const r of rows){
        const taken=parseInt(r.dataset.taken,10)||0;
        if(r.dataset.removed==='1'){
          if(r.dataset.new!=='1') del.push(r.dataset.id);
          continue;
        }
        const t=r.querySelector('.es-t').value, q=parseInt(r.querySelector('.es-q').value,10);
        if(!t||!q||q<1){ err.textContent='時段的時間與名額都要填。'; return; }
        if(q<taken){ err.textContent=`${t} 這個時段已經有 ${taken} 人報名，名額不能少於 ${taken}。`; return; }
        const [h,m]=t.split(':').map(Number);
        const d=new Date(dv+'T00:00:00'); d.setHours(h,m,0,0);
        (r.dataset.new==='1'?add:keep).push({id:r.dataset.id, starts_at:d.toISOString(), quota:q});
      }
      if(!keep.length && !add.length){ err.textContent='至少要保留一個時段。'; return; }
      patch.quota=[...keep,...add].reduce((a,x)=>a+x.quota,0);
    }else{
      const q=parseInt($('.e-q').value,10);
      if(!q||q<1){ err.textContent='請填正確的名額。'; return; }
      if(q<(e.registered||0)){
        err.textContent=`已經有 ${e.registered} 人報名，名額不能少於 ${e.registered}。`; return; }
      patch.quota=q;
    }

    const btn=$('.e-save'); btn.disabled=true; btn.textContent='儲存中…';
    try{
      await backend.updateEvent(e.id, patch);
      for(const x of keep) await backend.updateSlot(x.id, {starts_at:x.starts_at, quota:x.quota});
      for(const id of del) await backend.deleteSlot(id);
      if(add.length) await backend.addSlots(e.id, add.map((x,i)=>({
        starts_at:x.starts_at, quota:x.quota, sort:keep.length+i})));
      toast('活動已更新');
      await refreshList();
    }catch(ex){
      err.textContent='儲存失敗：'+(ex.message||'請稍後再試。');
      btn.disabled=false; btn.textContent='儲存修改';
    }
  };
}

// ============================================================
// 匯出報名名單（CSV）
// 管理者已登入，直接在瀏覽器產生檔案，不需要任何額外金鑰
// ============================================================
function csvCell(v){
  const t=String(v==null?'':v);
  return /[",\n\r]/.test(t) ? '"'+t.replace(/"/g,'""')+'"' : t;
}
function downloadCSV(filename, rows){
  const body=rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
  // 加 BOM，Excel 打開中文才不會變亂碼
  const blob=new Blob(['\uFEFF'+body], {type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function exportRegs(e, regs, slots){
  const pf=e.participant_fields||[];
  const slotTime=id=>{ const x=(slots||[]).find(y=>y.id===id); return x?fmtTime(x.starts_at):''; };
  const head=['報名序號','報名時間'];
  if(e.has_slots) head.push('時段');
  head.push('報名人姓名');
  if(e.collect_contact!==false) head.push('聯絡電話');
  head.push('人數');
  if(pf.length){
    head.push('第幾位');
    pf.forEach(k=> head.push(PFIELDS[k]?PFIELDS[k].label:k));
  }
  const rows=[head];
  regs.forEach((r,i)=>{
    const base=[i+1, fmtDate(r.created_at)];
    if(e.has_slots) base.push(slotTime(r.slot_id));
    base.push(r.name||'');
    if(e.collect_contact!==false) base.push(r.phone||'');
    base.push(r.party_size||1);
    const ps=r.participants||[];
    if(pf.length && ps.length){
      ps.forEach((x,j)=>{
        const row=base.slice(); row.push(j+1);
        pf.forEach(k=> row.push(k==='birth_year'
          ? (x.birth_year!=null?'民國 '+x.birth_year+' 年次':'')
          : (x[k]||'')));
        rows.push(row);
      });
    }else{
      rows.push(pf.length ? base.concat(['']).concat(pf.map(()=>'')) : base);
    }
  });
  // 統計列
  const people=regs.reduce((a,r)=>a+(r.party_size||1),0);
  rows.push([]);
  rows.push(['合計', regs.length+' 組', people+' 人']);
  const safe=String(e.title||'活動').replace(/[\\/:*?"<>|]/g,'_').slice(0,40);
  const d=new Date(), pad=n=>String(n).padStart(2,'0');
  downloadCSV(`${safe}_報名名單_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.csv`, rows);
  toast(`已匯出 ${regs.length} 組／${people} 人`);
}

// 建立活動表單：時段／攜伴的顯示切換與時段編輯器
function wireEventForm(panel){
  const hs=panel.querySelector('#hs'), ap=panel.querySelector('#ap');
  const single=panel.querySelector('#single'), slotmode=panel.querySelector('#slotmode');
  const partybox=panel.querySelector('#partybox'), list=panel.querySelector('#slotlist');

  const br=panel.querySelector('#br'), mobox=panel.querySelector('#mobox');
  const mo=panel.querySelector('#mo'), pfnote=panel.querySelector('#pfnote');
  const pfBoxes=[...panel.querySelectorAll('[data-pf]')];

  // 乾坤堂沒有會員名單，也不沿用 HAMONDE 的：直接不給這個選項
  const cc=panel.querySelector('#cc'), ccbox=panel.querySelector('#ccbox');
  const syncBrand=()=>{
    const isH=br.value==='hamonde';
    mobox.style.display=isH?'':'none';
    if(!isH) mo.checked=false;
    syncContact();
  };
  // 限會員是靠手機辨識身分的，所以一定要收
  const syncContact=()=>{
    if(mo.checked){ cc.checked=true; cc.disabled=true;
      ccbox.title='限會員活動需以手機辨識會員身分，必須收集'; }
    else { cc.disabled=false; ccbox.title=''; }
  };
  mo.addEventListener('change', syncContact);
  // 收逐位資料時，人數由參與者筆數決定，攜伴選項無意義
  const syncFields=()=>{
    const any=pfBoxes.some(b=>b.checked);
    const nameBox=pfBoxes.find(b=>b.dataset.pf==='name');
    if(any && !nameBox.checked) nameBox.checked=true;   // 姓名必收
    panel.querySelector('.chk input#ap').closest('.chk').style.display=any?'none':'';
    if(any){ ap.checked=false; partybox.hidden=true; }
    pfnote.textContent=any
      ? '客人可一次填寫多位參與者，報名人數＝實際填寫的筆數。'
      : '不勾選＝只計算人數，不收集個別資料。';
  };
  br.onchange=syncBrand;
  pfBoxes.forEach(b=> b.onchange=syncFields);

  hs.onchange=()=>{ single.hidden=hs.checked; slotmode.hidden=!hs.checked; };
  ap.onchange=()=>{ partybox.hidden=!ap.checked; };

  // 範本
  panel.querySelectorAll('.pst').forEach(b=> b.onclick=()=>{
    const v=PRESETS[b.dataset.k];
    panel.querySelectorAll('.pst').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    br.value=v.brand;
    hs.checked=v.has_slots; single.hidden=v.has_slots; slotmode.hidden=!v.has_slots;
    ap.checked=v.allow_party; partybox.hidden=!v.allow_party;
    panel.querySelector('#mp').value=v.max_party;
    mo.checked=v.members_only;
    cc.checked=v.contact!==false;
    pfBoxes.forEach(x=> x.checked=v.fields.includes(x.dataset.pf));
    syncBrand(); syncFields(); syncContact();
    toast('已套用範本：'+v.label);
  });
  syncBrand(); syncFields();

  const drawSlots=()=>{
    const rows=[...list.querySelectorAll('.slotrow')];
    if(!rows.length) list.innerHTML='<div class="noslot">尚未設定時段</div>';
    else list.querySelector('.noslot')?.remove();
  };
  const addRow=(time,quota)=>{
    list.querySelector('.noslot')?.remove();
    const row=document.createElement('div');
    row.className='slotrow';
    row.innerHTML=`<input type="time" class="st" value="${time||'10:00'}">
      <input type="number" class="sq" min="1" value="${quota||4}">
      <span class="sunit">人</span>
      <button type="button" class="sdel" title="刪除這個時段">✕</button>`;
    row.querySelector('.sdel').onclick=()=>{ row.remove(); drawSlots(); };
    list.appendChild(row);
  };
  panel._addSlotRow=addRow;

  panel.querySelector('#addslot').onclick=()=>addRow();
  panel.querySelector('#gen').onclick=()=>{
    const [sh,sm]=panel.querySelector('#gs').value.split(':').map(Number);
    const [eh,em]=panel.querySelector('#ge').value.split(':').map(Number);
    const step=parseInt(panel.querySelector('#gi').value,10);
    const q=parseInt(panel.querySelector('#gq').value,10);
    const err=panel.querySelector('#cerr'); err.textContent='';
    if([sh,sm,eh,em].some(isNaN)||!step||step<5||!q||q<1){ err.textContent='請確認時段產生器的欄位。'; return; }
    let cur=sh*60+sm; const end=eh*60+em;
    if(cur>=end){ err.textContent='結束時間要晚於開始時間。'; return; }
    list.innerHTML='';
    let n=0;
    while(cur<end && n<60){
      addRow(String(Math.floor(cur/60)).padStart(2,'0')+':'+String(cur%60).padStart(2,'0'), q);
      cur+=step; n++;
    }
    toast('已產生 '+n+' 個時段');
  };
  drawSlots();
}

// 從表單讀出時段設定
function readSlots(panel, dayStr){
  const out=[];
  panel.querySelectorAll('.slotrow').forEach(row=>{
    const t=row.querySelector('.st').value, q=parseInt(row.querySelector('.sq').value,10);
    if(!t||!q||q<1) return;
    const [h,m]=t.split(':').map(Number);
    const d=new Date(dayStr+'T00:00:00'); d.setHours(h,m,0,0);
    out.push({starts_at:d.toISOString(), quota:q});
  });
  out.sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  return out;
}

async function createEvent(){
  const panel=app.querySelector('#panel');
  const title=app.querySelector('#t').value.trim();
  const desc=app.querySelector('#ds').value.trim();
  const members_only=app.querySelector('#mo').checked;
  const success_message=app.querySelector('#sm').value.trim() || DEFAULT_SUCCESS;
  const has_slots=app.querySelector('#hs').checked;
  const brand=app.querySelector('#br').value;
  const collect_contact=app.querySelector('#mo').checked || app.querySelector('#cc').checked;
  const participant_fields=[...app.querySelectorAll('[data-pf]')].filter(b=>b.checked).map(b=>b.dataset.pf);
  const allow_party=participant_fields.length?false:app.querySelector('#ap').checked;
  const max_party=allow_party?Math.max(parseInt(app.querySelector('#mp').value,10)||1,1):1;
  const err=app.querySelector('#cerr'); err.textContent='';
  if(!title){ err.textContent='請填活動名稱。'; return; }

  let event_date=null, quota=0, slots=null;
  if(has_slots){
    const day=app.querySelector('#dd').value;
    if(!day){ err.textContent='請選擇活動日期。'; return; }
    slots=readSlots(panel, day);
    if(!slots.length){ err.textContent='請至少設定一個時段。'; return; }
    // 時段型活動：整體名額 = 各時段名額加總，日期存當天 00:00
    quota=slots.reduce((a,x)=>a+x.quota,0);
    event_date=new Date(day+'T00:00:00').toISOString();
    if(allow_party){
      const smallest=Math.min(...slots.map(x=>x.quota));
      if(max_party>smallest){
        err.textContent=`每組上限 ${max_party} 人超過最小時段的名額（${smallest} 人），這些組合永遠報不進去。請調低上限或加大時段名額。`;
        return;
      }
    }
  }else{
    const date=app.querySelector('#d').value;
    quota=parseInt(app.querySelector('#q').value,10);
    if(!quota||quota<1){ err.textContent='請填正確的名額。'; return; }
    if(allow_party && max_party>quota){
      err.textContent=`每組上限 ${max_party} 人超過活動總名額（${quota} 人）。請調整。`; return; }
    event_date=date?new Date(date).toISOString():null;
  }

  try{
    const ev=await backend.createEvent({title,description:desc,event_date,quota,members_only,
      success_message,has_slots,allow_party,max_party,brand,participant_fields,collect_contact}, slots);
    toast('活動建立完成');
    navigator.clipboard?.writeText(regLink(ev.slug, ev.brand)).then(()=>toast('報名連結已複製'));
    switchTab('events');               // 跳回總覽，立刻看到剛建立的活動
    adminFilter='all';
  }catch(e){ err.textContent='建立失敗，請稍後再試。'; }
}

let adminEvents=[]; let adminFilter='all';

async function refreshList(){
  const box=app.querySelector('#list');
  if(!box) return;                     // 不在「活動總覽」分頁時不用更新
  box.innerHTML='<p style="color:var(--muted);margin-top:20px">載入活動中…</p>';
  adminEvents=await backend.listEvents();
  renderTable();
}

function renderTable(){
  const box=app.querySelector('#list');
  if(!box) return;
  const tabs=`<div class="filters">
      <button class="ftab ${adminFilter==='all'?'on':''}" data-f="all">全部</button>
      <button class="ftab ${adminFilter==='open'?'on':''}" data-f="open">報名中</button>
      <button class="ftab ${adminFilter==='closed'?'on':''}" data-f="closed">已關閉</button>
    </div>`;
  if(!adminEvents.length){
    box.innerHTML='<div class="listhead"><h2>活動總覽</h2></div><p style="color:var(--muted)">還沒有活動，建立第一場吧。</p>';
    return;
  }
  const rows=adminEvents.filter(e=> adminFilter==='all'?true : adminFilter==='open'? e.is_open : !e.is_open);
  const body = rows.length ? rows.map(rowHtml).join('')
    : '<tr><td colspan="4" class="empty">此分類目前沒有活動</td></tr>';
  box.innerHTML=`
    <div class="listhead"><h2>活動總覽</h2>${tabs}</div>
    <table class="tbl">
      <thead><tr><th>活動</th><th style="text-align:center">報名</th><th style="text-align:center">狀態</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  box.querySelectorAll('.ftab').forEach(b=> b.onclick=()=>{ adminFilter=b.dataset.f; renderTable(); });
  rows.forEach(e=> attachRow(box, e));
}

function rowHtml(e){
  const status = e.is_open ? '<span class="pill go">報名中</span>' : '<span class="pill closed">已關閉</span>';
  return `<tr class="srow" data-id="${e.id}">
      <td><div class="ename"><span class="bdot" style="background:${
          BRANDS[e.brand||DEFAULT_BRAND].theme.accent}" title="${esc(brandOf(e.brand).name)}"></span>${esc(e.title)}</div>
        <div class="etime">🗓 ${esc(e.has_slots?fmtDay(e.event_date):fmtDate(e.event_date))}${
          e.has_slots?`　·　${(e.slots||[]).length} 個時段`:''}</div></td>
      <td class="cnum">${e.registered}/${e.quota}</td>
      <td class="cstat">${status}</td>
      <td class="ccaret"><span class="caret">▸</span></td>
    </tr>
    <tr class="drow" data-id="${e.id}" hidden><td colspan="4"><div class="detail"></div></td></tr>`;
}

function attachRow(box, e){
  const srow=box.querySelector('.srow[data-id="'+e.id+'"]');
  const drow=box.querySelector('.drow[data-id="'+e.id+'"]');
  const detail=drow.querySelector('.detail');
  let built=false;
  srow.onclick=async()=>{
    const show=drow.hidden; drow.hidden=!show; srow.classList.toggle('open', show);
    if(show && !built){ built=true; await buildDetail(detail, e); }
  };
}

async function buildDetail(detail, e){
  const link=regLink(e.slug, e.brand), date=e.has_slots?fmtDay(e.event_date):fmtDate(e.event_date);
  const slots=e.slots||[];
  detail.innerHTML=`
    <div class="dacts">
      <button class="mini2" data-a="toggle">${e.is_open?'關閉報名':'重新開啟'}</button>
      <button class="mini2 ghost" data-a="copy">複製報名連結</button>
      <button class="mini2 ghost" data-a="msg">訊息模板</button>
      <button class="mini2 ghost" data-a="csv">匯出名單</button>
      <button class="mini2 ghost" data-a="edit">✏️ 編輯活動</button>
    </div>
    <div class="editbox" hidden></div>
    <div class="msg" hidden>
      <div class="msg-label">📣 報名邀請訊息（貼到 LINE 揪團用）</div>
      <textarea class="invite"></textarea>
      <button class="mini" data-a="copy-invite">複製邀請訊息</button>
      <div class="msg-label" style="margin-top:16px">✅ 報名成功通知（可用 {姓名}${e.has_slots?'、{時段}':''}${e.allow_party?'、{人數}':''} 代入，每位會員各發一則）</div>
      <textarea class="tmpl"></textarea>
    </div>
    <div class="dmeta"><span class="bdot" style="background:${
        BRANDS[e.brand||DEFAULT_BRAND].theme.accent}"></span>${esc(brandOf(e.brand).name)}${
        (e.participant_fields||[]).length?`　·　收集：${(e.participant_fields||[])
          .map(k=>PFIELDS[k]?PFIELDS[k].label:k).join('、')}`:''}</div>
    ${e.has_slots?`<div class="dn-title">時段狀況</div>
      <div class="slotstat">${slots.map(x=>`<div class="ss${x.taken>=x.quota?' full':''}">
        <span class="sst">${esc(fmtTime(x.starts_at))}</span>
        <span class="ssn">${x.taken}/${x.quota}</span></div>`).join('')}</div>`:''}
    <div class="dn-title">報名名單（${e.registered} 人${e.groups&&e.groups!==e.registered?`／${e.groups} 組`:''}）</div>
    <div class="names">載入中…</div>
    <div class="danger">
      <button class="dz-open">🗑 刪除這場活動</button>
      <div class="dz-confirm" hidden>
        <div class="dz-warn">即將永久刪除「<b>${esc(e.title)}</b>」，
          連同底下 <b>${e.registered}</b> 筆報名紀錄一併移除。此動作<b>無法復原</b>。</div>
        <label class="dz-label">確定的話，請在下面輸入「刪除」兩個字</label>
        <input class="dz-input" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="刪除">
        <div class="dz-btns">
          <button class="dz-cancel">取消</button>
          <button class="dz-go" disabled>永久刪除</button>
        </div>
        <div class="err dz-err"></div>
      </div>
    </div>`;

  detail.querySelector('.invite').value =
    `【HAMONDE 活動報名】${e.title}\n🗓 ${date}\n名額有限，手刀報名 👉 ${link}`;
  detail.querySelector('.tmpl').value =
    `{姓名} 您好，您已成功報名「${e.title}」🎉\n🗓 ${date}`
    + (e.has_slots?`\n🕘 您的時段：{時段}`:'')
    + (e.allow_party?`\n👥 報名人數：{人數} 位`:'')
    + `\n名額已為您保留，屆時見！\n— HAMONDE CAFE 愛蒙娣咖啡`;

  detail.querySelector('[data-a="toggle"]').onclick=async()=>{
    await backend.setOpen(e.id, !e.is_open); e.is_open=!e.is_open; renderTable();
  };
  detail.querySelector('[data-a="edit"]').onclick=()=>{
    const box=detail.querySelector('.editbox');
    if(box.hidden){ buildEditor(box, e); box.hidden=false; box.scrollIntoView({block:'nearest'}); }
    else { box.hidden=true; box.innerHTML=''; }
  };
  detail.querySelector('[data-a="copy"]').onclick=()=>{ navigator.clipboard?.writeText(link); toast('已複製報名連結'); };
  detail.querySelector('[data-a="msg"]').onclick=()=>{ const m=detail.querySelector('.msg'); m.hidden=!m.hidden; };
  detail.querySelector('[data-a="copy-invite"]').onclick=()=>{ navigator.clipboard?.writeText(detail.querySelector('.invite').value); toast('已複製邀請訊息'); };

  // 刪除活動：需展開確認區、輸入「刪除」解鎖，再經一次系統確認
  const dz=detail.querySelector('.dz-confirm'), dzInput=detail.querySelector('.dz-input'),
        dzGo=detail.querySelector('.dz-go'), dzErr=detail.querySelector('.dz-err');
  const dzReset=()=>{ dz.hidden=true; dzInput.value=''; dzGo.disabled=true; dzErr.textContent=''; };
  detail.querySelector('.dz-open').onclick=()=>{ if(dz.hidden){ dz.hidden=false; dzInput.focus(); } else dzReset(); };
  detail.querySelector('.dz-cancel').onclick=dzReset;
  dzInput.oninput=()=>{ dzGo.disabled = dzInput.value.trim()!=='刪除'; };
  dzGo.onclick=async()=>{
    if(dzInput.value.trim()!=='刪除') return;
    if(!confirm('最後確認：永久刪除「'+e.title+'」及其報名紀錄？')) return;
    dzGo.disabled=true; dzErr.textContent='';
    try{ await backend.deleteEvent(e.id); toast('已刪除「'+e.title+'」'); await refreshList(); }
    catch(err){ dzErr.textContent='刪除失敗：'+(err.message||'請稍後再試。'); dzGo.disabled=false; }
  };

  const rs=await backend.listRegs(e.id);
  detail.querySelector('[data-a="csv"]').onclick=()=>{
    if(!rs.length){ toast('目前還沒有人報名'); return; }
    exportRegs(e, rs, slots);
  };
  const n=detail.querySelector('.names');
  if(!rs.length){ n.innerHTML='<div style="color:var(--muted)">目前還沒有人報名</div>'; return; }

  const slotTime=id=>{ const x=slots.find(y=>y.id===id); return x?fmtTime(x.starts_at):''; };
  const pdetail=r=>{
    const ps=r.participants||[];
    if(!ps.length) return '';
    return `<div class="plist2">${ps.map((x,i)=>`<div class="pline">${i+1}. ${esc(x.name||'')}${
      x.gender?'　'+esc(x.gender):''}${x.birth_year?'　民國 '+esc(String(x.birth_year))+' 年次':''}${
      x.address?'<br><span class="paddr">'+esc(x.address)+'</span>':''}</div>`).join('')}</div>`;
  };
  const line=(r,i)=>`<div class="nrow"><span>${i+1}. ${esc(r.name)}　${r.phone?esc(r.phone):'<span style="color:var(--muted)">未留聯絡方式</span>'}${
      (r.party_size||1)>1?`　<b class="pty">${r.party_size} 位</b>`:''}</span>
    <button class="nbtn" data-id="${r.id}">複製通知</button></div>${pdetail(r)}`;

  if(e.has_slots){
    n.innerHTML=slots.map(x=>{
      const mine=rs.filter(r=>r.slot_id===x.id);
      const head=mine.reduce((a,r)=>a+(r.party_size||1),0);
      return `<div class="sgrp"><div class="sgrph">🕘 ${esc(fmtTime(x.starts_at))}
        <span class="ssn">${head}/${x.quota}</span></div>
        ${mine.length?mine.map(line).join(''):'<div class="sgrpe">還沒有人報名</div>'}</div>`;
    }).join('');
    const orphan=rs.filter(r=>!slots.some(x=>x.id===r.slot_id));
    if(orphan.length) n.innerHTML+=`<div class="sgrp"><div class="sgrph">未指定時段</div>${orphan.map(line).join('')}</div>`;
  }else{
    n.innerHTML=rs.map(line).join('');
  }

  n.querySelectorAll('.nbtn').forEach(b=>{ b.onclick=()=>{
    const r=rs.find(x=>String(x.id)===String(b.dataset.id)); if(!r) return;
    const msg=detail.querySelector('.tmpl').value
      .replace(/{姓名}/g, r.name)
      .replace(/{時段}/g, slotTime(r.slot_id))
      .replace(/{人數}/g, String(r.party_size||1));
    navigator.clipboard?.writeText(msg); toast('已複製給 '+r.name+' 的通知');
  };});
}

// ============================================================
// 進入點
// ============================================================
(function init(){
  backend = CONFIG.DEMO_MODE ? makeDemoBackend() : makeSupabaseBackend();
  const p=new URLSearchParams(location.search);
  if(p.has('e')) renderRegister(p.get('e'));
  else if(p.has('admin')) renderAdmin();
  else{
    applyBrand(DEFAULT_BRAND);
    app.innerHTML=brandHeader(DEFAULT_BRAND)+`
    <div class="card"><h1>活動報名系統</h1>
    <p class="desc">這是後台入口。建立活動後複製連結分享給客人。</p>
    <a class="btn ghost" href="?admin" style="display:block;text-align:center;text-decoration:none">進入後台</a>
    <a class="btn" href="?e=coffee01" style="display:block;text-align:center;text-decoration:none">看看範例報名頁</a></div>`;
  }
})();
