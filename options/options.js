// options.js
import { getDebugInfo, exportDebugLog, clearDebugLogs } from '../utils/debugger.js';

// --- HELPER FUNCTIONS ---

function maskApiKey(key) {
    if (!key || key.length <= 4) return key;
    return '*'.repeat(key.length - 4) + key.slice(-4);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 KB';
    const k = 1024;
    const dm = 2;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Icon based on type
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    // Ensure properly escaped message
    const escapedMsg = String(message)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    toast.innerHTML = `<span>${icon}</span> <span>${escapedMsg}</span>`;

    container.appendChild(toast);

    // Remove after animation completes (3s total)
    setTimeout(() => {
        if (toast.parentNode === container) {
            container.removeChild(toast);
        }
    }, 3000);
}

// --- INITIALIZATION & STATE ---

let currentActualKey = ''; // to keep track of the real key if it's currently masked in the input

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await init();
        bindEvents();
    } catch (e) {
        console.error("Initialization error:", e);
    }
});

async function init() {
    // 1. Check for setup=true in URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get('setup') === 'true') {
        const welcomeCard = document.getElementById('welcomeMessage');
        if (welcomeCard) welcomeCard.classList.remove('hidden');
    }

    // 2. Load API key, notification preferences, category, tasks, debugMode, theme
    const data = await chrome.storage.local.get(['apiKey', 'notificationPreferences', 'defaultCategory', 'tasks', 'debugMode', 'theme', 'widgetEnabled', 'widgetPositionPref', 'widgetAutoHide', 'widgetBlacklist', 'widgetSound', 'telegramEnabled', 'telegramToken', 'telegramChatId', 'telegramIncludeScreenshot']);

    // Theme Settings
    const themeRadios = document.querySelectorAll('input[name="themeSetting"]');
    const currentTheme = data.theme || 'light';
    for (const radio of themeRadios) {
        if (radio.value === currentTheme) {
            radio.checked = true;
        }
        radio.addEventListener('change', async (e) => {
            if (e.target.checked) {
                try {
                    await chrome.storage.local.set({ theme: e.target.value });
                    showToast('Theme updated!', 'success');
                } catch (err) {
                    showToast('Failed to update theme', 'error');
                }
            }
        });
    }

    // Debug Mode
    const isDebugMode = !!data.debugMode;
    document.getElementById('debugModeToggle').checked = isDebugMode;
    toggleDebugTools(isDebugMode);

    // API Key
    const apiKeyInput = document.getElementById('apiKeyInput');
    const testApiKeyBtn = document.getElementById('testApiKeyBtn');

    if (data.apiKey) {
        currentActualKey = data.apiKey;
        apiKeyInput.value = maskApiKey(data.apiKey);
        testApiKeyBtn.disabled = false;
    } else {
        currentActualKey = '';
        testApiKeyBtn.disabled = true;
    }

    // Notification Preferences
    const prefs = data.notificationPreferences || { remind7days: true, remind3days: true, remind1day: true };
    document.getElementById('remind7days').checked = !!prefs.remind7days;
    document.getElementById('remind3days').checked = !!prefs.remind3days;
    document.getElementById('remind1day').checked = !!prefs.remind1day;

    // Default Category
    const defaultCategory = document.getElementById('defaultCategory');
    if (data.defaultCategory) {
        defaultCategory.value = data.defaultCategory;
    }

    // Stats calculation
    updateStats(data.tasks || []);

    // Widget Settings
    const widgetEnabledEl = document.getElementById('widgetEnabled');
    if (widgetEnabledEl) widgetEnabledEl.checked = data.widgetEnabled !== undefined ? data.widgetEnabled : true;

    const widgetPositionEl = document.getElementById('widgetPosition');
    if (widgetPositionEl && data.widgetPositionPref) widgetPositionEl.value = data.widgetPositionPref;

    const widgetAutoHideEl = document.getElementById('widgetAutoHide');
    if (widgetAutoHideEl) widgetAutoHideEl.value = data.widgetAutoHide !== undefined ? String(data.widgetAutoHide) : '10';

    const widgetBlacklistEl = document.getElementById('widgetBlacklist');
    if (widgetBlacklistEl && data.widgetBlacklist) widgetBlacklistEl.value = data.widgetBlacklist;

    const widgetSoundEl = document.getElementById('widgetSound');
    if (widgetSoundEl) widgetSoundEl.checked = !!data.widgetSound;

    // Telegram Settings
    const enableTelegramEl = document.getElementById('enableTelegram');
    const telegramSetup = document.getElementById('telegramSetup');
    const chatIdDisplay = document.getElementById('chatIdDisplay');
    const testTelegramBtn = document.getElementById('testTelegramBtn');
    const botTokenInput = document.getElementById('botToken');
    const telegramScreenshotEl = document.getElementById('telegramIncludeScreenshot');

    if (data.telegramEnabled) {
        enableTelegramEl.checked = true;
        telegramSetup.classList.remove('hidden');
    }
    if (data.telegramToken && botTokenInput) {
        botTokenInput.value = maskApiKey(data.telegramToken);
    }
    if (data.telegramChatId && chatIdDisplay) {
        chatIdDisplay.textContent = data.telegramChatId;
        if (testTelegramBtn) testTelegramBtn.disabled = false;
    }
    if (data.telegramIncludeScreenshot && telegramScreenshotEl) {
        telegramScreenshotEl.checked = true;
    }
}

