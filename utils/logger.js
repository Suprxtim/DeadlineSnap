class Logger {
    constructor() {
        this.maxLogs = 100;
        this.maxErrors = 10;
    }

    async log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, level, message, data };

        try {
            const result = await chrome.storage.local.get(['debugMode', 'debug_logs', 'recent_errors']);
            const isDebug = result.debugMode === true;

            // In development/debug mode: console.log with styled output
            if (isDebug) {
                const styles = {
                    info: 'color: #3b82f6; font-weight: bold;',
                    warn: 'color: #f59e0b; font-weight: bold;',
                    error: 'color: #ef4444; font-weight: bold;',
                    debug: 'color: #8b5cf6; font-weight: bold;'
                };
                const style = styles[level] || 'color: black;';
                if (data) {
                    console.log(`%c[${timestamp}] [${level.toUpperCase()}] ${message}`, style, data);
                } else {
                    console.log(`%c[${timestamp}] [${level.toUpperCase()}] ${message}`, style);
                }
            }

            // Always save to storage for debugging purposes
            let logs = result.debug_logs || [];
            logs.push(logEntry);
            if (logs.length > this.maxLogs) logs = logs.slice(-this.maxLogs);

            let updatePayload = { debug_logs: logs };

            if (level === 'error') {
                let errors = result.recent_errors || [];
                errors.push(logEntry);
                if (errors.length > this.maxErrors) errors = errors.slice(-this.maxErrors);
                updatePayload.recent_errors = errors;
            }

            await chrome.storage.local.set(updatePayload);

        } catch (e) {
            console.error("Logger failed:", e);
        }
    }

    info(message, data) { return this.log('info', message, data); }
    warn(message, data) { return this.log('warn', message, data); }
    error(message, data) { return this.log('error', message, data); }
    debug(message, data) { return this.log('debug', message, data); }
}

export const logger = new Logger();
