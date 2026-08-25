const apiBase = window.__MODERATION_API_BASE__ || '';
let accessToken = null;
let capabilities = new Set();
let nextCursor = null;
let selectedCaseId = null;

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

async function signIn(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  $('login-error').textContent = '';
  try {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify({ login: form.get('login'), password: form.get('password') }) });
    accessToken = result.accessToken;
    const capabilityResult = await request('/moderation/capabilities');
    capabilities = new Set(capabilityResult.permissions || []);
    if (!can('moderation.queue.read')) throw new Error('This account is not authorized for moderation.');
    showPanel();
    await loadQueue();
  } catch (error) { showLogin(error.message); }
}

function queryString(cursor = null) {
  const params = new URLSearchParams({ limit: '30' });
  for (const [id, key] of [['status-filter', 'status'], ['priority-filter', 'priority']]) if ($(id).value) params.set(key, $(id).value);
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
      row.innerHTML = `<strong>${escapeHtml(item.targetType)} · ${escapeHtml(item.targetId)}</strong><span class="pill ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span><span class="pill">${escapeHtml(item.status)}</span><span class="case-meta">${item.reportsCount} report(s) · ${new Date(item.createdAt).toLocaleString()}</span>`;
      row.onclick = () => loadCase(item.id);
      queue.appendChild(row);
    }
    $('case-count').textContent = `${queue.children.length} loaded`;
    $('load-more').hidden = !nextCursor;
  } catch (error) { handleError(error); }
}

async function loadCase(caseId) {
  try {
    selectedCaseId = caseId;
    const result = await request(`/moderation/cases/${caseId}`);
    const item = result.case;
    $('case-detail').innerHTML = `<div class="section-title"><div><p class="eyebrow">CASE</p><h2>${escapeHtml(item.targetType)} · ${escapeHtml(item.targetId)}</h2><span class="pill">${escapeHtml(item.status)}</span><span class="pill ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span></div></div>
      <p class="muted">${item.reportsCount} report(s) · assigned: ${escapeHtml(item.assignedToUserId || 'unassigned')}</p>
      <div class="actions">${can('moderation.case.assign') ? '<button id="assign-case" class="secondary">Assign to me</button><button id="takeover-case" class="ghost">Take over</button>' : ''}${can('moderation.content.delete') && item.targetType !== 'user' ? '<button id="remove-content" class="primary">Remove content</button>' : ''}${can('moderation.case.resolve') ? '<button id="resolve-case" class="secondary">Resolve</button><button id="dismiss-case" class="ghost">Dismiss</button><button id="escalate-case" class="ghost">Escalate</button>' : ''}</div>
      <div class="detail-section"><h3>Reports</h3>${(result.reports || []).map((report) => `<article class="report"><strong>${escapeHtml(report.category)}</strong><p>${escapeHtml(report.description)}</p><small>${new Date(report.createdAt).toLocaleString()}</small></article>`).join('') || '<p class="muted">No reports.</p>'}</div>
      <div class="detail-section"><h3>Internal notes</h3><div>${(result.notes || []).map((note) => `<article class="note">${escapeHtml(note.body)}<br><small>${new Date(note.createdAt).toLocaleString()}</small></article>`).join('') || '<p class="muted">No notes.</p>'}</div>${can('moderation.case.resolve') ? '<textarea id="note-body" placeholder="Add an internal note"></textarea><button id="add-note" class="secondary">Add note</button>' : ''}</div>`;
    bindCaseActions(item);
    document.querySelectorAll('.case-row').forEach((row) => row.classList.toggle('selected', row.textContent.includes(item.id)));
  } catch (error) { handleError(error); }
}

function reason(label) { const value = window.prompt(`${label} — reason (required):`); return value?.trim() || null; }
async function mutate(path, body = {}) { await request(path, { method: 'POST', body: JSON.stringify(body) }); await loadCase(selectedCaseId); await loadQueue(); }
function bindCaseActions(item) {
  $('assign-case')?.addEventListener('click', () => mutate(`/moderation/cases/${item.id}/assign`));
  $('takeover-case')?.addEventListener('click', () => mutate(`/moderation/cases/${item.id}/takeover`));
  $('add-note')?.addEventListener('click', async () => { const body = $('note-body').value.trim(); if (body) await mutate(`/moderation/cases/${item.id}/notes`, { body }); });
  for (const action of ['resolve', 'dismiss', 'escalate']) $(`${action}-case`)?.addEventListener('click', async () => { const note = reason(action); if (note) await mutate(`/moderation/cases/${item.id}/${action}`, { resolutionCode: action, note }); });
  $('remove-content')?.addEventListener('click', async () => { const note = reason('Remove content'); if (note) await mutate(`/moderation/content/${item.targetType}/${item.targetId}/remove`, { caseId: item.id, reason: note }); });
}
function handleError(error) { if (error.status === 401) { accessToken = null; showLogin('Session expired.'); } else $('capability-error').textContent = `${error.status || ''} ${error.message}`; }

$('login-form').addEventListener('submit', signIn);
$('logout-button').addEventListener('click', () => { accessToken = null; capabilities.clear(); showLogin(); });
$('refresh-button').addEventListener('click', () => loadQueue());
$('load-more').addEventListener('click', () => loadQueue(true));
$('status-filter').addEventListener('change', () => loadQueue());
$('priority-filter').addEventListener('change', () => loadQueue());
