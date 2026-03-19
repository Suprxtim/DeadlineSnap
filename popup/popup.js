// DeadlineSnap Popup JavaScript
import { logger } from '../utils/logger.js';
import { logPerformance } from '../utils/debugger.js';

console.log('DeadlineSnap popup loaded')

// DOM Elements
const setupScreen = document.getElementById('setupScreen')
const mainApp = document.getElementById('mainApp')
const getApiKeyBtn = document.getElementById('getApiKeyBtn')
const apiKeyInput = document.getElementById('apiKeyInput')
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn')
const setupError = document.getElementById('setupError')

const toastContainer = document.getElementById('toastContainer')

const taskList = document.getElementById('taskList')
const emptyState = document.getElementById('emptyState')
const loadingState = document.getElementById('loadingState')

const captureTabBtn = document.getElementById('captureTabBtn')
const settingsBtn = document.getElementById('settingsBtn')
const uploadBtn = document.getElementById('uploadBtn')
const fileInput = document.getElementById('fileInput')
const uploadZone = document.getElementById('uploadZone')
const processingOverlay = document.getElementById('processingOverlay')
const processingText = document.getElementById('processingText')

const filterTabs = document.querySelectorAll('.tab')
const badgeAll = document.getElementById('badgeAll')
const badgePending = document.getElementById('badgePending')
const badgeCompleted = document.getElementById('badgeCompleted')

const themeToggleBtn = document.getElementById('themeToggleBtn')
const taskDetailModal = document.getElementById('taskDetailModal')
const closeModalBtn = document.getElementById('closeModalBtn')
const detailScreenshot = document.getElementById('detailScreenshot')
const detailTitle = document.getElementById('detailTitle')
const detailDeadline = document.getElementById('detailDeadline')
const detailCountdown = document.getElementById('detailCountdown')
const detailCategory = document.getElementById('detailCategory')
const detailConfidence = document.getElementById('detailConfidence')
const detailNotes = document.getElementById('detailNotes')
const saveTaskBtn = document.getElementById('saveTaskBtn')
const deleteTaskBtn = document.getElementById('deleteTaskBtn')
const toggleCompleteBtn = document.getElementById('toggleCompleteBtn')

// State
let currentFilter = 'all'
let allTasks = []
let selectedTask = null

// Initialize
init()

async function init() {
    console.log('Initializing popup...')

    // Check if setup is complete
    const setupComplete = await checkSetupStatus()

    if (setupComplete) {
        showMainApp()
        loadTasks()
    } else {
        showSetupScreen()
    }

    // Initialize Theme Icon
    try {
        const result = await chrome.storage.local.get(['theme'])
        updateThemeIcon(result.theme || 'light')
    } catch (e) { }

    // Attach event listeners
    attachEventListeners()
}

// Check if API key is configured
async function checkSetupStatus() {
    try {
        const result = await chrome.storage.local.get(['geminiApiKey', 'setupComplete'])
        return result.setupComplete === true && !!result.geminiApiKey
    } catch (error) {
        console.error('Setup check error:', error)
        return false
    }
}

// Show setup screen
function showSetupScreen() {
    setupScreen.classList.remove('hidden')
    mainApp.classList.add('hidden')
}

// Show main app
function showMainApp() {
    setupScreen.classList.add('hidden')
    mainApp.classList.remove('hidden')
}

// Attach event listeners
function attachEventListeners() {
    // Setup screen
    getApiKeyBtn.addEventListener('click', handleGetApiKey)
    saveApiKeyBtn.addEventListener('click', handleSaveApiKey)
    apiKeyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSaveApiKey()
    })

    // Main app
    themeToggleBtn.addEventListener('click', handleToggleTheme)
    captureTabBtn.addEventListener('click', handleCaptureTab)
    settingsBtn.addEventListener('click', handleOpenSettings)

    // Upload button
    uploadBtn.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', handleFileUpload)

    // Paste support (document-level + zone-level)
    document.addEventListener('paste', handlePaste)
    uploadZone.addEventListener('click', () => uploadZone.focus())

    // Drag-and-drop
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.stopPropagation()
        uploadZone.classList.add('dragover')
    })
    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault()
        e.stopPropagation()
        uploadZone.classList.remove('dragover')
    })
    uploadZone.addEventListener('drop', handleDrop)

    // Filter tabs
    filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const filter = tab.dataset.filter
            handleFilterChange(filter)
        })
    })

    // Modal
    closeModalBtn.addEventListener('click', closeModal)
    taskDetailModal.addEventListener('click', (e) => {
        if (e.target === taskDetailModal) closeModal()
    })

    // Modal actions
    saveTaskBtn.addEventListener('click', handleSaveTask)
    deleteTaskBtn.addEventListener('click', handleDeleteTask)
    toggleCompleteBtn.addEventListener('click', handleToggleComplete)
}

