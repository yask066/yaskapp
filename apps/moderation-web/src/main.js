const apiBase = window.__MODERATION_API_BASE__ || '';
let accessToken = null;
let currentUserId = null;
let capabilities = new Set();
let nextCursor = null;
let appealsCursor = null;
let auditCursor = null;
let selectedCaseId = null;
let activeSection = 'cases';

const $ = (id) => document.getElementById(id);
const loginView = $('login-view');
const panelView = $('panel-view');

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(options.headers || {}) }
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.message || 'Request failed.');
    error.status = response.status;
    error.code = body?.error;
    throw error;
  }
  return body;
}

function showPanel() { loginView.hidden = true; panelView.hidden = false; }
function showLogin(message = '') { panelView.hidden = true; loginView.hidden = false; $('login-error').textContent = message; }
function can(permission) { return capabilities.has(permission); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function idempotencyKey() { return `${crypto.randomUUID()}-${Date.now()}`; }
function shortId(value) { return String(value).replaceAll('-', '').slice(-6).toUpperCase(); }
function targetLabel(targetType) { return `${String(targetType).charAt(0).toUpperCase()}${String(targetType).slice(1)} report`; }
function renderActionBar(item) {
  const sanctionItems = item.targetType === 'user' ? [
    can('moderation.warning.issue') ? '<button id="issue-warning">Warning</button>' : '',
    can('moderation.strike.issue') ? '<button id="issue-strike">Strike</button>' : '',
    can('moderation.restriction.issue') ? '<button id="issue-posting">Restrict posting</button><button id="issue-comment">Restrict comments</button>' : '',
    can('moderation.user.ban') ? '<button id="issue-ban" class="menu-danger">Temporary ban</button>' : '',
    can('moderation.permanent_ban.issue') ? '<button id="issue-permanent-ban" class="menu-danger">Permanent ban</button>' : '',
  ].join('') : '';
  const menuItems = [
    can('moderation.content.delete') && item.targetType !== 'user' ? '<button id="remove-content" class="menu-danger">Remove content</button>' : '',
    can('moderation.case.resolve') ? '<button id="escalate-case" class="menu-warning">Escalate</button>' : '',
    can('moderation.case.assign') ? '<button id="assign-case">Assign to me</button><button id="takeover-case">Take over</button>' : '',
    sanctionItems,
    '<button id="copy-case-id-menu">Copy case ID</button>',
  ].join('');
  return `<div class="action-bar">${can('moderation.case.resolve') ? '<button id="resolve-case" class="primary action-button">✓&nbsp; Resolve</button>' : ''}${can('moderation.case.resolve') ? '<button id="dismiss-case" class="ghost action-button">⊗&nbsp; Dismiss</button>' : ''}<div class="more-actions"><button id="more-actions-toggle" class="ghost action-button" aria-expanded="false" aria-controls="more-actions-menu">•••&nbsp; More actions</button><div id="more-actions-menu" class="more-actions-menu" hidden>${menuItems || '<span class="muted">No additional actions.</span>'}</div></div></div>`;
}

function showSection(section) {
  activeSection = section;
  document.querySelectorAll('.panel-section').forEach((panel) => { panel.hidden = panel.id !== `section-${section}`; });
  document.querySelectorAll('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.section === section));
  if (section === 'appeals') loadAppeals();
  if (section === 'audit') loadAudit();
  if (section === 'policy') loadPolicy();
}

function configureNavigation() {
  document.querySelectorAll('.nav-tab[data-permission]').forEach((tab) => {
    tab.hidden = !can(tab.dataset.permission);
  });
  document.querySelectorAll('.nav-tab').forEach((tab) => tab.onclick = () => showSection(tab.dataset.section));
}

async function signIn(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  $('login-error').textContent = '';
  try {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify({ login: form.get('login'), password: form.get('password') }) });
    accessToken = result.accessToken;
    const currentUser = await request('/auth/me');
    currentUserId = currentUser.user?.id || null;
    const capabilityResult = await request('/moderation/capabilities');
    capabilities = new Set(capabilityResult.permissions || []);
    if (!can('moderation.queue.read')) throw new Error('This account is not authorized for moderation.');
    configureNavigation();
    showPanel();
    await loadQueue();
    await loadAppeals();
  } catch (error) { accessToken = null; currentUserId = null; capabilities.clear(); showLogin(error.status === 403 ? 'This account is not authorized for moderation.' : error.message); }
}

