// This file executes synchronously on page load to apply the theme instantly and avoid a flash of unstyled content (FOUC)
(function () {
    function applyTheme(theme) {
        if (theme === 'auto') {
            const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme || 'light');
        }
    }

    try {
        chrome.storage.local.get(['theme'], function (result) {
            const theme = result.theme || 'light';
            applyTheme(theme);
        });
    } catch (e) {
        console.error('Error loading theme:', e);
    }

    // Listen for system theme changes if in auto mode
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            chrome.storage.local.get(['theme'], function (result) {
                if (result.theme === 'auto') {
                    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                }
            });
        });
    }

    // Listen for storage changes to sync theme across extension pages
    chrome.storage.onChanged.addListener(function (changes, namespace) {
        if (namespace === 'local' && changes.theme) {
            applyTheme(changes.theme.newValue || 'light');
        }
    });
})();