// Handle get API key button
function handleGetApiKey() {
    chrome.tabs.create({
        url: 'https://makersuite.google.com/app/apikey'
    })
}

// Handle save API key
async function handleSaveApiKey() {
    const apiKey = apiKeyInput.value.trim()

    if (!apiKey) {
        showError('Please enter an API key')
        return
    }

    // Show loading
    saveApiKeyBtn.textContent = 'TESTING...'
    saveApiKeyBtn.disabled = true

    try {
        // Test API key directly via fetch (avoids service worker caching issues)
        const testResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Reply with OK' }] }]
                })
            }
        )

        if (testResponse.ok) {
            // Save API key
            await chrome.storage.local.set({
                geminiApiKey: apiKey,
                setupComplete: true
            })

            logger.info('API key validated and saved successfully');

            showToast('API Key verified!', 'success');
            showMainApp()
            loadTasks()
        } else {
            let errorMsg = 'Invalid API key. Please check and try again.';
            try {
                const errData = await testResponse.json();
                if (errData.error && errData.error.message) {
                    errorMsg = errData.error.message;
                }
            } catch (e) { }
            logger.warn('Invalid API key provided during setup', errorMsg);
            showError(errorMsg)
            showToast('API Error', 'error');
        }
    } catch (error) {
        logger.error('API key validation error:', error)
        showError('Failed to validate API key. Please try again.')
        showToast('Connection error', 'error');
    } finally {
        saveApiKeyBtn.textContent = 'SAVE'
        saveApiKeyBtn.disabled = false
    }
}

// Show error in setup
function showError(message) {
    setupError.textContent = message
    setupError.classList.remove('hidden')
    setTimeout(() => {
        setupError.classList.add('hidden')
    }, 5000)
}

// Load tasks
async function loadTasks() {
    const startTime = performance.now();
    try {
        // Show loading
        loadingState.classList.remove('hidden')
        taskList.innerHTML = ''
        emptyState.classList.add('hidden')

        // Get tasks from storage (temporary - will use Firebase later)
        const result = await chrome.storage.local.get('tasks')
        allTasks = result.tasks || []

        // Sort by deadline (soonest first)
        allTasks.sort((a, b) => new Date(a.deadline) - new Date(b.deadline))

        // Hide loading
        loadingState.classList.add('hidden')

        // Display tasks
        displayTasks()
        updateBadges()

        // Show onboarding tip for first task
        if (allTasks.length === 1) {
            const res = await chrome.storage.local.get('firstTaskTipShown');
            if (!res.firstTaskTipShown) {
                setTimeout(() => {
                    showToast('🎉 First task added! Click it to edit details.', 'info');
                    chrome.storage.local.set({ firstTaskTipShown: true });
                }, 500);
            }
        }

        // Tell background to update badge
        chrome.runtime.sendMessage({ action: 'updateBadge' })

        const endTime = performance.now();
        logPerformance('Popup_loadTasks', Math.round(endTime - startTime), { taskCount: allTasks.length });
    } catch (error) {
        const endTime = performance.now();
        logPerformance('Popup_loadTasks', Math.round(endTime - startTime), { success: false, error: error.message });
        logger.error('Load tasks error:', error)
        loadingState.classList.add('hidden')
        emptyState.classList.remove('hidden')
    }
}

// Display tasks based on current filter
function displayTasks() {
    const filteredTasks = filterTasks(allTasks, currentFilter)

    if (filteredTasks.length === 0) {
        taskList.innerHTML = ''
        emptyState.classList.remove('hidden')
        return
    }

    emptyState.classList.add('hidden')
    taskList.innerHTML = filteredTasks.map(task => createTaskCard(task)).join('')

    // Attach click listeners to task cards
    document.querySelectorAll('.task-card').forEach(card => {
        card.addEventListener('click', () => {
            const taskId = card.dataset.taskId
            openTaskDetail(taskId)
        })
    })
}

