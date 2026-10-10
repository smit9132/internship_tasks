(() => {
  const { currentUser, escapeHtml: h, formatDate, request, setHeader, toast } = window.EventSync;
  const root = document.getElementById('admin-root');
  let activeTab = 'users';
  let searchTimer;

  function tableEmpty(message) {
    return `<div class="dashboard-empty"><h3>${h(message)}</h3><p>There’s nothing to review right now.</p></div>`;
  }

  function shell(stats) {
    root.innerHTML = `<div class="dashboard-top"><div><span class="eyebrow">Behind the scenes</span><h1>Admin workspace.</h1><p>Keep the EventSync community thoughtful and safe.</p></div><span class="status-badge">Administrator</span></div>
      <div class="stats-grid">${[['People', stats.users, 'registered accounts'], ['Events', stats.events, 'all statuses'], ['Confirmed bookings', stats.registrations, 'across the platform']].map(([label, value, note]) => `<div class="stat-card"><span class="stat-label">${h(label)}</span><div class="stat-value">${h(value)}</div><div class="stat-note">${h(note)}</div></div>`).join('')}</div>
      <section class="dashboard-section"><div class="admin-tabs" role="tablist"><button class="admin-tab ${activeTab === 'users' ? 'selected' : ''}" data-admin-tab="users" role="tab">People & roles</button><button class="admin-tab ${activeTab === 'events' ? 'selected' : ''}" data-admin-tab="events" role="tab">Event moderation</button></div><div id="admin-content"></div></section>`;
    root.querySelectorAll('[data-admin-tab]').forEach((button) => button.addEventListener('click', () => {
      activeTab = button.dataset.adminTab;
      root.querySelectorAll('[data-admin-tab]').forEach((tab) => tab.classList.toggle('selected', tab === button));
      loadCurrentTab();
    }));
  }

  async function renderUsers(query = '', page = 1) {
    const content = document.getElementById('admin-content');
    content.innerHTML = '<div class="loading-panel"><span class="spinner"></span><span>Loading people…</span></div>';
    const params = new URLSearchParams({ limit: 25, page });
    if (query) params.set('q', query);
    try {
      const { users, pagination } = await request(`/api/admin/users?${params}`);
      if (!users.length) { content.innerHTML = tableEmpty('No people match that search.'); return; }
      content.innerHTML = `<div class="admin-users-summary"><b>${pagination.total} account${pagination.total === 1 ? '' : 's'} created</b><span>Event registrations are counted for each account.</span></div><label class="sr-only" for="user-search">Search people</label><input id="user-search" class="admin-search" type="search" placeholder="Search name or email…" value="${h(query)}"><div class="admin-table-wrap" style="margin-top:13px"><table class="admin-table"><thead><tr><th>Person</th><th>Account created</th><th>Events registered</th><th>Role</th><th>Account status</th></tr></thead><tbody>${users.map((user) => `<tr><td><b>${h(user.name)}</b><br><span>${h(user.email)}</span></td><td>${h(formatDate(user.createdAt, { month: 'short', day: 'numeric', year: 'numeric' }))}</td><td><b>${h(user.confirmedRegistrationCount)}</b> confirmed${user.registrationCount !== user.confirmedRegistrationCount ? `<br><span>${h(user.registrationCount)} total, including cancelled</span>` : ''}<details class="user-event-details"><summary>${user.registrationCount ? 'View registered events' : 'No event registrations'}</summary>${user.registrations.length ? `<ul>${user.registrations.map((registration) => `<li><b>${h(registration.event?.title || 'Event no longer available')}</b><span>${registration.event ? `${h(registration.event.category)} · ${h(formatDate(registration.event.startAt, { month: 'short', day: 'numeric', year: 'numeric' }))}` : ''}</span><span class="status-badge ${registration.status === 'cancelled' ? 'cancelled' : ''}">${h(registration.status)}</span>${registration.paymentStatus === 'offline-payment-required' ? '<span class="payment-label">Payment arranged directly</span>' : ''}</li>`).join('')}</ul>` : '<p>This account has not registered for any events yet.</p>'}</details></td><td><label class="sr-only" for="role-${h(user._id)}">Role for ${h(user.name)}</label><select id="role-${h(user._id)}" data-user-role="${h(user._id)}"><option value="attendee" ${user.role === 'attendee' ? 'selected' : ''}>Attendee</option><option value="organizer" ${user.role === 'organizer' ? 'selected' : ''}>Organizer</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option></select></td><td><button class="button button-outline button-small" data-user-active="${h(user._id)}" data-active="${user.isActive}">${user.isActive ? 'Active' : 'Deactivated'}</button></td></tr>`).join('')}</tbody></table></div><div class="admin-pagination"><button class="button button-outline button-small" data-users-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${pagination.page} of ${Math.max(1, pagination.pages)}</span><button class="button button-outline button-small" data-users-page="${page + 1}" ${page >= pagination.pages ? 'disabled' : ''}>Next</button></div>`;
      content.querySelector('#user-search').addEventListener('input', (event) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderUsers(event.target.value.trim(), 1), 250);
      });
      content.querySelectorAll('[data-users-page]').forEach((button) => button.addEventListener('click', () => renderUsers(query, Number(button.dataset.usersPage))));
      content.querySelectorAll('[data-user-role]').forEach((select) => select.addEventListener('change', async () => {
        select.disabled = true;
        try { await request(`/api/admin/users/${encodeURIComponent(select.dataset.userRole)}`, { method: 'PATCH', body: { role: select.value } }); toast('Account role updated.'); }
        catch (error) { toast(error.message, true); renderUsers(query, page); }
        finally { select.disabled = false; }
      }));
      content.querySelectorAll('[data-user-active]').forEach((button) => button.addEventListener('click', async () => {
        const isActive = button.dataset.active === 'true';
        if (isActive && !window.confirm('Deactivate this account?')) return;
        button.disabled = true;
        try { await request(`/api/admin/users/${encodeURIComponent(button.dataset.userActive)}`, { method: 'PATCH', body: { isActive: !isActive } }); toast(isActive ? 'Account deactivated.' : 'Account reactivated.'); await renderUsers(query, page); }
        catch (error) { toast(error.message, true); button.disabled = false; }
      }));
    } catch (error) { content.innerHTML = `<div class="error-state"><h3>Couldn’t load people</h3><p>${h(error.message)}</p></div>`; }
  }

  async function renderEvents() {
    const content = document.getElementById('admin-content');
    content.innerHTML = '<div class="loading-panel"><span class="spinner"></span><span>Loading events…</span></div>';
    try {
      const { events } = await request('/api/admin/events');
      if (!events.length) { content.innerHTML = tableEmpty('No events have been created yet.'); return; }
      content.innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Event</th><th>Organizer</th><th>Date</th><th>Registrations</th><th>Moderate</th></tr></thead><tbody>${events.map((event) => `<tr><td><b>${h(event.title)}</b><br><span class="status-badge ${h(event.status)}">${h(event.status)}</span></td><td>${h(event.organizer?.name || event.organizerName || 'Unknown')}</td><td>${h(formatDate(event.startAt, { year: 'numeric' }))}</td><td>${h(event.registeredCount)} / ${h(event.capacity)}</td><td><label class="sr-only" for="event-status-${h(event._id)}">Moderate ${h(event.title)}</label><select id="event-status-${h(event._id)}" data-event-status="${h(event._id)}"><option value="draft" disabled>Draft</option><option value="published" ${event.status === 'published' ? 'selected' : ''}>Published</option><option value="cancelled" ${event.status === 'cancelled' ? 'selected' : ''}>Cancelled</option><option value="completed" ${event.status === 'completed' ? 'selected' : ''}>Completed</option></select></td></tr>`).join('')}</tbody></table></div>`;
      content.querySelectorAll('[data-event-status]').forEach((select) => select.addEventListener('change', async () => {
        select.disabled = true;
        try { await request(`/api/admin/events/${encodeURIComponent(select.dataset.eventStatus)}`, { method: 'PATCH', body: { status: select.value } }); toast('Event status updated.'); }
        catch (error) { toast(error.message, true); }
        finally { select.disabled = false; }
      }));
    } catch (error) { content.innerHTML = `<div class="error-state"><h3>Couldn’t load events</h3><p>${h(error.message)}</p></div>`; }
  }

  function loadCurrentTab() {
    return activeTab === 'users' ? renderUsers() : renderEvents();
  }
  async function init() {
    const user = await currentUser();
    await setHeader(user);
    if (!user) {
      root.innerHTML = '<div class="error-state"><h3>Administrator access required</h3><p>Please log in with an administrator account.</p><a class="button button-dark button-small" href="/?login=1">Log in</a></div>';
      return;
    }
    if (user.role !== 'admin') {
      root.innerHTML = '<div class="error-state"><h3>Administrator access required</h3><p>This area is only available to administrators.</p><a class="button button-dark button-small" href="/dashboard.html">Back to your events</a></div>';
      return;
    }
    const stats = await request('/api/admin/stats');
    shell(stats);
    loadCurrentTab();
  }
  init().catch((error) => {
    root.innerHTML = `<div class="error-state"><h3>Admin workspace unavailable</h3><p>${h(error.message)}</p></div>`;
  });
})();