function queryString(cursor = null) {
  const params = new URLSearchParams({ limit: '30' });
  for (const [id, key] of [['status-filter', 'status'], ['priority-filter', 'priority'], ['type-filter', 'targetType']]) if ($(id).value) params.set(key, $(id).value);
  const search = $('search-filter').value.trim();
  if (search) params.set('search', search);
  if ($('assigned-filter').value === 'me' && currentUserId) params.set('assigneeId', currentUserId);
  if ($('assigned-filter').value === 'unassigned') params.set('unassigned', 'true');
  if (cursor) params.set('cursor', cursor);
  return `?${params}`;
}

async function loadQueue(append = false) {
  try {
    const result = await request(`/moderation/cases${queryString(append ? nextCursor : null)}`);
    nextCursor = result.nextCursor;
    const queue = $('queue');
    if (!append) queue.innerHTML = '';
    for (const item of result.items || []) {
      const row = document.createElement('button');
      row.className = `case-row${item.id === selectedCaseId ? ' selected' : ''}`;
      row.innerHTML = `<strong>${escapeHtml(targetLabel(item.targetType))}</strong><span class="case-reason">${escapeHtml(item.category || 'Reported content')}</span><span class="pill ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span><span class="pill">${escapeHtml(item.status)}</span><span class="case-meta">${new Date(item.createdAt).toLocaleString()}</span>`;
      row.onclick = () => loadCase(item.id);
      queue.appendChild(row);
    }
    $('case-count').textContent = `${queue.children.length} loaded`;
    $('sidebar-case-count').textContent = queue.children.length;
    $('load-more').hidden = !nextCursor;
  } catch (error) { handleError(error); }
}

