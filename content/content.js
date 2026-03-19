chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    try {
        if (req.action === 'getImageUrl') {
            sendResponse({ url: getBest(req.elementId || req.selector) });
        } else if (req.action === 'getPageImages') {
            sendResponse({ images: getImages() });
        }
    } catch (e) {
        sendResponse({ url: null, error: e.message });
    }
});

const getSrc = (el) => {
    if (!el) return null;
    if (el.tagName === 'IMG') {
        return el.getAttribute('data-src') ||
            el.getAttribute('data-original') ||
            el.currentSrc ||
            el.src;
    }
    const bg = window.getComputedStyle(el).backgroundImage;
    return bg !== 'none' ? bg.match(/url\(['"]?(.*?)['"]?\)/)?.[1] || null : null;
};

const getBest = (sel) => sel ? getSrc(document.getElementById(sel) || document.querySelector(sel)) : null;

const getImages = () => Array.from(document.querySelectorAll('img'))
    .filter(img => img.getBoundingClientRect().width > 0)
    .map(img => ({
        url: getSrc(img),
        w: img.naturalWidth || img.width || img.clientWidth,
        h: img.naturalHeight || img.height || img.clientHeight
    }))
    .filter(item => item.w >= 100 && item.h >= 100 && item.url)
    .map(item => ({
        url: item.url,
        width: item.w,
        height: item.h,
        preferred: item.w > 400
    }));