// Filter tasks
function filterTasks(tasks, filter) {
    if (filter === 'all') return tasks
    if (filter === 'pending') return tasks.filter(t => t.status === 'pending')
    if (filter === 'completed') return tasks.filter(t => t.status === 'completed')
    return tasks
}

// Create task card HTML
function createTaskCard(task) {
    const daysLeft = calculateDaysLeft(task.deadline)
    const urgencyClass = getUrgencyClass(daysLeft)
    const countdownText = getCountdownText(daysLeft)
    const completedClass = task.status === 'completed' ? 'completed' : ''

    return `
    <div class="task-card ${completedClass}" data-task-id="${task.id}">
      <div class="task-thumbnail">
        <img src="${task.screenshotBase64}" alt="Screenshot" loading="lazy" />
      </div>
      <div class="task-content">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <span class="task-category ${task.category}">${task.category.toUpperCase()}</span>
        <div class="task-countdown ${urgencyClass}">${countdownText}</div>
        <div class="task-priority">${getPriorityHearts(daysLeft)}</div>
      </div>
    </div>
  `
}

// Calculate days left
function calculateDaysLeft(deadline) {
    const now = new Date()
    const deadlineDate = new Date(deadline)
    const diffTime = deadlineDate - now
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
}

// Get urgency class
function getUrgencyClass(daysLeft) {
    if (daysLeft < 0) return 'urgent'
    if (daysLeft <= 3) return 'urgent'
    if (daysLeft <= 7) return 'warning'
    return 'safe'
}

// Get countdown text
function getCountdownText(daysLeft) {
    if (daysLeft < 0) {
        return `OVERDUE BY ${Math.abs(daysLeft)}D`
    }
    if (daysLeft === 0) return 'TODAY!'
    if (daysLeft === 1) return '1 DAY LEFT'
    return `${daysLeft} DAYS LEFT`
}

// Get priority hearts
function getPriorityHearts(daysLeft) {
    if (daysLeft <= 3) return '❤️❤️❤️'
    if (daysLeft <= 7) return '❤️❤️'
    return '❤️'
}

// Update filter badges
function updateBadges() {
    const allCount = allTasks.length
    const pendingCount = allTasks.filter(t => t.status === 'pending').length
    const completedCount = allTasks.filter(t => t.status === 'completed').length

    badgeAll.textContent = allCount
    badgePending.textContent = pendingCount
    badgeCompleted.textContent = completedCount
}

// Handle filter change
function handleFilterChange(filter) {
    currentFilter = filter

    // Update active tab
    filterTabs.forEach(tab => {
        if (tab.dataset.filter === filter) {
            tab.classList.add('active')
        } else {
            tab.classList.remove('active')
        }
    })

    // Display filtered tasks
    displayTasks()
}

// Handle capture tab
async function handleCaptureTab() {
    const startTime = performance.now();
    try {
        captureTabBtn.textContent = 'CAPTURING...'
        captureTabBtn.disabled = true

        // Send message to background to capture tab
        const response = await chrome.runtime.sendMessage({
            action: 'captureTab'
        })

        if (response.success) {
            showProcessing('ANALYZING TAB...')
            const processResult = await chrome.runtime.sendMessage({
                action: 'processImage',
                imageData: response.imageData
            })
            hideProcessing()

            if (processResult.success) {
                await loadTasks()
                captureTabBtn.textContent = '✓ ADDED!'
                showToast('Deadline captured successfully!', 'success')
                setTimeout(() => {
                    captureTabBtn.textContent = '📷 CAPTURE'
                }, 2000)

                const endTime = performance.now();
                logPerformance('Popup_handleCaptureTab', Math.round(endTime - startTime), { success: true });
                logger.info('Tab captured and processed via popup successfully');
            } else {
                logger.warn('Failed to extract deadline from popup capture', { error: processResult.error });
                showToast(processResult.error || 'Failed to extract deadline', 'error')
            }
        } else {
            logger.warn('Failed to capture screenshot from popup', { error: response.error });
            showToast('Failed to capture screenshot', 'error')
        }
    } catch (error) {
        hideProcessing()
        const endTime = performance.now();
        logPerformance('Popup_handleCaptureTab', Math.round(endTime - startTime), { success: false, error: error.message });
        logger.error('Capture error:', error)
        showToast('Failed to capture. Please try again.', 'error')
    } finally {
        captureTabBtn.disabled = false
        captureTabBtn.textContent = '📷 CAPTURE'
    }
}

