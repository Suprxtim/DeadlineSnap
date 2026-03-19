// Background Service Worker for DeadlineSnap

import { extractDeadlineFromImage } from '../services/gemini.js'
import { getApiKey, saveTask, getTasks } from '../services/storage.js'
import { logger } from '../utils/logger.js';
import { logPerformance } from '../utils/debugger.js';

console.log('DeadlineSnap background service worker loaded')

// Initialize on install
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed:', details.reason)

    // Create context menu
    chrome.contextMenus.create({
        id: 'deadlinesnap-add',
        title: '📌 Add to DeadlineSnap',
        contexts: ['image']
    })

    // Open setup wizard on first install
    if (details.reason === 'install') {
        chrome.tabs.create({
            url: 'options/options.html?setup=true'
        })
    }

    // Set initial badge
    updateBadge()

    // Clear old legacy "checkReminders" periodic alarm from previous versions
    chrome.alarms.clear('checkReminders').then(() => {
        console.log('Cleared legacy checkReminders alarm')
    }).catch(() => { })

    // Re-schedule reminders for all pending tasks on install/update
    rescheduleAllReminders()
})

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'deadlinesnap-add') {
        console.log('Context menu clicked:', info.srcUrl)
        handleImageCapture(info.srcUrl, tab)
    }
})

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
    if (command === 'capture-screenshot') {
        console.log('Keyboard shortcut triggered:', command)
        captureCurrentTab().then(response => {
            if (response.success) {
                // If popup is open, this would normally be handled there, 
                // but since it's a global shortcut, we process it directly
                processImageWithGemini(response.imageData)
                    .then(result => {
                        if (result.success) {
                            chrome.notifications.create({
                                type: 'basic',
                                iconUrl: 'assets/icons/icon48.png',
                                title: 'DeadlineSnap',
                                message: `✅ Added: ${result.data.title}`
                            });
                        }
                    });
            }
        });
    }

    if (command === 'toggle-widget') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleWidget' }).catch(() => { });
            }
        });
    }
});

// Handle messages from popup/content
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received:', request.action)

    if (request.action === 'testApiKey') {
        handleTestApiKey(request.apiKey)
            .then(sendResponse)
            .catch(error => sendResponse({ valid: false, error: error.message }))
        return true
    }

    if (request.action === 'captureTab') {
        captureCurrentTab()
            .then(sendResponse)
            .catch(error => sendResponse({ success: false, error: error.message }))
        return true // Keep channel open for async response
    }

    if (request.action === 'processImage') {
        processImageWithGemini(request.imageData)
            .then(sendResponse)
            .catch(error => sendResponse({ success: false, error: error.message }))
        return true
    }

    if (request.action === 'updateBadge') {
        updateBadge()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }))
        return true
    }

    if (request.action === 'scheduleReminders') {
        console.log('📋 scheduleReminders message received for task:', request.task?.id, 'deadline:', request.task?.deadline, request.task?.deadlineTime)
        scheduleTaskReminders(request.task)
            .then(() => sendResponse({ success: true }))
            .catch(error => {
                console.error('scheduleReminders handler error:', error)
                sendResponse({ success: false, error: error.message })
            })
        return true
    }

    if (request.action === 'clearTaskAlarms') {
        clearTaskAlarms(request.taskId)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }))
        return true
    }

    if (request.action === 'openPopup') {
        chrome.action.openPopup().catch(() => {
            chrome.tabs.create({ url: 'popup/popup.html' });
        });
    }
})

// Handle testApiKey
async function handleTestApiKey(apiKey) {
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: 'Hello, this is a test. Reply with just "OK".'
                            }
                        ]
                    }
                ]
            }),
            signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
            let errMsg = 'Invalid API key';
            try {
                const data = await response.json();
                if (data.error && data.error.message) {
                    errMsg = data.error.message;
                }
            } catch (e) { }
            return { valid: false, error: errMsg }
        }

        return { valid: true }
    } catch (error) {
        if (error.name === 'AbortError') {
            return { valid: false, error: 'Request timed out after 10 seconds. Check your internet connection.' }
        }
        return { valid: false, error: error.message }
    }
}

