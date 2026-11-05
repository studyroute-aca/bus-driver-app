(() => {
  'use strict';
  // OPERATIONS AUTO CLEAR V1
  // 運行情報カードの全影響便が定刻復帰したら、運行情報セクションから自動で非表示にする。

  const HIDDEN_CLASS = 'ops-auto-recovered-hidden';

  function isRecoveredCard(card) {
    if (!card || card.classList.contains('suspended')) return false;

    const predictionCells = [...card.querySelectorAll('.affectedTable tbody tr td:last-child')]
      .map(td => td.textContent.trim())
      .filter(Boolean);

    if (!predictionCells.length) return false;

    const hasActiveProblem = predictionCells.some(text =>
      /\d+分遅れ|運休|運航不能/.test(text)
    );
    if (hasActiveProblem) return false;

    return predictionCells.every(text =>
      /定刻復帰|ここから定刻復帰|定刻/.test(text)
    );
  }

  function refreshOperationsInfo() {
    const list = document.getElementById('reportsList');
    const count = document.getElementById('reportCount');
    if (!list || !count) return;

    const cards = [...list.querySelectorAll('.reportCard')];
    cards.forEach(card => {
      card.classList.toggle(HIDDEN_CLASS, isRecoveredCard(card));
    });

    const visibleCards = cards.filter(card => !card.classList.contains(HIDDEN_CLASS));
    count.textContent = `${visibleCards.length}件`;

    let empty = list.querySelector('.ops-auto-clear-empty');
    if (!visibleCards.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'muted ops-auto-clear-empty';
        empty.style.padding = '22px 0';
        empty.textContent = '現在、有効な遅延・運休情報はありません。';
        list.appendChild(empty);
      }
    } else if (empty) {
      empty.remove();
    }
  }

  const style = document.createElement('style');
  style.textContent = `.${HIDDEN_CLASS}{display:none!important}`;
  document.head.appendChild(style);

  function start() {
    refreshOperationsInfo();
    const root = document.getElementById('reportsList') || document.body;
    const observer = new MutationObserver(() => refreshOperationsInfo());
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    setInterval(refreshOperationsInfo, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
