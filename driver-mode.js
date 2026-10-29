(() => {
  'use strict';

  const CONFIG = window.BUS_SUPABASE;
  const SB = window.supabase && CONFIG
    ? window.supabase.createClient(CONFIG.url, CONFIG.publishableKey)
    : null;
  const CACHE_KEY = 'busDelayReportsCacheV2';
  let reports = [];
  let channel = null;
  let currentSnapshot = null;
  let focusMode = false;

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const fmtDuration = sec => {
    sec = Math.max(0, Math.floor(sec));
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`;
  };
  const fmtMinute = minute => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function japanParts() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const get = type => parts.find(x => x.type === type)?.value || '';
    const h = Number(get('hour')), m = Number(get('minute')), s = Number(get('second'));
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      h, m, s,
      sec: (h < 3 ? h + 24 : h) * 3600 + m * 60 + s
    };
  }

  const serviceDate = () => japanParts().date;
  const tripKey = t => `${t.duty}|${t.time}|${t.no}`;

  function activeReports() {
    const date = serviceDate();
    return reports.filter(r => r.active && r.service_date === date);
  }

  function reportForTrip(t) {
    return activeReports()
      .filter(r => r.duty === t.duty && r.origin_trip_no === String(t.no) && r.origin_scheduled_departure === t.time)
      .sort((a,b) => new Date(b.updated_at || b.reported_at) - new Date(a.updated_at || a.reported_at))[0] || null;
  }

  function calculateAffected(origin, delayMinutes) {
    const list = trips.filter(t => t.duty === origin.duty).sort((a,b) => min(a.time) - min(b.time));
    const startIndex = list.findIndex(t => tripKey(t) === tripKey(origin));
    if (startIndex < 0) return [];
    const affected = [];
    let previousNewArrival = null;
    for (let i = startIndex; i < list.length; i++) {
      const t = list[i];
      const scheduledDeparture = min(t.time);
      const scheduledArrival = scheduledDeparture + duration(t.no);
      let newDeparture;
      if (i === startIndex) newDeparture = scheduledDeparture + delayMinutes;
      else newDeparture = Math.max(scheduledDeparture, previousNewArrival);
      const newArrival = newDeparture + duration(t.no);
      const delay = newDeparture - scheduledDeparture;
      if (i > startIndex && delay <= 0) {
        affected.push({
          no:String(t.no), from:t.from, to:t.to,
          old_departure:fmtMinute(scheduledDeparture), old_arrival:fmtMinute(scheduledArrival),
          new_departure:fmtMinute(scheduledDeparture), new_arrival:fmtMinute(scheduledArrival),
          delay_minutes:0, recovered:true
        });
        break;
      }
      affected.push({
        no:String(t.no), from:t.from, to:t.to,
        old_departure:fmtMinute(scheduledDeparture), old_arrival:fmtMinute(scheduledArrival),
        new_departure:fmtMinute(newDeparture), new_arrival:fmtMinute(newArrival),
        delay_minutes:delay, recovered:false
      });
      previousNewArrival = newArrival;
    }
    return affected;
  }

  function effectiveSchedule(t) {
    const direct = reportForTrip(t);
    if (direct) {
      const row = (direct.affected_trips || [])[0];
      if (row) return {departure:min(row.new_departure), arrival:min(row.new_arrival), report:direct};
    }
    for (const r of activeReports()) {
      if (r.duty !== t.duty) continue;
      const row = (r.affected_trips || []).find(x => String(x.no) === String(t.no) && x.old_departure === t.time);
      if (row && row.delay_minutes > 0) return {departure:min(row.new_departure), arrival:min(row.new_arrival), report:r};
    }
    return {departure:min(t.time), arrival:min(t.time)+duration(t.no), report:null};
  }

  function snapshot(sec) {
    const list = trips.filter(t => t.duty === duty).sort((a,b) => min(a.time)-min(b.time));
    if (!list.length) return {mode:'finished', list};
    const minute = sec / 60;
    const running = list.find(t => {
      const e = effectiveSchedule(t);
      return minute >= e.departure && minute < e.arrival;
    });
    const next = list.find(t => effectiveSchedule(t).departure > minute);
    if (minute < effectiveSchedule(list[0]).departure) return {mode:'before', list, next:list[0]};
    if (running) return {mode:'driving', list, running, next};
    if (next) {
      const idx = list.indexOf(next);
      const previous = idx > 0 ? list[idx-1] : null;
      const previousArrival = previous ? effectiveSchedule(previous).arrival : effectiveSchedule(next).departure;
      return {mode:effectiveSchedule(next).departure-previousArrival >= 60 ? 'break':'standby', list, next, end:effectiveSchedule(next).departure};
    }
    return {mode:'finished', list};
  }

  function cacheReports() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({date:serviceDate(), reports})); } catch {}
  }
  function restoreCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      if (saved.date === serviceDate() && Array.isArray(saved.reports)) reports = saved.reports;
    } catch {}
  }

  const style = document.createElement('style');
  style.textContent = `
    .driverModeCard{color:#fff;background:linear-gradient(135deg,#334155,#64748b);border-radius:26px;padding:22px;margin-bottom:14px;box-shadow:0 8px 24px #0f172a30}.mode-driving{background:linear-gradient(135deg,#075985,#0ea5e9)}.mode-standby{background:linear-gradient(135deg,#92400e,#f59e0b)}.mode-break{background:linear-gradient(135deg,#166534,#22c55e)}.mode-finished{background:linear-gradient(135deg,#312e81,#6366f1)}
    .driverTop,.driverActions,.infoHeader{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.driverBadge{background:#ffffff25;border:1px solid #ffffff45;border-radius:999px;padding:7px 11px;font-weight:900}.driverClock{font:900 24px ui-monospace}.driverTitle{font-size:clamp(30px,5vw,50px);font-weight:950;margin:17px 0 6px}.driverRoute{font-size:clamp(17px,2.3vw,24px);font-weight:850}.driverGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:18px}.driverInfo{background:#ffffff18;border:1px solid #ffffff2b;border-radius:15px;padding:12px}.driverInfo span{display:block;font-size:11px;opacity:.8;font-weight:800}.driverInfo b{display:block;margin-top:5px;font-size:17px}.driverActions{justify-content:flex-start;margin-top:17px}.driverBtn{border:0;border-radius:14px;padding:13px 17px;font-weight:900;cursor:pointer;background:#fff;color:#123}.driverBtn.alert{background:#fee2e2;color:#991b1b}.driverBtn.secondary{background:#ffffff25;color:#fff;border:1px solid #ffffff55}.syncState{font-size:12px;margin-top:10px;opacity:.85}
    .operationsInfo{background:#fff;border-radius:24px;padding:20px;margin-bottom:14px;box-shadow:0 4px 18px #1f334415}.reportCard{border:1px solid #fecaca;background:#fff7f7;border-left:6px solid #ef4444;border-radius:16px;padding:15px;margin-top:12px}.reportMeta{color:#64748b;font-size:12px}.affectedTable{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}.affectedTable th,.affectedTable td{padding:9px 7px;border-bottom:1px solid #e5e7eb;text-align:left}.oldTime{text-decoration:line-through;color:#64748b}.newTime{color:#b91c1c;font-weight:900}.recovered{color:#15803d;font-weight:900}.noticeToast{position:fixed;right:18px;top:18px;z-index:10000;width:min(430px,calc(100% - 36px));background:#7f1d1d;color:#fff;border-radius:17px;padding:16px;box-shadow:0 14px 45px #0006;display:none}.noticeToast.show{display:block}.driverPanel{position:fixed;inset:0;background:#071526ee;z-index:9999;display:none;align-items:center;justify-content:center;padding:16px}.driverPanel.open{display:flex}.driverDialog{width:min(520px,100%);background:#fff;border-radius:24px;padding:22px}.driverDialog label{display:block;font-size:13px;font-weight:850;margin:14px 0 5px}.driverDialog select,.driverDialog textarea{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font:inherit}.driverDialog textarea{min-height:90px}.drivingFocus .mapScheduleLayout,.drivingFocus #upcoming,.drivingFocus #team,.drivingFocus .operationsInfo{display:none!important}
    @media(max-width:760px){.driverGrid{grid-template-columns:1fr 1fr}.affectedTable{display:block;overflow:auto}.driverBtn{flex:1}.driverModeCard{border-radius:20px}}
  `;
  document.head.appendChild(style);

  const driverCard = document.createElement('section');
  driverCard.id = 'driverModeCard';
  driverCard.className = 'driverModeCard';
  driverCard.innerHTML = `<div class="driverTop"><div class="driverBadge" id="driverBadge">● 接続中</div><div class="driverClock" id="driverClock">00:00:00</div></div><div class="driverTitle" id="driverTitle">勤務を確認しています</div><div class="driverRoute" id="driverRoute">--</div><div class="driverGrid"><div class="driverInfo"><span>到着・終了まで</span><b id="driverCountdown">--</b></div><div class="driverInfo"><span>次の担当</span><b id="driverNext">--</b></div><div class="driverInfo"><span>折返し時間</span><b id="driverTurn">--</b></div><div class="driverInfo"><span>現在の遅延</span><b id="driverDelay">0分</b></div></div><div class="driverActions"><button class="driverBtn" id="arrivalBtn">到着を記録</button><button class="driverBtn alert" id="reportBtn">異常・遅延を報告</button><button class="driverBtn secondary" id="focusBtn">運転中表示に集中</button></div><div class="syncState" id="syncState">リアルタイム接続を準備中</div>`;

  const operations = document.createElement('section');
  operations.className = 'operationsInfo';
  operations.innerHTML = `<div class="infoHeader"><div><h2 style="margin:0">📢 運行情報</h2><div class="muted">当日の遅延と変更後時刻を全端末で共有</div></div><span class="pill run" id="reportCount">0件</span></div><div id="reportsList"></div>`;

  const panel = document.createElement('div');
  panel.className = 'driverPanel'; panel.id = 'reportPanel';
  panel.innerHTML = `<div class="driverDialog"><h2 style="margin-top:0">異常・遅延を報告</h2><label>遅延時間</label><select id="delayMinutes">${[0,5,10,15,20,30,45,60,90,120].map(v=>`<option value="${v}">${v}分</option>`).join('')}</select><label>報告種別</label><select id="reportType"><option>遅延</option><option>交通渋滞</option><option>車両故障</option><option>乗客の急病</option><option>事故</option><option>道路通行止め</option><option>乗客トラブル</option><option>その他</option></select><label>状況メモ</label><textarea id="reportMemo" maxlength="500" placeholder="停車中に入力してください"></textarea><div class="driverActions" style="justify-content:flex-end"><button class="driverBtn" id="cancelBtn">キャンセル</button><button class="driverBtn alert" id="saveBtn">全ユーザーへ通報</button></div></div>`;
  const toast = document.createElement('div'); toast.className='noticeToast'; toast.id='noticeToast';

  const main = document.querySelector('main.main');
  if (!main || typeof trips === 'undefined' || typeof duty === 'undefined') return;
  main.prepend(operations); main.prepend(driverCard); document.body.append(panel, toast);

  function renderReports() {
    const list = activeReports().sort((a,b)=>new Date(b.updated_at||b.reported_at)-new Date(a.updated_at||a.reported_at));
    $('reportCount').textContent = `${list.length}件`;
    $('reportsList').innerHTML = list.length ? list.map(r => {
      const rows = r.affected_trips || [];
      return `<article class="reportCard"><div class="infoHeader"><div><b>${escHtml(r.duty)}・${escHtml(r.origin_trip_no)}便　${r.delay_minutes}分遅れ</b><div class="reportMeta">${escHtml(r.report_type)}${r.memo ? '／'+escHtml(r.memo):''}　最終更新 ${new Date(r.updated_at||r.reported_at).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})}</div></div></div><table class="affectedTable"><thead><tr><th>便</th><th>区間</th><th>元の時刻</th><th>変更後</th><th>予想</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escHtml(x.no)}便</td><td>${escHtml(x.from)} → ${escHtml(x.to)}</td><td class="oldTime">${x.old_departure} → ${x.old_arrival}</td><td class="${x.recovered?'recovered':'newTime'}">${x.new_departure} → ${x.new_arrival}</td><td class="${x.recovered?'recovered':'newTime'}">${x.recovered?'ここから定刻復帰':x.delay_minutes+'分遅れ'}</td></tr>`).join('')}</tbody></table></article>`;
    }).join('') : '<div class="muted" style="padding:22px 0">現在、有効な遅延情報はありません。</div>';
  }

  function showToast(report) {
    toast.innerHTML = `<b>新しい運行情報</b><div style="margin-top:5px">${escHtml(report.duty)}・${escHtml(report.origin_trip_no)}便　${report.delay_minutes}分遅れ</div><div style="font-size:12px;margin-top:5px">影響見込み ${(report.affected_trips||[]).filter(x=>!x.recovered).length}便</div>`;
    toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'), 9000);
  }

  async function loadReports() {
    restoreCache(); renderReports();
    if (!SB) { $('syncState').textContent='Supabase設定を確認してください。端末キャッシュのみ表示中'; return; }
    const {data,error} = await SB.from('delay_reports').select('*').eq('service_date',serviceDate()).eq('active',true).order('reported_at',{ascending:false});
    if (error) { $('syncState').textContent=`同期エラー: ${error.message}`; return; }
    reports = data || []; cacheReports(); renderReports(); $('syncState').textContent='● 全端末リアルタイム同期中';
    channel = SB.channel('delay-reports-live').on('postgres_changes',{event:'*',schema:'public',table:'delay_reports',filter:`service_date=eq.${serviceDate()}`}, payload => {
      const incoming = payload.new;
      if (payload.eventType === 'DELETE') reports = reports.filter(r=>r.id!==payload.old.id);
      else reports = [incoming, ...reports.filter(r=>r.id!==incoming.id)];
      cacheReports(); renderReports(); if (payload.eventType === 'INSERT') showToast(incoming);
    }).subscribe(status => { if(status==='SUBSCRIBED') $('syncState').textContent='● 全端末リアルタイム同期中'; });
  }

  function renderDriver() {
    const now = japanParts(), snap = snapshot(now.sec); currentSnapshot = snap;
    driverCard.className = `driverModeCard mode-${snap.mode}`;
    $('driverClock').textContent = `${pad(now.h)}:${pad(now.m)}:${pad(now.s)}`;
    $('arrivalBtn').style.display = snap.mode==='driving' ? '' : 'none';
    let title,route,count='--:--:--',next='なし',turn='--',delay=0;
    if (snap.mode==='driving') {
      const e=effectiveSchedule(snap.running); delay=e.departure-min(snap.running.time);
      title=`${snap.running.no}便を運行中`; route=`${snap.running.from} → ${snap.running.to}`; count=fmtDuration(e.arrival*60-now.sec); $('driverBadge').textContent='● 運転中';
      if(snap.next){const ne=effectiveSchedule(snap.next);next=`${snap.next.no}便 ${fmtMinute(ne.departure)}発`;turn=`${Math.floor((ne.departure-e.arrival))}分`;}
    } else if(snap.mode==='before'){title='勤務開始前';route=`最初は ${snap.next.no}便 ${snap.next.from} → ${snap.next.to}`;count=fmtDuration(effectiveSchedule(snap.next).departure*60-now.sec);next=`${snap.next.no}便 ${fmtMinute(effectiveSchedule(snap.next).departure)}発`;$('driverBadge').textContent='● 勤務前';}
    else if(snap.mode==='standby'||snap.mode==='break'){title=snap.mode==='break'?'休憩中':'待機中';route=snap.next?`次は ${snap.next.no}便 ${snap.next.from} → ${snap.next.to}`:'次の指示を確認';count=fmtDuration(snap.end*60-now.sec);next=snap.next?`${snap.next.no}便 ${fmtMinute(snap.end)}発`:'なし';$('driverBadge').textContent=snap.mode==='break'?'● 休憩中':'● 待機中';}
    else{title='本日の勤務終了';route='乗務後点呼・忘れ物・車両状態を確認してください';$('driverBadge').textContent='● 勤務終了';}
    $('driverTitle').textContent=title;$('driverRoute').textContent=route;$('driverCountdown').textContent=count;$('driverNext').textContent=next;$('driverTurn').textContent=turn;$('driverDelay').textContent=`${delay}分`;
  }

  $('reportBtn').onclick=()=>{if(!currentSnapshot?.running){alert('遅延通報は運行中の便があるときに行ってください。');return;}$('reportPanel').classList.add('open');};
  $('cancelBtn').onclick=()=>$('reportPanel').classList.remove('open');
  $('saveBtn').onclick=async()=>{
    const origin=currentSnapshot?.running;if(!origin)return;
    const delay=Number($('delayMinutes').value);if(delay<=0){alert('遅延時間を選択してください。');return;}
    const affected=calculateAffected(origin,delay);
    const payload={service_date:serviceDate(),duty:origin.duty,origin_trip_no:String(origin.no),origin_scheduled_departure:origin.time,delay_minutes:delay,report_type:$('reportType').value,memo:$('reportMemo').value.trim(),affected_trips:affected,active:true,updated_at:new Date().toISOString()};
    if(!SB){alert('Supabaseに接続できません。');return;}
    $('saveBtn').disabled=true;
    const old=reportForTrip(origin);let result;
    if(old) result=await SB.from('delay_reports').update(payload).eq('id',old.id).select().single();
    else result=await SB.from('delay_reports').insert(payload).select().single();
    $('saveBtn').disabled=false;
    if(result.error){alert(`通報に失敗しました: ${result.error.message}`);return;}
    reports=[result.data,...reports.filter(r=>r.id!==result.data.id)];cacheReports();renderReports();$('reportPanel').classList.remove('open');$('reportMemo').value='';alert('遅延情報を全ユーザーへ送信しました。');
  };
  $('arrivalBtn').onclick=()=>alert('到着記録の全端末同期は次の実装段階です。現在は遅延情報の共有が有効です。');
  $('focusBtn').onclick=()=>{focusMode=!focusMode;document.body.classList.toggle('drivingFocus',focusMode);$('focusBtn').textContent=focusMode?'詳細画面へ戻る':'運転中表示に集中';};

  restoreCache(); renderReports(); renderDriver(); loadReports();
  setInterval(renderDriver,1000);
  window.addEventListener('beforeunload',()=>{if(channel&&SB)SB.removeChannel(channel);});
})();
