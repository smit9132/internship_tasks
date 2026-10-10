(function () {
  let csrfToken = '';

  class ApiError extends Error {
    constructor(message, status, details) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }

  async function getCsrfToken(force = false) {
    if (!csrfToken || force) {
      const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const body = await response.json();
      if (!response.ok) throw new ApiError(body.error || 'Could not start a secure session.', response.status);
      csrfToken = body.csrfToken;
    }
    return csrfToken;
  }

  async function request(path, options = {}) {
    const method = options.method || 'GET';
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', await getCsrfToken());
    const response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const isFile = response.headers.get('content-type')?.includes('text/csv');
    if (isFile) {
      if (!response.ok) throw new ApiError('Could not download the attendee list.', response.status);
      return response.blob();
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(body.error || 'Something went wrong. Please try again.', response.status, body.details);
    if (path === '/api/auth/login' || path === '/api/auth/register') await getCsrfToken(true);
    if (path === '/api/auth/logout') {
      csrfToken = '';
      await getCsrfToken(true);
    }
    return body;
  }

  async function currentUser() {
    try {
      return (await request('/api/auth/me')).user;
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, window.location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function formatDate(value, options = {}) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date to be announced';
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...options }).format(date);
  }

  function formatTime(value, timezone = undefined) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(date);
    } catch {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
    }
  }

  function toast(message, error = false) {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast${error ? ' error' : ''}`;
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  async function setHeader(user) {
    const header = document.getElementById('header-actions');
    if (!header) return;
    if (!user) {
      if (!document.getElementById('auth-dialog')) {
        header.innerHTML = '<a class="button button-quiet" href="/?login=1">Log in</a><a class="button button-dark" href="/?register=1">Get started <span aria-hidden="true">↗</span></a>';
        return;
      }
      header.innerHTML = '<button class="button button-quiet" data-auth-open="login">Log in</button><button class="button button-dark" data-auth-open="register">Get started <span aria-hidden="true">↗</span></button>';
      return;
    }
    header.innerHTML = `<a class="button button-quiet" href="/dashboard.html">${escapeHtml(user.name.split(' ')[0])} · My events</a>${user.role === 'admin' ? '<a class="button button-quiet" href="/admin.html">Admin</a>' : ''}<button class="button button-dark" data-logout>Log out</button>`;
    header.querySelector('[data-logout]').addEventListener('click', async () => {
      try {
        await request('/api/auth/logout', { method: 'POST', body: {} });
        window.location.href = '/';
      } catch (error) { toast(error.message, true); }
    });
  }

  window.EventSync = { ApiError, currentUser, escapeHtml, formatDate, formatTime, getCsrfToken, request, safeUrl, setHeader, toast };
  document.querySelectorAll('#year').forEach((node) => { node.textContent = new Date().getFullYear(); });
})();
