const state = {
  currentView: 'dashboard',
  aiStatus: null,
};

const api = {
  async get(path) {
    const response = await fetch(path);
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || 'Request failed');
    }
    return json.data;
  },
  async post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || 'Request failed');
    }
    return json.data;
  },
  async put(path, body) {
    const response = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || 'Request failed');
    }
    return json.data;
  },
  async patch(path, body) {
    const response = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || 'Request failed');
    }
    return json.data;
  },
  async delete(path) {
    const response = await fetch(path, { method: 'DELETE' });
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || 'Request failed');
    }
    return json.data;
  },
};

function setView(view) {
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.getElementById('pageTitle').textContent = view === 'dashboard' ? 'Dashboard' : view.charAt(0).toUpperCase() + view.slice(1);
  state.currentView = view;
}

function formatMoney(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderRecentExpenses(items) {
  if (!items?.length) {
    document.getElementById('recentExpenses').innerHTML = '<div class="empty-state">No recent expenses yet.</div>';
    return;
  }
  document.getElementById('recentExpenses').innerHTML = items.map(item => `
    <div class="list-row">
      <div>
        <strong>${escapeHtml(item.description)}</strong><br/>
        <small>${escapeHtml(item.category)}</small>
      </div>
      <div>${formatMoney(item.amount)}</div>
    </div>
  `).join('');
}

function renderUpcomingTasks(items) {
  if (!items?.length) {
    document.getElementById('upcomingTasks').innerHTML = '<div class="empty-state">No upcoming tasks.</div>';
    return;
  }
  document.getElementById('upcomingTasks').innerHTML = items.map(item => `
    <div class="list-row">
      <div>
        <strong>${escapeHtml(item.title)}</strong><br/>
        <small>${item.dueDate ? new Date(item.dueDate).toLocaleDateString() : 'No due date'}</small>
      </div>
      <span class="badge ${item.priority === 'High' ? 'danger' : item.priority === 'Medium' ? 'warning' : 'success'}">${escapeHtml(item.priority)}</span>
    </div>
  `).join('');
}

function renderCategoryBreakdown(items) {
  const max = Math.max(...items.map(item => Number(item.total || 0)), 1);
  document.getElementById('categoryBreakdown').innerHTML = items.length ? items.map(item => `
    <div class="chart-item">
      <div style="width: 90px;">${escapeHtml(item.category)}</div>
      <div class="chart-bar"><span style="width:${(Number(item.total) / max) * 100}%"></span></div>
      <div>${formatMoney(item.total)}</div>
    </div>
  `).join('') : '<div class="empty-state">No categories yet.</div>';
}

function renderMonthlyTrend(items) {
  const max = Math.max(...items.map(item => Number(item.total || 0)), 1);
  document.getElementById('monthlyTrend').innerHTML = items.length ? items.map(item => `
    <div class="chart-item">
      <div style="width: 80px;">${item.month}</div>
      <div class="chart-bar"><span style="width:${(Number(item.total) / max) * 100}%"></span></div>
      <div>${formatMoney(item.total)}</div>
    </div>
  `).join('') : '<div class="empty-state">No monthly data yet.</div>';
}

async function loadDashboard() {
  try {
    const data = await api.get('/api/dashboard');
    document.getElementById('todaySpending').textContent = formatMoney(data.todaySpending);
    document.getElementById('monthSpending').textContent = formatMoney(data.monthSpending);
    document.getElementById('habitCompletionRate').textContent = `${Number(data.completionRate || 0).toFixed(0)}%`;
    document.getElementById('pendingTasks').textContent = String(data.pendingTasks || 0);
    renderRecentExpenses(data.recentExpenses || []);
    renderUpcomingTasks(data.upcomingTasks || []);
    renderCategoryBreakdown(data.categoryBreakdown || []);
    renderMonthlyTrend(data.monthlyTrend || []);
  } catch (error) {
    console.error(error);
  }
}

function renderAIStatus(status) {
  const pill = document.getElementById('aiStatus');
  const settings = document.getElementById('settingsAiStatus');
  const text = status?.status === 'configured' ? 'AI available' : 'AI unavailable';
  const html = status ? `
    <p><strong>Provider:</strong> ${escapeHtml(status.provider || 'fallback')}</p>
    <p><strong>Model:</strong> ${escapeHtml(status.model || 'n/a')}</p>
    <p><strong>Base URL:</strong> ${escapeHtml(status.baseUrl || 'n/a')}</p>
  ` : '<p>No AI status available.</p>';
  pill.textContent = text;
  settings.innerHTML = html;
}

async function loadAIStatus() {
  try {
    const status = await api.get('/api/ai/status');
    state.aiStatus = status;
    renderAIStatus(status);
  } catch (error) {
    console.error(error);
    renderAIStatus({ status: 'fallback-only', provider: 'Fallback parser', model: 'local', baseUrl: 'n/a' });
  }
}

async function loadExpenses(filters = {}) {
  const params = new URLSearchParams(filters);
  const data = await api.get(`/api/expenses?${params.toString()}`);
  const tableBody = document.getElementById('expenseTableBody');
  if (!data.length) {
    tableBody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No expenses found.</div></td></tr>';
    return;
  }

  tableBody.innerHTML = data.map((item) => `
    <tr>
      <td>${formatMoney(item.amount)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${new Date(item.date).toLocaleDateString()}</td>
      <td>
        <button class="secondary edit-expense" data-id="${item._id}">Edit</button>
        <button class="secondary delete-expense" data-id="${item._id}">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function loadHabits() {
  const data = await api.get('/api/habits');
  const list = document.getElementById('habitList');
  if (!data.length) {
    list.innerHTML = '<div class="empty-state">No habits yet. Create one to start tracking.</div>';
    return;
  }
  list.innerHTML = data.map((habit) => `
    <article class="habit-card">
      <h4>${escapeHtml(habit.name)}</h4>
      <p>${escapeHtml(habit.description || 'No description')}</p>
      <div class="badge ${habit.frequency === 'Daily' ? 'success' : 'warning'}">${escapeHtml(habit.frequency)}</div>
      <div class="habit-actions">
        <button class="complete-habit" data-id="${habit._id}">Mark complete</button>
        <button class="secondary delete-habit" data-id="${habit._id}">Delete</button>
      </div>
    </article>
  `).join('');
}

async function loadTasks(filters = {}) {
  const params = new URLSearchParams(filters);
  const data = await api.get(`/api/tasks?${params.toString()}`);
  const tableBody = document.getElementById('taskTableBody');
  if (!data.length) {
    tableBody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No tasks yet.</div></td></tr>';
    return;
  }

  tableBody.innerHTML = data.map(item => `
    <tr>
      <td>${escapeHtml(item.title)}</td>
      <td><span class="badge ${item.priority === 'High' ? 'danger' : item.priority === 'Medium' ? 'warning' : 'success'}">${escapeHtml(item.priority)}</span></td>
      <td>${item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}</td>
      <td><span class="badge ${item.status === 'completed' ? 'success' : item.status === 'overdue' ? 'danger' : 'warning'}">${escapeHtml(item.status)}</span></td>
      <td>
        <button class="secondary complete-task" data-id="${item._id}">Toggle</button>
        <button class="secondary delete-task" data-id="${item._id}">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function loadChat() {
  const messages = document.getElementById('chatMessages');
  messages.innerHTML = '<div class="message assistant">Hello! I can help track your expenses, habits, and tasks.</div>';
}

async function sendChatMessage(event) {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  const messages = document.getElementById('chatMessages');
  const userMessage = document.createElement('div');
  userMessage.className = 'message user';
  userMessage.textContent = message;
  messages.appendChild(userMessage);
  input.value = '';

  try {
    const result = await api.post('/api/ai/chat', { message });
    const assistantMessage = document.createElement('div');
    assistantMessage.className = 'message assistant';
    assistantMessage.textContent = result.assistant;
    messages.appendChild(assistantMessage);
    await loadDashboard();
    await loadExpenses();
    await loadHabits();
    await loadTasks();
  } catch (error) {
    const assistantMessage = document.createElement('div');
    assistantMessage.className = 'message assistant';
    assistantMessage.textContent = error.message;
    messages.appendChild(assistantMessage);
  }
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.getElementById('chatForm').addEventListener('submit', sendChatMessage);

document.getElementById('expenseFilterForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const filters = {
    category: document.getElementById('expenseCategoryFilter').value,
    description: document.getElementById('expenseSearch').value,
    startDate: document.getElementById('expenseStartDate').value,
    endDate: document.getElementById('expenseEndDate').value,
  };
  await loadExpenses(filters);
});

document.getElementById('openExpenseModal').addEventListener('click', () => {
  document.getElementById('expenseModal').classList.remove('hidden');
});

document.querySelectorAll('.close-modal').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.modal').forEach((modal) => modal.classList.add('hidden'));
  });
});