// Handle file upload from device
async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error')
        fileInput.value = ''
        return
    }

    const base64 = await readFileAsBase64(file)
    fileInput.value = '' // reset so same file can be re-selected
    await processUploadedImage(base64)
}

// Handle clipboard paste
async function handlePaste(e) {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault()
            const blob = item.getAsFile()
            if (!blob) continue
            const base64 = await readFileAsBase64(blob)
            await processUploadedImage(base64)
            return
        }
    }
}

// Handle drag-and-drop
async function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    uploadZone.classList.remove('dragover')

    const file = e.dataTransfer?.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
        showToast('Please drop an image file', 'error')
        return
    }

    const base64 = await readFileAsBase64(file)
    await processUploadedImage(base64)
}

// Shared: process any uploaded/pasted/dropped image
async function processUploadedImage(base64Data) {
    const startTime = performance.now()
    try {
        showProcessing('ANALYZING IMAGE...')

        const result = await chrome.runtime.sendMessage({
            action: 'processImage',
            imageData: base64Data
        })

        hideProcessing()

        if (result.success) {
            await loadTasks()
            showToast('Deadline extracted successfully!', 'success')
            const endTime = performance.now()
            logPerformance('Popup_processUploadedImage', Math.round(endTime - startTime), { success: true })
            logger.info('Uploaded image processed successfully')
        } else {
            showToast(result.error || 'Failed to extract deadline', 'error')
        }
    } catch (error) {
        hideProcessing()
        const endTime = performance.now()
        logPerformance('Popup_processUploadedImage', Math.round(endTime - startTime), { success: false, error: error.message })
        logger.error('Upload processing error:', error)
        showToast('Failed to process image. Please try again.', 'error')
    }
}

// Helper: read file/blob as base64 data URL
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

// Show/hide processing overlay
function showProcessing(text = 'ANALYZING...') {
    processingText.textContent = text
    processingOverlay.classList.remove('hidden')
}

function hideProcessing() {
    processingOverlay.classList.add('hidden')
}

// Handle open settings
function handleOpenSettings() {
    chrome.runtime.openOptionsPage()
}

// Handle theme toggle
async function handleToggleTheme() {
    try {
        const result = await chrome.storage.local.get(['theme'])
        const currentTheme = result.theme || 'light'

        let newTheme = 'light'
        // If current is auto, toggle to dark, otherwise toggle light/dark
        if (currentTheme === 'light' || currentTheme === 'auto') {
            newTheme = 'dark'
        }

        await chrome.storage.local.set({ theme: newTheme })
        updateThemeIcon(newTheme)
    } catch (e) {
        console.error('Error toggling theme:', e)
    }
}

function updateThemeIcon(theme) {
    if (!themeToggleBtn) return
    const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    themeToggleBtn.textContent = isDark ? '☀️' : '🌙'
}

// Update icon if theme changes from elsewhere
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local' && changes.theme) {
        if (typeof updateThemeIcon === 'function') {
            updateThemeIcon(changes.theme.newValue || 'light')
        }
    }
})

// Default reminder config
const DEFAULT_REMINDERS = [
    { type: 'at_due_time', offset: 0 },
    { type: '1hour', offset: 3600000 },
    { type: '1day', offset: 86400000 }
]

// Get full deadline timestamp from task
function getDeadlineTimestamp(task) {
    if (task.deadlineTime && task.deadline) {
        return new Date(task.deadline + 'T' + task.deadlineTime).getTime()
    }
    if (task.deadline) {
        return new Date(task.deadline + 'T23:59:00').getTime()
    }
    return null
}

// Populate reminder checkboxes from task
function setReminderCheckboxes(task) {
    const allBoxes = document.querySelectorAll('.reminder-grid input[type="checkbox"]')
    const popupBox = document.getElementById('showPopupNotification')

    if (task.reminders && task.reminders.length > 0) {
        // Uncheck all first
        allBoxes.forEach(cb => cb.checked = false)
        // Check the ones in the task
        task.reminders.forEach(r => {
            const cb = document.querySelector(`.reminder-grid input[data-type="${r.type}"]`)
            if (cb) cb.checked = true
        })
    } else {
        // Defaults: at_due_time, 1hour, 1day
        allBoxes.forEach(cb => {
            const type = cb.dataset.type
            cb.checked = (type === 'at_due_time' || type === '1hour' || type === '1day')
        })
    }
    popupBox.checked = task.showPopupNotification !== false
}

