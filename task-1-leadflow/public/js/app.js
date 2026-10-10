const statusLabels = ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'];

const elements = {
  addButton: document.querySelector('#add-lead-button'),
  closeDialogButton: document.querySelector('#close-dialog-button'),
  cancelDialogButton: document.querySelector('#cancel-dialog-button'),
  dialog: document.querySelector('#lead-dialog'),
  dialogTitle: document.querySelector('#dialog-title'),
  form: document.querySelector('#lead-form'),
  formError: document.querySelector('#form-error'),
  saveButton: document.querySelector('#save-lead-button'),
  saveButtonLabel: document.querySelector('#save-button-label'),
  tableBody: document.querySelector('#leads-table-body'),
  search: document.querySelector('#search-input'),
  statusFilter: document.querySelector('#status-filter'),
  sourceFilter: document.querySelector('#source-filter'),
  visibleCount: document.querySelector('#visible-lead-count'),
  tableSummary: document.querySelector('#table-summary'),
  totalMetric: document.querySelector('#metric-total'),
  newMetric: document.querySelector('#metric-new'),
  qualifiedMetric: document.querySelector('#metric-qualified'),
  convertedMetric: document.querySelector('#metric-converted'),
  lostMetric: document.querySelector('#metric-lost'),
  sidebarCount: document.querySelector('#sidebar-lead-count'),
  refreshButton: document.querySelector('#refresh-button'),
  footerRefreshButton: document.querySelector('#footer-refresh-button'),
  toast: document.querySelector('#toast'),
  todayLabel: document.querySelector('#today-label'),
};

let currentLeads = [];
let editingLeadId = null;
let searchTimer;
let toastTimer;
let listRequestId = 0;

elements.todayLabel.textContent = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
}).format(new Date());

function escapeStatusClass(status) {
  return status.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Could not reach LeadFlow. Check that the server is running and try again.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response. Please try again.');
  }

  if (!response.ok || result.success === false) {
    throw new Error(result.error?.message || 'The request could not be completed.');
  }

  return result;
}

function setTableMessage(message, { isError = false } = {}) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 6;
  cell.className = `table-message${isError ? ' error' : ''}`;
  cell.textContent = message;
  row.append(cell);
  elements.tableBody.replaceChildren(row);
}

function updateMetrics(leads) {
  const counts = Object.fromEntries(statusLabels.map((status) => [status, 0]));
  for (const lead of leads) {
    if (Object.hasOwn(counts, lead.status)) {
      counts[lead.status] += 1;
    }
  }

  elements.totalMetric.textContent = String(leads.length);
  elements.newMetric.textContent = String(counts.New);
  elements.qualifiedMetric.textContent = String(counts.Qualified);
  elements.convertedMetric.textContent = String(counts.Converted);
  elements.lostMetric.textContent = String(counts.Lost);
  elements.sidebarCount.textContent = String(leads.length);
}