async function loadCase(caseId) {
  try {
    selectedCaseId = caseId;
    const result = await request(`/moderation/cases/${caseId}`);
    const item = result.case;
    const sanctions = result.sanctions || [];
    const reports = result.reports || [];
    const firstReport = reports[0];
    $('case-detail').innerHTML = `<div class="inspector-header"><div><p class="eyebrow">CASE</p><h2>Case #${shortId(item.id)} <button id="copy-case-id" class="icon-button" title="Copy case ID">▣</button></h2><span class="pill">${escapeHtml(item.status)}</span><span class="pill ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span><span class="meta-dot">·</span><span class="muted">${new Date(item.createdAt).toLocaleString()}</span></div><div class="assignment"><span>Assigned to</span><strong>${escapeHtml(item.assignedToUserId ? 'you' : 'unassigned')} <button class="icon-button" title="Edit assignment">✎</button></strong></div></div>
      <div class="inspector-grid"><section class="inspector-section reported-content"><h3>Reported content</h3><div class="content-preview"><div class="content-author"><span class="avatar small">Y</span><span>Reported ${escapeHtml(item.targetType)} · ${new Date(item.createdAt).toLocaleString()}</span></div><strong>${escapeHtml(targetLabel(item.targetType))}</strong><p class="muted">Content ID: ${escapeHtml(shortId(item.targetId))}</p><details><summary>Poll details</summary><p class="muted">Technical content details are available for inspection.</p></details></div></section><section class="inspector-section report-section"><h3>Report</h3>${firstReport ? `<strong>${escapeHtml(firstReport.category)}</strong><p>${escapeHtml(firstReport.description)}</p><span class="muted">Reported by</span><div class="reporter"><span class="avatar small neutral">A</span><span>Reporter<br><small>${new Date(firstReport.createdAt).toLocaleString()}</small></span></div>` : '<p class="muted">No reports.</p>'}</section></div>
      <div class="history-section"><h3>History</h3><details open><summary>History · ${reports.length + 1} events</summary><div class="timeline"><div><span class="timeline-dot"></span><strong>${new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><span>Case created</span></div><div><span class="timeline-dot"></span><strong>${new Date(item.updatedAt || item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><span>Status changed to <em>${escapeHtml(item.status)}</em></span></div></div></details></div>
      <div class="detail-section"><h3>Internal notes</h3><div>${(result.notes || []).map((note) => `<article class="note">${escapeHtml(note.body)}<br><small>${new Date(note.createdAt).toLocaleString()}</small></article>`).join('') || '<p class="muted">No notes.</p>'}</div>${can('moderation.case.resolve') ? '<textarea id="note-body" placeholder="Add an internal note"></textarea><button id="add-note" class="secondary">Add note</button>' : ''}</div>
      <div class="detail-section"><h3>Sanctions</h3>${sanctions.map((sanction) => `<article class="note"><strong>${escapeHtml(sanction.type)}</strong> · ${escapeHtml(sanction.status)}<p>${escapeHtml(sanction.reason)}</p><small>${new Date(sanction.createdAt).toLocaleString()}${sanction.expiresAt ? ` · expires ${new Date(sanction.expiresAt).toLocaleString()}` : ''}</small>${sanction.status === 'active' && can('moderation.sanction.revoke') ? `<button class="ghost revoke-sanction" data-sanction-id="${escapeHtml(sanction.id)}">Revoke</button>` : ''}</article>`).join('') || '<p class="muted">No sanctions.</p>'}</div>${renderActionBar(item)}`;
    bindCaseActions(item);
    document.querySelectorAll('.case-row').forEach((row) => row.classList.toggle('selected', row.textContent.includes(item.id)));
  } catch (error) { handleError(error); }
}

function reason(label) { const value = window.prompt(`${label} — reason (required):`); return value?.trim() || null; }
function durationHours(label) { const value = Number.parseInt(window.prompt(`${label} — duration in hours:`) || '', 10); return Number.isInteger(value) && value > 0 ? value : null; }
async function mutate(path, body = {}, idempotent = false) { await request(path, { method: 'POST', body: JSON.stringify(body), headers: idempotent ? { 'idempotency-key': idempotencyKey() } : {} }); await loadCase(selectedCaseId); await loadQueue(); }
async function mutateAppeal(path, body = {}) { await request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'idempotency-key': idempotencyKey() } }); appealsCursor = null; await loadAppeals(); }
function bindCaseActions(item) {
  const menu = $('more-actions-menu');
  const menuToggle = $('more-actions-toggle');
  menuToggle?.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    menuToggle.setAttribute('aria-expanded', String(!menu.hidden));
  });
  const copyCaseId = async () => { await navigator.clipboard?.writeText(item.id); };
  $('copy-case-id')?.addEventListener('click', copyCaseId);
  $('copy-case-id-menu')?.addEventListener('click', async () => {
    await copyCaseId();
    if (menu) menu.hidden = true;
    menuToggle?.setAttribute('aria-expanded', 'false');
  });
  $('assign-case')?.addEventListener('click', () => mutate(`/moderation/cases/${item.id}/assign`));
  $('takeover-case')?.addEventListener('click', () => mutate(`/moderation/cases/${item.id}/takeover`));
  $('add-note')?.addEventListener('click', async () => { const body = $('note-body').value.trim(); if (body) await mutate(`/moderation/cases/${item.id}/notes`, { body }); });
  for (const action of ['resolve', 'dismiss', 'escalate']) $(`${action}-case`)?.addEventListener('click', async () => { const note = reason(action); if (note) await mutate(`/moderation/cases/${item.id}/${action}`, { resolutionCode: action, note }); });
  $('remove-content')?.addEventListener('click', async () => { const note = reason('Remove content'); if (note) await mutate(`/moderation/content/${item.targetType}/${item.targetId}/remove`, { caseId: item.id, reason: note }); });
  const issue = async (path, type, needsDuration = false, restrictionType = null) => { const note = reason(`Issue ${type}`); if (!note) return; const hours = needsDuration ? durationHours(`Issue ${type}`) : null; if (needsDuration && !hours) return; await mutate(`/moderation/users/${item.targetId}/${path}`, { caseId: item.id, reason: note, ...(restrictionType ? { restrictionType } : {}), ...(hours ? { durationHours: hours } : {}) }, true); };
  $('issue-warning')?.addEventListener('click', () => issue('warning', 'warning'));
  $('issue-strike')?.addEventListener('click', () => issue('strike', 'strike'));
  $('issue-posting')?.addEventListener('click', () => issue('restriction', 'posting restriction', true, 'posting_restriction'));
  $('issue-comment')?.addEventListener('click', () => issue('restriction', 'comment restriction', true, 'comment_restriction'));
  $('issue-ban')?.addEventListener('click', () => issue('temporary-ban', 'temporary ban', true));
  $('issue-permanent-ban')?.addEventListener('click', async () => { const note = reason('Issue permanent ban'); if (!note || window.prompt('Type PERMANENT BAN to confirm:') !== 'PERMANENT BAN') return; await mutate(`/moderation/users/${item.targetId}/permanent-ban`, { caseId: item.id, reason: note }, true); });
  document.querySelectorAll('.revoke-sanction').forEach((button) => button.addEventListener('click', async () => { const note = reason('Revoke sanction'); if (note && window.confirm('Revoke this sanction?')) await mutate(`/moderation/sanctions/${button.dataset.sanctionId}/revoke`, { reason: note }, true); }));
}

