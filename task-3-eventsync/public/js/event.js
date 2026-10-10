(() => {
  const { currentUser, escapeHtml: h, formatDate, formatTime, request, safeUrl, setHeader, toast } = window.EventSync;
  const root = document.getElementById('event-content');
  const eventId = new URLSearchParams(location.search).get('id');

  function render(event, user) {
    const available = Math.max(0, event.capacity - event.registeredCount);
    const percent = event.capacity ? Math.min(100, event.registeredCount / event.capacity * 100) : 0;
    const venue = event.venue?.type === 'online' ? 'Online event' : [event.venue?.name, event.venue?.address].filter(Boolean).join(' · ');
    const meeting = event.venue?.type === 'online' ? (safeUrl(event.venue.meetingUrl) ? `<p><a class="text-link" href="${h(safeUrl(event.venue.meetingUrl))}" target="_blank" rel="noopener noreferrer">Join the event online ↗</a></p>` : '<p>Online meeting details are shared with confirmed attendees.</p>') : '';
    const paidEvent = Number(event.ticketPrice) > 0;
    const statusClosed = event.status !== 'published' || !available || new Date(event.registrationClosesAt) <= new Date() || new Date(event.startAt) <= new Date();
    const accessMessage = statusClosed ? (!available ? 'This event is full' : 'Registration is closed') : paidEvent ? 'Reserve a spot · pay organizer directly ↗' : 'Count me in ↗';
    root.innerHTML = `<div class="event-detail-hero" style="${safeUrl(event.coverImage) ? `background-image:url(&quot;${h(safeUrl(event.coverImage))}&quot;)` : 'background-image:linear-gradient(135deg,#dae6c8,#efd8cb 52%,#b7c7a8)'}"><span class="category-pill">${h(event.category)}</span></div>
      <div class="event-detail-layout"><section class="event-detail-main"><span class="eyebrow">${h(formatDate(event.startAt, { weekday: 'long', year: 'numeric' }))}</span><h1>${h(event.title)}</h1><div class="event-facts">
        <div class="fact"><span class="fact-icon">◷</span><span><b>${h(formatTime(event.startAt, event.timezone))} – ${h(formatTime(event.endAt, event.timezone))}</b><small>${h(event.timezone)}</small></span></div>
        <div class="fact"><span class="fact-icon">⌖</span><span><b>${h(venue || 'Venue to be announced')}</b><small>${event.venue?.type === 'online' ? 'Join from anywhere' : 'In-person gathering'}</small></span></div>
        <div class="fact"><span class="fact-icon">✳</span><span><b>${h(event.organizerName || event.organizer?.name || 'EventSync organizer')}</b><small>Organized with care</small></span></div>
        <div class="fact"><span class="fact-icon">♧</span><span><b>${available} of ${event.capacity} places available</b><small>Small groups make good things happen</small></span></div></div>
        <h2 class="section-heading-title">A little about this event</h2><p>${h(event.description)}</p>${meeting}</section>
        <aside class="booking-card"><span class="eyebrow">Save your spot</span><h3>${available ? `${available} spots left` : 'All spots taken'}</h3><div class="booking-price">${paidEvent ? `Paid event · ${h(event.currency)} ${Number(event.ticketPrice).toFixed(2)} per ticket` : 'Free to attend · no payment required'}</div>${paidEvent ? `<p class="payment-note">No payment is collected on this site. Reserve your spot, then contact the organizer${event.organizer?.email ? ` at <a href="mailto:${h(event.organizer.email)}">${h(event.organizer.email)}</a>` : ''} to arrange payment directly.</p>` : ''}
        <div class="capacity-bar" role="progressbar" aria-label="Event capacity filled" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div><small>${event.registeredCount} ${event.registeredCount === 1 ? 'person has' : 'people have'} joined so far</small>
        <button id="register-button" class="button button-coral button-full" ${(statusClosed || event.registration) ? 'disabled' : ''}>${event.registration ? (event.registration.paymentStatus === 'offline-payment-required' ? 'Reserved · payment pending' : 'You’re registered ✓') : statusClosed ? h(accessMessage) : user ? h(accessMessage) : 'Log in to register ↗'}</button>
        ${event.registration?.paymentStatus === 'offline-payment-required' ? `<p class="payment-note">Your spot is reserved. No payment was collected. Please contact the organizer${event.organizer?.email ? ` at <a href="mailto:${h(event.organizer.email)}">${h(event.organizer.email)}</a>` : ''} to arrange payment.</p>` : ''}
        <div class="organizer-note">A good thing, brought to you by<b>${h(event.organizerName || event.organizer?.name || 'Your event host')}</b></div></aside></div>`;
    document.getElementById('register-button').addEventListener('click', async () => {
      if (!user) {
        const returnTo = `${location.pathname}${location.search}`;
        location.href = `/?login=1&returnTo=${encodeURIComponent(returnTo)}`;
        return;
      }
      const button = document.getElementById('register-button');
      button.disabled = true;
      try {
        const result = await request(`/api/events/${encodeURIComponent(event._id)}/register`, { method: 'POST', body: {} });
        toast(result.message);
        button.textContent = result.registration.paymentStatus === 'offline-payment-required' ? 'Reserved · payment pending' : 'You’re registered ✓';
        const note = document.createElement('p');
        note.className = 'payment-note';
        note.textContent = result.message;
        button.insertAdjacentElement('afterend', note);
      } catch (error) {
        toast(error.message, true);
        button.disabled = false;
      }
    });
  }

  async function init() {
    const user = await currentUser();
    await setHeader(user);
    if (!eventId) {
      root.innerHTML = '<div class="error-state"><h3>We can’t find that event</h3><p>This event link is missing its details.</p><a class="button button-dark button-small" href="/">Discover events</a></div>';
      return;
    }
    try {
      const { event, registration } = await request(`/api/events/${encodeURIComponent(eventId)}`);
      document.title = `${event.title} — EventSync`;
      event.registration = registration;
      render(event, user);
    } catch (error) {
      root.innerHTML = `<div class="error-state"><h3>This event is taking a little break</h3><p>${h(error.message)}</p><a class="button button-dark button-small" href="/">Back to discover</a></div>`;
    }
  }
  init().catch((error) => { root.innerHTML = `<div class="error-state"><h3>Something went wrong</h3><p>${h(error.message)}</p></div>`; });
})();