document.getElementById('expenseForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const body = Object.fromEntries(new FormData(form).entries());
  await api.post('/api/expenses', body);
  form.reset();
  document.getElementById('expenseModal').classList.add('hidden');
  await loadExpenses();
  await loadDashboard();
});

document.getElementById('openHabitModal').addEventListener('click', () => {
  document.getElementById('habitModal').classList.remove('hidden');
});

document.getElementById('habitForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const body = Object.fromEntries(new FormData(form).entries());
  await api.post('/api/habits', body);
  form.reset();
  document.getElementById('habitModal').classList.add('hidden');
  await loadHabits();
  await loadDashboard();
});

document.getElementById('openTaskModal').addEventListener('click', () => {
  document.getElementById('taskModal').classList.remove('hidden');
});

document.getElementById('taskForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const body = Object.fromEntries(new FormData(form).entries());
  await api.post('/api/tasks', body);
  form.reset();
  document.getElementById('taskModal').classList.add('hidden');
  await loadTasks();
  await loadDashboard();
});

document.getElementById('taskFilterStatus').addEventListener('change', async (event) => {
  const filters = {
    status: event.target.value,
    priority: document.getElementById('taskFilterPriority').value,
  };
  await loadTasks(filters);
});

document.getElementById('taskFilterPriority').addEventListener('change', async (event) => {
  const filters = {
    status: document.getElementById('taskFilterStatus').value,
    priority: event.target.value,
  };
  await loadTasks(filters);
});