// Capture screenshot of current tab
async function captureCurrentTab() {
    const startTime = performance.now();
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab) throw new Error("No active tab")

        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
            throw new Error("Cannot capture browser's internal pages")
        }

        const imageData = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png',
            quality: 90
        })

        const endTime = performance.now();
        logPerformance('Background_captureCurrentTab', Math.round(endTime - startTime), { success: true });
        logger.debug('Tab captured successfully');

        return { success: true, imageData }
    } catch (error) {
        const endTime = performance.now();
        logPerformance('Background_captureCurrentTab', Math.round(endTime - startTime), { success: false, error: error.message });
        logger.error('Screenshot capture error:', error)
        return { success: false, error: error.message }
    }
}

// Handle image capture from context menu
async function handleImageCapture(imageUrl, tab) {
    const startTime = performance.now();
    try {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icons/icon48.png',
            title: 'DeadlineSnap',
            message: '⏳ Processing screenshot...'
        })

        const apiKey = await getApiKey()

        if (!apiKey) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'assets/icons/icon48.png',
                title: 'DeadlineSnap',
                message: '❌ Please add your Gemini API key in settings'
            })
            chrome.tabs.create({ url: 'options/options.html' })
            return
        }

        let base64 = null

        // Try fetching the image URL directly (works for same-origin / CORS-enabled)
        try {
            const response = await fetch(imageUrl)
            if (response.ok) {
                const blob = await response.blob()
                if (blob.type.startsWith('image/')) {
                    base64 = await blobToBase64(blob)
                }
            }
        } catch (fetchError) {
            logger.warn('Direct image fetch failed (likely CORS), falling back to tab capture', fetchError.message)
        }

        // Fallback: capture the visible tab screenshot
        if (!base64) {
            logger.info('Using tab capture fallback for context menu image')
            try {
                const captureResult = await captureCurrentTab()
                if (captureResult.success) {
                    base64 = captureResult.imageData
                }
            } catch (captureError) {
                logger.error('Tab capture fallback also failed', captureError)
            }
        }

        if (!base64) {
            throw new Error('Could not capture image from this page')
        }

        const result = await processImageWithGemini(base64)

        if (result.success) {
            const endTime = performance.now();
            logPerformance('Background_handleImageCapture', Math.round(endTime - startTime), { success: true });
            logger.info('Image captured and processed successfully via context menu', { title: result.data.title });

            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'assets/icons/icon48.png',
                title: 'DeadlineSnap',
                message: `✅ Added: ${result.data.title}`
            })
        } else {
            throw new Error(result.error)
        }
    } catch (error) {
        const endTime = performance.now();
        logPerformance('Background_handleImageCapture', Math.round(endTime - startTime), { success: false, error: error.message });
        logger.error('Image capture error from context menu:', error)
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icons/icon48.png',
            title: 'DeadlineSnap',
            message: '❌ Failed to process. Please try again.'
        })
    }
}

// Process image with Gemini API
async function processImageWithGemini(base64Image) {
    const startTime = performance.now();
    try {
        const apiKey = await getApiKey()

        if (!apiKey) {
            return {
                success: false,
                error: 'No API key found. Please add your Gemini API key in settings.'
            }
        }

        // Compress image if necessary (max width 800px)
        let optimizedImage = base64Image;
        try {
            optimizedImage = await resizeBase64Img(base64Image, 800);
        } catch (e) {
            logger.warn('Failed to resize image, continuing with original', e);
        }

        const result = await extractDeadlineFromImage(optimizedImage, apiKey)

        if (!result.success) {
            return result
        }

        const task = {
            id: generateId(),
            ...result.data,
            screenshotBase64: base64Image,
            status: 'pending',
            createdAt: new Date().toISOString(),
            completedAt: null,
            source: 'extension',
            deadlineTime: result.data.deadlineTime || '23:59',
            showPopupNotification: true,
            reminders: [] // Will be populated with defaults by scheduleTaskReminders
        }

        await saveTask(task)
        await scheduleTaskReminders(task)
        await updateBadge()

        const endTime = performance.now();
        logPerformance('Background_processImageWithGemini', Math.round(endTime - startTime), { success: true, taskId: task.id });
        logger.info('Image processed and logic completed', { taskId: task.id });

        return {
            success: true,
            data: task
        }
    } catch (error) {
        const endTime = performance.now();
        logPerformance('Background_processImageWithGemini', Math.round(endTime - startTime), { success: false, error: error.message });
        logger.error('Process image error:', error)
        return {
            success: false,
            error: error.message
        }
    }
}

