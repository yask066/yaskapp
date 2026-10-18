export function createArchivePanel({ document, request, can, handleError, confirm, requestReason }) {
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const date = (value) => value ? new Date(value).toLocaleString() : 'Unknown';
  let generation = 0;
  let archiveCursor = null;
  let banCursor = null;
  let detailVersion = 0;
  let listVersion = 0;
  let expiryTimer;
  const timers = document.defaultView;

  function reset() {
    generation++;
    detailVersion++;
    listVersion++;
    archiveCursor = banCursor = null;
    timers.clearTimeout(expiryTimer);
    for (const id of ['archive-list', 'archive-detail', 'ip-ban-list']) $(id).replaceChildren();
    $('archive-search').value = '';
    $('archive-load-more').hidden = $('ip-bans-load-more').hidden = true;
  }

  function renderEvidence(evidence = {}) {
    const cases = (evidence.cases || []).map((item) => `<details open class="note"><summary>Case ${escape(item.id)} · ${escape(item.status)}</summary>
      <p>${escape(item.priority)} · ${escape(item.targetType)} · ${escape(date(item.createdAt))}</p>
      ${item.content ? `<p class="archive-text">${escape(item.content.question || item.content.body)}${item.content.description ? `\n${escape(item.content.description)}` : ''}</p>` : ''}
      ${item.resolutionNote ? `<p>Resolution: ${escape(item.resolutionNote)}</p>` : ''}
      ${(item.reports || []).map((report) => `<p class="archive-text"><strong>${escape(report.category)}</strong>: ${escape(report.description)}</p>`).join('')}
      ${(item.notes || []).map((note) => `<p class="archive-text">Note: ${escape(note.body)}</p>`).join('')}
      </details>`).join('');
    const sanctions = (evidence.sanctions || []).map((item) => `<article class="note"><strong>${escape(item.type)} · ${escape(item.status)}</strong><p class="archive-text">${escape(item.reason)}</p><small>${escape(date(item.createdAt))}</small></article>`).join('');
    const appeals = (evidence.appeals || []).map((item) => `<article class="note"><strong>Appeal · ${escape(item.status)}</strong><p class="archive-text">${escape(item.reason)}</p><p class="archive-text">${escape(item.decisionNote)}</p></article>`).join('');
    return cases + sanctions + appeals || '<p class="muted">No moderation records at deletion.</p>';
  }

  async function openArchive(userId) {
    if (!can('admin.deleted_accounts.read')) return;
    const session = generation;
    const version = ++detailVersion;
    timers.clearTimeout(expiryTimer);
    $('archive-detail').textContent = 'Loading archive…';
    try {
      const { account } = await request(`/admin/deleted-accounts/${encodeURIComponent(userId)}`, { cache: 'no-store' });
      if (session !== generation || version !== detailVersion) return;
      const profile = account.profile || {};
      $('archive-detail').innerHTML = `<h3>${escape(profile.displayName || profile.username)}</h3>
        <p>@${escape(profile.username)} · ${escape(profile.email)}</p><p class="muted">User ID: ${escape(account.userId)}</p>
        <p>Deleted: ${escape(date(account.deletedAt))}<br>Archive expires: ${escape(date(account.expiresAt))}</p>
        ${profile.bio ? `<p class="archive-text">${escape(profile.bio)}</p>` : ''}
        <h4>Recent IP addresses</h4><p class="muted">An address may be shared by other people. Confirm the evidence before blocking it.</p>
        ${(account.ips || []).map((item) => `<article class="note"><strong>${escape(item.ip)}</strong><small>Last recorded: ${escape(date(item.lastSeenAt))}</small>
          ${can('admin.ip_bans.manage') ? `<button type="button" class="danger" data-ban-ip="${escape(item.ip)}">Block this IP</button>` : ''}</article>`).join('') || '<p class="muted">No IP history was recorded.</p>'}
        <h4>Moderation evidence at deletion</h4>${renderEvidence(account.evidence)}`;
      function checkExpiry() {
        if (session !== generation || version !== detailVersion) return;
        const remaining = new Date(account.expiresAt).getTime() - Date.now();
        if (remaining <= 0) {
          $('archive-detail').textContent = 'This archive has expired.';
          void loadArchives();
        } else expiryTimer = timers.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
      }
      checkExpiry();
      $('archive-detail').querySelectorAll('[data-ban-ip]').forEach((button) => {
        button.onclick = async () => {
          if (!confirm(`Block ${button.dataset.banIp}? This may also affect people using the same network.`)) return;
          const reason = requestReason('Block IP address');
          if (!reason) return;
          button.disabled = true;
          try {
            await request(`/admin/deleted-accounts/${encodeURIComponent(account.userId)}/ip-bans`, {
              method: 'POST', body: JSON.stringify({ ip: button.dataset.banIp, reason })
            });
            if (session === generation && version === detailVersion) button.textContent = 'IP blocked';
          } catch (error) {
            if (session === generation) {
              if (error.status === 404) $('archive-detail').textContent = 'This archive has expired or is unavailable.';
              handleError(error);
              button.disabled = false;
            }
          }
        };
      });
    } catch (error) {
      if (session !== generation || version !== detailVersion) return;
      $('archive-detail').textContent = 'This archive has expired or is unavailable.';
      handleError(error);
    }
  }

  async function loadArchives(append = false) {
    if (!can('admin.deleted_accounts.read')) return;
    const session = generation;
    const version = ++listVersion;
    const params = new URLSearchParams({ limit: '30' });
    if ($('archive-search').value.trim()) params.set('query', $('archive-search').value.trim());
    if (append && archiveCursor) params.set('cursor', archiveCursor);
    try {
      const result = await request(`/admin/deleted-accounts?${params}`, { cache: 'no-store' });
      if (session !== generation || version !== listVersion) return;
      if (!append) $('archive-list').replaceChildren();
      archiveCursor = result.nextCursor;
      for (const item of result.items || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'case-row';
        button.innerHTML = `<strong>@${escape(item.profile.username)}</strong><span>${escape(item.profile.email)}</span><small>Expires ${escape(date(item.expiresAt))}</small>`;
        button.onclick = () => { void openArchive(item.userId); };
        $('archive-list').append(button);
      }
      if (!$('archive-list').children.length) $('archive-list').textContent = 'No unexpired archives found.';
      $('archive-load-more').hidden = !archiveCursor;
    } catch (error) { if (session === generation) handleError(error); }
  }

  async function loadBans(append = false) {
    if (!can('admin.ip_bans.manage')) return;
    const session = generation;
    try {
      const result = await request(`/admin/ip-bans?limit=30${append && banCursor ? `&cursor=${encodeURIComponent(banCursor)}` : ''}`, { cache: 'no-store' });
      if (session !== generation) return;
      if (!append) $('ip-ban-list').replaceChildren();
      banCursor = result.nextCursor;
      for (const ban of result.items || []) {
        const article = document.createElement('article');
        article.className = 'note';
        article.innerHTML = `<strong>${escape(ban.ip)}</strong><p class="archive-text">${escape(ban.reason)}</p><small>${escape(date(ban.createdAt))}</small><button type="button" class="secondary">Revoke IP ban</button>`;
        article.querySelector('button').onclick = async (event) => {
          const reason = requestReason('Revoke IP ban');
          if (!reason) return;
          event.target.disabled = true;
          try {
            await request(`/admin/ip-bans/${encodeURIComponent(ban.id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
            if (session === generation) await loadBans();
          } catch (error) { if (session === generation) { event.target.disabled = false; handleError(error); } }
        };
        $('ip-ban-list').append(article);
      }
      if (!$('ip-ban-list').children.length) $('ip-ban-list').textContent = 'No active IP bans.';
      $('ip-bans-load-more').hidden = !banCursor;
    } catch (error) { if (session === generation) handleError(error); }
  }

  $('refresh-archive').onclick = () => { void loadArchives(); };
  $('archive-load-more').onclick = () => { void loadArchives(true); };
  $('archive-search-form').onsubmit = (event) => { event.preventDefault(); void loadArchives(); };
  $('refresh-ip-bans').onclick = () => { void loadBans(); };
  $('ip-bans-load-more').onclick = () => { void loadBans(true); };
  return { loadArchives, loadBans, reset };
}
