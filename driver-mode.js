(() => {
  "use strict";

  const DRIVER_STORAGE_KEY = "busDriverModeV1";
  const safeStore = {
    read() {
      try { return JSON.parse(localStorage.getItem(DRIVER_STORAGE_KEY) || "{}"); }
      catch { return {}; }
    },
    write(value) {
      try { localStorage.setItem(DRIVER_STORAGE_KEY, JSON.stringify(value)); }
      catch { /* storage unavailable: current session still works */ }
    }
  };

  let driverData = safeStore.read();

  const style = document.createElement("style");
  style.textContent = `
    .driverModeCard{position:relative;overflow:hidden;border-radius:26px;padding:22px;margin-bottom:14px;color:#fff;background:#0f766e;box-shadow:0 8px 24px #0f172a30}
    .driverModeCard.mode-driving{background:linear-gradient(135deg,#075985,#0ea5e9)}
    .driverModeCard.mode-standby{background:linear-gradient(135deg,#92400e,#f59e0b)}
    .driverModeCard.mode-break{background:linear-gradient(135deg,#166534,#22c55e)}
    .driverModeCard.mode-before{background:linear-gradient(135deg,#334155,#64748b)}
    .driverModeCard.mode-finished{background:linear-gradient(135deg,#312e81,#6366f1)}
    .driverModeTop{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .driverModeBadge{display:inline-flex;align-items:center;gap:7px;background:#ffffff25;border:1px solid #ffffff45;padding:7px 11px;border-radius:999px;font-size:13px;font-weight:900}
    .driverModeClock{font:900 24px ui-monospace,monospace}
    .driverModeTitle{font-size:clamp(30px,5vw,50px);font-weight:950;line-height:1.1;margin:17px 0 7px}
    .driverModeRoute{font-size:clamp(17px,2.3vw,24px);font-weight:850}
    .driverModeGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:18px}
    .driverModeInfo{background:#ffffff18;border:1px solid #ffffff2b;border-radius:15px;padding:12px}
    .driverModeInfo span{display:block;font-size:11px;opacity:.78;font-weight:800}
    .driverModeInfo b{display:block;margin-top:5px;font-size:17px}
    .driverModeActions{display:flex;gap:9px;flex-wrap:wrap;margin-top:17px}
    .driverModeButton{border:0;border-radius:14px;padding:14px 18px;font-size:15px;font-weight:900;cursor:pointer;background:#fff;color:#123}
    .driverModeButton.alert{background:#fee2e2;color:#991b1b}
    .driverModeButton.secondary{background:#ffffff25;color:#fff;border:1px solid #ffffff55}
    .driverModeWarning{margin-top:12px;padding:10px 12px;background:#7f1d1d;color:#fff;border-radius:12px;font-weight:900;display:none}
    .driverPanel{position:fixed;inset:0;background:#071526ee;z-index:9999;display:none;align-items:center;justify-content:center;padding:16px}
    .driverPanel.open{display:flex}
    .driverDialog{width:min(520px,100%);background:#fff;color:#172033;border-radius:24px;padding:22px;box-shadow:0 20px 60px #0008}
    .driverDialog h2{margin:0 0 8px}.driverDialog label{display:block;font-size:13px;font-weight:850;margin:14px 0 5px}
    .driverDialog select,.driverDialog textarea{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font:inherit}
    .driverDialog textarea{min-height:92px;resize:vertical}
    .driverDialogActions{display:flex;justify-content:flex-end;gap:9px;margin-top:16px}
    .drivingFocus .mapScheduleLayout,.drivingFocus #upcoming,.drivingFocus #team{display:none!important}
    @media(max-width:760px){.driverModeGrid{grid-template-columns:1fr 1fr}.driverModeButton{flex:1;min-width:140px}.driverModeCard{border-radius:20px}.driverModeTitle{font-size:34px}}
  `;
  document.head.appendChild(style);

  const card = document.createElement("section");
  card.id = "driverModeCard";
  card.className = "driverModeCard mode-before";
  card.innerHTML = `
    <div class="driverModeTop">
      <div class="driverModeBadge" id="driverModeBadge">● 勤務前</div>
      <div class="driverModeClock" id="driverModeClock">00:00:00</div>
    </div>
    <div class="driverModeTitle" id="driverModeTitle">勤務を確認しています</div>
    <div class="driverModeRoute" id="driverModeRoute">選択した勤務区分を確認してください</div>
    <div class="driverModeGrid">
      <div class="driverModeInfo"><span>到着・終了まで</span><b id="driverModeCountdown">--:--:--</b></div>
      <div class="driverModeInfo"><span>次の担当</span><b id="driverModeNext">--</b></div>
      <div class="driverModeInfo"><span>折返し時間</span><b id="driverModeTurn">--</b></div>
      <div class="driverModeInfo"><span>遅延</span><b id="driverModeDelay">0分</b></div>
    </div>
    <div class="driverModeWarning" id="driverModeWarning"></div>
    <div class="driverModeActions">
      <button class="driverModeButton" id="arrivalButton" type="button">到着を記録</button>
      <button class="driverModeButton alert" id="reportButton" type="button">異常・遅延を報告</button>
      <button class="driverModeButton secondary" id="focusButton" type="button">運転中表示に集中</button>
    </div>
  `;

  const main = document.querySelector("main.main");
  if (!main || typeof trips === "undefined") return;
  main.prepend(card);

  const panel = document.createElement("div");
  panel.id = "driverReportPanel";
  panel.className = "driverPanel";
  panel.innerHTML = `
    <div class="driverDialog" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
      <h2 id="reportTitle">異常・遅延を報告</h2>
      <label for="delayMinutes">遅延時間</label>
      <select id="delayMinutes">
        ${[0,5,10,15,20,30,45,60].map(v => `<option value="${v}">${v}分</option>`).join("")}
      </select>
      <label for="reportType">報告種別</label>
      <select id="reportType">
        <option>遅延</option><option>交通渋滞</option><option>車両故障</option>
        <option>乗客の急病</option><option>事故</option><option>道路通行止め</option>
        <option>忘れ物</option><option>乗客トラブル</option><option>その他</option>
      </select>
      <label for="reportMemo">状況メモ</label>
      <textarea id="reportMemo" placeholder="停車中に入力してください"></textarea>
      <div class="driverDialogActions">
        <button class="driverModeButton secondary" style="color:#334155;border-color:#cbd5e1" id="cancelReport" type="button">キャンセル</button>
        <button class="driverModeButton alert" id="saveReport" type="button">端末に記録</button>
      </div>
    </div>`;
  document.body.appendChild(panel);

  const el = id => document.getElementById(id);
  let focusMode = false;
  let currentSnapshot = null;

  function japanNow() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date());
    const get = type => Number(parts.find(x => x.type === type)?.value || 0);
    const h = get("hour"), m = get("minute"), s = get("second");
    return {h,m,s,sec:(h < 3 ? h + 24 : h) * 3600 + m * 60 + s};
  }

  function tripKey(t) { return `${duty}|${t.time}|${t.no}`; }
  function nextTripFor(list, sec) { return list.find(t => min(t.time) * 60 > sec); }
  function arrivalSec(t) { return (min(t.time) + duration(t.no)) * 60; }

  function snapshot(sec) {
    const tl = buildTimeline(duty);
    const list = tl.list;
    const running = list.find(t => sec >= min(t.time)*60 && sec < arrivalSec(t));
    const activity = tl.items.find(x => sec/60 >= x.start && sec/60 < x.end);
    const next = nextTripFor(list, sec);
    if (!list.length) return {mode:"finished", list, next:null};
    if (sec < min(list[0].time)*60) return {mode:"before", list, next:list[0]};
    if (running) return {mode:"driving", list, running, next};
    if (activity?.type === "break") return {mode:"break", list, activity, next};
    if (activity?.type === "standby") return {mode:"standby", list, activity, next};
    return {mode:"finished", list, next:null};
  }

  function renderDriverMode() {
    const now = japanNow();
    const snap = snapshot(now.sec);
    currentSnapshot = snap;
    const delay = Number(driverData.delay || 0);
    const classes = {driving:"mode-driving",standby:"mode-standby",break:"mode-break",before:"mode-before",finished:"mode-finished"};
    card.className = `driverModeCard ${classes[snap.mode]}`;
    el("driverModeClock").textContent = [now.h,now.m,now.s].map(x=>String(x).padStart(2,"0")).join(":");
    el("driverModeDelay").textContent = `${delay}分`;
    el("arrivalButton").style.display = snap.mode === "driving" ? "inline-block" : "none";

    let title, route, countdown = "--:--:--", nextText = "なし", turnText = "--";
    if (snap.mode === "driving") {
      const t = snap.running;
      const end = arrivalSec(t) + delay*60;
      title = `${t.no}便を運行中`;
      route = `${t.from} → ${t.to}`;
      countdown = fmt(end-now.sec);
      if (snap.next) {
        nextText = `${snap.next.no}便 ${snap.next.time}発`;
        const turn = min(snap.next.time)*60 - end;
        turnText = `${Math.floor(turn/60)}分`;
        const warning = el("driverModeWarning");
        if (turn < 0) { warning.style.display="block"; warning.textContent=`次便に${Math.ceil(-turn/60)}分間に合わない見込みです。運行管理者へ連絡してください。`; }
        else if (turn < 300) { warning.style.display="block"; warning.textContent=`折返し時間が${Math.floor(turn/60)}分です。安全を優先し、必要なら遅延報告してください。`; }
        else warning.style.display="none";
      }
      el("driverModeBadge").textContent = "● 運転中";
    } else if (snap.mode === "standby" || snap.mode === "break") {
      const isBreak = snap.mode === "break";
      title = isBreak ? "休憩中" : "待機中";
      route = snap.next ? `次は ${snap.next.no}便　${snap.next.from} → ${snap.next.to}` : "次の指示を確認してください";
      countdown = fmt(snap.activity.end*60-now.sec);
      nextText = snap.next ? `${snap.next.no}便 ${snap.next.time}発` : "なし";
      turnText = snap.next ? `${Math.max(0,Math.floor((min(snap.next.time)*60-now.sec)/60))}分` : "--";
      el("driverModeBadge").textContent = isBreak ? "● 休憩中" : "● 待機中";
      el("driverModeWarning").style.display = "none";
    } else if (snap.mode === "before") {
      title = "勤務開始前";
      route = `最初は ${snap.next.no}便　${snap.next.from} → ${snap.next.to}`;
      countdown = fmt(min(snap.next.time)*60-now.sec);
      nextText = `${snap.next.no}便 ${snap.next.time}発`;
      el("driverModeBadge").textContent = "● 勤務前";
      el("driverModeWarning").style.display = "none";
    } else {
      title = "本日の勤務終了";
      route = "乗務後点呼・忘れ物・車両状態を確認してください";
      el("driverModeBadge").textContent = "● 勤務終了";
      el("driverModeWarning").style.display = "none";
    }
    el("driverModeTitle").textContent = title;
    el("driverModeRoute").textContent = route;
    el("driverModeCountdown").textContent = countdown;
    el("driverModeNext").textContent = nextText;
    el("driverModeTurn").textContent = turnText;
  }

  el("arrivalButton").addEventListener("click", () => {
    if (!currentSnapshot?.running) return;
    if (!confirm(`${currentSnapshot.running.no}便の到着を記録しますか？\n安全な場所に停車してから操作してください。`)) return;
    const now = new Date();
    const key = tripKey(currentSnapshot.running);
    driverData.arrivals = driverData.arrivals || {};
    driverData.arrivals[key] = now.toISOString();
    safeStore.write(driverData);
    alert("到着時刻をこの端末に記録しました。運行管理者への送信機能は未接続です。");
  });

  el("reportButton").addEventListener("click", () => {
    el("delayMinutes").value = String(driverData.delay || 0);
    panel.classList.add("open");
  });
  el("cancelReport").addEventListener("click", () => panel.classList.remove("open"));
  el("saveReport").addEventListener("click", () => {
    driverData.delay = Number(el("delayMinutes").value || 0);
    driverData.reports = driverData.reports || [];
    driverData.reports.push({
      at:new Date().toISOString(), duty,
      trip:currentSnapshot?.running?.no || null,
      type:el("reportType").value,
      memo:el("reportMemo").value.trim(),
      delay:driverData.delay
    });
    safeStore.write(driverData);
    panel.classList.remove("open");
    renderDriverMode();
    alert("報告をこの端末に記録しました。現在は運行管理者へ自動送信されません。");
  });
  el("focusButton").addEventListener("click", () => {
    focusMode = !focusMode;
    document.body.classList.toggle("drivingFocus", focusMode);
    el("focusButton").textContent = focusMode ? "詳細画面へ戻る" : "運転中表示に集中";
  });

  renderDriverMode();
  setInterval(renderDriverMode, 1000);
})();