// 7. HELPER FUNCTION: generateId()
function generateId() {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

// Helper: get full deadline timestamp from task
function getTaskDeadlineTimestamp(task) {
    if (task.deadlineTime && task.deadline) {
        return new Date(task.deadline + 'T' + task.deadlineTime).getTime()
    }
    if (task.deadline) {
        return new Date(task.deadline + 'T23:59:00').getTime()
    }
    return null
}

// Default reminders for tasks without reminders array (backward compat)
const DEFAULT_REMINDER_CONFIG = [
    { type: 'at_due_time', offset: 0 },
    { type: '1hour', offset: 3600000 },
    { type: '1day', offset: 86400000 }
]

// Schedule all reminders for a task using per-alarm chrome.alarms
async function scheduleTaskReminders(task) {
    try {
        if (!task.deadline) {
            console.log('scheduleTaskReminders: No deadline, skipping')
            return
        }

        // First clear any existing alarms for this task
        await clearTaskAlarms(task.id)

        const deadlineTs = getTaskDeadlineTimestamp(task)
        const now = Date.now()
        console.log(`scheduleTaskReminders: taskId=${task.id}, deadline=${task.deadline} ${task.deadlineTime || ''}, deadlineTs=${deadlineTs}, now=${now}, diff=${deadlineTs - now}ms`)

        if (!deadlineTs || deadlineTs < now) {
            console.log('scheduleTaskReminders: Deadline is in the past, skipping')
            return
        }

        // Get or generate reminders
        let reminders = task.reminders
        if (!reminders || reminders.length === 0) {
            // Generate defaults for old tasks
            reminders = DEFAULT_REMINDER_CONFIG.map(r => ({
                ...r,
                fireTime: new Date(deadlineTs - r.offset).toISOString(),
                sent: false
            }))
            console.log('scheduleTaskReminders: Generated default reminders:', reminders.length)
        } else {
            console.log('scheduleTaskReminders: Using task reminders:', reminders.length)
        }

        let alarmsCreated = 0

        for (const reminder of reminders) {
            const fireTime = new Date(reminder.fireTime).getTime()

            // Skip if already past or already sent
            if (fireTime <= now) {
                console.log(`  Skipping ${reminder.type}: fireTime ${new Date(fireTime).toLocaleString()} is in the past`)
                continue
            }
            if (reminder.sent) {
                console.log(`  Skipping ${reminder.type}: already sent`)
                continue
            }

            const alarmName = `${task.id}_${reminder.type}`
            await chrome.alarms.create(alarmName, { when: fireTime })
            alarmsCreated++
            console.log(`  ✅ Alarm created: ${alarmName} → fires at ${new Date(fireTime).toLocaleString()} (in ${Math.round((fireTime - now) / 1000)}s)`)
        }

        // Verify alarms were actually registered
        const allAlarms = await chrome.alarms.getAll()
        const taskAlarms = allAlarms.filter(a => a.name.startsWith(task.id + '_'))
        console.log(`scheduleTaskReminders: ${alarmsCreated} alarms created, ${taskAlarms.length} verified in chrome.alarms`)

    } catch (error) {
        console.error('Schedule reminders error:', error)
    }
}

// Clear all Chrome alarms for a given taskId
async function clearTaskAlarms(taskId) {
    try {
        const allAlarms = await chrome.alarms.getAll()
        const prefix = taskId + '_'
        for (const alarm of allAlarms) {
            if (alarm.name.startsWith(prefix)) {
                await chrome.alarms.clear(alarm.name)
                console.log(`Alarm cleared: ${alarm.name}`)
            }
        }
    } catch (error) {
        console.error('Clear task alarms error:', error)
    }
}

// Re-schedule all reminders on extension install/update
async function rescheduleAllReminders() {
    try {
        const tasks = await getTasks()
        const pendingTasks = tasks.filter(t => t.status === 'pending')
        for (const task of pendingTasks) {
            await scheduleTaskReminders(task)
        }
        console.log(`Rescheduled reminders for ${pendingTasks.length} pending tasks`)
    } catch (error) {
        console.error('Reschedule all reminders error:', error)
    }
}

// Helper: Convert blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

// Helper: Resize base64 image using OffscreenCanvas
async function resizeBase64Img(base64Str, maxWidth) {
    const res = await fetch(base64Str);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width <= maxWidth) return base64Str;
    const ratio = maxWidth / bitmap.width;
    const canvas = new OffscreenCanvas(maxWidth, bitmap.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob2 = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return await blobToBase64(blob2);
}

// 5. UPDATE 'updateBadge' HANDLER
async function updateBadge() {
    try {
        const tasks = await getTasks()
        const pendingTasks = tasks.filter(t => t.status === 'pending')
        const count = pendingTasks.length

        if (count > 0) {
            chrome.action.setBadgeText({ text: count.toString() })

            const now = new Date()
            let hasOverdue = false
            let hasUrgent = false

            for (const task of pendingTasks) {
                if (!task.deadline) continue
                const deadline = new Date(task.deadline + 'T23:59:59')
                const diffTime = deadline.getTime() - now.getTime()
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

                if (diffTime < 0) {
                    hasOverdue = true
                } else if (diffDays <= 3) {
                    hasUrgent = true
                }
            }

            if (hasOverdue) {
                chrome.action.setBadgeBackgroundColor({ color: '#E74C3C' })
            } else if (hasUrgent) {
                chrome.action.setBadgeBackgroundColor({ color: '#F1C40F' })
            } else {
                chrome.action.setBadgeBackgroundColor({ color: '#4A9EFF' })
            }
        } else {
            chrome.action.setBadgeText({ text: '' })
        }
    } catch (error) {
        console.error('Badge update error:', error)
    }
}

// Format human-readable time remaining
function formatTimeRemaining(msLeft) {
    if (msLeft <= 0) return 'Deadline is now!';
    const minutes = Math.floor(msLeft / 60000);
    const hours = Math.floor(msLeft / 3600000);
    const days = Math.floor(msLeft / 86400000);

    if (days >= 7) return `${Math.floor(days / 7)} week(s) until deadline`;
    if (days >= 1) return `${days} day(s) until deadline`;
    if (hours >= 1) return `${hours} hour(s) remaining`;
    if (minutes >= 1) return `${minutes} minute(s) remaining`;
    return 'Less than a minute remaining';
}

// Get Telegram message based on reminder type
function getTelegramMessage(task, reminderType) {
    const categoryEmojis = {
        scholarship: '📚', internship: '💼', event: '🎯', course: '📖', other: '📌'
    };
    const catEmoji = categoryEmojis[task.category] || '📌';

    let hearts = '❤️❤️';
    if (task.urgency === 'urgent' || task.priority === 'urgent') hearts = '❤️❤️❤️';
    else if (task.urgency === 'low' || task.priority === 'low') hearts = '❤️';

    const deadlineStr = task.deadline + (task.deadlineTime ? ' ' + task.deadlineTime : '');
    const footer = `\n\n${catEmoji} Category: ${task.category || 'other'}\n${hearts} Priority\n🗓 Due: ${deadlineStr}`;

    switch (reminderType) {
        case 'at_due_time':
            return `⏰ *DEADLINE NOW!*\n\n📌 ${task.title}\n🗓 Due right now!${footer}`;
        case '15min':
            return `⏱ *15 MINUTES LEFT!*\n\n📌 ${task.title}\n⚠️ Hurry!${footer}`;
        case '30min':
            return `⏱ *30 MINUTES LEFT!*\n\n📌 ${task.title}\n⚠️ Almost time!${footer}`;
        case '1hour':
            return `⏰ *1 HOUR REMAINING!*\n\n📌 ${task.title}${footer}`;
        case '2hours':
            return `⏰ *2 HOURS REMAINING!*\n\n📌 ${task.title}${footer}`;
        case '1day':
            return `📅 *DEADLINE TOMORROW!*\n\n📌 ${task.title}${footer}`;
        case '3days':
            return `📅 *3 DAYS UNTIL DEADLINE!*\n\n📌 ${task.title}${footer}`;
        case '1week':
            return `📅 *1 WEEK UNTIL DEADLINE!*\n\n📌 ${task.title}${footer}`;
        default:
            return `⏰ *Deadline Reminder*\n\n📌 ${task.title}${footer}`;
    }
}

// Send Telegram reminder for a task with specific reminder type
async function sendTelegramReminder(task, reminderType) {
    try {
        const data = await chrome.storage.local.get(['telegramEnabled', 'telegramToken', 'telegramChatId', 'telegramIncludeScreenshot']);
        const { telegramEnabled, telegramToken, telegramChatId, telegramIncludeScreenshot } = data;

        if (!telegramEnabled || !telegramToken || !telegramChatId) return;

        const message = getTelegramMessage(task, reminderType);

        // Send as photo if enabled and screenshot exists
        if (telegramIncludeScreenshot && task.screenshotBase64) {
            try {
                const res = await fetch(task.screenshotBase64);
                const blob = await res.blob();
                const formData = new FormData();
                formData.append('chat_id', telegramChatId);
                formData.append('photo', blob, 'deadline.png');
                formData.append('caption', message);
                formData.append('parse_mode', 'Markdown');

                const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                if (result.ok) {
                    console.log('✅ Telegram photo reminder sent:', task.title, reminderType);
                    return;
                }
                // Fall through to text if photo fails
            } catch (photoErr) {
                console.warn('Telegram photo send failed, falling back to text:', photoErr);
            }
        }

        // Send as text
        const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        const result = await response.json();
        if (result.ok) {
            console.log('✅ Telegram reminder sent:', task.title, reminderType);
        } else {
            console.error('Telegram send failed:', result.description);
        }
    } catch (error) {
        console.error('sendTelegramReminder error:', error);
        // Never throw — Telegram failure must not break core functionality
    }
}

// 6. REMINDER SYSTEM — Per-alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
        console.log('Alarm triggered:', alarm.name)

        // Ignore and clear legacy periodic alarm from old system
        if (alarm.name === 'checkReminders') {
            console.log('Clearing legacy checkReminders alarm')
            await chrome.alarms.clear('checkReminders')
            return
        }

        // Parse alarm name: "taskId_reminderType"
        // Task IDs contain underscores (e.g. "task_1234567890_abc123def"),
        // so we match known reminder type suffixes.
        const REMINDER_TYPES = ['at_due_time', '15min', '30min', '1hour', '2hours', '1day', '3days', '1week']
        let taskId = null
        let reminderType = null

        for (const type of REMINDER_TYPES) {
            if (alarm.name.endsWith('_' + type)) {
                taskId = alarm.name.slice(0, alarm.name.length - type.length - 1)
                reminderType = type
                break
            }
        }

        if (!taskId || !reminderType) return // Unrecognized alarm

        // Look up the task
        const tasks = await getTasks()
        const task = tasks.find(t => t.id === taskId)

        if (!task) {
            console.log('Task not found for alarm, skipping:', taskId)
            return
        }

        // Skip if task is completed or deleted
        if (task.status === 'completed') {
            console.log('Task is completed, skipping reminder:', taskId)
            return
        }

        // Calculate time remaining
        const deadlineTs = getTaskDeadlineTimestamp(task)
        const msLeft = deadlineTs ? deadlineTs - Date.now() : 0
        const timeRemainingText = formatTimeRemaining(msLeft)
        console.log(`  📊 deadlineTs=${deadlineTs}, msLeft=${msLeft}, timeRemaining=${timeRemainingText}`)

        // Show browser notification if enabled
        if (task.showPopupNotification !== false) {
            const notifTitle = reminderType === 'at_due_time' ? '⏰ Deadline Now!' : '🔔 Deadline Reminder'
            chrome.notifications.create(alarm.name, {
                type: 'basic',
                iconUrl: 'assets/icons/icon48.png',
                title: notifTitle,
                message: `${task.title} — ${timeRemainingText}`,
                priority: 2
            })
        }

        // Send Telegram reminder (non-blocking)
        try {
            await sendTelegramReminder(task, reminderType)
        } catch (tgErr) {
            console.error('Telegram reminder failed (non-blocking):', tgErr)
        }

        // Mark this reminder as sent in storage
        try {
            const result = await chrome.storage.local.get('tasks')
            const storedTasks = result.tasks || []
            const idx = storedTasks.findIndex(t => t.id === taskId)
            if (idx !== -1 && storedTasks[idx].reminders) {
                const reminder = storedTasks[idx].reminders.find(r => r.type === reminderType)
                if (reminder) {
                    reminder.sent = true
                    await chrome.storage.local.set({ tasks: storedTasks })
                }
            }
        } catch (storageErr) {
            console.error('Failed to mark reminder as sent:', storageErr)
        }

    } catch (error) {
        console.error('Alarm handler error:', error)
    }
})

// 9. NOTIFICATION CLICK HANDLER
chrome.notifications.onClicked.addListener((notificationId) => {
    chrome.action.openPopup().catch((error) => {
        chrome.windows.getCurrent((win) => {
            chrome.windows.update(win.id, { focused: true }).catch(() => { });
        });
        chrome.tabs.create({ url: 'popup/popup.html' });
    });
})