function updateSourceOptions(leads) {
  const selectedSource = elements.sourceFilter.value;
  const sources = [...new Set(leads.map((lead) => lead.source).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const options = [new Option('All sources', '')];

  for (const source of sources) {
    options.push(new Option(source, source));
  }

  elements.sourceFilter.replaceChildren(...options);
  if (sources.includes(selectedSource)) {
    elements.sourceFilter.value = selectedSource;
  }
}

function appendTextCell(row, text, className = '') {
  const cell = document.createElement('td');
  if (className) {
    cell.className = className;
  }
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function createLeadCell(lead) {
  const cell = document.createElement('td');
  const wrapper = document.createElement('div');
  wrapper.className = 'lead-cell';

  const avatar = document.createElement('span');
  avatar.className = 'lead-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = getInitials(lead.name);

  const copy = document.createElement('span');
  copy.className = 'lead-copy';
  const name = document.createElement('strong');
  name.textContent = lead.name;
  const email = document.createElement('span');
  email.textContent = lead.email;
  copy.append(name, email);
  wrapper.append(avatar, copy);
  cell.append(wrapper);
  return cell;
}

function createStatusCell(status) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `status-badge status-${escapeStatusClass(status)}`;
  badge.textContent = status;
  cell.append(badge);
  return cell;
}

function createActionButton(action, label, icon, { danger = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-button${danger ? ' danger' : ''}`;
  button.dataset.action = action;
  button.dataset.id = icon.leadId;
  button.setAttribute('aria-label', `${label} ${icon.leadName}`);
  button.title = `${label} lead`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', action === 'edit'
    ? 'm13.8 4.2 2 2M4 16l3.7-.8 8.8-8.8a1.4 1.4 0 0 0-2-2l-8.8 8.8L4 16Z'
    : 'M5 6.5h10M8 6.5V4h4v2.5m-5.5 0 .6 9.2h4.8l.6-9.2');
  svg.append(path);
  button.append(svg);
  return button;
}

function renderLeads(leads) {
  currentLeads = leads;
  elements.visibleCount.textContent = String(leads.length);
  elements.tableSummary.textContent = leads.length === 1
    ? 'Showing 1 lead'
    : `Showing ${leads.length} leads`;

  if (leads.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('strong');
    const description = document.createElement('span');
    const hasFilters = Boolean(
      elements.search.value.trim() || elements.statusFilter.value || elements.sourceFilter.value,
    );

    title.textContent = hasFilters ? 'No leads match those filters' : 'Your pipeline starts here';
    description.textContent = hasFilters
      ? 'Try a different search or clear a filter to see more leads.'
      : 'Add your first lead and keep every opportunity in one place.';
    empty.append(title, description);

    if (!hasFilters) {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'button button-primary';
      addButton.dataset.action = 'add';
      addButton.textContent = 'Add your first lead';
      empty.append(addButton);
    }
    cell.append(empty);
    row.append(cell);
    elements.tableBody.replaceChildren(row);
    return;
  }

  const rows = leads.map((lead) => {
    const row = document.createElement('tr');
    row.append(createLeadCell(lead));
    appendTextCell(row, lead.company, 'company-cell');
    const sourceCell = appendTextCell(row, '');
    const sourceChip = document.createElement('span');
    sourceChip.className = 'source-chip';
    sourceChip.textContent = lead.source;
    sourceCell.append(sourceChip);
    row.append(createStatusCell(lead.status));
    appendTextCell(row, formatDate(lead.createdAt), 'date-cell');

    const actionsCell = document.createElement('td');
    const actions = document.createElement('span');
    actions.className = 'row-actions';
    actions.append(
      createActionButton('edit', 'Edit', { leadId: lead._id, leadName: lead.name }),
      createActionButton('delete', 'Delete', { leadId: lead._id, leadName: lead.name }, { danger: true }),
    );
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  });

  elements.tableBody.replaceChildren(...rows);
}

function showToast(message, { isError = false } = {}) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('visible');
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3400);
}

async function loadLeads({ showLoading = true } = {}) {
  const requestId = ++listRequestId;
  const params = new URLSearchParams();
  const search = elements.search.value.trim();
  if (search) params.set('search', search);
  if (elements.statusFilter.value) params.set('status', elements.statusFilter.value);
  if (elements.sourceFilter.value) params.set('source', elements.sourceFilter.value);

  if (showLoading) {
    setTableMessage('Loading your leads…');
  }

  try {
    const query = params.toString();
    const result = await apiRequest(`/api/leads${query ? `?${query}` : ''}`);
    if (requestId !== listRequestId) return;
    renderLeads(result.data);
  } catch (error) {
    if (requestId !== listRequestId) return;
    setTableMessage(error.message, { isError: true });
    elements.visibleCount.textContent = '!';
    elements.tableSummary.textContent = 'Could not load leads';
  }
}

async function loadDashboard({ showLoading = true } = {}) {
  if (showLoading) {
    setTableMessage('Loading your leads…');
  }

  try {
    const result = await apiRequest('/api/leads');
    updateMetrics(result.data);
    updateSourceOptions(result.data);
    await loadLeads({ showLoading: false });
  } catch (error) {
    updateMetrics([]);
    setTableMessage(error.message, { isError: true });
    elements.visibleCount.textContent = '!';
    elements.tableSummary.textContent = 'Could not load leads';
    showToast(error.message, { isError: true });
  }
}

function openCreateDialog() {
  editingLeadId = null;
  elements.form.reset();
  elements.form.elements.status.value = 'New';
  elements.dialogTitle.textContent = 'Add a lead';
  elements.saveButtonLabel.textContent = 'Save lead';
  elements.formError.hidden = true;
  elements.formError.textContent = '';
  elements.dialog.showModal();
  elements.form.elements.name.focus();
}

async function openEditDialog(id) {
  try {
    const result = await apiRequest(`/api/leads/${encodeURIComponent(id)}`);
    const lead = result.data;
    editingLeadId = lead._id;
    elements.form.reset();
    for (const field of ['name', 'email', 'phone', 'company', 'source', 'enquiry', 'status']) {
      elements.form.elements[field].value = lead[field] || '';
    }
    elements.dialogTitle.textContent = 'Edit lead';
    elements.saveButtonLabel.textContent = 'Save changes';
    elements.formError.hidden = true;
    elements.formError.textContent = '';
    elements.dialog.showModal();
    elements.form.elements.name.focus();
  } catch (error) {
    showToast(error.message, { isError: true });
  }
}

async function deleteLead(id) {
  const lead = currentLeads.find((item) => item._id === id);
  if (!lead) return;
  if (!window.confirm(`Delete ${lead.name}? This action cannot be undone.`)) return;

  try {
    const result = await apiRequest(`/api/leads/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    showToast(result.message || 'Lead deleted.');
    await loadDashboard({ showLoading: false });
  } catch (error) {
    showToast(error.message, { isError: true });
  }
}

function closeDialog() {
  elements.dialog.close();
  elements.formError.hidden = true;
  elements.formError.textContent = '';
}

elements.addButton.addEventListener('click', openCreateDialog);
elements.closeDialogButton.addEventListener('click', closeDialog);
elements.cancelDialogButton.addEventListener('click', closeDialog);
elements.dialog.addEventListener('click', (event) => {
  if (event.target === elements.dialog) closeDialog();
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.formError.hidden = true;
  elements.formError.textContent = '';

  if (!elements.form.reportValidity()) {
    return;
  }

  const formData = new FormData(elements.form);
  const payload = Object.fromEntries(formData.entries());
  elements.saveButton.disabled = true;
  elements.saveButtonLabel.textContent = editingLeadId ? 'Saving…' : 'Adding…';

  try {
    const result = await apiRequest(
      editingLeadId ? `/api/leads/${encodeURIComponent(editingLeadId)}` : '/api/leads',
      {
        method: editingLeadId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      },
    );
    closeDialog();
    showToast(result.message || (editingLeadId ? 'Lead updated.' : 'Lead added.'));
    await loadDashboard({ showLoading: false });
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.hidden = false;
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButtonLabel.textContent = editingLeadId ? 'Save changes' : 'Save lead';
  }
});

elements.tableBody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  if (button.dataset.action === 'add') {
    openCreateDialog();
  } else if (button.dataset.action === 'edit') {
    openEditDialog(button.dataset.id);
  } else if (button.dataset.action === 'delete') {
    deleteLead(button.dataset.id);
  }
});

elements.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => loadLeads({ showLoading: false }), 250);
});

elements.statusFilter.addEventListener('change', () => loadLeads());
elements.sourceFilter.addEventListener('change', () => loadLeads());
elements.refreshButton.addEventListener('click', () => loadDashboard());
elements.footerRefreshButton.addEventListener('click', () => loadDashboard());

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    elements.search.focus();
  }
});

loadDashboard();