function updateStats(tasks) {
    const exportDataBtn = document.getElementById('exportDataBtn');

    if (!tasks || tasks.length === 0) {
        document.getElementById('totalTasks').textContent = '0';
        document.getElementById('pendingTasks').textContent = '0';
        document.getElementById('storageUsed').textContent = '0 KB';
        exportDataBtn.disabled = true;
    } else {
        document.getElementById('totalTasks').textContent = tasks.length.toString();
        const pendingCount = tasks.filter(t => t.status === 'pending').length;
        document.getElementById('pendingTasks').textContent = pendingCount.toString();

        // Storage calculation uses getBytesInUse for everything, which is close enough to data stats
        chrome.storage.local.getBytesInUse(null, (bytes) => {
            document.getElementById('storageUsed').textContent = formatBytes(bytes);
        });

        exportDataBtn.disabled = false;
    }
}

// --- EVENT BINDING ---

function bindEvents() {
    // API Key Management bindings
    const getApiKeyBtn = document.getElementById('getApiKeyBtn');
    getApiKeyBtn.addEventListener('click', () => {
        try {
            window.open('https://makersuite.google.com/app/apikey', '_blank');
        } catch (e) {
            console.error(e);
        }
    });

    const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
    const apiKeyInput = document.getElementById('apiKeyInput');
    toggleApiKeyBtn.addEventListener('click', () => {
        try {
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                toggleApiKeyBtn.textContent = '🔒';
            } else {
                apiKeyInput.type = 'password';
                toggleApiKeyBtn.textContent = '👁️';
            }
        } catch (e) {
            console.error(e);
        }
    });

    // Clear masked key if user starts typing
    apiKeyInput.addEventListener('input', (e) => {
        try {
            if (e.target.value.includes('**')) {
                // User started editing the masked string, clear it completely for fresh input
                e.target.value = '';
                currentActualKey = '';
            } else {
                currentActualKey = e.target.value;
            }

            const testApiKeyBtn = document.getElementById('testApiKeyBtn');
            if (currentActualKey && currentActualKey.trim().length > 0) {
                testApiKeyBtn.disabled = false;
            } else {
                testApiKeyBtn.disabled = true;
            }
        } catch (e) {
            console.error(e);
        }
    });

    const testApiKeyBtn = document.getElementById('testApiKeyBtn');
    testApiKeyBtn.addEventListener('click', async () => {
        const keyToTest = currentActualKey.trim();
        if (!keyToTest) return;

        const originalText = testApiKeyBtn.textContent;
        testApiKeyBtn.textContent = 'TESTING...';
        testApiKeyBtn.disabled = true;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(keyToTest)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Respond with 'OK'." }] }]
                })
            });

            if (response.ok) {
                showToast('API Key is valid!', 'success');
            } else {
                let errorMsg = 'Invalid API key';
                try {
                    const errorObj = await response.json();
                    if (errorObj.error && errorObj.error.message) {
                        errorMsg = errorObj.error.message;
                    }
                } catch (e) { }
                showToast(`Validation failed: ${errorMsg}`, 'error');
            }
        } catch (e) {
            // Error connecting
            showToast('Network error testing API Key.', 'error');
        } finally {
            testApiKeyBtn.textContent = originalText;
            testApiKeyBtn.disabled = false;
        }
    });

    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    saveApiKeyBtn.addEventListener('click', async () => {
        const keyToSave = currentActualKey.trim();
        if (!keyToSave) {
            showToast('Please enter an API Key to save.', 'error');
            return;
        }

        const originalText = saveApiKeyBtn.textContent;
        saveApiKeyBtn.textContent = 'SAVING...';
        saveApiKeyBtn.disabled = true;

        try {
            await chrome.storage.local.set({
                apiKey: keyToSave,
                setupComplete: true
            });
            apiKeyInput.value = maskApiKey(keyToSave);

            showToast('API Key saved successfully!', 'success');

            const params = new URLSearchParams(window.location.search);
            if (params.get('setup') === 'true') {
                setTimeout(() => {
                    try {
                        window.location.href = '../popup/popup.html';
                    } catch (e) { }
                }, 2000);
            }
        } catch (e) {
            showToast('Failed to save API Key.', 'error');
        } finally {
            saveApiKeyBtn.textContent = originalText;
            saveApiKeyBtn.disabled = false;
        }
    });

    // Notification Preferences
    const saveNotificationsBtn = document.getElementById('saveNotificationsBtn');
    saveNotificationsBtn.addEventListener('click', async () => {
        const originalText = saveNotificationsBtn.textContent;
        saveNotificationsBtn.textContent = 'SAVING...';
        saveNotificationsBtn.disabled = true;

        try {
            const preferences = {
                remind7days: document.getElementById('remind7days').checked,
                remind3days: document.getElementById('remind3days').checked,
                remind1day: document.getElementById('remind1day').checked
            };

            await chrome.storage.local.set({ notificationPreferences: preferences });
            saveNotificationsBtn.textContent = 'SAVED!';
            showToast('Preferences saved!', 'success');

            setTimeout(() => {
                saveNotificationsBtn.textContent = originalText;
                saveNotificationsBtn.disabled = false;
            }, 2000);

        } catch (e) {
            showToast('Error saving preferences', 'error');
            saveNotificationsBtn.textContent = 'ERROR!';
            setTimeout(() => {
                saveNotificationsBtn.textContent = originalText;
                saveNotificationsBtn.disabled = false;
            }, 2000);
        }
    });

    // Widget Settings
    const saveWidgetBtn = document.getElementById('saveWidgetBtn');
    if (saveWidgetBtn) {
        saveWidgetBtn.addEventListener('click', async () => {
            const originalText = saveWidgetBtn.textContent;
            saveWidgetBtn.textContent = 'SAVING...';
            saveWidgetBtn.disabled = true;

            try {
                const autoHideVal = document.getElementById('widgetAutoHide').value;
                await chrome.storage.local.set({
                    widgetEnabled: document.getElementById('widgetEnabled').checked,
                    widgetPositionPref: document.getElementById('widgetPosition').value,
                    widgetAutoHide: autoHideVal === 'never' ? 'never' : parseInt(autoHideVal),
                    widgetBlacklist: document.getElementById('widgetBlacklist').value,
                    widgetSound: document.getElementById('widgetSound').checked
                });
                saveWidgetBtn.textContent = 'SAVED!';
                showToast('Widget settings saved!', 'success');
                setTimeout(() => {
                    saveWidgetBtn.textContent = originalText;
                    saveWidgetBtn.disabled = false;
                }, 2000);
            } catch (e) {
                showToast('Error saving widget settings', 'error');
                saveWidgetBtn.textContent = 'ERROR!';
                setTimeout(() => {
                    saveWidgetBtn.textContent = originalText;
                    saveWidgetBtn.disabled = false;
                }, 2000);
            }
        });
    }

    // Default Category auto-save
    const defaultCategory = document.getElementById('defaultCategory');
    defaultCategory.addEventListener('change', async (e) => {
        try {
            await chrome.storage.local.set({ defaultCategory: e.target.value });
            showToast('Default category updated!', 'success');
        } catch (e) {
            showToast('Failed to save category', 'error');
        }
    });

    // Data Management
    const exportDataBtn = document.getElementById('exportDataBtn');
    exportDataBtn.addEventListener('click', async () => {
        try {
            const data = await chrome.storage.local.get('tasks');
            const tasks = data.tasks || [];
            if (tasks.length === 0) return;

            const jsonStr = JSON.stringify(tasks, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const pad = (n) => String(n).padStart(2, '0');
            const d = new Date();
            const dateString = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

            const a = document.createElement('a');
            a.href = url;
            a.download = `deadlinesnap-backup-${dateString}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Export data error:", e);
        }
    });

    const clearDataBtn = document.getElementById('clearDataBtn');
    clearDataBtn.addEventListener('click', async () => {
        try {
            const confirmClear = confirm("Are you sure? This will delete all tasks and cannot be undone.");
            if (confirmClear) {
                await chrome.storage.local.remove('tasks');
                showToast("All tasks have been cleared.", "success");
                // Storage sync handled by onChanged listener
            }
        } catch (e) {
            showToast("Failed to clear tasks.", "error");
        }
    });

    // About Section
    document.getElementById('privacyBtn').addEventListener('click', () => {
        try { window.open('https://yourwebsite.com/privacy', '_blank'); } catch (e) { }
    });

    document.getElementById('reportBugBtn').addEventListener('click', () => {
        try { window.location.href = 'mailto:support@yourwebsite.com'; } catch (e) { }
    });

    document.getElementById('rateBtn').addEventListener('click', () => {
        try { window.open('https://chrome.google.com/webstore', '_blank'); } catch (e) { }
    });

    // Danger Zone
    const resetBtn = document.getElementById('resetBtn');
    resetBtn.addEventListener('click', async () => {
        try {
            const confirmReset = confirm("This will delete EVERYTHING including API key. Continue?");
            if (confirmReset) {
                await chrome.storage.local.clear();
                showToast("Reset complete. The page will now reload.", "success");
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        } catch (e) {
            showToast("Failed to perform factory reset.", "error");
        }
    });

    // Real-time updates
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            try {
                if (changes.tasks) {
                    updateStats(changes.tasks.newValue || []);
                }

                if (changes.notificationPreferences) {
                    const prefs = changes.notificationPreferences.newValue;
                    if (prefs) {
                        document.getElementById('remind7days').checked = !!prefs.remind7days;
                        document.getElementById('remind3days').checked = !!prefs.remind3days;
                        document.getElementById('remind1day').checked = !!prefs.remind1day;
                    }
                }

                if (changes.defaultCategory) {
                    document.getElementById('defaultCategory').value = changes.defaultCategory.newValue;
                }

                if (changes.debugMode) {
                    document.getElementById('debugModeToggle').checked = !!changes.debugMode.newValue;
                    toggleDebugTools(!!changes.debugMode.newValue);
                }

                // Widget settings sync
                if (changes.widgetEnabled !== undefined) {
                    const el = document.getElementById('widgetEnabled');
                    if (el) el.checked = changes.widgetEnabled.newValue !== false;
                }
                if (changes.widgetAutoHide) {
                    const el = document.getElementById('widgetAutoHide');
                    if (el) el.value = String(changes.widgetAutoHide.newValue || '10');
                }
                if (changes.widgetBlacklist) {
                    const el = document.getElementById('widgetBlacklist');
                    if (el) el.value = changes.widgetBlacklist.newValue || '';
                }
                if (changes.widgetSound !== undefined) {
                    const el = document.getElementById('widgetSound');
                    if (el) el.checked = !!changes.widgetSound.newValue;
                }
            } catch (e) {
                console.error("Storage onChanged listener error:", e);
            }
        }
    });

    // --- TELEGRAM ---

    const enableTelegramCb = document.getElementById('enableTelegram');
    const telegramSetupDiv = document.getElementById('telegramSetup');

    enableTelegramCb.addEventListener('change', async (e) => {
        try {
            if (e.target.checked) {
                telegramSetupDiv.classList.remove('hidden');
            } else {
                telegramSetupDiv.classList.add('hidden');
            }
            await chrome.storage.local.set({ telegramEnabled: e.target.checked });
        } catch (err) {
            console.error('Telegram toggle error:', err);
        }
    });

    // Modal open/close
    const telegramModal = document.getElementById('telegramModal');
    document.getElementById('setupBotHelpBtn').addEventListener('click', () => {
        telegramModal.classList.remove('hidden');
    });
    document.getElementById('closeTelegramModal').addEventListener('click', () => {
        telegramModal.classList.add('hidden');
    });
    telegramModal.addEventListener('click', (e) => {
        if (e.target === telegramModal) telegramModal.classList.add('hidden');
    });

    // Connect Telegram
    document.getElementById('connectTelegramBtn').addEventListener('click', async () => {
        const statusDiv = document.getElementById('telegramStatus');
        const botTokenInput = document.getElementById('botToken');
        let token = botTokenInput.value.trim();

        // If the field shows masked text, use stored token
        if (token.includes('*')) {
            const stored = await chrome.storage.local.get('telegramToken');
            token = stored.telegramToken || '';
        }

        if (!token || !token.includes(':')) {
            showTelegramStatus(statusDiv, '❌ Invalid bot token. Must contain a colon.', 'error');
            return;
        }

        const connectBtn = document.getElementById('connectTelegramBtn');
        connectBtn.textContent = 'CONNECTING...';
        connectBtn.disabled = true;

        try {
            const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
            const data = await response.json();

            if (!data.ok) {
                showTelegramStatus(statusDiv, '❌ Invalid bot token. Please check and try again.', 'error');
                return;
            }

            // Find a message with a chat id
            let chatId = null;
            if (data.result && data.result.length > 0) {
                for (const update of data.result) {
                    if (update.message && update.message.chat && update.message.chat.id) {
                        chatId = update.message.chat.id;
                        break;
                    }
                }
            }

            if (!chatId) {
                showTelegramStatus(statusDiv, '❌ No messages found. Please send /start to your bot first, then try again.', 'error');
                return;
            }

            await chrome.storage.local.set({
                telegramToken: token,
                telegramChatId: chatId,
                telegramEnabled: true
            });

            document.getElementById('chatIdDisplay').textContent = chatId;
            document.getElementById('testTelegramBtn').disabled = false;
            botTokenInput.value = maskApiKey(token);
            showTelegramStatus(statusDiv, '✅ Connected to Telegram!', 'success');
            showToast('Telegram connected!', 'success');

        } catch (err) {
            console.error('Telegram connect error:', err);
            showTelegramStatus(statusDiv, '❌ Network error. Check your connection.', 'error');
        } finally {
            connectBtn.textContent = '🔗 CONNECT TELEGRAM';
            connectBtn.disabled = false;
        }
    });

    // Send Test Message
    document.getElementById('testTelegramBtn').addEventListener('click', async () => {
        const statusDiv = document.getElementById('telegramStatus');
        const testBtn = document.getElementById('testTelegramBtn');
        testBtn.textContent = 'SENDING...';
        testBtn.disabled = true;

        try {
            const stored = await chrome.storage.local.get(['telegramToken', 'telegramChatId', 'telegramIncludeScreenshot', 'tasks']);
            const { telegramToken, telegramChatId, telegramIncludeScreenshot, tasks } = stored;

            if (!telegramToken || !telegramChatId) {
                showTelegramStatus(statusDiv, '❌ Not connected. Click Connect first.', 'error');
                return;
            }

            const message = '🎮 Test from DeadlineSnap!\n\nIf you see this, Telegram notifications are working! 🎉';

            // If screenshot mode is on and we have a task with screenshot, send as photo
            if (telegramIncludeScreenshot && tasks && tasks.length > 0) {
                const taskWithScreenshot = tasks.find(t => t.screenshotBase64);
                if (taskWithScreenshot) {
                    const sent = await sendTelegramPhoto(telegramToken, telegramChatId, taskWithScreenshot.screenshotBase64, message);
                    if (sent) {
                        showTelegramStatus(statusDiv, '✅ Test photo sent! Check Telegram', 'success');
                        showToast('Test photo sent!', 'success');
                        return;
                    }
                }
            }

            // Default: send text
            const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: telegramChatId, text: message })
            });
            const result = await response.json();

            if (result.ok) {
                showTelegramStatus(statusDiv, '✅ Test message sent! Check Telegram', 'success');
                showToast('Test message sent!', 'success');
            } else {
                showTelegramStatus(statusDiv, `❌ ${result.description || 'Send failed'}`, 'error');
            }
        } catch (err) {
            console.error('Telegram test error:', err);
            showTelegramStatus(statusDiv, '❌ Network error. Check connection.', 'error');
        } finally {
            testBtn.textContent = '📨 SEND TEST MESSAGE';
            testBtn.disabled = false;
        }
    });

    // Include screenshot checkbox
    document.getElementById('telegramIncludeScreenshot').addEventListener('change', async (e) => {
        try {
            await chrome.storage.local.set({ telegramIncludeScreenshot: e.target.checked });
        } catch (err) {
            console.error('Save telegram screenshot pref error:', err);
        }
    });

    // Debug Mode Functions
    const debugModeToggle = document.getElementById('debugModeToggle');
    const copyDebugInfoBtn = document.getElementById('copyDebugInfoBtn');
    const downloadDebugLogBtn = document.getElementById('downloadDebugLogBtn');
    const clearDebugLogBtn = document.getElementById('clearDebugLogBtn');

    debugModeToggle.addEventListener('change', async (e) => {
        try {
            await chrome.storage.local.set({ debugMode: e.target.checked });
            // The onChanged listener will handle UI updates
        } catch (e) {
            console.error("Save debug mode error:", e);
        }
    });

    copyDebugInfoBtn.addEventListener('click', async () => {
        try {
            const info = await getDebugInfo();
            await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
            const originalText = copyDebugInfoBtn.textContent;
            copyDebugInfoBtn.textContent = 'COPIED!';
            setTimeout(() => copyDebugInfoBtn.textContent = originalText, 2000);
        } catch (e) {
            console.error('Copy debug info failed', e);
        }
    });

    downloadDebugLogBtn.addEventListener('click', async () => {
        await exportDebugLog();
    });

    clearDebugLogBtn.addEventListener('click', async () => {
        const confirmClear = confirm("Clear all debug and error logs?");
        if (confirmClear) {
            await clearDebugLogs();
            alert("Debug logs cleared.");
        }
    });
}

function toggleDebugTools(isEnabled) {
    const debugTools = document.getElementById('debugTools');
    if (isEnabled) {
        debugTools.classList.remove('hidden');
        populateDebugInfo();
    } else {
        debugTools.classList.add('hidden');
    }
}

async function populateDebugInfo() {
    try {
        const info = await getDebugInfo();
        if (info) {
            document.getElementById('debugExtensionVersion').textContent = info.extensionVersion;
            document.getElementById('debugChromeVersion').textContent = info.chromeVersion;
        }
    } catch (e) {
        console.error('Failed to populate debug info', e);
    }
}

// --- TELEGRAM HELPERS ---

function showTelegramStatus(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = `status-message ${type}`;
    el.classList.remove('hidden');
    // Auto-hide after 8 seconds
    setTimeout(() => {
        el.classList.add('hidden');
    }, 8000);
}

async function sendTelegramPhoto(token, chatId, base64Data, caption) {
    try {
        // Convert base64 data URL to Blob
        const res = await fetch(base64Data);
        const blob = await res.blob();

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, 'screenshot.png');
        if (caption) formData.append('caption', caption);

        const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        return result.ok;
    } catch (err) {
        console.error('sendTelegramPhoto error:', err);
        return false;
    }
}