document.addEventListener('click', async (event) => {
  if (event.target.matches('.delete-expense')) {
    await api.delete(`/api/expenses/${event.target.dataset.id}`);
    await loadExpenses();
    await loadDashboard();
  }
  if (event.target.matches('.delete-task')) {
    await api.delete(`/api/tasks/${event.target.dataset.id}`);
    await loadTasks();
    await loadDashboard();
  }
  if (event.target.matches('.delete-habit')) {
    await api.delete(`/api/habits/${event.target.dataset.id}`);
    await loadHabits();
    await loadDashboard();
  }
  if (event.target.matches('.complete-habit')) {
    await api.post(`/api/habits/${event.target.dataset.id}/complete`, { date: new Date().toISOString() });
    await loadHabits();
    await loadDashboard();
  }
  if (event.target.matches('.complete-task')) {
    const row = event.target.closest('tr');
    const taskId = event.target.dataset.id;
    const nextStatus = row.querySelector('.badge').textContent === 'completed' ? 'pending' : 'completed';
    await api.patch(`/api/tasks/${taskId}/status`, { status: nextStatus });
    await loadTasks();
    await loadDashboard();
  }
});

(async function init() {
  setView('dashboard');
  await loadDashboard();
  await loadAIStatus();
  await loadExpenses();
  await loadHabits();
  await loadTasks();
  await loadChat();
})();
