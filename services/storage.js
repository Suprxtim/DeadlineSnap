// Chrome Storage Helper Functions
import { logger } from '../utils/logger.js';
import { logPerformance } from '../utils/debugger.js';

/**
 * Get Gemini API key from storage
 */
export async function getApiKey() {
    const result = await chrome.storage.local.get('geminiApiKey')
    return result.geminiApiKey || null
}

/**
 * Save Gemini API key to storage
 */
export async function saveApiKey(apiKey) {
    await chrome.storage.local.set({ geminiApiKey: apiKey })
}

/**
 * Check if setup is complete
 */
export async function isSetupComplete() {
    const result = await chrome.storage.local.get(['geminiApiKey', 'setupComplete'])
    return result.setupComplete === true && !!result.geminiApiKey
}

/**
 * Mark setup as complete
 */
export async function markSetupComplete() {
    await chrome.storage.local.set({ setupComplete: true })
}

/**
 * Get all tasks from storage (temporary until Firebase implemented)
 */
export async function getTasks() {
    const startTime = performance.now();
    try {
        const result = await chrome.storage.local.get('tasks')
        const endTime = performance.now();
        logPerformance('Storage_getTasks', Math.round(endTime - startTime), { count: result.tasks?.length || 0 });
        return result.tasks || []
    } catch (error) {
        logger.error('Failed to get tasks from storage', error);
        return [];
    }
}

/**
 * Save task to storage (temporary)
 */
export async function saveTask(task) {
    const startTime = performance.now();
    try {
        const tasks = await getTasks()
        tasks.push(task)
        await chrome.storage.local.set({ tasks })

        const endTime = performance.now();
        logPerformance('Storage_saveTask', Math.round(endTime - startTime), { taskId: task.id || 'unknown' });
        logger.info('Task saved to local storage directly', task);

        return task
    } catch (error) {
        logger.error('Failed to save task to storage', error);
        throw error;
    }
}
