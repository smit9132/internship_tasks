(() => {
  const { currentUser, escapeHtml: h, formatDate, request, safeUrl, setHeader, toast } = window.EventSync;
  const root = document.getElementById('dashboard-root');
  const eventDialog = document.getElementById('event-dialog');
  const attendeeDialog = document.getElementById('attendees-dialog');
  const categories = ['Technology', 'Business', 'Arts', 'Music', 'Food', 'Wellness', 'Education', 'Community', 'Other'];
  let user;
  let organizerEvents = [];
  let attendeeData = null;
  let editingId = null;

  function cover(value) {
    const url = safeUrl(value);
    return url ? `background-image:url("${h(url)}")` : 'background-image:linear-gradient(135deg,#dae6c8,#efd8cb 52%,#b7c7a8)';
  }
  function empty(title, description, button = '') {
    return `<div class="dashboard-empty"><div class="empty-icon">✳</div><h3>${h(title)}</h3><p>${h(description)}</p>${button}</div>`;
  }
  function pageShell(title, description, action = '') {
    return `<div class="dashboard-top"><div><span class="eyebrow">Your EventSync</span><h1>${h(title)}</h1><p>${h(description)}</p></div>${action}</div>`;
  }
  function stats(items) {
    return `<div class="stats-grid">${items.map(([label, value, note]) => `<div class="stat-card"><span class="stat-label">${h(label)}</span><div class="stat-value">${h(value)}</div><div class="stat-note">${h(note)}</div></div>`).join('')}</div>`;
  }

  function registrationCard(item) {
    if (!item.event) return '';
    const event = item.event;
    const date = new Date(event.startAt);
    const canCancel = item.status === 'confirmed' && new Date(event.startAt) > new Date() && event.status === 'published';
    return `<article class="registration-card">    <div class="registration-main"><div class="registration-date"><b>${date.toLocaleDateString(undefined, { day: 'numeric' })}</b><small>${h(date.toLocaleDateString(undefined, { month: 'short' }))}</small></div><div><h3>${h(event.title)}</h3><p>${h(formatDate(event.startAt, { weekday: 'long', year: 'numeric' }))} · ${h(event.venue?.type === 'online' ? 'Online' : event.venue?.name || 'Venue to be announced')}</p><span class="status-badge ${item.status === 'cancelled' ? 'cancelled' : ''}">${h(item.status)}</span>${item.status === 'confirmed' && item.paymentStatus === 'offline-payment-required' ? `<p class="payment-note">Payment not collected. Arrange directly with the organizer${event.organizer?.email ? `: <a href="mailto:${h(event.organizer.email)}">${h(event.organizer.email)}</a>` : '.'}</p>` : ''}</div></div><div class="management-actions">${['published', 'completed'].includes(event.status) ? `<a class="button button-outline button-small" href="/event.html?id=${encodeURIComponent(event._id)}">Details</a>` : ''}${canCancel ? `<button class="button button-outline button-small" data-cancel-registration="${h(item._id)}">Cancel</button>` : ''}</div></article>`;
  }

  async function loadAttendee() {
    const [profile, data] = await Promise.all([request('/api/auth/me'), request('/api/dashboard/attendee')]);
    user = profile.user;
    attendeeData = data;
    const upcoming = data.upcoming;
    const past = data.past;
    root.innerHTML = `${pageShell(`Hi, ${user.name.split(' ')[0]}.`, 'A little look at the things you’re showing up for.', '<a class="button button-dark" href="/">Find an event <span aria-hidden="true">↗</span></a>')}
      ${stats([['Upcoming', upcoming.length, 'good things on the calendar'], ['Past events', past.length, 'memories made'], ['All registrations', data.registrations.length, 'your EventSync history'], ['Your role', 'Attendee', 'your people are waiting']])}
      <section class="dashboard-section"><div class="dashboard-section-heading"><h2>Coming up</h2><span class="eyebrow">${upcoming.length} ${upcoming.length === 1 ? 'event' : 'events'}</span></div><div class="management-list" id="upcoming-list">${upcoming.length ? upcoming.map(registrationCard).join('') : empty('Nothing on the calendar yet', 'There are plenty of good things to discover. Browse events and find something that feels like you.', '<a class="button button-dark button-small" href="/">Explore events ↗</a>')}</div></section>
      <section class="dashboard-section"><div class="dashboard-section-heading"><h2>Your event history</h2><span class="eyebrow">${data.registrations.length} total</span></div><div class="dashboard-tabs"><button class="dashboard-tab selected" data-history="all">All</button><button class="dashboard-tab" data-history="upcoming">Upcoming</button><button class="dashboard-tab" data-history="past">Past</button></div><div class="management-list" id="history-list">${data.registrations.length ? data.registrations.map(registrationCard).join('') : empty('Your story starts here', 'Register for an event and it will show up here.')}</div></section>
      <section class="dashboard-section"><div class="dashboard-section-heading"><h2>Your profile</h2></div><form id="profile-form" class="profile-form"><div class="event-form-grid"><label class="form-label">Name<input name="name" value="${h(user.name)}" minlength="2" maxlength="80" required></label><label class="form-label">Email<input name="email" type="email" value="${h(user.email)}" maxlength="254" required></label></div><button class="button button-outline button-small">Save profile</button></form></section>`;
    root.onclick = attendeeClick;
    document.getElementById('profile-form').addEventListener('submit', saveProfile);
    document.querySelectorAll('[data-history]').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('[data-history]').forEach((item) => item.classList.toggle('selected', item === button));
      const filter = button.dataset.history;
      const records = data.registrations.filter((item) => {
        if (!item.event) return filter === 'all';
        const pastEvent = new Date(item.event.startAt) <= new Date();
        return filter === 'all' || (filter === 'past' ? pastEvent : !pastEvent);
      });
      document.getElementById('history-list').innerHTML = records.length ? records.map(registrationCard).join('') : empty('Nothing to show yet', 'Your event history will appear here.');
    }));
  }

  async function attendeeClick(event) {
    const button = event.target.closest('[data-cancel-registration]');
    if (!button) return;
    if (!window.confirm('Cancel your registration for this event?')) return;
    button.disabled = true;
    try {
      await request(`/api/events/registrations/${encodeURIComponent(button.dataset.cancelRegistration)}`, { method: 'DELETE', body: {} });
      toast('Your place has been released.');
      await loadAttendee();
    } catch (error) { toast(error.message, true); button.disabled = false; }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await request('/api/auth/me', { method: 'PATCH', body: Object.fromEntries(new FormData(event.currentTarget)) });
      toast('Your profile has been updated.');
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  }

  function localInput(value) {
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
  function defaultDate(days, hours = 0) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hours, 0, 0, 0);
    return localInput(date);
  }

  function buildEventForm(event = null) {
    editingId = event?._id || null;
    document.getElementById('event-dialog-title').textContent = event ? 'Edit your event' : 'Create an event';
    const opens = event ? localInput(event.registrationOpensAt) : defaultDate(0, new Date().getHours());
    const starts = event ? localInput(event.startAt) : defaultDate(14, 18);
    const ends = event ? localInput(event.endAt) : defaultDate(14, 20);
    const closes = event ? localInput(event.registrationClosesAt) : defaultDate(14, 17);
    const venueType = event?.venue?.type || 'in-person';
    const form = document.getElementById('event-form');
    form.innerHTML = `<div class="event-form-grid">
      <label class="form-label wide">Event title<input name="title" required minlength="4" maxlength="120" value="${h(event?.title || '')}" placeholder="A name people will remember"></label>
      <label class="form-label">Category<select name="category" required>${categories.map((category) => `<option ${event?.category === category ? 'selected' : ''}>${h(category)}</option>`).join('')}</select></label>
      <label class="form-label">Cover image URL <span class="fine-print">Optional</span><input name="coverImage" type="url" maxlength="2048" value="${h(event?.coverImage || '')}" placeholder="https://…"></label>
      <label class="form-label wide">Tell people what to expect<textarea name="description" required minlength="20" maxlength="10000" placeholder="The details, the feeling, the reason to come…">${h(event?.description || '')}</textarea></label>
      <div class="form-section-label">Where and when</div>
      <label class="form-label">Format<select name="venueType" id="venue-type"><option value="in-person" ${venueType === 'in-person' ? 'selected' : ''}>In person</option><option value="online" ${venueType === 'online' ? 'selected' : ''}>Online</option></select></label>
      <label class="form-label">Timezone<input name="timezone" required maxlength="80" value="${h(event?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}" list="timezone-options"><datalist id="timezone-options">${(Intl.supportedValuesOf?.('timeZone') || ['UTC']).map((zone) => `<option value="${h(zone)}">`).join('')}</datalist></label>
      <label class="form-label" data-venue-field="name">Venue name<input name="venueName" maxlength="120" value="${h(event?.venue?.name || '')}"></label>
      <label class="form-label" data-venue-field="address">Address<input name="venueAddress" maxlength="300" value="${h(event?.venue?.address || '')}"></label>
      <label class="form-label wide" data-venue-field="meetingUrl">Meeting URL<input name="meetingUrl" type="url" maxlength="2048" value="${h(event?.venue?.meetingUrl || '')}" placeholder="https://"></label>
      <label class="form-label">Starts<input name="startAt" type="datetime-local" required value="${h(starts)}"></label>
      <label class="form-label">Ends<input name="endAt" type="datetime-local" required value="${h(ends)}"></label>
      <div class="form-section-label">Registration and tickets</div>
      <label class="form-label">Registration opens<input name="registrationOpensAt" type="datetime-local" required value="${h(opens)}"></label>
      <label class="form-label">Registration closes<input name="registrationClosesAt" type="datetime-local" required value="${h(closes)}"></label>
      <label class="form-label">Capacity<input name="capacity" type="number" min="1" max="100000" step="1" required value="${h(event?.capacity || 40)}"></label>
      <label class="form-label">Ticket price · free by default<input name="ticketPrice" type="number" min="0" max="1000000" step="0.01" value="${h(event?.ticketPrice ?? 0)}"><span class="fine-print">Paid events need a real payment provider; this app does not process payments.</span></label>
      <label class="form-label">Currency<input name="currency" value="${h(event?.currency || 'USD')}" maxlength="3" pattern="[A-Za-z]{3}" required></label>
    </div><p class="form-error" id="event-form-error" role="alert"></p><div class="event-form-actions"><button class="button button-outline button-small" type="button" data-close-event>Close without saving</button><button class="button button-dark button-small" type="submit">${event ? 'Save changes' : 'Create draft'} ↗</button></div>`;
    const typeSelect = form.querySelector('#venue-type');
    function showVenueFields() {
      const online = typeSelect.value === 'online';
      form.querySelector('[data-venue-field="name"]').hidden = online;
      form.querySelector('[data-venue-field="address"]').hidden = online;
      form.querySelector('[data-venue-field="meetingUrl"]').hidden = !online;
      form.querySelector('[name="venueName"]').required = !online;
      form.querySelector('[name="venueAddress"]').required = !online;
      form.querySelector('[name="meetingUrl"]').required = online;
    }
    typeSelect.addEventListener('change', showVenueFields);
    showVenueFields();
    form.querySelector('[data-close-event]').addEventListener('click', () => eventDialog.close());
    form.onsubmit = saveEvent;
    eventDialog.showModal();
  }

  async function saveEvent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const data = Object.fromEntries(new FormData(form));
    const online = data.venueType === 'online';
    const payload = {
      title: data.title, description: data.description, category: data.category, coverImage: data.coverImage,
      venue: online ? { type: 'online', meetingUrl: data.meetingUrl } : { type: 'in-person', name: data.venueName, address: data.venueAddress },
      timezone: data.timezone,
      startAt: new Date(data.startAt).toISOString(), endAt: new Date(data.endAt).toISOString(),
      registrationOpensAt: new Date(data.registrationOpensAt).toISOString(), registrationClosesAt: new Date(data.registrationClosesAt).toISOString(),
      capacity: Number(data.capacity), ticketPrice: Number(data.ticketPrice), currency: data.currency.toUpperCase()
    };
    button.disabled = true;
    document.getElementById('event-form-error').textContent = '';
    try {
      await request(editingId ? `/api/events/${encodeURIComponent(editingId)}` : '/api/events', { method: editingId ? 'PATCH' : 'POST', body: payload });
      eventDialog.close();
      toast(editingId ? 'Your event has been updated.' : 'Draft created. Publish it when you’re ready.');
      await loadOrganizer();
    } catch (error) {
      document.getElementById('event-form-error').textContent = error.details?.join(' ') || error.message;
    } finally { button.disabled = false; }
  }

  function organizerCard(event) {
    const status = event.status;
    const location = event.venue?.type === 'online' ? 'Online' : event.venue?.name || 'Venue to be announced';
    return `<article class="management-card"><div class="management-thumb" style="${cover(event.coverImage)}"></div><div class="management-info"><span class="event-card-date">${h(formatDate(event.startAt, { weekday: 'short', year: 'numeric' }))}</span><h3>${h(event.title)}</h3><p>${h(location)} · ${event.registeredCount} registered · ${Math.max(0, event.capacity - event.registeredCount)} spaces left</p></div><div class="management-actions"><span class="status-badge ${h(status)}">${h(status)}</span><button class="button button-outline button-small" data-edit-event="${h(event._id)}">Edit</button>${status === 'draft' ? `<button class="button button-dark button-small" data-publish-event="${h(event._id)}">Publish</button>` : ''}${['published', 'draft'].includes(status) ? `<button class="button button-outline button-small" data-cancel-event="${h(event._id)}">Cancel</button>` : ''}${status === 'published' && new Date(event.endAt) <= new Date() ? `<button class="button button-outline button-small" data-complete-event="${h(event._id)}">Mark completed</button>` : ''}<button class="button button-outline button-small" data-view-attendees="${h(event._id)}">Attendees</button><button class="button button-outline button-small" data-export="${h(event._id)}" aria-label="Export attendees for ${h(event.title)}">CSV ↓</button>${status === 'published' ? `<a class="button button-outline button-small" href="/event.html?id=${encodeURIComponent(event._id)}">View</a>` : ''}</div></article>`;
  }

  async function loadOrganizer() {
    const { events, counts, trends } = await request('/api/dashboard/organizer');
    organizerEvents = events;
    root.innerHTML = `${pageShell('Your gatherings.', 'Bring your community together, one event at a time.', '<button class="button button-dark" id="create-event">Create an event <span aria-hidden="true">↗</span></button>')}
      ${stats([['Total events', counts.total, 'all your gatherings'], ['Published', counts.published, 'open to the community'], ['Drafts', counts.drafts, 'ideas in progress'], ['Upcoming', counts.upcoming, 'still on the calendar'], ['Completed', counts.completed, 'gatherings held'], ['Registrations', counts.registrations, 'people showing up']])}
      <section class="dashboard-section"><div class="dashboard-section-heading"><h2>Registration activity</h2><span class="eyebrow">Last 7 days</span></div><div class="trend-chart" id="trend-chart"></div></section>
      <section class="dashboard-section"><div class="dashboard-section-heading"><h2>Your events</h2><span class="eyebrow">${events.length} total</span></div><div class="management-list" id="organizer-events">${events.length ? events.map(organizerCard).join('') : empty('Your first event starts with an idea', 'Create a draft, add the details, and publish it when you are ready to welcome people.', '<button class="button button-dark button-small" id="create-first-event">Create your first event ↗</button>')}</div></section>`;
    const chart = document.getElementById('trend-chart');
    const peak = Math.max(1, ...trends.map((item) => item.count));
    chart.innerHTML = `<div class="trend-bars">${trends.map((item) => `<div class="trend-column"><span class="trend-count">${item.count ? h(item.count) : ''}</span><div class="trend-bar" style="height:${Math.max(3, item.count / peak * 100)}%" title="${item.count} confirmed registrations on ${h(item.date)}"></div><small>${h(new Date(`${item.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short' }))}</small></div>`).join('')}</div><p class="trend-note">Confirmed attendee registrations per UTC day · last 7 days</p>`;
    root.querySelector('#create-event')?.addEventListener('click', () => buildEventForm());
    root.querySelector('#create-first-event')?.addEventListener('click', () => buildEventForm());
    root.onclick = organizerClick;
  }

  async function organizerClick(event) {
    const button = event.target.closest('[data-edit-event],[data-publish-event],[data-cancel-event],[data-complete-event],[data-view-attendees],[data-export]');
    if (!button) return;
    const id = button.dataset.editEvent || button.dataset.publishEvent || button.dataset.cancelEvent || button.dataset.completeEvent || button.dataset.viewAttendees || button.dataset.export;
    if (button.dataset.editEvent) return buildEventForm(organizerEvents.find((item) => item._id === id));
    button.disabled = true;
    try {
      if (button.dataset.publishEvent) {
        await request(`/api/events/${encodeURIComponent(id)}/publish`, { method: 'POST', body: {} });
        toast('Your event is published. Let the people know!');
        await loadOrganizer();
      } else if (button.dataset.cancelEvent) {
        if (!window.confirm('Cancel this event? It will no longer be open for registration.')) {
          button.disabled = false;
          return;
        }
        await request(`/api/events/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
        toast('Event cancelled.');
        await loadOrganizer();
      } else if (button.dataset.completeEvent) {
        await request(`/api/events/${encodeURIComponent(id)}/complete`, { method: 'POST', body: {} });
        toast('Event marked completed.');
        await loadOrganizer();
      } else if (button.dataset.viewAttendees) {
        const [eventInfo, result] = await Promise.all([Promise.resolve(organizerEvents.find((item) => item._id === id)), request(`/api/events/${encodeURIComponent(id)}/registrations`)]);
        document.getElementById('attendees-title').textContent = `Attendees · ${eventInfo?.title || 'Event'}`;
        document.getElementById('attendee-list').innerHTML = result.registrations.length ? `<div class="attendee-table-wrap"><table class="attendee-table"><thead><tr><th>Name</th><th>Email</th><th>Registered</th><th>Payment</th></tr></thead><tbody>${result.registrations.map((item) => `<tr><td>${h(item.user.name)}</td><td>${h(item.user.email)}</td><td>${h(formatDate(item.registeredAt, { year: 'numeric' }))}</td><td>${h(item.paymentStatus || (eventInfo?.ticketPrice > 0 ? 'offline-payment-required' : 'not-required'))}</td></tr>`).join('')}</tbody></table></div>` : empty('No one has registered yet', 'Attendee details will appear here once someone saves their spot.');
        attendeeDialog.showModal();
      } else if (button.dataset.export) {
        const blob = await request(`/api/events/${encodeURIComponent(id)}/registrations.csv`);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `eventsync-attendees-${id}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        toast('Attendee list downloaded.');
      }
    } catch (error) { toast(error.message, true); button.disabled = false; }
  }

  async function init() {
    user = await currentUser();
    await setHeader(user);
    if (!user) {
      root.innerHTML = `${pageShell('Your people are waiting.', 'Log in or create an attendee account to see your events.', '<a class="button button-dark" href="/?login=1">Log in ↗</a>')}`;
      return;
    }
    if (user.role === 'attendee') await loadAttendee();
    else await loadOrganizer();
    document.querySelectorAll('.form-dialog .dialog-close').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
    eventDialog.addEventListener('click', (event) => { if (event.target === eventDialog) eventDialog.close(); });
    attendeeDialog.addEventListener('click', (event) => { if (event.target === attendeeDialog) attendeeDialog.close(); });
  }

  init().catch((error) => {
    if (error.status === 403) {
      root.innerHTML = `${pageShell('Your dashboard is on its way.', 'Organizer access is not enabled for this account yet.', '<a class="button button-dark" href="/">Back to discover ↗</a>')}`;
    } else {
      root.innerHTML = `<div class="error-state"><h3>We couldn’t load your dashboard</h3><p>${h(error.message)}</p><button class="button button-dark button-small" onclick="location.reload()">Try again</button></div>`;
    }
  });
})();
