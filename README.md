# ChatGPT TOC Navigator (Chrome/Edge Extension)

A lightweight browser extension that adds a draggable, clickable Table of Contents (TOC) to ChatGPT conversations so you can jump to earlier messages instantly — especially helpful when answers are long.

> Works by injecting a small UI panel into ChatGPT webpages (content script).  
> This is **not** an OpenAI “plugin/Action” — it’s a **browser extension** that enhances the page UI.

---

## Features

- ✅ **Clickable TOC**: One item per user prompt (and corresponding assistant reply)
- ✅ **Jump to message**: Click an item to scroll to that turn smoothly
- ✅ **Supports non-text prompts**:
  - 📷 Image-only messages (shows count + optional thumbnails)
  - 📎 File-only messages (shows file name or file count)
- ✅ **Search**: Filter TOC items by keyword
- ✅ **Draggable UI**:
  - Drag the panel by the title area
  - Minimized “TOC” bubble is also draggable
- ✅ **Minimize / Restore**:
  - `Min` → collapses into a small **TOC** bubble
  - Click the bubble → restore the panel
- ✅ **Shared position**:
  - Panel & bubble share the same saved position
- ✅ **Smooth animations**: Fade + scale transitions (not abrupt)
- ✅ **Auto-updates**: TOC updates when new messages appear (MutationObserver)

---

## Demo / Screenshot

<<<<<<< HEAD
> Add your own screenshot here if you want:
- `./assets/screenshot.png`
=======
- <img width="3399" height="1596" alt="image" src="https://github.com/user-attachments/assets/83c47078-38b8-4ba8-b908-a395402d00b7" />


>>>>>>> bca2e3df145451b53b16a9a9c315b9c53daa35a6

---

## Install (Developer Mode)

1. Clone / download this repo.
2. Open Chrome/Edge and go to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the project folder (the one that contains `manifest.json`).

Open ChatGPT:
- `https://chatgpt.com/`
- or `https://chat.openai.com/`

You should see the TOC panel on the page.

---

## How to Use

- **Drag** the panel using the **title area** (“Conversation TOC”).
- **Min**: Click `Min` → panel collapses into a small **TOC** bubble.
- **Restore**: Click the **TOC** bubble → panel reopens at the same position.
- **Hide/Show list**: Click `Hide` (this only collapses the list/search inside the panel).
- **Search**: Type into the search box to filter items.
- **Jump**: Click a TOC item → smooth scroll to that conversation turn.

---
<<<<<<< HEAD

## Permissions & Privacy

=======
>>>>>>> bca2e3df145451b53b16a9a9c315b9c53daa35a6
### Permissions used
- `host_permissions`: only for:
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`

### Privacy
- This extension runs locally in your browser.
- It does **not** send your chat content anywhere.
- No analytics, no tracking, no external network requests (unless you add them yourself).

---

## Project Structure

├─ manifest.json

├─ content.js

├─ styles.css

└─ README.md

---

## Notes / Limitations

- ChatGPT’s DOM structure can change. If OpenAI updates the UI, selectors may need updates.
- Some file cards may not expose filenames consistently; the extension uses best-effort detection.

---

## Troubleshooting

### 1) “Min” works but clicking the TOC bubble doesn’t restore
- Make sure you are using the latest `content.js`.
- If you just dragged the bubble, the immediate click is intentionally ignored to avoid accidental restore.

### 2) The bubble/panel is off-screen
- Resize the browser window or set zoom back to 100%.
- Refresh the page; the extension clamps position back into view.

### 3) TOC items are missing / not updating
- Click `Refresh`.
- If the page was open a long time, DOM changes might need a refresh.

---

## Roadmap (Ideas)

- Nested TOC: parse assistant headings (# / ## / ###) as second-level items
- Bookmark/star important turns
- Export TOC to markdown
- Keyboard shortcut to toggle TOC (e.g., Alt+T)

---

## Disclaimer

This project is not affiliated with or endorsed by OpenAI.  
“ChatGPT” is a trademark of OpenAI.