async function loadAppeals(append = false) {
  if (!can('moderation.appeal.read')) return;
  try {
    const result = await request(`/moderation/appeals?status=open&limit=30${appealsCursor ? `&cursor=${encodeURIComponent(appealsCursor)}` : ''}`);
    appealsCursor = result.nextCursor;
    const html = (result.items || []).map((appeal) => `<article class="note"><strong>${escapeHtml(appeal.status)}</strong> · ${escapeHtml(appeal.userId)}<p>${escapeHtml(appeal.reason)}</p><small>${new Date(appeal.createdAt).toLocaleString()}</small>${can('moderation.appeal.resolve') ? `<div class="actions"><button class="secondary appeal-decision" data-id="${escapeHtml(appeal.id)}" data-status="upheld">Uphold</button><button class="ghost appeal-decision" data-id="${escapeHtml(appeal.id)}" data-status="reduced">Reduce</button><button class="danger appeal-decision" data-id="${escapeHtml(appeal.id)}" data-status="revoked">Revoke</button><button class="ghost appeal-decision" data-id="${escapeHtml(appeal.id)}" data-status="request_more_info">Request info</button></div>` : ''}</article>`).join('');
    if (!append) $('appeals').innerHTML = '';
    $('appeals').insertAdjacentHTML('beforeend', html || (!append ? '<p class="muted">No open appeals.</p>' : ''));
    $('appeals-load-more').hidden = !appealsCursor;
    document.querySelectorAll('.appeal-decision').forEach((button) => button.addEventListener('click', async () => { const note = reason(`Appeal decision: ${button.dataset.status}`); if (note) await mutateAppeal(`/moderation/appeals/${button.dataset.id}/resolve`, { status: button.dataset.status, decisionNote: note }); }));
  } catch (error) { handleError(error); }
}

