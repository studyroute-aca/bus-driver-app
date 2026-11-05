(() => {
  if (document.getElementById('operationsAdminPortalCard')) return;
  const grid = document.querySelector('.grid');
  if (!grid) return;
  const card = document.createElement('a');
  card.id = 'operationsAdminPortalCard';
  card.className = 'card';
  card.href = 'operations-admin.html';
  card.innerHTML = '<div class="icon" style="background:#dbe5ee">管</div><h2>運行管理者コンソール</h2><p>遅延便の監視、予備便の出庫・引上げ判断、欠航判断、便別パフォーマンスを管理します。</p><div class="open">運行管理者画面を開く →</div>';
  grid.appendChild(card);
})();
