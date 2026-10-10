(() => {
  const { currentUser, escapeHtml: h, formatDate, request, safeUrl, setHeader, toast } = window.EventSync;
  const categories = ['Technology', 'Business', 'Arts', 'Music', 'Food', 'Wellness', 'Education', 'Community', 'Other'];
  const grid = document.getElementById('event-grid');
  const form = document.getElementById('search-form');
  const dialog = document.getElementById('auth-dialog');
  const authForm = document.getElementById('auth-form');
  let page = 1;
  let authMode = 'login';
  let signedInUser = null;

  function coverStyle(value) {
    const url = safeUrl(value);
    return url ? `background-image:url("${h(url)}")` : 'background-image:linear-gradient(135deg,#dae6c8,#efd8cb 52%,#b7c7a8)';
  }

  function card(event) {
    const available = Math.max(0, event.capacity - event.registeredCount);
    const location = event.venue?.type === 'online' ? 'Online event' : event.venue?.name || event.venue?.address || 'Venue to be announced';
    return `<a class="event-card" href="/event.html?id=${encodeURIComponent(event._id)}">
      <div class="event-cover" style="${coverStyle(event.coverImage)}"><span class="category-pill">${h(event.category)}</span></div>
      <div class="event-card-body"><span class="event-card-date">${h(formatDate(event.startAt, { weekday: 'short', year: 'numeric' }))}</span>
      <h3>${h(event.title)}</h3><p class="event-card-desc">${h(event.description)}</p>
      <div class="event-card-foot"><span class="card-venue">⌖ ${h(location)}</span><span>${available ? `<b>${available}</b> spots left` : '<b>Wait for next time</b>'}</span><span class="card-arrow" aria-hidden="true">↗</span></div></div></a>`;
  }

  async function loadEvents() {
    grid.innerHTML = '<div class="loading-panel"><span class="spinner"></span><span>Finding your next thing…</span></div>';
    const params = new URLSearchParams({ page, limit: 9, sort: document.getElementById('sort-filter').value });
    const query = document.getElementById('search-input').value.trim();
    const category = document.getElementById('category-filter').value;
    const date = document.getElementById('date-filter').value;
    if (query) params.set('q', query);
    if (category) params.set('category', category);
    if (date) params.set('from', new Date(`${date}T00:00:00`).toISOString());
    try {
      const { events, pagination } = await request(`/api/events?${params}`);
      document.getElementById('results-label').textContent = `${pagination.total} ${pagination.total === 1 ? 'lovely event' : 'lovely events'} to explore`;
      grid.innerHTML = events.length ? events.map(card).join('') : '<div class="empty-state"><div class="empty-icon">✳</div><h3>Nothing on the calendar just yet</h3><p>Try a different search or check back soon. Your next good thing is out there.</p><button class="button button-outline button-small" id="clear-filters">Clear filters</button></div>';
      const pages = document.getElementById('pagination');
      pages.innerHTML = pagination.pages > 1 ? Array.from({ length: pagination.pages }, (_, index) => `<button type="button" class="${page === index + 1 ? 'selected' : ''}" data-page="${index + 1}" aria-label="Go to page ${index + 1}">${index + 1}</button>`).join('') : '';
    } catch (error) {
      grid.innerHTML = `<div class="error-state"><h3>Events are taking a moment</h3><p>${h(error.message)}</p><button class="button button-dark button-small" id="retry-events">Try again</button></div>`;
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === 'register';
    document.getElementById('auth-title').textContent = registering ? 'Find your people' : 'Welcome back';
    document.getElementById('auth-intro').textContent = registering ? 'Create your free account and get out there.' : 'Log in and find your people.';
    document.getElementById('name-label').hidden = !registering;
    document.getElementById('name-label').querySelector('input').required = registering;
    document.querySelector('[name=password]').autocomplete = registering ? 'new-password' : 'current-password';
    document.querySelector('[name=password]').minLength = registering ? 10 : 1;
    document.getElementById('auth-submit').innerHTML = registering ? 'Create my account <span aria-hidden="true">↗</span>' : 'Log in <span aria-hidden="true">↗</span>';
    document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.classList.toggle('selected', tab.dataset.authTab === mode));
    document.getElementById('auth-error').textContent = '';
  }

  categories.forEach((category) => document.getElementById('category-filter').add(new Option(category, category)));
  document.getElementById('search-form').addEventListener('submit', (event) => { event.preventDefault(); page = 1; loadEvents(); });
  document.getElementById('sort-filter').addEventListener('change', () => { page = 1; loadEvents(); });
  document.getElementById('pagination').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (button) { page = Number(button.dataset.page); loadEvents(); document.getElementById('discover').scrollIntoView({ behavior: 'smooth' }); }
  });
  grid.addEventListener('click', (event) => {
    if (event.target.closest('#clear-filters')) {
      form.reset(); page = 1; loadEvents();
    } else if (event.target.closest('#retry-events')) loadEvents();
  });
  document.getElementById('header-actions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-auth-open]');
    if (!button) return;
    setAuthMode(button.dataset.authOpen);
    dialog.showModal();
  });
  document.querySelectorAll('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authTab)));
  document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(authForm));
    const button = document.getElementById('auth-submit');
    button.disabled = true;
    document.getElementById('auth-error').textContent = '';
    try {
      const { user } = await request(`/api/auth/${authMode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: data });
      signedInUser = user;
      await setHeader(user);
      dialog.close();
      authForm.reset();
      toast(authMode === 'register' ? 'Welcome to EventSync. Let’s find your next thing.' : 'Welcome back.');
      const returnTo = new URLSearchParams(location.search).get('returnTo');
      if (returnTo) {
        const target = new URL(returnTo, location.origin);
        if (target.origin === location.origin && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
          location.assign(target.href);
          return;
        }
      }
      if (new URLSearchParams(location.search).has('login') || new URLSearchParams(location.search).has('register')) history.replaceState(null, '', '/');
    } catch (error) {
      document.getElementById('auth-error').textContent = error.details?.join(' ') || error.message;
    } finally { button.disabled = false; }
  });
  document.querySelector('[data-host-start]').addEventListener('click', async () => {
    if (!signedInUser) { setAuthMode('register'); dialog.showModal(); return; }
    if (signedInUser.role === 'attendee') {
      toast('Hosting tools are enabled for organizer accounts. Ask an administrator to update your role.', true);
      return;
    }
    location.href = '/dashboard.html';
  });

  currentUser().then(async (user) => {
    signedInUser = user;
    await setHeader(user);
    const params = new URLSearchParams(location.search);
    if (!user && (params.has('login') || params.has('register'))) {
      setAuthMode(params.has('register') ? 'register' : 'login');
      dialog.showModal();
    }
  }).catch((error) => toast(error.message, true));
  loadEvents();
})();
