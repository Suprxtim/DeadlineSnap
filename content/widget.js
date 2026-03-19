// DeadlineSnap Floating Widget — Content Script
// Injected on every page, uses Shadow DOM for CSS isolation

(function () {
    'use strict';

    // Prevent double injection
    if (document.getElementById('deadlinesnap-widget-host')) return;

    // ─── State ────────────────────────────────────────────────────
    let state = 'collapsed'; // collapsed | expanded | hidden | dismissed
    let tasks = [];
    let settings = {};
    let snoozedTasks = {};
    let dismissedUntil = 0;
    let autoHideTimer = null;
    let countdownInterval = null;
    let dragState = null;
    let widgetPosition = null; // { bottom, right } in px
    let activeSnoozeMenu = null;

    // ─── Shadow DOM Setup ─────────────────────────────────────────
    const hostEl = document.createElement('div');
    hostEl.id = 'deadlinesnap-widget-host';
    hostEl.style.cssText = 'all:initial; position:fixed; z-index:999999; bottom:0; right:0; width:0; height:0; pointer-events:none;';
    document.documentElement.appendChild(hostEl);

    const shadow = hostEl.attachShadow({ mode: 'closed' });

    // Load CSS
    const cssUrl = chrome.runtime.getURL('content/widget.css');
    const linkEl = document.createElement('link');
    linkEl.rel = 'stylesheet';
    linkEl.href = cssUrl;
    shadow.appendChild(linkEl);

    // Widget container
    const widget = document.createElement('div');
    widget.className = 'ds-widget';
    shadow.appendChild(widget);

    // ─── Helpers ───────────────────────────────────────────────────
    function getUrgencyInfo(deadline) {
        if (!deadline) return { class: 'ds-safe', label: 'No date', hearts: '♡♡♡', ms: Infinity };
        const now = new Date();
        const dl = new Date(deadline + 'T23:59:59');
        const ms = dl.getTime() - now.getTime();
        const totalHours = ms / (1000 * 60 * 60);
        const days = Math.floor(totalHours / 24);
        const hours = Math.floor(totalHours % 24);
        const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

        if (ms < 0) {
            return { class: 'ds-overdue', label: 'OVERDUE', hearts: '💔💔💔', ms };
        } else if (totalHours < 1) {
            return { class: 'ds-overdue', label: `${mins}m left`, hearts: '💔💔💔', ms };
        } else if (days < 1) {
            return { class: 'ds-overdue', label: `${hours}h ${mins}m`, hearts: '❤️💔💔', ms };
        } else if (days < 3) {
            return { class: 'ds-warning', label: `${days}d ${hours}h`, hearts: '❤️❤️💔', ms };
        } else if (days < 7) {
            return { class: 'ds-safe', label: `${days}d ${hours}h`, hearts: '❤️❤️❤️', ms };
        } else {
            return { class: 'ds-safe', label: `${days}d`, hearts: '❤️❤️❤️', ms };
        }
    }

    function formatCountdown(deadline) {
        if (!deadline) return '—';
        const now = new Date();
        const dl = new Date(deadline + 'T23:59:59');
        const ms = dl.getTime() - now.getTime();
        if (ms < 0) return 'OVERDUE';
        const d = Math.floor(ms / (1000 * 60 * 60 * 24));
        const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((ms % (1000 * 60)) / 1000);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        return `${m}m ${s}s`;
    }

    function getCategoryIcon(cat) {
        const icons = { scholarship: '📚', internship: '💼', event: '🎯', course: '📖', other: '📌' };
        return icons[cat] || '📌';
    }

    function isSnoozed(taskId) {
        const wake = snoozedTasks[taskId];
        if (!wake) return false;
        return Date.now() < wake;
    }

    function isOnBlacklist() {
        const bl = settings.widgetBlacklist || '';
        if (!bl.trim()) return false;
        const domains = bl.split('\n').map(d => d.trim().toLowerCase()).filter(Boolean);
        const host = window.location.hostname.toLowerCase();
        return domains.some(d => host === d || host.endsWith('.' + d));
    }

    // ─── Filter & Sort Tasks ──────────────────────────────────────
    function getUrgentTasks() {
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        return tasks
            .filter(t => {
                if (t.status !== 'pending') return false;
                if (!t.deadline) return false;
                if (isSnoozed(t.id)) return false;
                const dl = new Date(t.deadline + 'T23:59:59').getTime();
                const diff = dl - now;
                // Show overdue + tasks within 7 days
                return diff < sevenDaysMs;
            })
            .sort((a, b) => {
                const aT = new Date(a.deadline + 'T23:59:59').getTime();
                const bT = new Date(b.deadline + 'T23:59:59').getTime();
                return aT - bT;
            })
            .slice(0, 3);
    }

    function getTodayCount() {
        const now = new Date();
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        return tasks.filter(t => {
            if (t.status !== 'pending' || !t.deadline) return false;
            if (isSnoozed(t.id)) return false;
            const dl = new Date(t.deadline + 'T23:59:59').getTime();
            return dl - Date.now() < sevenDaysMs;
        }).length;
    }

    // ─── Render Functions ─────────────────────────────────────────
    function render() {
        if (state === 'hidden' || state === 'dismissed') {
            widget.classList.add('ds-hidden');
            return;
        }
        widget.classList.remove('ds-hidden');
        widget.classList.remove('ds-auto-hiding');
        widget.innerHTML = '';

        if (state === 'collapsed') {
            renderBadge();
        } else if (state === 'expanded') {
            renderCard();
        }

        applyPosition();
    }

    function renderBadge() {
        const count = getTodayCount();
        const urgentTasks = getUrgentTasks();
        let urgencyClass = '';

        if (urgentTasks.some(t => {
            const dl = new Date(t.deadline + 'T23:59:59').getTime();
            return dl < Date.now();
        })) {
            urgencyClass = 'ds-urgent';
        } else if (urgentTasks.some(t => {
            const dl = new Date(t.deadline + 'T23:59:59').getTime();
            return (dl - Date.now()) < 3 * 24 * 60 * 60 * 1000;
        })) {
            urgencyClass = 'ds-warning';
        }

        const badge = document.createElement('div');
        badge.className = `ds-badge ${urgencyClass}`;
        badge.innerHTML = `<span class="ds-badge-icon">🔔</span> <span>${count} task${count !== 1 ? 's' : ''}</span>`;
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            state = 'expanded';
            resetAutoHide();
            render();
        });

        widget.appendChild(badge);
    }

    function renderCard() {
        const urgentTasks = getUrgentTasks();

        const card = document.createElement('div');
        card.className = 'ds-card';

        // Header
        const header = document.createElement('div');
        header.className = 'ds-card-header';
        header.innerHTML = `
            <div class="ds-card-title">🔔 DEADLINES</div>
            <div class="ds-card-actions">
                <button class="ds-icon-btn ds-minimize" title="Minimize">_</button>
                <button class="ds-icon-btn ds-close" title="Close">×</button>
            </div>
        `;

        header.querySelector('.ds-minimize').addEventListener('click', (e) => {
            e.stopPropagation();
            state = 'collapsed';
            resetAutoHide();
            render();
        });

        header.querySelector('.ds-close').addEventListener('click', (e) => {
            e.stopPropagation();
            dismissWidget();
        });

        // Drag handling on header
        setupDrag(header);

        card.appendChild(header);

        // Task list
        const list = document.createElement('div');
        list.className = 'ds-task-list';

        if (urgentTasks.length === 0) {
            list.innerHTML = `
                <div class="ds-empty">
                    <div class="ds-empty-icon">✨</div>
                    <div class="ds-empty-text">No urgent deadlines!<br>You're all caught up.</div>
                </div>
            `;
        } else {
            urgentTasks.forEach(task => {
                list.appendChild(createTaskItem(task));
            });
        }

        card.appendChild(list);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'ds-card-footer';
        const totalPending = tasks.filter(t => t.status === 'pending').length;
        footer.innerHTML = `
            <span class="ds-footer-text">${totalPending} total pending</span>
        `;

        const openBtn = document.createElement('button');
        openBtn.className = 'ds-open-popup-btn';
        openBtn.textContent = 'OPEN ▸';
        openBtn.title = 'Open DeadlineSnap popup';
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: 'openPopup' });
        });
        footer.appendChild(openBtn);

        card.appendChild(footer);
        widget.appendChild(card);
    }

    function createTaskItem(task) {
        const urgency = getUrgencyInfo(task.deadline);
        const item = document.createElement('div');
        item.className = `ds-task-item ${urgency.class}`;
        item.style.position = 'relative';

        // Thumbnail
        const thumb = document.createElement('div');
        thumb.className = 'ds-task-thumb';
        if (task.screenshotBase64) {
            const img = document.createElement('img');
            img.src = task.screenshotBase64;
            img.alt = task.title;
            thumb.appendChild(img);
        } else {
            thumb.textContent = getCategoryIcon(task.category);
        }

        // Info
        const info = document.createElement('div');
        info.className = 'ds-task-info';

        const title = document.createElement('div');
        title.className = 'ds-task-title';
        title.textContent = task.title || 'Untitled';
        title.addEventListener('click', (e) => {
            e.stopPropagation();
            showDetailModal(task);
        });

        const countdown = document.createElement('div');
        countdown.className = `ds-task-countdown ${urgency.class}`;
        countdown.textContent = urgency.label;
        countdown.setAttribute('data-deadline', task.deadline);

        const hearts = document.createElement('div');
        hearts.className = 'ds-task-hearts';
        hearts.textContent = urgency.hearts;

        // Actions row
        const actions = document.createElement('div');
        actions.className = 'ds-task-actions';

        const completeBtn = document.createElement('button');
        completeBtn.className = 'ds-action-btn ds-complete';
        completeBtn.textContent = '✓ Done';
        completeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            completeTask(task.id);
        });

        const snoozeBtn = document.createElement('button');
        snoozeBtn.className = 'ds-action-btn ds-snooze';
        snoozeBtn.textContent = '💤';
        snoozeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSnoozeMenu(item, task.id);
        });

        actions.appendChild(completeBtn);
        actions.appendChild(snoozeBtn);

        info.appendChild(title);
        info.appendChild(countdown);
        info.appendChild(hearts);
        info.appendChild(actions);

        item.appendChild(thumb);
        item.appendChild(info);

        item.addEventListener('click', () => showDetailModal(task));

        return item;
    }

    // ─── Snooze ───────────────────────────────────────────────────
    function toggleSnoozeMenu(itemEl, taskId) {
        // Close any open menu first
        closeSnoozeMenus();

        const menu = document.createElement('div');
        menu.className = 'ds-snooze-menu ds-open';

        const options = [
            { label: '⏰ 15 min', ms: 15 * 60 * 1000 },
            { label: '🕐 1 hour', ms: 60 * 60 * 1000 },
            { label: '📅 1 day', ms: 24 * 60 * 60 * 1000 },
        ];

        options.forEach(opt => {
            const el = document.createElement('div');
            el.className = 'ds-snooze-option';
            el.textContent = opt.label;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                snoozeTask(taskId, opt.ms);
                closeSnoozeMenus();
            });
            menu.appendChild(el);
        });

        itemEl.appendChild(menu);
        activeSnoozeMenu = menu;
    }

    function closeSnoozeMenus() {
        if (activeSnoozeMenu) {
            activeSnoozeMenu.remove();
            activeSnoozeMenu = null;
        }
    }

    // ─── Actions ──────────────────────────────────────────────────
    async function completeTask(taskId) {
        try {
            const data = await chrome.storage.local.get('tasks');
            const allTasks = data.tasks || [];
            const idx = allTasks.findIndex(t => t.id === taskId);
            if (idx !== -1) {
                allTasks[idx].status = 'completed';
                allTasks[idx].completedAt = new Date().toISOString();
                await chrome.storage.local.set({ tasks: allTasks });
                chrome.runtime.sendMessage({ action: 'updateBadge' });
            }
        } catch (e) {
            console.error('DeadlineSnap: complete failed', e);
        }
    }

    async function snoozeTask(taskId, durationMs) {
        const wakeTime = Date.now() + durationMs;
        snoozedTasks[taskId] = wakeTime;
        try {
            await chrome.storage.local.set({ widgetSnoozed: snoozedTasks });
        } catch (e) {
            console.error('DeadlineSnap: snooze save failed', e);
        }
        render();
    }

    function dismissWidget() {
        // Dismiss for 1 hour
        dismissedUntil = Date.now() + 60 * 60 * 1000;
        chrome.storage.local.set({ widgetDismissedUntil: dismissedUntil });
        state = 'dismissed';
        render();
    }

    // ─── Detail Modal ─────────────────────────────────────────────
    function showDetailModal(task) {
        closeSnoozeMenus();
        const urgency = getUrgencyInfo(task.deadline);

        const overlay = document.createElement('div');
        overlay.className = 'ds-modal-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const modal = document.createElement('div');
        modal.className = 'ds-modal';

        // Header
        const header = document.createElement('div');
        header.className = 'ds-modal-header';
        header.innerHTML = `<span class="ds-modal-title">📋 TASK DETAIL</span>`;
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ds-icon-btn ds-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => overlay.remove());
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'ds-modal-body';

        // Screenshot
        if (task.screenshotBase64) {
            const ssDiv = document.createElement('div');
            ssDiv.className = 'ds-modal-screenshot';
            const img = document.createElement('img');
            img.src = task.screenshotBase64;
            img.alt = task.title;
            ssDiv.appendChild(img);
            body.appendChild(ssDiv);
        }

        // Title
        const titleField = document.createElement('div');
        titleField.className = 'ds-modal-field';
        titleField.innerHTML = `<span class="ds-modal-label">Title</span><span class="ds-modal-value">${escapeHtml(task.title || 'Untitled')}</span>`;
        body.appendChild(titleField);

        // Category
        if (task.category) {
            const catField = document.createElement('div');
            catField.className = 'ds-modal-field';
            catField.innerHTML = `<span class="ds-modal-label">Category</span>`;
            const badge = document.createElement('span');
            badge.className = `ds-category-badge ${task.category}`;
            badge.textContent = `${getCategoryIcon(task.category)} ${task.category.toUpperCase()}`;
            catField.appendChild(badge);
            body.appendChild(catField);
        }

        // Description
        if (task.description) {
            const descField = document.createElement('div');
            descField.className = 'ds-modal-field';
            descField.innerHTML = `<span class="ds-modal-label">Description</span><span class="ds-modal-value">${escapeHtml(task.description)}</span>`;
            body.appendChild(descField);
        }

        // Deadline & Countdown
        if (task.deadline) {
            const dlField = document.createElement('div');
            dlField.className = 'ds-modal-field';
            dlField.innerHTML = `<span class="ds-modal-label">Deadline</span><span class="ds-modal-value">${task.deadline}</span>`;
            body.appendChild(dlField);

            const cdDiv = document.createElement('div');
            cdDiv.className = `ds-modal-countdown ${urgency.class}`;
            cdDiv.textContent = `${urgency.hearts} ${formatCountdown(task.deadline)}`;
            cdDiv.setAttribute('data-deadline', task.deadline);
            body.appendChild(cdDiv);
        }

        // Actions
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'ds-modal-actions';

        const completeBtn = document.createElement('button');
        completeBtn.className = 'ds-modal-btn ds-success';
        completeBtn.textContent = '✓ COMPLETE';
        completeBtn.addEventListener('click', () => {
            completeTask(task.id);
            overlay.remove();
        });

        const snooze1h = document.createElement('button');
        snooze1h.className = 'ds-modal-btn ds-primary';
        snooze1h.textContent = '💤 SNOOZE 1H';
        snooze1h.addEventListener('click', () => {
            snoozeTask(task.id, 60 * 60 * 1000);
            overlay.remove();
        });

        const closeModalBtn = document.createElement('button');
        closeModalBtn.className = 'ds-modal-btn ds-danger';
        closeModalBtn.textContent = '✕ CLOSE';
        closeModalBtn.addEventListener('click', () => overlay.remove());

        actionsDiv.appendChild(completeBtn);
        actionsDiv.appendChild(snooze1h);
        actionsDiv.appendChild(closeModalBtn);
        body.appendChild(actionsDiv);

        modal.appendChild(body);
        overlay.appendChild(modal);
        shadow.appendChild(overlay);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Drag ─────────────────────────────────────────────────────
    function setupDrag(headerEl) {
        headerEl.addEventListener('mousedown', (e) => {
            if (e.target.closest('.ds-icon-btn')) return;
            e.preventDefault();
            const rect = widget.getBoundingClientRect();
            dragState = {
                startX: e.clientX,
                startY: e.clientY,
                origBottom: window.innerHeight - rect.bottom,
                origRight: window.innerWidth - rect.right
            };
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragEnd);
        });
    }

    function onDragMove(e) {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        const newBottom = Math.max(0, dragState.origBottom - dy);
        const newRight = Math.max(0, dragState.origRight - dx);
        widget.style.bottom = newBottom + 'px';
        widget.style.right = newRight + 'px';
    }

    function onDragEnd() {
        if (!dragState) return;
        widgetPosition = {
            bottom: parseInt(widget.style.bottom) || 20,
            right: parseInt(widget.style.right) || 20
        };
        chrome.storage.local.set({ widgetPosition });
        dragState = null;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
    }

    function applyPosition() {
        if (widgetPosition) {
            widget.style.bottom = widgetPosition.bottom + 'px';
            widget.style.right = widgetPosition.right + 'px';
            widget.style.left = '';
        } else if (settings.widgetPositionPref === 'bottom-left') {
            widget.style.bottom = '20px';
            widget.style.left = '20px';
            widget.style.right = '';
        } else {
            widget.style.bottom = '20px';
            widget.style.right = '20px';
            widget.style.left = '';
        }
    }

    // ─── Auto-hide ────────────────────────────────────────────────
    function resetAutoHide() {
        clearTimeout(autoHideTimer);
        const delay = settings.widgetAutoHide || 10;
        if (delay === 'never') return;
        autoHideTimer = setTimeout(() => {
            if (state === 'collapsed' || state === 'expanded') {
                widget.classList.add('ds-auto-hiding');
                setTimeout(() => {
                    state = 'hidden';
                    render();
                }, 400);
            }
        }, delay * 1000);
    }

    // ─── Theme Sync ───────────────────────────────────────────────
    function applyTheme(theme) {
        if (theme === 'auto') {
            const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            hostEl.setAttribute('data-theme', isDark ? 'dark' : 'light');
        } else {
            hostEl.setAttribute('data-theme', theme || 'light');
        }
    }

    // ─── Countdown Timer ──────────────────────────────────────────
    function startCountdownTimer() {
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            // Update all countdown elements in shadow
            const countdowns = shadow.querySelectorAll('[data-deadline]');
            countdowns.forEach(el => {
                const dl = el.getAttribute('data-deadline');
                if (dl) {
                    const urgency = getUrgencyInfo(dl);
                    if (el.classList.contains('ds-modal-countdown')) {
                        el.textContent = `${urgency.hearts} ${formatCountdown(dl)}`;
                    } else {
                        el.textContent = urgency.label;
                    }
                }
            });
        }, 1000);
    }

    // ─── Data Loading ─────────────────────────────────────────────
    async function loadData() {
        try {
            const data = await chrome.storage.local.get([
                'tasks', 'widgetEnabled', 'widgetPosition', 'widgetAutoHide',
                'widgetBlacklist', 'widgetSound', 'widgetSnoozed',
                'widgetDismissedUntil', 'theme', 'widgetPositionPref'
            ]);

            tasks = data.tasks || [];
            settings = {
                widgetEnabled: data.widgetEnabled !== undefined ? data.widgetEnabled : true,
                widgetAutoHide: data.widgetAutoHide !== undefined ? data.widgetAutoHide : 10,
                widgetBlacklist: data.widgetBlacklist || '',
                widgetSound: data.widgetSound !== undefined ? data.widgetSound : false,
                widgetPositionPref: data.widgetPositionPref || 'bottom-right',
            };
            widgetPosition = data.widgetPosition || null;
            snoozedTasks = data.widgetSnoozed || {};
            dismissedUntil = data.widgetDismissedUntil || 0;

            applyTheme(data.theme || 'light');
        } catch (e) {
            console.error('DeadlineSnap widget: load failed', e);
        }
    }

    // ─── Initialize ───────────────────────────────────────────────
    async function init() {
        await loadData();

        // Check if widget is disabled
        if (!settings.widgetEnabled) {
            hostEl.style.display = 'none';
            return;
        }

        // Check blacklist
        if (isOnBlacklist()) {
            hostEl.style.display = 'none';
            return;
        }

        // Check dismissed state
        if (dismissedUntil > Date.now()) {
            state = 'dismissed';
            render();
            return;
        }

        // Check if there are any urgent tasks to show
        const urgent = getUrgentTasks();
        if (urgent.length === 0) {
            state = 'hidden';
            render();
            return;
        }

        state = 'collapsed';
        render();
        resetAutoHide();
        startCountdownTimer();

        // Listen for hover to pause auto-hide
        widget.addEventListener('mouseenter', () => {
            clearTimeout(autoHideTimer);
            widget.classList.remove('ds-auto-hiding');
            if (state === 'hidden') {
                state = 'collapsed';
                render();
            }
        });

        widget.addEventListener('mouseleave', () => {
            resetAutoHide();
            closeSnoozeMenus();
        });
    }

    // ─── Storage Change Listener (real-time sync) ─────────────────
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;

        let needsRender = false;

        if (changes.tasks) {
            tasks = changes.tasks.newValue || [];
            needsRender = true;
        }

        if (changes.widgetEnabled !== undefined) {
            const enabled = changes.widgetEnabled.newValue;
            settings.widgetEnabled = enabled !== undefined ? enabled : true;
            if (!settings.widgetEnabled) {
                hostEl.style.display = 'none';
                return;
            } else {
                hostEl.style.display = '';
                needsRender = true;
            }
        }

        if (changes.widgetBlacklist) {
            settings.widgetBlacklist = changes.widgetBlacklist.newValue || '';
            if (isOnBlacklist()) {
                hostEl.style.display = 'none';
                return;
            } else {
                hostEl.style.display = '';
            }
        }

        if (changes.widgetAutoHide) {
            settings.widgetAutoHide = changes.widgetAutoHide.newValue || 10;
        }

        if (changes.widgetSnoozed) {
            snoozedTasks = changes.widgetSnoozed.newValue || {};
            needsRender = true;
        }

        if (changes.widgetDismissedUntil) {
            dismissedUntil = changes.widgetDismissedUntil.newValue || 0;
            if (dismissedUntil > Date.now()) {
                state = 'dismissed';
            }
            needsRender = true;
        }

        if (changes.theme) {
            applyTheme(changes.theme.newValue || 'light');
        }

        if (needsRender) {
            // If currently dismissed/hidden, check if we should show again
            if (state === 'hidden' || state === 'dismissed') {
                if (dismissedUntil <= Date.now() && getUrgentTasks().length > 0 && settings.widgetEnabled) {
                    state = 'collapsed';
                    resetAutoHide();
                }
            }
            render();
        }
    });

    // ─── Keyboard Shortcut (Ctrl+Shift+D) ─────────────────────────
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'toggleWidget') {
            if (state === 'hidden' || state === 'dismissed') {
                state = 'collapsed';
                dismissedUntil = 0;
                chrome.storage.local.set({ widgetDismissedUntil: 0 });
            } else if (state === 'collapsed') {
                state = 'expanded';
            } else if (state === 'expanded') {
                state = 'hidden';
            }
            render();
            if (state !== 'hidden') resetAutoHide();
        }
    });

    // Keyboard shortcut listener for pages (fallback)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            if (state === 'hidden' || state === 'dismissed') {
                state = 'collapsed';
                dismissedUntil = 0;
                chrome.storage.local.set({ widgetDismissedUntil: 0 });
            } else if (state === 'collapsed') {
                state = 'expanded';
            } else if (state === 'expanded') {
                state = 'hidden';
            }
            render();
            if (state !== 'hidden') resetAutoHide();
        }
    });

    // ─── Boot ─────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
