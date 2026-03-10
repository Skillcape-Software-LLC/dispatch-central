(function () {
  'use strict';

  const API_BASE = '/api/admin';
  let adminToken = localStorage.getItem('dc_admin_token') || '';
  let currentPage = 'dashboard';
  let activityOffset = 0;
  const ACTIVITY_LIMIT = 50;

  // --- API helper ---
  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        'X-Admin-Token': adminToken,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      logout();
      throw new Error('Unauthorized');
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // --- Auth ---
  function showAuthGate() {
    document.getElementById('auth-gate').classList.remove('d-none');
    document.querySelectorAll('.page').forEach((p) => p.classList.add('d-none'));
  }

  function hideAuthGate() {
    document.getElementById('auth-gate').classList.add('d-none');
  }

  function logout() {
    adminToken = '';
    localStorage.removeItem('dc_admin_token');
    showAuthGate();
  }

  document.getElementById('auth-submit').addEventListener('click', async () => {
    const input = document.getElementById('admin-token-input');
    const errEl = document.getElementById('auth-error');
    adminToken = input.value.trim();
    if (!adminToken) return;

    try {
      await api('/dashboard');
      localStorage.setItem('dc_admin_token', adminToken);
      errEl.classList.add('d-none');
      hideAuthGate();
      navigate('dashboard');
    } catch {
      errEl.textContent = 'Invalid admin token.';
      errEl.classList.remove('d-none');
      adminToken = '';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('admin-token-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('auth-submit').click();
  });

  // --- Navigation ---
  document.querySelectorAll('[data-page]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });

  function navigate(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach((p) => p.classList.add('d-none'));
    document.getElementById(`page-${page}`).classList.remove('d-none');
    document.querySelectorAll('[data-page]').forEach((l) => {
      l.classList.toggle('active', l.dataset.page === page);
    });
    loadPage(page);
  }

  function loadPage(page) {
    if (page === 'dashboard') loadDashboard();
    else if (page === 'instances') loadInstances();
    else if (page === 'channels') loadChannels();
    else if (page === 'activity') { activityOffset = 0; loadActivity(); }
  }

  // --- Helpers ---
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function timeAgo(dateStr) {
    const d = new Date(dateStr + 'Z');
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function eventBadge(type) {
    const cls = `badge badge-${type}`;
    return `<span class="${cls}">${type}</span>`;
  }

  function tokenShort(token) {
    if (!token) return '—';
    return `<span class="token-mono">${token.substring(0, 8)}...</span>`;
  }

  function channelShort(id) {
    if (!id) return '—';
    return `<span class="token-mono">${id.substring(0, 8)}...</span>`;
  }

  function metadataSummary(meta) {
    if (!meta) return '';
    const parts = [];
    if (meta.name) parts.push(meta.name);
    if (meta.requestCount !== undefined) parts.push(`${meta.requestCount} reqs`);
    if (meta.added !== undefined) parts.push(`+${meta.added}`);
    if (meta.modified !== undefined) parts.push(`~${meta.modified}`);
    if (meta.deleted !== undefined) parts.push(`-${meta.deleted}`);
    if (meta.version !== undefined) parts.push(`v${meta.version}`);
    if (meta.sinceVersion !== undefined) parts.push(`since v${meta.sinceVersion}`);
    return parts.join(', ');
  }

  function renderActivityRows(events) {
    return events
      .map(
        (e) => `<tr>
          <td>${eventBadge(e.eventType)}</td>
          <td>${tokenShort(e.instanceToken)}</td>
          <td>${channelShort(e.channelId)}</td>
          <td class="small text-body-secondary">${metadataSummary(e.metadata)}</td>
          <td class="small text-body-secondary" title="${e.createdAt}">${timeAgo(e.createdAt)}</td>
        </tr>`,
      )
      .join('');
  }

  // --- Dashboard ---
  async function loadDashboard() {
    try {
      const data = await api('/dashboard');
      document.getElementById('stat-instances').textContent = data.instances;
      document.getElementById('stat-channels').textContent = data.channels;
      document.getElementById('stat-subscriptions').textContent = data.subscriptions;
      document.getElementById('stat-dbsize').textContent = formatBytes(data.dbSizeBytes);
      document.getElementById('dashboard-activity').innerHTML = renderActivityRows(data.recentActivity);
    } catch { /* handled by api() */ }
  }

  // --- Instances ---
  async function loadInstances() {
    try {
      const data = await api('/instances');
      const tbody = document.getElementById('instances-table');
      tbody.innerHTML = data
        .map(
          (i) => `<tr>
            <td>${esc(i.name)}</td>
            <td><span class="token-mono">${i.tokenPrefix}...</span></td>
            <td class="small" title="${i.registeredAt}">${timeAgo(i.registeredAt)}</td>
            <td class="small" title="${i.lastSeenAt}">${timeAgo(i.lastSeenAt)}</td>
            <td>${i.ownedChannels}</td>
            <td>${i.subscriptions}</td>
            <td><button class="btn btn-sm btn-outline-danger revoke-btn" data-token="${esc(i.token)}">Revoke</button></td>
          </tr>`,
        )
        .join('');

      tbody.querySelectorAll('.revoke-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Revoke this instance? Its subscriptions will be removed.')) return;
          await api(`/instances/${btn.dataset.token}`, { method: 'DELETE' });
          loadInstances();
        });
      });
    } catch { /* handled by api() */ }
  }

  // --- Channels ---
  async function loadChannels() {
    try {
      const data = await api('/channels');
      const tbody = document.getElementById('channels-table');
      tbody.innerHTML = data
        .map(
          (c) => `<tr>
            <td>${esc(c.name)}</td>
            <td><span class="token-mono">${c.id.substring(0, 8)}...</span></td>
            <td title="${c.ownerToken}">${c.ownerName ? esc(c.ownerName) : c.ownerTokenPrefix + '...'}</td>
            <td><span class="badge ${c.mode === 'readwrite' ? 'bg-success' : 'bg-secondary'}">${c.mode}</span></td>
            <td>${c.version}</td>
            <td>${c.requestCount}</td>
            <td>${c.subscriberCount}</td>
            <td class="small" title="${c.updatedAt}">${timeAgo(c.updatedAt)}</td>
            <td><button class="btn btn-sm btn-outline-danger delete-ch-btn" data-id="${esc(c.id)}">Delete</button></td>
          </tr>`,
        )
        .join('');

      tbody.querySelectorAll('.delete-ch-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this channel and all its data?')) return;
          await api(`/channels/${btn.dataset.id}`, { method: 'DELETE' });
          loadChannels();
        });
      });
    } catch { /* handled by api() */ }
  }

  // --- Activity ---
  document.getElementById('activity-refresh').addEventListener('click', () => {
    activityOffset = 0;
    loadActivity();
  });

  document.getElementById('activity-type-filter').addEventListener('change', () => {
    activityOffset = 0;
    loadActivity();
  });

  document.getElementById('activity-prev').addEventListener('click', () => {
    activityOffset = Math.max(0, activityOffset - ACTIVITY_LIMIT);
    loadActivity();
  });

  document.getElementById('activity-next').addEventListener('click', () => {
    activityOffset += ACTIVITY_LIMIT;
    loadActivity();
  });

  async function loadActivity() {
    try {
      const type = document.getElementById('activity-type-filter').value;
      const params = new URLSearchParams({ limit: ACTIVITY_LIMIT, offset: activityOffset });
      if (type) params.set('type', type);

      const data = await api(`/activity?${params}`);
      document.getElementById('activity-table').innerHTML = renderActivityRows(data.events);
      document.getElementById('activity-count').textContent = `Showing ${activityOffset + 1}–${Math.min(activityOffset + data.events.length, data.total)} of ${data.total}`;
      document.getElementById('activity-prev').disabled = activityOffset === 0;
      document.getElementById('activity-next').disabled = activityOffset + ACTIVITY_LIMIT >= data.total;
    } catch { /* handled by api() */ }
  }

  // --- XSS escape ---
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // --- Init ---
  if (adminToken) {
    api('/dashboard')
      .then(() => { hideAuthGate(); navigate('dashboard'); })
      .catch(() => showAuthGate());
  } else {
    showAuthGate();
  }
})();
