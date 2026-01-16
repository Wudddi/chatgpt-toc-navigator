(() => {
  // =========================
  // Config / IDs
  // =========================
  const PANEL_ID = "cgtoc-panel";
  const LAUNCHER_ID = "cgtoc-launcher";
  const DATA_ID = "data-cgtoc-id";
  const EXTRA_STYLE_ID = "cgtoc-extra-style";
  const STATE_KEY = "cgtoc_state_v2_sharedpos";

  // Performance knobs
  const SHOW_ASSISTANT_PREVIEW = true;
  const MAX_ITEMS = 250;

  // For assistant streaming updates (updates only the last TOC item, no full rebuild)
  const ASSISTANT_IDLE_MS = 600;

  // File detection helpers
  const FILE_SIZE_RE = /\b\d+(\.\d+)?\s*(KB|MB|GB)\b/i;
  const DOWNLOAD_RE = /(download|下载)/i;
  const FILE_HINT_RE = /(file|attachment|附件|文件)/i;
  const FILE_LINK_RE = /\/files\/|file-|blob:|oaiusercontent|backend-api\/files/i;

  // File extension matcher (fallback)
  const FILE_EXT_RE =
    /\b[\w][\w\- .]{0,80}\.(pdf|docx?|pptx?|xlsx?|csv|txt|zip|rar|7z|png|jpe?g|gif|webp|mp4|mov|webm)\b/gi;

  let lastBuiltUserCount = -1;
  let lastRenderedTurnTargetId = null;

  // Assistant observer (to update last preview during streaming)
  let assistantObserver = null;
  let assistantIdleTimer = null;
  let lastObservedAssistantEl = null;

  // =========================
  // Utils
  // =========================
  function djb2Hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  function summarize(text, maxLen = 48) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) return "(empty)";
    return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
  }

  function uniq(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveState(patch) {
    const prev = loadState();
    const next = { ...prev, ...patch };
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
    } catch {}
    return next;
  }

  // =========================
  // Styles
  // =========================
  function injectExtraStyles() {
    if (document.getElementById(EXTRA_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = EXTRA_STYLE_ID;
    style.textContent = `
      /* thumbs */
      .cgtoc-thumbs{display:flex;gap:6px;margin-top:6px}
      .cgtoc-thumb{width:28px;height:28px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.18)}

      /* drag: only title is draggable */
      #cgtoc-header{user-select:none; cursor:default}
      #cgtoc-title{cursor:move}

      /* animation */
      #${PANEL_ID}, #${LAUNCHER_ID}{
        transition: opacity 160ms ease, transform 160ms ease;
        will-change: opacity, transform;
      }
      .cgtoc-anim-hide{
        opacity: 0 !important;
        transform: scale(0.96) !important;
        pointer-events: none !important;
      }

      /* launcher */
      #${LAUNCHER_ID}{
        position:fixed;
        right:20px;
        bottom:20px;
        width:54px;
        height:54px;
        border-radius:999px;
        display:none;
        align-items:center;
        justify-content:center;
        z-index:999999;
        background:rgba(20,20,20,0.92);
        color:#fff;
        border:1px solid rgba(255,255,255,0.18);
        box-shadow:0 10px 30px rgba(0,0,0,0.35);
        backdrop-filter: blur(6px);
        font-weight:800;
        font-size:12px;
        cursor:move;
        user-select:none;
      }
      #${LAUNCHER_ID}:hover{background:rgba(35,35,35,0.92)}
    `;
    document.documentElement.appendChild(style);
  }

  // =========================
  // Position / Drag / Anim
  // =========================
  function placeFixed(el, left, top) {
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;

    const L = clamp(left, 8, Math.max(8, maxLeft));
    const T = clamp(top, 8, Math.max(8, maxTop));

    el.style.left = `${L}px`;
    el.style.top = `${T}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.position = "fixed";
  }

  function saveSharedPosFrom(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    saveState({ posLeft: r.left, posTop: r.top });
  }

  function applySharedPosTo(el) {
    if (!el) return;
    const s = loadState();
    if (typeof s.posLeft === "number" && typeof s.posTop === "number") {
      placeFixed(el, s.posLeft, s.posTop);
    }
  }

  function showWithAnim(el, displayValue) {
    el.style.display = displayValue;
    el.classList.add("cgtoc-anim-hide");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.remove("cgtoc-anim-hide"));
    });
  }

  function hideWithAnim(el, after) {
    if (!el || el.style.display === "none") {
      after && after();
      return;
    }

    el.classList.add("cgtoc-anim-hide");
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      el.style.display = "none";
      after && after();
    };

    const onEnd = (e) => {
      if (e && e.target !== el) return;
      el.removeEventListener("transitionend", onEnd);
      finish();
    };

    el.addEventListener("transitionend", onEnd);
    setTimeout(() => {
      el.removeEventListener("transitionend", onEnd);
      finish();
    }, 220);
  }

  // Draggable without swallowing normal click
  function makeDraggable(target, handle, { onDragEnd } = {}) {
    if (!target || !handle) return;

    let isDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const DRAG_THRESHOLD = 4;

    const onPointerDown = (e) => {
      if (e.target && e.target.closest && e.target.closest("button, input, textarea, a")) return;
      if (e.button !== undefined && e.button !== 0) return;

      isDown = true;
      isDragging = false;

      const rect = target.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      document.addEventListener("pointermove", onPointerMove, { passive: false });
      document.addEventListener("pointerup", onPointerUp, { passive: true });
      document.addEventListener("pointercancel", onPointerUp, { passive: true });
    };

    const onPointerMove = (e) => {
      if (!isDown) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!isDragging) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        isDragging = true;
      }

      e.preventDefault();
      placeFixed(target, startLeft + dx, startTop + dy);
    };

    const onPointerUp = () => {
      if (!isDown) return;
      isDown = false;

      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);

      if (isDragging) {
        target.__movedRecently = true;
        setTimeout(() => (target.__movedRecently = false), 200);
        onDragEnd && onDragEnd(target);
      }
    };

    handle.addEventListener("pointerdown", onPointerDown);
  }

  // =========================
  // UI
  // =========================
  function ensureLauncher() {
    let launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) return launcher;

    launcher = document.createElement("div");
    launcher.id = LAUNCHER_ID;
    launcher.textContent = "TOC";

    launcher.addEventListener("click", () => {
      if (launcher.__movedRecently) return;
      setMinimized(false);
    });

    document.documentElement.appendChild(launcher);
    return launcher;
  }

  function setMinimized(minimized, opts = {}) {
    const panel = document.getElementById(PANEL_ID);
    const launcher = ensureLauncher();
    if (!panel || !launcher) return;

    if (minimized) {
      saveSharedPosFrom(panel);
      applySharedPosTo(launcher);
      showWithAnim(launcher, "flex");
      hideWithAnim(panel);
    } else {
      saveSharedPosFrom(launcher);
      applySharedPosTo(panel);
      showWithAnim(panel, "flex");
      hideWithAnim(launcher);
    }

    if (!opts.skipSave) saveState({ minimized: !!minimized });
  }

  function applySavedUIState() {
    const s = loadState();
    const panel = document.getElementById(PANEL_ID);
    const launcher = ensureLauncher();
    if (!panel || !launcher) return;

    applySharedPosTo(panel);
    applySharedPosTo(launcher);

    const minimized = !!s.minimized;
    if (minimized) {
      panel.style.display = "none";
      launcher.style.display = "flex";
      launcher.classList.remove("cgtoc-anim-hide");
    } else {
      launcher.style.display = "none";
      panel.style.display = "flex";
      panel.classList.remove("cgtoc-anim-hide");
    }
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    const header = document.createElement("div");
    header.id = "cgtoc-header";

    const title = document.createElement("div");
    title.id = "cgtoc-title";
    title.textContent = "Conversation TOC";

    const refreshBtn = document.createElement("button");
    refreshBtn.id = "cgtoc-btn";
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", () => rebuild({ force: true }));

    const minBtn = document.createElement("button");
    minBtn.id = "cgtoc-btn";
    minBtn.textContent = "Min";
    minBtn.addEventListener("click", () => setMinimized(true));

    const toggleBtn = document.createElement("button");
    toggleBtn.id = "cgtoc-btn";
    toggleBtn.textContent = "Hide";
    toggleBtn.addEventListener("click", () => {
      const list = panel.querySelector("#cgtoc-list");
      const search = panel.querySelector("#cgtoc-search");
      const hidden = list.style.display === "none";
      list.style.display = hidden ? "block" : "none";
      search.style.display = hidden ? "block" : "none";
      toggleBtn.textContent = hidden ? "Hide" : "Show";
    });

    header.appendChild(title);
    header.appendChild(refreshBtn);
    header.appendChild(minBtn);
    header.appendChild(toggleBtn);

    const search = document.createElement("input");
    search.id = "cgtoc-search";
    search.placeholder = "Search in TOC…";
    search.addEventListener("input", () => filterList(search.value));

    const list = document.createElement("div");
    list.id = "cgtoc-list";

    panel.appendChild(header);
    panel.appendChild(search);
    panel.appendChild(list);

    document.documentElement.appendChild(panel);

    // drag panel by title
    makeDraggable(panel, title, {
      onDragEnd: (el) => {
        saveSharedPosFrom(el);
        const launcher = document.getElementById(LAUNCHER_ID);
        if (launcher) applySharedPosTo(launcher);
      },
    });

    applySavedUIState();
  }

  // =========================
  // Robust file + image detection
  // =========================
  function matchFileNames(text) {
    if (!text) return null;
    return String(text).match(FILE_EXT_RE);
  }

  // Collect text inside scope excluding assistant subtree (avoid matching ".pdf" in assistant reply)
  function getTextExcluding(scopeNode, assistantNode) {
    if (!scopeNode) return "";
    const parts = [];

    const walker = document.createTreeWalker(
      scopeNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
          if (assistantNode && assistantNode.contains(node.parentElement)) return NodeFilter.FILTER_REJECT;
          const t = node.nodeValue?.trim();
          if (!t) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    while (walker.nextNode()) {
      parts.push(walker.currentNode.nodeValue.trim());
    }
    return parts.join(" ");
  }

  // Main: detect files in the whole turn (scope), but exclude assistant subtree
  function extractFileNames(scopeNode, assistantNode) {
    if (!scopeNode) return [];
    const inAssistant = (el) => assistantNode && assistantNode.contains(el);

    const names = [];
    const candidates = Array.from(
      scopeNode.querySelectorAll("a, button, [role='button'], [download], [aria-label], [title], [data-testid]")
    );

    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      if (inAssistant(el)) continue;

      const download = el.getAttribute?.("download") || "";
      const title = el.getAttribute?.("title") || "";
      const aria = el.getAttribute?.("aria-label") || "";
      const text = (el.textContent || "").trim();
      const href = el.getAttribute?.("href") || "";
      const testid = el.getAttribute?.("data-testid") || "";

      // Try to extract real names with extensions (old behavior)
      for (const v of [download, title, aria, text]) {
        const m = matchFileNames(v);
        if (m) names.push(...m);
      }

      // If link looks like file but no extension exposed, mark as generic file
      const looksLikeFileLink = FILE_LINK_RE.test(href);
      const looksLikeHint =
        FILE_HINT_RE.test(testid) || DOWNLOAD_RE.test(aria) || DOWNLOAD_RE.test(title) || FILE_SIZE_RE.test(text);

      if ((looksLikeFileLink || looksLikeHint) && names.length === 0) {
        names.push("File");
      }
    }

    // Fallback: scan visible text (excluding assistant) for filename-like tokens
    const rawText = getTextExcluding(scopeNode, assistantNode);
    const matches = matchFileNames(rawText);
    if (matches) names.push(...matches);

    const cleaned = uniq(names).map((n) => n.trim());
    const hasRealName = cleaned.some((x) => x !== "File");
    return hasRealName ? cleaned.filter((x) => x !== "File") : cleaned;
  }

  // Detect images in scope excluding assistant, and excluding file-card icons/thumbnails
  function extractImages(scopeNode, assistantNode) {
    if (!scopeNode) return [];
    const inAssistant = (el) => assistantNode && assistantNode.contains(el);

    const imgs = Array.from(scopeNode.querySelectorAll("img"))
      .filter((img) => {
        if (!img?.src) return false;
        if (img.src.startsWith("data:image/svg+xml")) return false;
        if (inAssistant(img)) return false;

        // If image is inside file/attachment card, ignore (usually just an icon/thumbnail)
        const card = img.closest?.('[data-testid*="file"], [data-testid*="attachment"]');
        if (card) return false;

        // Extra safety: ignore tiny icons
        const r = img.getBoundingClientRect?.();
        if (r && r.width <= 60 && r.height <= 60) return false;

        return true;
      })
      .map((img) => img.src);

    return uniq(imgs);
  }

  // =========================
  // Turn parsing & TOC item content
  // =========================
  function getUserDisplay(userNode) {
    const userText = (userNode?.textContent || "").trim();

    const turnRoot = userNode?.closest?.('[data-testid="conversation-turn"]') || userNode;
    const assistantNode =
      turnRoot?.querySelector?.('[data-message-author-role="assistant"]') || null;

    const scope = turnRoot || userNode;

    const fileNames = extractFileNames(scope, assistantNode);
    const imgSrcs = extractImages(scope, assistantNode);

    const filesCount = fileNames.length;
    const imgsCount = imgSrcs.length;

    if (userText) {
      let title = summarize(userText);
      if (filesCount) title += `  📎${filesCount}`;
      if (imgsCount) title += `  📷${imgsCount}`;
      return { title, thumbs: imgSrcs.slice(0, 3), filesCount, imgsCount, fileNames };
    }

    if (filesCount) {
      const single = filesCount === 1 ? summarize(fileNames[0], 60) : `${filesCount} files`;
      return { title: `📎 ${single}`, thumbs: [], filesCount, imgsCount, fileNames };
    }

    if (imgsCount) {
      return {
        title: `📷 ${imgsCount} image${imgsCount > 1 ? "s" : ""}`,
        thumbs: imgSrcs.slice(0, 3),
        filesCount,
        imgsCount,
        fileNames,
      };
    }

    return { title: "(non-text message)", thumbs: [], filesCount, imgsCount, fileNames };
  }

  function getTurns() {
    // Strategy 1: Newer UI
    const turnNodes = Array.from(document.querySelectorAll('[data-testid="conversation-turn"]'));
    if (turnNodes.length) {
      return turnNodes.map((root) => {
        const user = root.querySelector('[data-message-author-role="user"]');
        const assistant = root.querySelector('[data-message-author-role="assistant"]');
        return { root, user, assistant };
      });
    }

    // Strategy 2: fallback
    const roleNodes = Array.from(
      document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')
    );

    const turns = [];
    for (let i = 0; i < roleNodes.length; i++) {
      const n = roleNodes[i];
      const role = n.getAttribute("data-message-author-role");
      if (role !== "user") continue;

      const next = roleNodes[i + 1];
      const assistant =
        next && next.getAttribute("data-message-author-role") === "assistant" ? next : null;

      const root = n.closest("article") || n.parentElement || n;
      turns.push({ root, user: n, assistant });
      if (assistant) i++;
    }
    return turns;
  }

  function assignStableId(turn, globalIndex) {
    const userDisp = getUserDisplay(turn.user);
    const base = `${globalIndex}:${userDisp.title}`;
    const id = `cgtoc-${djb2Hash(base)}`;

    const existing = turn.root.getAttribute?.(DATA_ID);
    if (existing) return existing;

    turn.root.setAttribute(DATA_ID, id);
    if (!turn.root.id) turn.root.id = id;
    return id;
  }

  function getAssistantSummary(assistantEl) {
    if (!assistantEl) return "";
    const md = assistantEl.querySelector?.(".markdown") || assistantEl;
    // Use the first meaningful block to avoid summarizing huge text
    const first = md.querySelector?.("p, li, h1, h2, h3, pre, code") || md;
    return summarize(first ? first.textContent : "", 60);
  }

  // Update ONLY the last rendered TOC item meta during streaming (no full rebuild)
  function updateLastTocAssistantPreview() {
    if (!SHOW_ASSISTANT_PREVIEW) return;
    if (!lastRenderedTurnTargetId) return;

    const list = document.querySelector("#cgtoc-list");
    if (!list) return;

    const item = list.querySelector(`.cgtoc-item[data-target="${CSS.escape(lastRenderedTurnTargetId)}"]`);
    if (!item) return;

    // Find the turn by id and get assistant element
    const turnEl =
      document.getElementById(lastRenderedTurnTargetId) ||
      document.querySelector(`[${DATA_ID}="${CSS.escape(lastRenderedTurnTargetId)}"]`);
    if (!turnEl) return;

    const assistantEl = turnEl.querySelector?.('[data-message-author-role="assistant"]');
    const summary = getAssistantSummary(assistantEl);

    let meta = item.querySelector(".cgtoc-meta");
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "cgtoc-meta";
      item.appendChild(meta);
    }
    meta.textContent = summary;

    // Update search cache
    const titleText = item.querySelector("div")?.textContent || "";
    item.dataset.search = `${titleText} ${summary}`.toLowerCase();
  }

  function observeLastAssistantDuringStreaming(turns, startIndex) {
    if (!SHOW_ASSISTANT_PREVIEW) return;
    if (!turns.length) return;

    const lastTurn = turns[turns.length - 1];
    const assistantEl = lastTurn?.assistant;
    if (!assistantEl) return;

    if (assistantEl === lastObservedAssistantEl) return;
    lastObservedAssistantEl = assistantEl;

    if (assistantObserver) {
      try { assistantObserver.disconnect(); } catch {}
      assistantObserver = null;
    }
    if (assistantIdleTimer) {
      clearTimeout(assistantIdleTimer);
      assistantIdleTimer = null;
    }

    const target = assistantEl.querySelector?.(".markdown") || assistantEl;

    assistantObserver = new MutationObserver(() => {
      if (assistantIdleTimer) clearTimeout(assistantIdleTimer);
      assistantIdleTimer = setTimeout(() => {
        updateLastTocAssistantPreview();
      }, ASSISTANT_IDLE_MS);
    });

    assistantObserver.observe(target, { childList: true, subtree: true, characterData: true });

    // Try once immediately
    updateLastTocAssistantPreview();
  }

  // =========================
  // Build / Filter
  // =========================
  function rebuild({ force = false } = {}) {
    ensurePanel();
    injectExtraStyles();

    const launcher = ensureLauncher();
    if (!launcher.__draggableBound) {
      launcher.__draggableBound = true;
      makeDraggable(launcher, launcher, {
        onDragEnd: (el) => {
          saveSharedPosFrom(el);
          const panel = document.getElementById(PANEL_ID);
          if (panel) applySharedPosTo(panel);
        },
      });
    }

    // Rebuild only when user count changes (unless forced)
    const userCount = document.querySelectorAll('[data-message-author-role="user"]').length;
    if (!force && userCount === lastBuiltUserCount) return;
    lastBuiltUserCount = userCount;

    const allTurns = getTurns();
    const start = Math.max(0, allTurns.length - MAX_ITEMS);
    const turns = allTurns.slice(start);

    const list = document.querySelector("#cgtoc-list");
    if (!list) return;

    list.textContent = "";
    const frag = document.createDocumentFragment();

    lastRenderedTurnTargetId = null;

    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (!t?.root) continue;

      const globalIndex = start + i;
      const id = assignStableId(t, globalIndex);
      const userDisp = getUserDisplay(t.user);

      let assistantSummary = "";
      if (SHOW_ASSISTANT_PREVIEW) {
        assistantSummary = getAssistantSummary(t.assistant);
      }

      const item = document.createElement("div");
      item.className = "cgtoc-item";
      item.dataset.target = id;
      item.dataset.search = (SHOW_ASSISTANT_PREVIEW
        ? `${userDisp.title} ${assistantSummary}`
        : `${userDisp.title}`
      ).toLowerCase();

      const titleRow = document.createElement("div");
      titleRow.textContent = `${globalIndex + 1}. ${userDisp.title}`;
      item.appendChild(titleRow);

      if (userDisp.thumbs && userDisp.thumbs.length) {
        const thumbsWrap = document.createElement("div");
        thumbsWrap.className = "cgtoc-thumbs";
        for (const src of userDisp.thumbs) {
          const im = document.createElement("img");
          im.className = "cgtoc-thumb";
          im.src = src;
          thumbsWrap.appendChild(im);
        }
        item.appendChild(thumbsWrap);
      }

      if (SHOW_ASSISTANT_PREVIEW) {
        const meta = document.createElement("div");
        meta.className = "cgtoc-meta";
        meta.textContent = assistantSummary;
        item.appendChild(meta);
      }

      item.addEventListener("click", () => {
        const el = document.getElementById(id) || document.querySelector(`[${DATA_ID}="${id}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      frag.appendChild(item);

      // track last rendered item id
      lastRenderedTurnTargetId = id;
    }

    list.appendChild(frag);

    const search = document.querySelector("#cgtoc-search");
    if (search?.value) filterList(search.value);

    // Watch assistant streaming for the last turn and update only the last TOC item
    observeLastAssistantDuringStreaming(turns, start);
  }

  function filterList(keyword) {
    const k = (keyword || "").trim().toLowerCase();
    const items = Array.from(document.querySelectorAll(".cgtoc-item"));
    for (const it of items) {
      const hay = it.dataset.search || it.textContent.toLowerCase();
      it.style.display = !k || hay.includes(k) ? "block" : "none";
    }
  }

  // =========================
  // Observer (rebuild when userCount changes)
  // =========================
  function startObserver() {
    let scheduled = false;
    let lastObservedUserCount = 0;

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;

      const run = () => {
        scheduled = false;
        const userCount = document.querySelectorAll('[data-message-author-role="user"]').length;
        if (userCount !== lastObservedUserCount) {
          lastObservedUserCount = userCount;
          rebuild();
        }
      };

      if ("requestIdleCallback" in window) {
        requestIdleCallback(run, { timeout: 1200 });
      } else {
        setTimeout(run, 600);
      }
    };

    const root = document.querySelector("main") || document.body;

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (
            n.matches?.('[data-testid="conversation-turn"], [data-message-author-role="user"]') ||
            n.querySelector?.('[data-testid="conversation-turn"], [data-message-author-role="user"]')
          ) {
            schedule();
            return;
          }
        }
      }
    });

    obs.observe(root, { childList: true, subtree: true });

    // initial
    schedule();

    // keep inside viewport after resize
    window.addEventListener("resize", () => {
      const s = loadState();
      if (typeof s.posLeft === "number" && typeof s.posTop === "number") {
        const panel = document.getElementById(PANEL_ID);
        const launcher = document.getElementById(LAUNCHER_ID);
        if (panel) applySharedPosTo(panel);
        if (launcher) applySharedPosTo(launcher);
      }
    });
  }

  // =========================
  // Init
  // =========================
  injectExtraStyles();
  ensureLauncher();
  ensurePanel();
  startObserver();
})();