// Read selected reminders from checkboxes
function getSelectedReminders(deadlineTimestamp) {
    const reminders = []
    const allBoxes = document.querySelectorAll('.reminder-grid input[type="checkbox"]:checked')
    const now = Date.now()

    allBoxes.forEach(cb => {
        const type = cb.dataset.type
        const offset = parseInt(cb.dataset.offset, 10)
        const fireTime = deadlineTimestamp - offset

        reminders.push({
            type,
            offset,
            fireTime: new Date(fireTime).toISOString(),
            sent: fireTime <= now  // mark as sent if already past
        })
    })
    return reminders
}

// Open task detail modal
function openTaskDetail(taskId) {
    selectedTask = allTasks.find(t => t.id === taskId)

    if (!selectedTask) return

    // Populate modal
    detailScreenshot.src = selectedTask.screenshotBase64
    detailTitle.value = selectedTask.title

    // Populate datetime-local from deadline + deadlineTime
    if (selectedTask.deadline) {
        const time = selectedTask.deadlineTime || '23:59'
        detailDeadline.value = selectedTask.deadline + 'T' + time
    } else {
        detailDeadline.value = ''
    }

    detailCategory.value = selectedTask.category
    detailNotes.value = selectedTask.notes || ''

    // Update confidence badge
    detailConfidence.textContent = selectedTask.confidence.toUpperCase()
    detailConfidence.style.background = getConfidenceColor(selectedTask.confidence)

    // Update countdown
    const deadlineTs = getDeadlineTimestamp(selectedTask)
    if (deadlineTs) {
        const msLeft = deadlineTs - Date.now()
        const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))
        detailCountdown.textContent = getCountdownText(daysLeft)
    } else {
        detailCountdown.textContent = ''
    }

    // Populate reminder checkboxes
    setReminderCheckboxes(selectedTask)

    // Update complete button text
    if (selectedTask.status === 'completed') {
        toggleCompleteBtn.textContent = 'MARK AS PENDING'
    } else {
        toggleCompleteBtn.textContent = 'MARK AS COMPLETED'
    }

    // Show modal
    taskDetailModal.classList.remove('hidden')
}

// Close task detail modal
function closeModal() {
    taskDetailModal.classList.add('hidden')
    selectedTask = null
}

// Handle save task edits
async function handleSaveTask() {
    if (!selectedTask) return

    const originalId = selectedTask.id

    // Parse datetime-local value into date + time parts
    const dtValue = detailDeadline.value // format: "2026-03-15T23:59"
    let deadlineDate = selectedTask.deadline
    let deadlineTime = selectedTask.deadlineTime || '23:59'

    if (dtValue && dtValue.includes('T')) {
        const [datePart, timePart] = dtValue.split('T')
        deadlineDate = datePart
        deadlineTime = timePart
    } else if (dtValue) {
        deadlineDate = dtValue
    }

    const deadlineTimestamp = new Date(deadlineDate + 'T' + deadlineTime).getTime()
    console.log('handleSaveTask: dtValue=', dtValue, 'deadlineDate=', deadlineDate, 'deadlineTime=', deadlineTime, 'deadlineTimestamp=', deadlineTimestamp, 'now=', Date.now(), 'inFuture=', deadlineTimestamp > Date.now())

    // Warn if deadline is in the past
    if (deadlineTimestamp < Date.now()) {
        showToast('⚠️ Deadline is in the past! No reminders will be set.', 'error')
    }

    // Collect reminder selections
    const reminders = getSelectedReminders(deadlineTimestamp)
    const showPopup = document.getElementById('showPopupNotification').checked

    // Update task data from inputs
    const updatedTask = {
        ...selectedTask,
        title: detailTitle.value,
        deadline: deadlineDate,
        deadlineTime: deadlineTime,
        category: detailCategory.value,
        notes: detailNotes.value,
        reminders: reminders,
        showPopupNotification: showPopup,
    }

    saveTaskBtn.textContent = 'SAVING...'
    saveTaskBtn.disabled = true

    try {
        const result = await chrome.storage.local.get('tasks')
        let tasks = result.tasks || []

        const index = tasks.findIndex(t => t.id === originalId)
        if (index !== -1) {
            tasks[index] = updatedTask
        } else {
            tasks.push(updatedTask)
        }

        await chrome.storage.local.set({ tasks })

        // Update local state
        allTasks = tasks
        selectedTask = updatedTask

        // Refresh UI
        displayTasks()

        // Clear old alarms and schedule new reminders
        console.log('Sending scheduleReminders to service worker, task:', updatedTask.id, 'reminders:', updatedTask.reminders?.length)
        chrome.runtime.sendMessage({
            action: 'scheduleReminders',
            task: updatedTask
        }).then(resp => {
            console.log('scheduleReminders response:', resp)
        }).catch(err => {
            console.error('scheduleReminders send error:', err)
        })

        showToast('Task saved successfully', 'success')
        closeModal()
    } catch (error) {
        console.error('Failed to save task:', error)
        showToast('Failed to save task. Please try again.', 'error')
    } finally {
        saveTaskBtn.textContent = '💾 SAVE'
        saveTaskBtn.disabled = false
    }
}

