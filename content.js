(() => {
  const PANEL_ID = "cgtoc-panel";
  const LAUNCHER_ID = "cgtoc-launcher";
  const DATA_ID = "data-cgtoc-id";
  const EXTRA_STYLE_ID = "cgtoc-extra-style";
  const STATE_KEY = "cgtoc_state_v2_sharedpos";

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

  // ✅ 共享位置：posLeft/posTop
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
    // fallback
    setTimeout(() => {
      el.removeEventListener("transitionend", onEnd);
      finish();
    }, 220);
  }

  // ✅ 修复版拖拽：纯点击不会被吞
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
      // interactive elements should not start drag
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
      // ✅ 关键：min 前先把 panel 的位置保存成共享位置
      saveSharedPosFrom(panel);
      applySharedPosTo(launcher);

      // 动画：panel fade out，launcher fade in
      showWithAnim(launcher, "flex");
      hideWithAnim(panel);
    } else {
      // ✅ restore 前先把 launcher 的位置保存成共享位置
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

    // apply shared position to both (even if one is hidden)
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
    refreshBtn.addEventListener("click", () => rebuild());

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

    // ✅ 拖拽面板：更新共享位置
    makeDraggable(panel, title, {
      onDragEnd: (el) => {
        saveSharedPosFrom(el);
        // 同步另一端（就算隐藏也保持一致）
        const launcher = document.getElementById(LAUNCHER_ID);
        if (launcher) applySharedPosTo(launcher);
      },
    });

    applySavedUIState();
  }

  function looksLikeFileName(s) {
    if (!s) return false;
    const t = s.trim();
    return /\b[\w][\w\- .]{0,80}\.(pdf|docx?|pptx?|xlsx?|csv|txt|zip|rar|7z|png|jpe?g|gif|webp|mp4|mov|webm)\b/i.test(t);
  }

  function extractFileNames(userNode) {
    if (!userNode) return [];
    const names = [];
    const candidates = Array.from(
      userNode.querySelectorAll(
        [
          "a",
          "button",
          "[download]",
          "[title]",
          "[aria-label]",
          '[data-testid*="file"]',
          '[data-testid*="attachment"]',
          '[data-testid*="uploaded"]',
        ].join(",")
      )
    );

    for (const el of candidates) {
      const download = el.getAttribute?.("download");
      const title = el.getAttribute?.("title");
      const aria = el.getAttribute?.("aria-label");
      const txt = (el.textContent || "").trim();

      [download, title, aria, txt].forEach((v) => {
        if (!v) return;
        const m = v.match(
          /\b[\w][\w\- .]{0,80}\.(pdf|docx?|pptx?|xlsx?|csv|txt|zip|rar|7z|png|jpe?g|gif|webp|mp4|mov|webm)\b/gi
        );
        if (m) names.push(...m);
        else if (looksLikeFileName(v)) names.push(v.trim());
      });
    }

    const rawText = (userNode.innerText || "").replace(/\s+/g, " ").trim();
    const matches = rawText.match(
      /\b[\w][\w\- .]{0,80}\.(pdf|docx?|pptx?|xlsx?|csv|txt|zip|rar|7z|png|jpe?g|gif|webp|mp4|mov|webm)\b/gi
    );
    if (matches) names.push(...matches);

    return uniq(names).map((n) => n.trim());
  }

  function extractImages(userNode) {
    if (!userNode) return [];
    const imgs = Array.from(userNode.querySelectorAll("img"))
      .map((img) => img?.src)
      .filter(Boolean)
      .filter((src) => !src.startsWith("data:image/svg+xml"));
    return uniq(imgs);
  }

  function getUserDisplay(userNode) {
    const text = (userNode?.innerText || "").trim();
    const fileNames = extractFileNames(userNode);
    const imgSrcs = extractImages(userNode);

    const filesCount = fileNames.length;
    const imgsCount = imgSrcs.length;

    if (text) {
      let title = summarize(text);
      if (filesCount) title += `  📎${filesCount}`;
      if (imgsCount) title += `  📷${imgsCount}`;
      return { title, thumbs: imgSrcs.slice(0, 3) };
    }

    if (filesCount) {
      const single = filesCount === 1 ? summarize(fileNames[0], 60) : `${filesCount} files`;
      return { title: `📎 ${single}`, thumbs: [] };
    }

    if (imgsCount) {
      return { title: `📷 ${imgsCount} image${imgsCount > 1 ? "s" : ""}`, thumbs: imgSrcs.slice(0, 3) };
    }

    return { title: "(non-text message)", thumbs: [] };
  }

  function getTurns() {
    const turnNodes = Array.from(document.querySelectorAll('[data-testid="conversation-turn"]'));
    if (turnNodes.length) {
      return turnNodes.map((root) => {
        const user = root.querySelector('[data-message-author-role="user"]');
        const assistant = root.querySelector('[data-message-author-role="assistant"]');
        return { root, user, assistant };
      });
    }

    const roleNodes = Array.from(
      document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')
    );

    const turns = [];
    for (let i = 0; i < roleNodes.length; i++) {
      const n = roleNodes[i];
      const role = n.getAttribute("data-message-author-role");
      if (role !== "user") continue;

      const next = roleNodes[i + 1];
      const assistant = next && next.getAttribute("data-message-author-role") === "assistant" ? next : null;

      const root = n.closest("article") || n.parentElement || n;
      turns.push({ root, user: n, assistant });
      if (assistant) i++;
    }
    return turns;
  }

  function assignStableId(turn, index) {
    const userDisp = getUserDisplay(turn.user);
    const base = `${index}:${userDisp.title}`;
    const id = `cgtoc-${djb2Hash(base)}`;

    const existing = turn.root.getAttribute?.(DATA_ID);
    if (existing) return existing;

    turn.root.setAttribute(DATA_ID, id);
    if (!turn.root.id) turn.root.id = id;
    return id;
  }

  function rebuild() {
    ensurePanel();
    injectExtraStyles();

    const launcher = ensureLauncher();
    if (!launcher.__draggableBound) {
      launcher.__draggableBound = true;

      // ✅ 拖拽圆点：更新共享位置，并同步面板
      makeDraggable(launcher, launcher, {
        onDragEnd: (el) => {
          saveSharedPosFrom(el);
          const panel = document.getElementById(PANEL_ID);
          if (panel) applySharedPosTo(panel);
        },
      });
    }

    const turns = getTurns();
    const list = document.querySelector("#cgtoc-list");
    if (!list) return;
    list.innerHTML = "";

    turns.forEach((t, idx) => {
      if (!t?.root) return;

      const id = assignStableId(t, idx);
      const userDisp = getUserDisplay(t.user);

      const assistantText = t.assistant ? t.assistant.textContent : "";
      const assistantSummary = summarize(assistantText, 60);

      const item = document.createElement("div");
      item.className = "cgtoc-item";
      item.dataset.target = id;
      item.dataset.search = `${userDisp.title} ${assistantSummary}`.toLowerCase();

      const titleRow = document.createElement("div");
      titleRow.textContent = `${idx + 1}. ${userDisp.title}`;
      item.appendChild(titleRow);

      if (userDisp.thumbs && userDisp.thumbs.length) {
        const thumbsWrap = document.createElement("div");
        thumbsWrap.className = "cgtoc-thumbs";
        userDisp.thumbs.forEach((src) => {
          const im = document.createElement("img");
          im.className = "cgtoc-thumb";
          im.src = src;
          thumbsWrap.appendChild(im);
        });
        item.appendChild(thumbsWrap);
      }

      const meta = document.createElement("div");
      meta.className = "cgtoc-meta";
      meta.textContent = assistantSummary;
      item.appendChild(meta);

      item.addEventListener("click", () => {
        const el = document.getElementById(id) || document.querySelector(`[${DATA_ID}="${id}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      list.appendChild(item);
    });

    const search = document.querySelector("#cgtoc-search");
    if (search?.value) filterList(search.value);
  }

  function filterList(keyword) {
    const k = (keyword || "").trim().toLowerCase();
    const items = Array.from(document.querySelectorAll(".cgtoc-item"));
    for (const it of items) {
      const hay = it.dataset.search || it.textContent.toLowerCase();
      it.style.display = !k || hay.includes(k) ? "block" : "none";
    }
  }

  function startObserver() {
    let timer = null;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 250);
    };

    const obs = new MutationObserver(debounced);
    obs.observe(document.body, { childList: true, subtree: true });

    rebuild();

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

  injectExtraStyles();
  ensureLauncher();
  ensurePanel();
  startObserver();
})();
