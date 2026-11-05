(() => {
  'use strict';
  // BUS DRIVER MODE V7: calendar-aware traffic forecast
  const CONFIG = window.BUS_SUPABASE;
  const SB = window.supabase && CONFIG ? window.supabase.createClient(CONFIG.url, CONFIG.publishableKey) : null;
  const CACHE_KEY='busDelayReportsCacheV5', TOKEN_KEY='busReporterTokenV1', OWNED_KEY='busOwnedReportIdsV1';
  const reporterToken=(()=>{let v;try{v=localStorage.getItem(TOKEN_KEY);if(!v){v=crypto.randomUUID();localStorage.setItem(TOKEN_KEY,v)}}catch{v=crypto.randomUUID()}return v})();
  let ownedIds=(()=>{try{return JSON.parse(localStorage.getItem(OWNED_KEY)||'[]')}catch{return[]}})();
  let reports=[],channel=null,currentSnapshot=null,focusMode=false;
  const TRAFFIC_SIM_KEY='busTrafficSimulationEnabledV1';
  let trafficSimulationEnabled=(()=>{try{return localStorage.getItem(TRAFFIC_SIM_KEY)!=='false'}catch{return true}})();
  function stableHash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0)/4294967295}
  const JAPAN_HOLIDAYS={
    '2026-01-01':'元日','2026-01-12':'成人の日','2026-02-11':'建国記念の日','2026-02-23':'天皇誕生日','2026-03-20':'春分の日','2026-04-29':'昭和の日','2026-05-03':'憲法記念日','2026-05-04':'みどりの日','2026-05-05':'こどもの日','2026-05-06':'休日','2026-07-20':'海の日','2026-08-11':'山の日','2026-09-21':'敬老の日','2026-09-22':'休日','2026-09-23':'秋分の日','2026-10-12':'スポーツの日','2026-11-03':'文化の日','2026-11-23':'勤労感謝の日',
    '2027-01-01':'元日','2027-01-11':'成人の日','2027-02-11':'建国記念の日','2027-02-23':'天皇誕生日','2027-03-21':'春分の日','2027-03-22':'休日','2027-04-29':'昭和の日','2027-05-03':'憲法記念日','2027-05-04':'みどりの日','2027-05-05':'こどもの日','2027-07-19':'海の日','2027-08-11':'山の日','2027-09-20':'敬老の日','2027-09-23':'秋分の日','2027-10-11':'スポーツの日','2027-11-03':'文化の日','2027-11-23':'勤労感謝の日'
  };
  const dateKey=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const addDays=(d,n)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x};
  const isDayOff=d=>{const day=d.getUTCDay();return day===0||day===6||!!JAPAN_HOLIDAYS[dateKey(d)]};
  function calendarContext(dateText=serviceDate()){
    const d=new Date(`${dateText}T00:00:00Z`),dow=d.getUTCDay(),dayNames=['日','月','火','水','木','金','土'];
    let start=d,end=d;while(isDayOff(addDays(start,-1)))start=addDays(start,-1);while(isDayOff(addDays(end,1)))end=addDays(end,1);
    const off=isDayOff(d),length=off?Math.round((end-start)/86400000)+1:0,index=off?Math.round((d-start)/86400000)+1:0;
    const md=(d.getUTCMonth()+1)*100+d.getUTCDate();
    let season='通常期',seasonFactor=1;
    if(md>=429&&md<=506){season='ゴールデンウィーク';seasonFactor=1.5}
    else if(md>=810&&md<=817){season='お盆';seasonFactor=1.45}
    else if(md>=919&&md<=923){season='秋の大型連休';seasonFactor=1.45}
    else if(md>=1227||md<=104){season='年末年始';seasonFactor=1.55}
    let holidayStage='通常日',holidayFactor=1;
    if(length>=3){holidayStage=index===1?'連休初日':index===length?'連休最終日':'連休中日';holidayFactor=index===1?1.7:index===length?1.85:1.35}
    else if(!off&&isDayOff(addDays(d,1))&&isDayOff(addDays(d,2))){holidayStage='連休前日';holidayFactor=1.35}
    else if(off){holidayStage=JAPAN_HOLIDAYS[dateText]||'土日';holidayFactor=1.15}
    return{dateText,dow,dayName:dayNames[dow]+'曜日',off,length,index,holidayStage,holidayFactor,season,seasonFactor};
  }
  function trafficProfile(minute,t=null){
    const h=(minute/60)%24,cal=calendarContext(),weekend=cal.off;
    let base;
    if(h>=3&&h<5)base={label:'深夜・早朝',chance:.02,min:1,max:2,level:'非常に空いている'};
    else if(h<6.5)base={label:'早朝移動',chance:.08,min:1,max:3,level:'空いている'};
    else if(h<7.5)base={label:'朝の交通増加',chance:.35,min:2,max:6,level:'やや混雑'};
    else if(h<9.5)base={label:'朝ラッシュ',chance:.80,min:4,max:14,level:'混雑'};
    else if(h<11)base={label:'朝の混雑残り',chance:.48,min:2,max:8,level:'やや混雑'};
    else if(h<15.5)base={label:'日中',chance:.25,min:1,max:5,level:'通常'};
    else if(h<17)base={label:'夕方への移行',chance:.42,min:2,max:7,level:'やや混雑'};
    else if(h<19.5)base={label:'夕方ラッシュ',chance:.85,min:5,max:16,level:'混雑'};
    else if(h<21)base={label:'帰宅混雑',chance:.55,min:2,max:9,level:'やや混雑'};
    else if(h<23)base={label:'夜間',chance:.18,min:1,max:4,level:'空いている'};
    else base={label:'深夜',chance:.03,min:1,max:2,level:'非常に空いている'};
    let weekdayFactor=[.82,1.15,1,1,1.05,1.2,.95][cal.dow];
    if(weekend&&h>=7&&h<9.5)weekdayFactor*=.55;
    if(weekend&&h>=9.5&&h<15.5)weekdayFactor*=1.45;
    if((cal.dow===0||JAPAN_HOLIDAYS[cal.dateText])&&h>=16&&h<19.5)weekdayFactor*=1.5;
    let holidayFactor=cal.holidayFactor;
    if(cal.holidayStage==='連休初日'&&h>=5&&h<11)holidayFactor*=1.7;
    if(cal.holidayStage==='連休最終日'&&h>=13&&h<21)holidayFactor*=1.55;
    if(cal.holidayStage==='連休前日'&&h>=16&&h<22)holidayFactor*=1.3;
    let directionFactor=1,direction='';
    if(t){direction=t.to==='空港'?'空港方面':'ホテル方面';if(direction==='ホテル方面'&&cal.holidayStage==='連休初日'&&h<14)directionFactor=1.2;if(direction==='空港方面'&&cal.holidayStage==='連休最終日'&&h>=13)directionFactor=1.25;if(direction==='空港方面'&&cal.season==='お盆'&&h>=13)directionFactor=1.15}
    const total=Math.min(3,weekdayFactor*holidayFactor*cal.seasonFactor*directionFactor),chance=Math.min(.95,base.chance*total),min=Math.max(1,Math.round(base.min*Math.sqrt(total))),max=Math.min(30,Math.max(min,Math.round(base.max*total)));
    let level=chance>=.8?'非常に混雑':chance>=.55?'混雑':chance>=.3?'やや混雑':chance>=.12?'通常':'空いている';
    return{...base,chance,min,max,level,calendar:cal,direction,totalFactor:total};
  }
  function simulatedDelay(t){
    if(!trafficSimulationEnabled)return 0;
    const profile=trafficProfile(min(t.time),t),key=`${serviceDate()}|${t.duty}|${t.time}|${t.no}|traffic-calendar-v1`;
    if(stableHash(key)>profile.chance)return 0;
    return Math.round(profile.min+stableHash(key+'|minutes')*(profile.max-profile.min));
  }
  const $=id=>document.getElementById(id), pad=n=>String(n).padStart(2,'0');
  const fmtDuration=s=>{s=Math.max(0,Math.floor(s));return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`};
  const fmtMinute=m=>`${pad(Math.floor(m/60))}:${pad(m%60)}`;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function japanParts(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'',h=+g('hour'),m=+g('minute'),s=+g('second');let d=new Date(Date.UTC(+g('year'),+g('month')-1,+g('day')));if(h<3)d.setUTCDate(d.getUTCDate()-1);return{date:`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,h,m,s,sec:(h<3?h+24:h)*3600+m*60+s}}
  const serviceDate=()=>japanParts().date, tripKey=t=>`${t.duty}|${t.time}|${t.no}`;
  const activeReports=()=>reports.filter(r=>r.active&&r.service_date===serviceDate());
  const reportForTrip=t=>activeReports().filter(r=>r.duty===t.duty&&r.origin_trip_no===String(t.no)&&r.origin_scheduled_departure===t.time).sort((a,b)=>new Date(b.updated_at||b.reported_at)-new Date(a.updated_at||a.reported_at))[0]||null;
  function saveOwned(){try{localStorage.setItem(OWNED_KEY,JSON.stringify(ownedIds))}catch{}}
  function scheduledGap(previous, next) {
    return Math.max(0, min(next.time) - (min(previous.time) + duration(previous.no)));
  }
  function nextDeparture(previousArrival, previous, next) {
    const scheduledDeparture = min(next.time);
    const gap = scheduledGap(previous, next);
    if (gap >= 60) return previousArrival + gap; // 規定の休憩時間を全て確保し、遅延は吸収しない
    if (gap === 0) return previousArrival;       // 連続便は折返し待機を追加しない
    return Math.max(scheduledDeparture, previousArrival + Math.min(3, gap)); // 通常待機は最低3分
  }
  function calculateAffected(origin,totalDelay,mode){
    const list=trips.filter(t=>t.duty===origin.duty).sort((a,b)=>min(a.time)-min(b.time)),i0=list.findIndex(t=>tripKey(t)===tripKey(origin));
    if(i0<0)return[];
    const out=[];let prevArrival=null;
    for(let i=i0;i<list.length;i++){
      const t=list[i],sd=min(t.time),sa=sd+duration(t.no);
      if(mode==='suspended'){
        out.push({no:String(t.no),from:t.from,to:t.to,old_departure:fmtMinute(sd),old_arrival:fmtMinute(sa),new_departure:'運休',new_arrival:'運休',delay_minutes:0,recovered:false,suspended:true});
        continue;
      }
      const nd=i===i0?sd+totalDelay:nextDeparture(prevArrival,list[i-1],t),na=nd+duration(t.no),delay=nd-sd;
      if(i>i0&&delay<=0){
        out.push({no:String(t.no),from:t.from,to:t.to,old_departure:fmtMinute(sd),old_arrival:fmtMinute(sa),new_departure:fmtMinute(sd),new_arrival:fmtMinute(sa),delay_minutes:0,recovered:true,suspended:false});
        break;
      }
      out.push({no:String(t.no),from:t.from,to:t.to,old_departure:fmtMinute(sd),old_arrival:fmtMinute(sa),new_departure:fmtMinute(nd),new_arrival:fmtMinute(na),delay_minutes:Math.max(0,delay),recovered:false,suspended:false});
      prevArrival=na;
    }
    return out;
  }
  function calculateFromArrival(origin, actualArrival){
    const list=trips.filter(t=>t.duty===origin.duty).sort((a,b)=>min(a.time)-min(b.time)),i0=list.findIndex(t=>tripKey(t)===tripKey(origin));
    if(i0<0)return[];
    const out=[];const sd0=min(origin.time),sa0=sd0+duration(origin.no);
    out.push({no:String(origin.no),from:origin.from,to:origin.to,old_departure:fmtMinute(sd0),old_arrival:fmtMinute(sa0),new_departure:fmtMinute(sd0),new_arrival:fmtMinute(actualArrival),delay_minutes:Math.max(0,actualArrival-sa0),recovered:actualArrival<=sa0,suspended:false,actual_arrival:true});
    let prevArrival=actualArrival;
    for(let i=i0+1;i<list.length;i++){
      const t=list[i],sd=min(t.time),sa=sd+duration(t.no),nd=nextDeparture(prevArrival,list[i-1],t),na=nd+duration(t.no),delay=nd-sd;
      if(delay<=0){
        out.push({no:String(t.no),from:t.from,to:t.to,old_departure:fmtMinute(sd),old_arrival:fmtMinute(sa),new_departure:fmtMinute(sd),new_arrival:fmtMinute(sa),delay_minutes:0,recovered:true,suspended:false});
        break;
      }
      out.push({no:String(t.no),from:t.from,to:t.to,old_departure:fmtMinute(sd),old_arrival:fmtMinute(sa),new_departure:fmtMinute(nd),new_arrival:fmtMinute(na),delay_minutes:Math.max(0,delay),recovered:false,suspended:false});
      prevArrival=na;
    }
    return out;
  }
  function impactForTrip(t){for(const r of activeReports()){if(r.duty!==t.duty)continue;const row=(r.affected_trips||[]).find(x=>String(x.no)===String(t.no)&&x.old_departure===t.time);if(row)return{row,report:r}}return null}
  function effectiveSchedule(t){const impact=impactForTrip(t);if(impact?.row?.suspended)return{departure:min(t.time),arrival:min(t.time)+duration(t.no),suspended:true,report:impact.report};if(impact?.row&&impact.row.delay_minutes>0)return{departure:min(impact.row.new_departure),arrival:min(impact.row.new_arrival),suspended:false,report:impact.report};const auto=simulatedDelay(t);return{departure:min(t.time)+auto,arrival:min(t.time)+auto+duration(t.no),suspended:false,report:null,simulated:auto>0,simulatedDelay:auto}}
  function snapshot(sec){const list=trips.filter(t=>t.duty===duty).sort((a,b)=>min(a.time)-min(b.time));if(!list.length)return{mode:'finished',list};const mm=sec/60,suspended=list.find(t=>{const e=effectiveSchedule(t);return e.suspended&&mm>=e.departure});if(suspended)return{mode:'suspended',list,running:suspended,next:null};const running=list.find(t=>{const e=effectiveSchedule(t);return!e.suspended&&mm>=e.departure&&mm<e.arrival}),next=list.find(t=>{const e=effectiveSchedule(t);return!e.suspended&&e.departure>mm});if(mm<effectiveSchedule(list[0]).departure)return{mode:'before',list,next:list[0]};if(running)return{mode:'driving',list,running,next};if(next){const i=list.indexOf(next),prev=i>0?list[i-1]:null,arr=prev?effectiveSchedule(prev).arrival:effectiveSchedule(next).departure;return{mode:effectiveSchedule(next).departure-arr>=60?'break':'standby',list,next,end:effectiveSchedule(next).departure}}return{mode:'finished',list}}
  function cache(){try{localStorage.setItem(CACHE_KEY,JSON.stringify({date:serviceDate(),reports}))}catch{}}
  function restore(){try{const x=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');if(x.date===serviceDate()&&Array.isArray(x.reports))reports=x.reports}catch{}}

  const st=document.createElement('style');st.textContent=`.driverModeCard{color:#fff;background:linear-gradient(135deg,#334155,#64748b);border-radius:26px;padding:22px;margin-bottom:14px;box-shadow:0 8px 24px #0f172a30}.mode-driving{background:linear-gradient(135deg,#075985,#0ea5e9)}.mode-standby{background:linear-gradient(135deg,#92400e,#f59e0b)}.mode-break{background:linear-gradient(135deg,#166534,#22c55e)}.mode-finished{background:linear-gradient(135deg,#312e81,#6366f1)}.mode-suspended{background:linear-gradient(135deg,#7f1d1d,#dc2626)}.driverTop,.driverActions,.infoHeader{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.driverBadge{background:#ffffff25;border:1px solid #ffffff45;border-radius:999px;padding:7px 11px;font-weight:900}.driverClock{font:900 24px ui-monospace}.driverTitle{font-size:clamp(30px,5vw,50px);font-weight:950;margin:17px 0 6px}.driverRoute{font-size:clamp(17px,2.3vw,24px);font-weight:850}.driverGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:18px}.driverInfo{background:#ffffff18;border:1px solid #ffffff2b;border-radius:15px;padding:12px}.driverInfo span{display:block;font-size:11px;opacity:.8;font-weight:800}.driverInfo b{display:block;margin-top:5px;font-size:17px}.driverActions{justify-content:flex-start;margin-top:17px}.driverBtn{border:0;border-radius:14px;padding:13px 17px;font-weight:900;cursor:pointer;background:#fff;color:#123}.driverBtn.alert{background:#fee2e2;color:#991b1b}.driverBtn.secondary{background:#ffffff25;color:#fff;border:1px solid #ffffff55}.cancelReportBtn{background:#fff;border:1px solid #ef4444;color:#b91c1c;border-radius:10px;padding:7px 10px;font-weight:900;cursor:pointer}.trafficDemoCard{border:2px solid #f59e0b;background:#fffbeb}.trafficDemoWarning{color:#92400e;font-weight:900;margin-top:8px}.trafficDemoList{margin-top:8px;color:#475569}.operationsInfo{background:#fff;border-radius:24px;padding:20px;margin-bottom:14px;box-shadow:0 4px 18px #1f334415}.reportCard{border:1px solid #fecaca;background:#fff7f7;border-left:6px solid #ef4444;border-radius:16px;padding:15px;margin-top:12px}.reportCard.suspended{background:#fff1f2;border-color:#991b1b}.reportMeta{color:#64748b;font-size:12px}.affectedTable{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}.affectedTable th,.affectedTable td{padding:9px 7px;border-bottom:1px solid #e5e7eb;text-align:left}.oldTime{text-decoration:line-through;color:#64748b}.newTime{color:#b91c1c;font-weight:900}.recovered{color:#15803d;font-weight:900}.noticeToast{position:fixed;right:18px;top:18px;z-index:10000;width:min(430px,calc(100% - 36px));background:#7f1d1d;color:#fff;border-radius:17px;padding:16px;box-shadow:0 14px 45px #0006;display:none}.noticeToast.show{display:block}.driverPanel{position:fixed;inset:0;background:#071526ee;z-index:9999;display:none;align-items:center;justify-content:center;padding:16px}.driverPanel.open{display:flex}.driverDialog{width:min(520px,100%);background:#fff;border-radius:24px;padding:22px}.driverDialog label{display:block;font-size:13px;font-weight:850;margin:14px 0 5px}.driverDialog select,.driverDialog textarea{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font:inherit}.driverDialog textarea{min-height:90px}.buspin{position:relative!important;border-radius:50%!important}.buspin:after{content:'';position:absolute;left:50%;top:-11px;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:13px solid #fff}.busdot.selected .buspin:after{border-bottom-color:#fff}.drivingFocus .mapScheduleLayout,.drivingFocus #upcoming,.drivingFocus #team,.drivingFocus .operationsInfo{display:none!important}@media(max-width:760px){.driverGrid{grid-template-columns:1fr 1fr}.affectedTable{display:block;overflow:auto}.driverBtn{flex:1}}`;document.head.appendChild(st);
  const card=document.createElement('section');card.id='driverModeCard';card.className='driverModeCard';card.innerHTML=`<div class="driverTop"><div class="driverBadge" id="driverBadge">● 接続中</div><div class="driverClock" id="driverClock">00:00:00</div></div><div class="driverTitle" id="driverTitle">勤務を確認しています</div><div class="driverRoute" id="driverRoute">--</div><div class="driverGrid"><div class="driverInfo"><span>到着・終了まで</span><b id="driverCountdown">--</b></div><div class="driverInfo"><span>次の担当</span><b id="driverNext">--</b></div><div class="driverInfo"><span>折返し時間</span><b id="driverTurn">--</b></div><div class="driverInfo"><span>現在の遅延</span><b id="driverDelay">0分</b></div></div><div class="driverActions"><button class="driverBtn" id="arrivalBtn">到着を記録</button><button class="driverBtn alert" id="reportBtn">異常・遅延を報告</button><button class="driverBtn secondary" id="focusBtn">運転中表示に集中</button></div><div id="syncState" style="font-size:12px;margin-top:10px">リアルタイム接続を準備中</div>`;
  const operations=document.createElement('section');operations.className='operationsInfo';operations.innerHTML=`<div class="infoHeader"><div><h2 style="margin:0">📢 運行情報</h2><div class="muted">遅延・運航不能・変更後時刻を全端末で共有</div></div><span class="pill run" id="reportCount">0件</span></div><div id="reportsList"></div>`;
  const panel=document.createElement('div');panel.className='driverPanel';panel.id='reportPanel';panel.innerHTML=`<div class="driverDialog"><h2 style="margin-top:0">異常・遅延を報告</h2><label>運行状態</label><select id="incidentMode"><option value="delay">さらなる遅延を追加</option><option value="suspended">運航不能（この便以降を運休）</option></select><div id="delayWrap"><label>追加する遅延時間</label><select id="delayMinutes">${[5,10,15,20,30,45,60,90,120].map(v=>`<option value="${v}">${v}分追加</option>`).join('')}</select></div><label>報告種別</label><select id="reportType"><option>遅延</option><option>交通渋滞</option><option>車両故障</option><option>乗客の急病</option><option>事故</option><option>道路通行止め</option><option>乗客トラブル</option><option>その他</option></select><label>状況メモ</label><textarea id="reportMemo" maxlength="500" placeholder="停車中に入力してください"></textarea><div class="driverActions" style="justify-content:flex-end"><button class="driverBtn" id="closeBtn">キャンセル</button><button class="driverBtn alert" id="saveBtn">全ユーザーへ通報</button></div></div>`;
  const trafficCard=document.createElement('section');trafficCard.className='operationsInfo trafficDemoCard';trafficCard.id='trafficSimulationCard';trafficCard.innerHTML=`<div class="infoHeader"><div><h2 style="margin:0">🚦 交通予測</h2><div class="muted">曜日・祝日・連休・繁忙期・時間帯を基に交通量を予測します。</div></div><button class="driverBtn" id="trafficToggle"></button></div><div id="trafficStatus"></div>`;
  const toast=document.createElement('div');toast.className='noticeToast';toast.id='noticeToast';
  const main=document.querySelector('main.main');if(!main||typeof trips==='undefined'||typeof duty==='undefined')return;main.prepend(operations);main.prepend(trafficCard);main.prepend(card);document.body.append(panel,toast);
  function renderTraffic(){
    const now=japanParts(),profile=trafficProfile(now.sec/60),cal=profile.calendar;
    const current=trips.filter(t=>{const e=effectiveSchedule(t),m=now.sec/60;return!e.suspended&&m>=e.departure&&m<e.arrival});
    const delayed=current.map(t=>({t,d:simulatedDelay(t)})).filter(x=>x.d>0);
    $('trafficToggle').textContent=trafficSimulationEnabled?'交通予測を停止':'交通予測を開始';
    $('trafficToggle').className=trafficSimulationEnabled?'driverBtn alert':'driverBtn';
    $('trafficStatus').innerHTML=trafficSimulationEnabled
      ? `<div style="margin-top:12px"><b>${profile.label}：${profile.level}</b><div class="trafficDemoList">${cal.dayName}／${cal.holidayStage}／${cal.season}<br>現在運行中 ${current.length}便／予測遅延 ${delayed.length}便${delayed.length?'（'+delayed.map(x=>esc(x.t.duty)+'・'+esc(x.t.no)+'便 '+x.d+'分').join('、')+'）':''}</div><div class="trafficDemoWarning">⚠ 自動生成した予測情報です。曜日・カレンダー・時間帯を基に算出しています。</div></div>`
      : '<div style="margin-top:12px"><b>自動交通シミュレーションは停止中です</b></div>';
  }
  function autoTrafficReports(){
    if(!trafficSimulationEnabled)return[];
    const minute=japanParts().sec/60;
    return trips.filter(t=>{
      if(impactForTrip(t))return false;
      const delay=simulatedDelay(t),departure=min(t.time)+delay;
      return delay>0&&minute>=departure&&minute<departure+duration(t.no);
    }).map(t=>{
      const delay=simulatedDelay(t),profile=trafficProfile(min(t.time),t);
      return{id:`auto-${serviceDate()}-${t.duty}-${t.time}-${t.no}`,service_date:serviceDate(),duty:t.duty,origin_trip_no:String(t.no),origin_scheduled_departure:t.time,delay_minutes:delay,incident_mode:'delay',report_type:'交通予測',memo:`${profile.label}・${profile.calendar.dayName}・${profile.calendar.holidayStage}・${profile.calendar.season}${profile.direction?'・'+profile.direction:''}`,affected_trips:calculateAffected(t,delay,'delay'),active:true,is_simulated:true};
    });
  }
  function renderReports(){
    const manual=activeReports().sort((a,b)=>new Date(b.updated_at||b.reported_at)-new Date(a.updated_at||a.reported_at));
    const list=[...manual,...autoTrafficReports()];
    $('reportCount').textContent=`${list.length}件`;
    $('reportsList').innerHTML=list.length?list.map(r=>{
      const suspended=r.incident_mode==='suspended',simulated=!!r.is_simulated,owned=!simulated&&ownedIds.includes(r.id);
      return `<article class="reportCard ${suspended?'suspended':''}" style="${simulated?'border-left-color:#f59e0b;background:#fffbeb':''}"><div class="infoHeader"><div><b>${esc(r.duty)}・${esc(r.origin_trip_no)}便　${suspended?'運航不能':r.delay_minutes+'分遅れ'}${simulated?'　<span style="color:#b45309">［交通予測］</span>':''}</b><div class="reportMeta">${esc(r.report_type)}${r.actual_arrival?'／実績到着 '+esc(r.actual_arrival):''}${r.memo?'／'+esc(r.memo):''}${simulated?'／カレンダー・時間帯ベース':'　最終更新 '+new Date(r.updated_at||r.reported_at).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})}</div></div>${owned?`<button class="cancelReportBtn" data-id="${r.id}">この通報を取り消す</button>`:''}</div><table class="affectedTable"><thead><tr><th>便</th><th>区間</th><th>元の時刻</th><th>変更後</th><th>予想</th></tr></thead><tbody>${(r.affected_trips||[]).map(x=>`<tr><td>${esc(x.no)}便</td><td>${esc(x.from)} → ${esc(x.to)}</td><td class="oldTime">${x.old_departure} → ${x.old_arrival}</td><td class="${x.recovered?'recovered':'newTime'}">${x.new_departure} → ${x.new_arrival}</td><td class="${x.recovered?'recovered':'newTime'}">${x.suspended?'運休':x.recovered?'ここから定刻復帰':x.delay_minutes+'分遅れ'}</td></tr>`).join('')}</tbody></table></article>`;
    }).join(''):'<div class="muted" style="padding:22px 0">現在、有効な運行情報はありません。</div>';
    document.querySelectorAll('.cancelReportBtn').forEach(b=>b.onclick=()=>cancelReport(b.dataset.id));
  }
  function notify(r){toast.innerHTML=`<b>運行情報が更新されました</b><div style="margin-top:5px">${esc(r.duty)}・${esc(r.origin_trip_no)}便　${r.incident_mode==='suspended'?'運航不能':r.delay_minutes+'分遅れ'}</div>`;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),9000)}
  async function loadReports(){restore();renderReports();if(!SB){$('syncState').textContent='Supabase設定を確認してください';return}const{data,error}=await SB.from('delay_reports').select('id,service_date,duty,origin_trip_no,origin_scheduled_departure,delay_minutes,incident_mode,report_type,memo,affected_trips,active,reported_at,updated_at,cancelled_at,cancellation_reason,actual_arrival,arrival_recorded_at').eq('service_date',serviceDate()).eq('active',true).order('reported_at',{ascending:false});if(error){$('syncState').textContent=`同期エラー: ${error.message}`;return}reports=data||[];cache();renderReports();$('syncState').textContent='● 全端末リアルタイム同期中';channel=SB.channel('delay-live-v3').on('postgres_changes',{event:'*',schema:'public',table:'delay_reports',filter:`service_date=eq.${serviceDate()}`},p=>{const x=p.new;if(p.eventType==='DELETE')reports=reports.filter(r=>r.id!==p.old.id);else reports=[x,...reports.filter(r=>r.id!==x.id)];cache();renderReports();if(p.eventType==='INSERT'||p.eventType==='UPDATE')notify(x)}).subscribe()}
  async function cancelReport(id){if(!confirm('この遅延・運休通報を取り消しますか？全ユーザーの表示から消えます。'))return;const{data,error}=await SB.rpc('cancel_bus_report',{p_report_id:id,p_reporter_token:reporterToken,p_reason:'報告者による取消'});if(error){alert(`取消に失敗しました: ${error.message}`);return}reports=reports.filter(r=>r.id!==id);ownedIds=ownedIds.filter(x=>x!==id);saveOwned();cache();renderReports();alert('通報を取り消しました。')}
  function renderDriver(){const now=japanParts(),snap=snapshot(now.sec);currentSnapshot=snap;card.className=`driverModeCard mode-${snap.mode}`;$('driverClock').textContent=`${pad(now.h)}:${pad(now.m)}:${pad(now.s)}`;$('arrivalBtn').style.display=snap.mode==='driving'?'':'none';let title,route,count='--:--:--',next='なし',turn='--',delay=0;if(snap.mode==='suspended'){title='運航不能';route=`${snap.running.no}便以降は運休扱いです`;$('driverBadge').textContent='● 運航停止'}else if(snap.mode==='driving'){const e=effectiveSchedule(snap.running);delay=e.departure-min(snap.running.time);title=`${snap.running.no}便を運行中`;route=`${snap.running.from} → ${snap.running.to}`;count=fmtDuration(e.arrival*60-now.sec);$('driverBadge').textContent='● 運転中';if(snap.next){const ne=effectiveSchedule(snap.next);next=`${snap.next.no}便 ${fmtMinute(ne.departure)}発`;turn=`${Math.floor(ne.departure-e.arrival)}分`}}else if(snap.mode==='before'){title='勤務開始前';route=`最初は ${snap.next.no}便 ${snap.next.from} → ${snap.next.to}`;count=fmtDuration(effectiveSchedule(snap.next).departure*60-now.sec);next=`${snap.next.no}便 ${fmtMinute(effectiveSchedule(snap.next).departure)}発`;$('driverBadge').textContent='● 勤務前'}else if(snap.mode==='standby'||snap.mode==='break'){title=snap.mode==='break'?'休憩中':'待機中';route=snap.next?`次は ${snap.next.no}便 ${snap.next.from} → ${snap.next.to}`:'次の指示を確認';count=fmtDuration(snap.end*60-now.sec);next=snap.next?`${snap.next.no}便 ${fmtMinute(snap.end)}発`:'なし';$('driverBadge').textContent=snap.mode==='break'?'● 休憩中':'● 待機中'}else{title='本日の勤務終了';route='乗務後点呼・忘れ物・車両状態を確認してください';$('driverBadge').textContent='● 勤務終了'}$('driverTitle').textContent=title;$('driverRoute').textContent=route;$('driverCountdown').textContent=count;$('driverNext').textContent=next;$('driverTurn').textContent=turn;$('driverDelay').textContent=`${delay}分`;decoratePins()}
  function decoratePins(){
    const pts={'空港':[50,50],'各ホテル':[15,19],'ホテル日航':[85,20],'ホテルエクシブ':[50,87]},now=japanParts().sec/60;
    document.querySelectorAll('.busdot').forEach(dot=>{
      const label=dot.querySelector('.busname')?.textContent||'',m=label.match(/^(.*?)・(\d+)便/);
      if(!m)return;
      const t=trips.find(x=>x.duty===m[1]&&String(x.no)===m[2]&&effectiveSchedule(x).departure<=now&&effectiveSchedule(x).arrival>now);
      if(!t)return;
      const e=effectiveSchedule(t),a=pts[t.from],b=pts[t.to];if(!a||!b)return;
      const deg=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI+90,delay=Math.max(0,e.departure-min(t.time));
      const pin=dot.querySelector('.buspin');if(pin){pin.style.transform=`rotate(${deg}deg)`;pin.setAttribute('aria-label',`${t.to}方面へ進行中`)}
      dot.classList.add('mapBusActive');dot.classList.toggle('mapBusDelayed',delay>0);dot.classList.toggle('mapBusSevere',delay>=10);
      let badge=dot.querySelector('.mapDirectionBadge');if(!badge){badge=document.createElement('div');badge.className='mapDirectionBadge';dot.appendChild(badge)}
      badge.innerHTML=`<b>${esc(t.no)}便</b><span>${esc(t.to)}方面</span>${delay?`<em>${delay}分遅れ</em>`:'<em class="onTime">定刻</em>'}`;
      badge.title=`${t.duty}・${t.no}便 ${t.from}から${t.to}へ進行中`;
    });
  }
  $('incidentMode').onchange=()=>{$('delayWrap').style.display=$('incidentMode').value==='suspended'?'none':''};$('reportBtn').onclick=()=>{if(!currentSnapshot?.running){alert('通報は運行中の便があるときに行ってください。');return}$('reportPanel').classList.add('open')};$('closeBtn').onclick=()=>$('reportPanel').classList.remove('open');$('saveBtn').onclick=async()=>{const origin=currentSnapshot?.running;if(!origin)return;const mode=$('incidentMode').value,extra=mode==='delay'?+$('delayMinutes').value:0,old=reportForTrip(origin),ownedOld=old&&ownedIds.includes(old.id),total=mode==='suspended'?0:(ownedOld?old.delay_minutes:0)+extra,affected=calculateAffected(origin,total,mode);if(old&&!ownedOld){alert('同じ便に他端末からの通報があります。取り消し・追加は通報した端末から行ってください。');return}const args={p_report_id:ownedOld?old.id:null,p_reporter_token:reporterToken,p_service_date:serviceDate(),p_duty:origin.duty,p_origin_trip_no:String(origin.no),p_origin_scheduled_departure:origin.time,p_additional_delay:extra,p_incident_mode:mode,p_report_type:$('reportType').value,p_memo:$('reportMemo').value.trim(),p_affected_trips:affected};$('saveBtn').disabled=true;const{data,error}=await SB.rpc('submit_bus_report',args);$('saveBtn').disabled=false;if(error){alert(`通報に失敗しました: ${error.message}`);return}if(!ownedIds.includes(data.id))ownedIds.push(data.id);saveOwned();reports=[data,...reports.filter(r=>r.id!==data.id)];cache();renderReports();$('reportPanel').classList.remove('open');$('reportMemo').value='';alert(mode==='suspended'?'運航不能を全ユーザーへ通知しました。':`追加${extra}分を合算し、合計${data.delay_minutes}分遅れとして通知しました。`)};$('trafficToggle').onclick=()=>{trafficSimulationEnabled=!trafficSimulationEnabled;try{localStorage.setItem(TRAFFIC_SIM_KEY,String(trafficSimulationEnabled))}catch{}renderTraffic();renderDriver();renderReports();};
  $('arrivalBtn').onclick=async()=>{
    const origin=currentSnapshot?.running;if(!origin)return;
    if(!confirm(`${origin.no}便の到着を現在の日本時刻で記録しますか？\n次便は、定刻・連続便・通常待機・規定休憩のルールで再計算されます。`))return;
    if(!SB){alert('Supabaseに接続できません。');return;}
    const now=japanParts(),actualMinute=(now.h<3?now.h+24:now.h)*60+now.m;
    const scheduledArrival=min(origin.time)+duration(origin.no),arrivalDelay=Math.max(0,actualMinute-scheduledArrival);
    const affected=calculateFromArrival(origin,actualMinute),old=reportForTrip(origin);
    if(old&&!ownedIds.includes(old.id)){alert('この便には別端末からの通報があります。通報した端末、または運行管理者から到着を確定してください。');return;}
    $('arrivalBtn').disabled=true;
    const{data,error}=await SB.rpc('record_bus_arrival', {p_report_id:old?.id||null,p_reporter_token:reporterToken,p_service_date:serviceDate(),p_duty:origin.duty,p_origin_trip_no:String(origin.no),p_origin_scheduled_departure:origin.time,p_actual_arrival:fmtMinute(actualMinute),p_delay_minutes:arrivalDelay,p_affected_trips:affected});
    $('arrivalBtn').disabled=false;
    if(error){alert(`到着記録に失敗しました: ${error.message}`);return;}
    if(!ownedIds.includes(data.id))ownedIds.push(data.id);saveOwned();reports=[data,...reports.filter(r=>r.id!==data.id)];cache();renderReports();
    const next=affected[1];
    alert(next?`到着を全端末へ記録しました。\n次の${next.no}便は ${next.new_departure}発、${next.new_arrival}着見込みです。`:'到着を全端末へ記録しました。本日の担当便は終了です。');
  };$('focusBtn').onclick=()=>{focusMode=!focusMode;document.body.classList.toggle('drivingFocus',focusMode);$('focusBtn').textContent=focusMode?'詳細画面へ戻る':'運転中表示に集中'};
  restore();renderReports();renderTraffic();renderDriver();loadReports();setInterval(()=>{renderDriver();renderTraffic();renderReports()},1000);window.addEventListener('beforeunload',()=>{if(channel&&SB)SB.removeChannel(channel)});
})();