// Handle delete task
async function handleDeleteTask() {
    if (!selectedTask) return

    if (!confirm('Are you sure you want to delete this task?')) return

    deleteTaskBtn.textContent = 'DELETING...'
    deleteTaskBtn.disabled = true

    try {
        const taskId = selectedTask.id

        const result = await chrome.storage.local.get('tasks')
        let tasks = result.tasks || []
        tasks = tasks.filter(t => t.id !== taskId)

        await chrome.storage.local.set({ tasks })

        // Update local state
        allTasks = tasks

        // Clear all alarms for this task
        chrome.runtime.sendMessage({
            action: 'clearTaskAlarms',
            taskId: taskId
        })

        // Refresh UI
        displayTasks()
        updateBadges()
        chrome.runtime.sendMessage({ action: 'updateBadge' })

        showToast('Task deleted', 'success')
        closeModal()
    } catch (error) {
        console.error('Failed to delete task:', error)
        showToast('Failed to delete task', 'error')
    } finally {
        deleteTaskBtn.textContent = '🗑️ DELETE'
        deleteTaskBtn.disabled = false
    }
}

// Handle toggle complete
async function handleToggleComplete() {
    if (!selectedTask) return

    const isCompleted = selectedTask.status === 'completed'
    const newStatus = isCompleted ? 'pending' : 'completed'

    try {
        const taskId = selectedTask.id

        const result = await chrome.storage.local.get('tasks')
        let tasks = result.tasks || []
        const taskIndex = tasks.findIndex(t => t.id === taskId)

        if (taskIndex !== -1) {
            tasks[taskIndex].status = newStatus
            await chrome.storage.local.set({ tasks })

            // Update local state
            allTasks = tasks
            selectedTask = tasks[taskIndex]

            // Clear/schedule alarms based on status
            if (newStatus === 'completed') {
                chrome.runtime.sendMessage({ action: 'clearTaskAlarms', taskId })
            } else {
                chrome.runtime.sendMessage({ action: 'scheduleReminders', task: tasks[taskIndex] })
            }

            // Refresh UI
            displayTasks()
            updateBadges()
            chrome.runtime.sendMessage({ action: 'updateBadge' })

            showToast(`Task marked as ${newStatus}`, 'success')
            closeModal()
        }
    } catch (error) {
        console.error('Failed to toggle completion:', error)
        showToast('Failed to update task status', 'error')
    }
}

// Helper to escape HTML and prevent XSS
function escapeHtml(unsafe) {
    if (!unsafe) return ''
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
}

// Helper for confidence color
function getConfidenceColor(confidence) {
    switch (confidence?.toLowerCase()) {
        case 'high': return '#4CAF50'
        case 'medium': return '#FF9800'
        case 'low': return '#F44336'
        default: return '#9E9E9E'
    }
}

// Toast notification system
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Icon based on type
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

    toastContainer.appendChild(toast);

    // Remove after animation completes (3s total)
    setTimeout(() => {
        if (toast.parentNode === toastContainer) {
            toastContainer.removeChild(toast);
        }
    }, 3000);
}