async function loadAudit(append = false) {
  if (!can('admin.audit.read')) return;
  try {
    const result = await request(`/admin/audit?limit=30${append && auditCursor ? `&cursor=${encodeURIComponent(auditCursor)}` : ''}`);
    auditCursor = result.nextCursor;
    if (!append) $('audit').innerHTML = '';
    for (const entry of result.items || []) {
      const article = document.createElement('article');
      article.className = 'note';
      article.innerHTML = `<strong>${escapeHtml(entry.action)}</strong><p>${escapeHtml(entry.reason)}</p><small>${escapeHtml(entry.actorRole)} · ${escapeHtml(entry.targetType)}:${escapeHtml(entry.targetId)} · ${new Date(entry.createdAt).toLocaleString()}</small>`;
      $('audit').appendChild(article);
    }
    $('audit-load-more').hidden = !auditCursor;
  } catch (error) { handleError(error); }
}

async function loadPolicy() {
  if (!can('moderation.policy.read')) return;
  try {
    const result = await request('/moderation/policy');
    const form = $('policy-form');
    for (const [name, value] of Object.entries(result.policy || {})) if (form.elements[name]) form.elements[name].value = value;
    $('policy-status').textContent = result.policy?.updatedAt ? `Last updated ${new Date(result.policy.updatedAt).toLocaleString()}` : '';
  } catch (error) { handleError(error); }
}

async function savePolicy(event) {
  event.preventDefault();
  if (!can('moderation.policy.update')) return;
  const form = new FormData(event.target);
  const body = Object.fromEntries(form.entries());
  for (const name of ['postingRestrictionStrikes', 'temporaryBanStrikes', 'strikeRetentionDays', 'defaultRestrictionHours', 'defaultTemporaryBanHours']) body[name] = Number(body[name]);
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await request('/moderation/policy', { method: 'PATCH', body: JSON.stringify(body), headers: { 'idempotency-key': idempotencyKey() } });
    $('policy-status').textContent = `Saved ${new Date(result.policy.updatedAt).toLocaleString()}`;
  } catch (error) { handleError(error); } finally { button.disabled = false; }
}

function handleError(error) {
  if (error.status === 401) { accessToken = null; capabilities.clear(); showLogin('Session expired.'); return; }
  if (error.status === 403) { $('capability-error').textContent = 'You do not have permission for this section or action.'; return; }
  if (error.status === 429) { $('capability-error').textContent = 'Too many administrative requests. Try again later.'; return; }
  $('capability-error').textContent = `${error.status || ''} ${error.message}`;
}

$('login-form').addEventListener('submit', signIn);
$('logout-button').addEventListener('click', () => { accessToken = null; currentUserId = null; capabilities.clear(); showLogin(); });
$('refresh-button').addEventListener('click', () => loadQueue());
$('refresh-appeals').addEventListener('click', () => { appealsCursor = null; loadAppeals(); });
$('refresh-audit').addEventListener('click', () => { auditCursor = null; loadAudit(); });
$('refresh-policy').addEventListener('click', () => loadPolicy());
$('policy-form').addEventListener('submit', savePolicy);
$('filters-toggle').addEventListener('click', () => {
  const button = $('filters-toggle');
  const popover = $('filters-popover');
  popover.hidden = !popover.hidden;
  button.setAttribute('aria-expanded', String(!popover.hidden));
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.filter-dropdown')) {
    $('filters-popover').hidden = true;
    $('filters-toggle').setAttribute('aria-expanded', 'false');
  }
  if (!event.target.closest('.more-actions')) {
    const menu = $('more-actions-menu');
    const toggle = $('more-actions-toggle');
    if (menu) menu.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
  }
});
$('load-more').addEventListener('click', () => loadQueue(true));
$('appeals-load-more').addEventListener('click', () => loadAppeals(true));
$('audit-load-more').addEventListener('click', () => loadAudit(true));
$('status-filter').addEventListener('change', () => loadQueue());
$('priority-filter').addEventListener('change', () => loadQueue());
$('type-filter').addEventListener('change', () => loadQueue());
$('assigned-filter').addEventListener('change', () => loadQueue());
let searchTimer;
$('search-filter').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadQueue(), 250); });
