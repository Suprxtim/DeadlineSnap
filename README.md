# DeadlineSnap Chrome Extension

Never miss a deadline again. DeadlineSnap lets you right-click any opportunity screenshot or text, and automatically extracts the deadline and details using Google's Gemini AI. Everything is stored persistently and reminds you when the deadline is approaching.

## Features
- **Right-click & Capture**: Add deadlines from any image or text on the web.
- **Global Shortcut `Ctrl+Shift+S`**: Quickly take a screenshot of your active tab.
- **Gemini AI Extraction**: AI automatically parses the deadline, title, and important details.
- **Retro Pixel Theme**: A fun, lightweight, and engaging UI.
- **Smart Browser Notifications**: Reminders fire consistently at 7 days, 3 days, and 1 day before the deadline, regardless of whether the browser was closed.
- **In-Page Widget**: Optional floating widget to keep your pending deadlines always visible on any page.
- **Theme Toggle**: Switch effortlessly between Dark and Light mode.

## Installation
Currently, DeadlineSnap is loaded as an "unpacked extension" for testing. Here's how to install it:

1. Download or clone this repository to a folder on your computer (e.g., `Desktop/deadlinesnap-extension`).
2. Open Google Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the folder where you saved the extension.
6. Pin the extension to your Chrome toolbar for easy access!

## Getting a Gemini API Key (Free)
DeadlineSnap uses Google's Gemini AI to read your screenshots. You'll need a free API key to power this tool:

1. Go to [Google AI Studio (MakerSuite)](https://makersuite.google.com/app/apikey).
2. Sign in with your Google Account.
3. Click the **Create API key** button.
4. If asked, choose to create a key in a new project.
5. Copy the generated API key.
6. Open the DeadlineSnap extension settings (click the ⚙️ icon in the popup), paste your key into the text box, and click **SAVE**.

## Troubleshooting
- **API Key Invalid/Error**: Ensure you copied the entire key without any spaces. Check that you have internet access. The free tier gives you 1,500 requests per day.
- **Screenshot Won't Capture**: Chrome prevents extensions from taking screenshots on special browser pages (like `chrome://` or the New Tab page) and the Chrome Web Store. Try it on a regular website!
- **Notifications Not Showing**: Ensure your operating system (Windows/Mac) allows notifications from Google Chrome.

## Privacy & Security
- Your Gemini API key is stored locally on your device and is never sent to our servers. It is strictly used to communicate directly with Google's API.
- Your captured screenshots are only sent to the Gemini API for text processing and are not permanently stored anywhere else. No database tracking is utilized.

## Built With
- HTML, CSS, JavaScript (Vanilla, ES6+ Modules)
- Manifest V3 Chrome Extension APIs (Service Workers, Storage, Alarms, ContextMenus)
- Google GenAI (Gemini 2.5 Flash) for image parsing and content extraction
Demo video link:
https://drive.google.com/file/d/12OksNSPHd_teZ54i3d576sivJtsUMRlZ/view?usp=sharing
