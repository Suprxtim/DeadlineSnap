const fs = require('fs');

const cssVars = `/* CSS Variables */
:root {
    --grass-green: #5CB85C;
    --stone-gray: #7A7A7A;
    --diamond-blue: #4A9EFF;
    --redstone-red: #E74C3C;
    --gold-yellow: #F1C40F;
    
    --bg-primary: #FAFAFA;
    --bg-secondary: #FFFFFF;
    --bg-tertiary: #E0E0E0;
    --text-primary: #2C2C2C;
    --text-muted: #7A7A7A;
    --border-main: #2C2C2C;
    --header-bg: #2C2C2C;
    --header-text: #FFFFFF;
    --card-shadow: rgba(0, 0, 0, 0.2);
    --overlay-bg: rgba(44, 44, 44, 0.92);

    --border-thick: 4px;
    --shadow-block: 6px 6px 0 var(--card-shadow);
    --shadow-block-sm: 4px 4px 0 var(--card-shadow);
}

[data-theme="dark"] {
    --bg-primary: #0F1419;
    --bg-secondary: #1A1F2E;
    --bg-tertiary: #2D3748;
    --text-primary: #E0E0E0;
    --text-muted: #A0A0A0;
    --border-main: #4A4A4A;
    --header-bg: #1A1F2E;
    --header-text: #E0E0E0;
    --card-shadow: rgba(0, 0, 0, 0.6);
    --overlay-bg: rgba(15, 20, 25, 0.95);
    
    --grass-green: #68C968;
    --diamond-blue: #5BAAFF;
    --redstone-red: #F05C4D;
}

body, .pixel-container, .pixel-header, .pixel-card, .modal-content, .task-card, .pixel-input, .pixel-select, .tab, .upload-zone, .pixel-button, .toast, .filter-tabs, .pixel-footer, .options-container {
    transition: background-color 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s;
}`;

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace :root block until closing bracket (and following blank lines)
    content = content.replace(/:root\s*\{[^}]*\}/, cssVars);

    // Common replacements
    content = content.replace(/var\(--snow-white\)/g, 'var(--bg-primary)');
    content = content.replace(/background:\s*#FAFAFA;/g, 'background: var(--bg-primary);');
    content = content.replace(/background:\s*#E0E0E0;/g, 'background: var(--bg-tertiary);');
    content = content.replace(/color:\s*#2C2C2C;/g, 'color: var(--text-primary);');
    content = content.replace(/background:\s*white;/g, 'background: var(--bg-secondary);');
    content = content.replace(/background:\s*#FFFFFF;/g, 'background: var(--bg-secondary);');
    content = content.replace(/background-color:\s*white;/g, 'background-color: var(--bg-secondary);');

    // Care with var(--obsidian-black)
    // For borders:
    content = content.replace(/border([\w-]*):\s*(.*?)var\(--obsidian-black\)/g, 'border$1: $2var(--border-main)');
    content = content.replace(/border-color:\s*var\(--obsidian-black\)/g, 'border-color: var(--border-main)');
    // Text:
    content = content.replace(/color:\s*var\(--obsidian-black\)/g, 'color: var(--text-primary)');
    // Backgrounds:
    content = content.replace(/background:\s*var\(--obsidian-black\)/g, 'background: var(--header-bg)');

    // Other specific colors
    content = content.replace(/rgba\(44,\s*44,\s*44,\s*0\.92\)/g, 'var(--overlay-bg)');
    content = content.replace(/rgba\(44,\s*44,\s*44,\s*0\.9\)/g, 'var(--overlay-bg)');

    // Fix shadow variables that use new --card-shadow
    content = content.replace(/box-shadow:\s*8px 8px 0 rgba\(0, 0, 0, 0\.2\);/g, 'box-shadow: 8px 8px 0 var(--card-shadow);');
    content = content.replace(/box-shadow:\s*6px 6px 0 rgba\(0, 0, 0, 0\.2\);/g, 'box-shadow: 6px 6px 0 var(--card-shadow);');
    content = content.replace(/box-shadow:\s*4px 4px 0 rgba\(0, 0, 0, 0\.2\);/g, 'box-shadow: 4px 4px 0 var(--card-shadow);');
    content = content.replace(/box-shadow:\s*12px 12px 0 rgba\(0, 0, 0, 0\.3\);/g, 'box-shadow: 12px 12px 0 var(--card-shadow);');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Processed', filePath);
}

processFile('./popup/popup.css');
processFile('./options/options.css');
