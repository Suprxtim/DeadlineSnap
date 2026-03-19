import { logger } from './logger.js';

export async function getDebugInfo() {
    try {
        const result = await chrome.storage.local.get(null);

        const manifest = chrome.runtime.getManifest();
        const extensionVersion = manifest.version;
        const chromeVersionMatch = /Chrome\/([0-9.]+)/.exec(navigator.userAgent);
        const chromeVersion = chromeVersionMatch ? chromeVersionMatch[1] : 'Unknown';

        let totalTasksCount = 0;
        if (result.tasks && Array.isArray(result.tasks)) {
            totalTasksCount = result.tasks.length;
        }

        const apiKeyExists = !!result.geminiApiKey;

        let storageBytesInUse = await new Promise((resolve) => {
            if (chrome.storage.local.getBytesInUse) {
                chrome.storage.local.getBytesInUse(null, (bytes) => {
                    if (chrome.runtime.lastError) resolve(0);
                    resolve(bytes);
                });
            } else {
                resolve(0); // Fallback
            }
        });
        const storageUsageKB = (storageBytesInUse / 1024).toFixed(2) + ' KB';

        const recentErrors = result.recent_errors || [];
        const performanceLogs = result.performance_logs || [];

        return {
            extensionVersion,
            chromeVersion,
            totalTasksCount,
            apiKeyExists,
            storageUsage: storageUsageKB,
            recentErrors,
            performanceLogs
        };
    } catch (e) {
        logger.error('Failed to get debug info', e);
        return null;
    }
}

export async function exportDebugLog() {
    try {
        const result = await chrome.storage.local.get(['debug_logs', 'recent_errors', 'performance_logs']);
        const debugInfo = await getDebugInfo();

        const report = {
            generatedAt: new Date().toISOString(),
            environment: debugInfo,
            logs: result.debug_logs || [],
            errors: result.recent_errors || [],
            performance: result.performance_logs || []
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `deadlinesnap-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        logger.info('Debug log exported successfully');
    } catch (e) {
        logger.error('Failed to export debug log', e);
    }
}

export async function clearDebugLogs() {
    try {
        await chrome.storage.local.remove(['debug_logs', 'recent_errors', 'performance_logs']);
        logger.info('Debug logs cleared');
    } catch (e) {
        console.error('Failed to clear debug logs', e);
    }
}

export async function logPerformance(operation, timeTakenMs, extraData = null) {
    try {
        const result = await chrome.storage.local.get(['performance_logs']);
        let perfLogs = result.performance_logs || [];
        perfLogs.push({
            operation,
            timeTakenMs,
            timestamp: new Date().toISOString(),
            ...extraData
        });

        if (perfLogs.length > 50) perfLogs = perfLogs.slice(-50);
        await chrome.storage.local.set({ performance_logs: perfLogs });

        logger.debug(`Performance: ${operation} took ${timeTakenMs}ms`, extraData);
    } catch (e) {
        logger.error('Failed to log performance', e);
    }
}
