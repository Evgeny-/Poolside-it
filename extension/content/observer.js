(function installBrowserAgentObserver() {
  const OBSERVE_MESSAGE = "browserAgent.content.observePage";
  const PREVIEW_ACTION_MESSAGE = "browserAgent.content.previewAction";
  const CLEAR_ACTION_PREVIEW_MESSAGE = "browserAgent.content.clearActionPreview";
  const EXECUTE_ACTION_MESSAGE = "browserAgent.content.executeAction";
  const PAGE_OBSERVER_PORT = "browserAgent.pageObserver";
  const MAX_VISIBLE_TEXT_SNIPPETS = 1000;
  const MAX_ACTIONABLE_ELEMENTS = 150;
  const MAX_EMBEDDED_FRAMES = 50;
  const MAX_SEMANTIC_HINTS = 10;
  const MAX_IDENTIFIER_HINTS = 6;
  const MAX_DOM_SCAN_ELEMENTS = 4000;
  const MAX_TEXT_NODES_SCANNED = 6000;
  const MIN_ACTIONABLE_AREA = 48;
  const MIN_ACTIONABLE_SIDE = 4;
  const PREVIEW_ROOT_ID = "__browserAgentActionPreview";
  const PREVIEW_STYLE_ID = "__browserAgentActionPreviewStyle";
  const PREVIEW_DEFAULT_DELAY_MS = 650;
  const GENERIC_IDENTIFIER_VALUES = new Set([
    "button",
    "icon",
    "item",
    "link",
    "root",
    "container",
    "wrapper",
    "content"
  ]);
  const CONTROL_KEYWORD_LABELS = new Map([
    ["search", "search control"],
    ["find", "search control"],
    ["query", "search control"],
    ["lookup", "search control"],
    ["\u043f\u043e\u0438\u0441\u043a", "search control"],
    ["\u0438\u0441\u043a\u0430\u0442\u044c", "search control"],
    ["menu", "menu control"],
    ["nav", "menu control"],
    ["hamburger", "menu control"],
    ["close", "close control"],
    ["play", "play control"]
  ]);

  if (!globalThis.chrome?.runtime?.onMessage) {
    return;
  }

  if (window.__browserAgentObserverInstalled) {
    return;
  }
  window.__browserAgentObserverInstalled = true;
  window.__browserAgentElementMap = new Map();
  connectObserverPort();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isKnownContentMessage(message?.type)) {
      return false;
    }
    if (message.targetUrl && message.targetUrl !== window.location.href) {
      return false;
    }

    handleContentMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({
        ok: false,
        error: {
          name: error.name || "Error",
          message: error.message || String(error),
          stack: error.stack || ""
        }
      }));
    return true;
  });

  function connectObserverPort() {
    let port = null;

    function connect() {
      try {
        port = chrome.runtime.connect({ name: PAGE_OBSERVER_PORT });
        port.onMessage.addListener((message) => {
          if (!isKnownContentMessage(message?.type)) {
            return;
          }
          handleContentMessage(message)
            .then((response) => {
              port.postMessage({
                requestId: message.requestId,
                ...response
              });
            })
            .catch((error) => {
              port.postMessage({
                requestId: message.requestId,
                ok: false,
                error: {
                  name: error.name || "Error",
                  message: error.message || String(error),
                  stack: error.stack || ""
                }
              });
            });
        });
        port.onDisconnect.addListener(() => {
          port = null;
          window.setTimeout(connect, 500);
        });
      } catch (error) {
        window.setTimeout(connect, 1000);
      }
    }

    connect();
  }

  function isKnownContentMessage(type) {
    return [
      OBSERVE_MESSAGE,
      PREVIEW_ACTION_MESSAGE,
      CLEAR_ACTION_PREVIEW_MESSAGE,
      EXECUTE_ACTION_MESSAGE
    ].includes(type);
  }

  async function handleContentMessage(message) {
    if (message.targetUrl && message.targetUrl !== window.location.href) {
      return {
        ok: false,
        error: {
          name: "TargetMismatchError",
          message: "Observer is connected to a different page.",
          stack: ""
        }
      };
    }

    try {
      if (message.type === OBSERVE_MESSAGE) {
        return {
          ok: true,
          snapshot: createPageSnapshot()
        };
      }

      if (message.type === PREVIEW_ACTION_MESSAGE) {
        return {
          ok: true,
          result: await previewAction(message.action || {}, message.options || {})
        };
      }

      if (message.type === CLEAR_ACTION_PREVIEW_MESSAGE) {
        return {
          ok: true,
          result: clearActionPreview()
        };
      }

      if (message.type === EXECUTE_ACTION_MESSAGE) {
        return {
          ok: true,
          result: executeAction(message.action || {})
        };
      }

      return {
        ok: false,
        error: {
          name: "UnsupportedMessageError",
          message: `Unsupported content message: ${message.type}`,
          stack: ""
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: error.name || "Error",
          message: error.message || String(error),
          stack: error.stack || ""
        }
      };
    }
  }

  function executeAction(action) {
    const tool = action.tool;
    if (tool === "click_element") {
      return clickElement(action.elementId);
    }
    if (tool === "fill_element") {
      return fillElement(action.elementId, action.text || "");
    }
    if (tool === "clear_element") {
      return fillElement(action.elementId, "");
    }
    if (tool === "select_option") {
      return selectOption(action.elementId, action.value || action.text || "");
    }
    if (tool === "submit_form") {
      return submitForm(action.elementId);
    }
    if (tool === "press_key") {
      return pressKey(action.key || "", action.elementId || null);
    }
    if (tool === "scroll") {
      return scrollPage(action.direction || "down", action.amount || 600);
    }
    throw new Error(`Unsupported executable tool: ${tool}`);
  }

  async function previewAction(action, options = {}) {
    const element = getPreviewElement(action);
    if (!element) {
      return {
        status: "skipped",
        tool: action.tool || "",
        reason: "Action has no element target for visual preview.",
        url: window.location.href
      };
    }

    const delayMs = clampNumber(options.delayMs, 0, 2000, PREVIEW_DEFAULT_DELAY_MS);
    const behavior = options.smoothScroll === false ? "auto" : "smooth";
    element.scrollIntoView({ block: "center", inline: "center", behavior });
    showActionPreview(element, action);

    if (delayMs > 0) {
      await sleep(delayMs);
      positionActionPreview(element);
    }

    return {
      status: "ok",
      tool: action.tool || "",
      elementId: action.elementId || null,
      bbox: getRoundedRect(element),
      url: window.location.href
    };
  }

  function getPreviewElement(action) {
    if (!["click_element", "fill_element", "clear_element", "select_option", "submit_form"].includes(action.tool)) {
      return null;
    }
    return getMappedElement(action.elementId);
  }

  function showActionPreview(element, action) {
    const state = ensureActionPreview();
    state.target = element;
    state.action = action;
    state.root.hidden = false;
    state.root.dataset.tool = action.tool || "";
    state.root.setAttribute("aria-hidden", "true");
    positionActionPreview(element);
    installPreviewPositionListeners(state);
  }

  function ensureActionPreview() {
    if (window.__browserAgentActionPreview?.root?.isConnected) {
      return window.__browserAgentActionPreview;
    }

    const style = document.createElement("style");
    style.id = PREVIEW_STYLE_ID;
    style.textContent = `
      #${PREVIEW_ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }
      #${PREVIEW_ROOT_ID} .browser-agent-preview-highlight {
        position: fixed;
        border: 2px solid #2f80ed;
        border-radius: 8px;
        background: rgba(47, 128, 237, 0.12);
        box-shadow: 0 0 0 4px rgba(47, 128, 237, 0.16);
        transition:
          left 180ms ease,
          top 180ms ease,
          width 180ms ease,
          height 180ms ease,
          opacity 120ms ease;
      }
      #${PREVIEW_ROOT_ID} .browser-agent-preview-cursor {
        position: fixed;
        left: 24px;
        top: 24px;
        width: 28px;
        height: 28px;
        color: #176b5b;
        filter: drop-shadow(0 2px 5px rgba(23, 32, 46, 0.35));
        transform: translate(0, 0);
        transition: left 260ms ease, top 260ms ease;
      }
      #${PREVIEW_ROOT_ID} .browser-agent-preview-cursor svg {
        display: block;
        width: 28px;
        height: 28px;
      }
    `;

    const root = document.createElement("div");
    root.id = PREVIEW_ROOT_ID;
    root.hidden = true;

    const highlight = document.createElement("div");
    highlight.className = "browser-agent-preview-highlight";

    const cursor = document.createElement("div");
    cursor.className = "browser-agent-preview-cursor";
    cursor.innerHTML = [
      '<svg viewBox="0 0 32 32" role="presentation" focusable="false">',
      '<path d="M5 3l20 18-10 2-5 8L5 3z" fill="currentColor" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>',
      "</svg>"
    ].join("");

    root.append(highlight, cursor);
    (document.head || document.documentElement).append(style);
    (document.documentElement || document.body).append(root);

    window.__browserAgentActionPreview = {
      root,
      style,
      highlight,
      cursor,
      target: null,
      action: null,
      rafId: 0,
      listenersInstalled: false
    };
    return window.__browserAgentActionPreview;
  }

  function installPreviewPositionListeners(state) {
    if (state.listenersInstalled) {
      return;
    }
    state.listenersInstalled = true;
    const schedule = () => {
      if (!state.target || state.root.hidden || state.rafId) {
        return;
      }
      state.rafId = window.requestAnimationFrame(() => {
        state.rafId = 0;
        if (state.target && document.contains(state.target)) {
          positionActionPreview(state.target);
        }
      });
    };
    state.schedulePositionUpdate = schedule;
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
  }

  function positionActionPreview(element) {
    const state = ensureActionPreview();
    const rect = element.getBoundingClientRect();
    const paddedRect = {
      left: clampNumber(rect.left - 4, 0, window.innerWidth, 0),
      top: clampNumber(rect.top - 4, 0, window.innerHeight, 0),
      right: clampNumber(rect.right + 4, 0, window.innerWidth, window.innerWidth),
      bottom: clampNumber(rect.bottom + 4, 0, window.innerHeight, window.innerHeight)
    };
    const width = Math.max(8, paddedRect.right - paddedRect.left);
    const height = Math.max(8, paddedRect.bottom - paddedRect.top);
    const point = getElementAimPoint(rect);

    state.highlight.style.left = `${Math.round(paddedRect.left)}px`;
    state.highlight.style.top = `${Math.round(paddedRect.top)}px`;
    state.highlight.style.width = `${Math.round(width)}px`;
    state.highlight.style.height = `${Math.round(height)}px`;
    state.cursor.style.left = `${Math.round(point.x - 5)}px`;
    state.cursor.style.top = `${Math.round(point.y - 3)}px`;
  }

  function getElementAimPoint(rect) {
    const x = clampNumber(rect.left + rect.width / 2, 8, window.innerWidth - 24, window.innerWidth / 2);
    const y = clampNumber(rect.top + rect.height / 2, 8, window.innerHeight - 28, window.innerHeight / 2);
    return { x, y };
  }

  function clearActionPreview() {
    const state = window.__browserAgentActionPreview;
    if (!state?.root) {
      return {
        status: "ok",
        hidden: true,
        url: window.location.href
      };
    }
    state.root.hidden = true;
    state.target = null;
    state.action = null;
    return {
      status: "ok",
      hidden: true,
      url: window.location.href
    };
  }

  function clickElement(elementId) {
    const element = getMappedElement(elementId);
    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus({ preventScroll: true });
    element.click();
    return {
      status: "ok",
      tool: "click_element",
      elementId,
      url: window.location.href
    };
  }

  function fillElement(elementId, text) {
    const element = getMappedElement(elementId);
    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus({ preventScroll: true });

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeValue(element, text);
      dispatchInputEvents(element);
    } else if (element.isContentEditable) {
      element.textContent = text;
      dispatchInputEvents(element);
    } else {
      throw new Error(`Element ${elementId} is not fillable.`);
    }

    return {
      status: "ok",
      tool: text ? "fill_element" : "clear_element",
      elementId,
      valueLength: text.length,
      url: window.location.href
    };
  }

  function selectOption(elementId, value) {
    const element = getMappedElement(elementId);
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`Element ${elementId} is not a select element.`);
    }

    const normalizedValue = normalizeText(value).toLowerCase();
    const matchingOption = Array.from(element.options).find((option) => (
      option.value === value ||
      normalizeText(option.textContent || "").toLowerCase() === normalizedValue
    ));
    if (!matchingOption) {
      throw new Error(`No matching option found for ${value}.`);
    }

    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus({ preventScroll: true });
    element.value = matchingOption.value;
    dispatchInputEvents(element);
    return {
      status: "ok",
      tool: "select_option",
      elementId,
      value: matchingOption.value,
      url: window.location.href
    };
  }

  function submitForm(elementId) {
    const element = getMappedElement(elementId);
    const form = getOwningForm(element);
    if (!form) {
      throw new Error(`Element ${elementId} is not inside a form.`);
    }

    element.scrollIntoView({ block: "center", inline: "center" });
    if (typeof element.focus === "function") {
      element.focus({ preventScroll: true });
    }

    const submission = submitFormForElement(element, form);
    return {
      status: "ok",
      tool: "submit_form",
      elementId,
      ...submission,
      url: window.location.href
    };
  }

  function pressKey(key, elementId = null) {
    if (!key) {
      throw new Error("Key is required.");
    }

    const target = elementId ? getMappedElement(elementId) : (document.activeElement || document.body);
    if (elementId) {
      target.scrollIntoView({ block: "center", inline: "center" });
      if (typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
    }

    const keydown = dispatchKeyboardEvent(target, "keydown", key);
    const keypress = !keydown.defaultPrevented && shouldDispatchKeypress(key)
      ? dispatchKeyboardEvent(target, "keypress", key)
      : null;
    let defaultAction = null;
    if (key === "Enter" && !keydown.defaultPrevented && !keypress?.defaultPrevented) {
      defaultAction = applyEnterDefaultAction(target);
    }
    dispatchKeyboardEvent(target, "keyup", key);
    return {
      status: "ok",
      tool: "press_key",
      elementId,
      key,
      defaultAction,
      url: window.location.href
    };
  }

  function dispatchKeyboardEvent(target, type, key) {
    const event = new KeyboardEvent(type, {
      key,
      code: keyToCode(key),
      bubbles: true,
      cancelable: true
    });
    target.dispatchEvent(event);
    return event;
  }

  function keyToCode(key) {
    const codes = {
      Enter: "Enter",
      Tab: "Tab",
      Escape: "Escape",
      ArrowDown: "ArrowDown",
      ArrowUp: "ArrowUp",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      Backspace: "Backspace"
    };
    return codes[key] || key;
  }

  function shouldDispatchKeypress(key) {
    return key === "Enter" || key.length === 1;
  }

  function applyEnterDefaultAction(target) {
    if (target instanceof HTMLTextAreaElement) {
      return {
        status: "skipped",
        reason: "Enter inserts text in textareas."
      };
    }

    if (target instanceof HTMLInputElement) {
      const inputType = (target.type || "text").toLowerCase();
      if (isTextEntryInputType(inputType) && target.form) {
        return submitFormForElement(target, target.form);
      }
      if (isSubmitButtonLike(target)) {
        target.click();
        return {
          status: "clicked",
          target: describeSubmitter(target)
        };
      }
    }

    if (target instanceof HTMLButtonElement && isSubmitButtonLike(target)) {
      target.click();
      return {
        status: "clicked",
        target: describeSubmitter(target)
      };
    }

    if (target instanceof HTMLAnchorElement && target.href) {
      target.click();
      return {
        status: "clicked",
        target: "link"
      };
    }

    if (target.getAttribute?.("role") === "button" || target.getAttribute?.("role") === "link") {
      target.click();
      return {
        status: "clicked",
        target: target.getAttribute("role")
      };
    }

    return {
      status: "skipped",
      reason: "No built-in Enter action is known for the focused element."
    };
  }

  function submitFormForElement(element, form = getOwningForm(element)) {
    if (!form) {
      throw new Error("No form was found for submission.");
    }

    const submitter = findFormSubmitter(form, element);
    let submissionMode = "";
    const requestSubmit = HTMLFormElement.prototype.requestSubmit;
    const nativeSubmit = HTMLFormElement.prototype.submit;

    if (typeof requestSubmit === "function") {
      try {
        if (submitter) {
          requestSubmit.call(form, submitter);
        } else {
          requestSubmit.call(form);
        }
        submissionMode = "requestSubmit";
      } catch (error) {
        if (!submitter) {
          throw error;
        }
        submitter.click();
        submissionMode = "click_submitter";
      }
    } else if (submitter) {
      submitter.click();
      submissionMode = "click_submitter";
    } else if (typeof nativeSubmit === "function") {
      nativeSubmit.call(form);
      submissionMode = "native_submit";
    } else {
      throw new Error("This form cannot be submitted by the page executor.");
    }

    return {
      status: "submitted",
      mode: submissionMode,
      formMethod: getFormMethod(form),
      formAction: getFormAction(form),
      formIntent: inferFormIntent(form),
      submitter: submitter ? describeSubmitter(submitter) : ""
    };
  }

  function getOwningForm(element) {
    if (element instanceof HTMLFormElement) {
      return element;
    }
    if ("form" in element && element.form instanceof HTMLFormElement) {
      return element.form;
    }
    return element.closest?.("form") || null;
  }

  function findFormSubmitter(form, preferredElement = null) {
    if (preferredElement && isSubmitButtonLike(preferredElement) && getOwningForm(preferredElement) === form) {
      return preferredElement;
    }

    const controls = Array.from(form.elements || []);
    return controls.find((control) => isSubmitButtonLike(control) && isEnabled(control)) || null;
  }

  function isSubmitButtonLike(element) {
    if (element instanceof HTMLButtonElement) {
      const type = (element.getAttribute("type") || "submit").toLowerCase();
      return !["button", "reset"].includes(type);
    }
    if (element instanceof HTMLInputElement) {
      return ["submit", "image"].includes((element.type || "").toLowerCase());
    }
    return false;
  }

  function isTextEntryInputType(type) {
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit"
    ].includes(type);
  }

  function getFormMethod(form) {
    return (form.getAttribute("method") || form.method || "get").toLowerCase();
  }

  function getFormAction(form) {
    return form.action || window.location.href;
  }

  function describeSubmitter(submitter) {
    return normalizeText([
      submitter.getAttribute("aria-label"),
      submitter.getAttribute("title"),
      submitter.getAttribute("alt"),
      submitter instanceof HTMLInputElement ? submitter.value : "",
      submitter.innerText || submitter.textContent || "",
      submitter.getAttribute("name"),
      submitter.getAttribute("id")
    ].filter(Boolean).join(" ")) || submitter.tagName.toLowerCase();
  }

  function inferFormIntent(form) {
    const text = [
      form.getAttribute("id"),
      form.getAttribute("name"),
      form.getAttribute("class"),
      form.getAttribute("action"),
      ...Array.from(form.elements || []).slice(0, 12).flatMap((control) => [
        control.getAttribute?.("id"),
        control.getAttribute?.("name"),
        control.getAttribute?.("class"),
        control.getAttribute?.("title"),
        control.getAttribute?.("alt"),
        control.getAttribute?.("placeholder"),
        control instanceof HTMLInputElement ? control.value : "",
        control.innerText || control.textContent || ""
      ])
    ].join(" ");

    const tokens = tokenizeIdentifier(text);
    if (tokens.some((token) => ["search", "find", "query", "lookup", "\u043f\u043e\u0438\u0441\u043a", "\u0438\u0441\u043a\u0430\u0442\u044c"].includes(token))) {
      return "search";
    }
    if (tokens.some((token) => ["login", "signin", "auth", "\u0432\u0445\u043e\u0434"].includes(token))) {
      return "auth";
    }
    if (tokens.some((token) => ["comment", "reply", "send", "post", "submit", "\u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c"].includes(token))) {
      return "submit";
    }
    return "";
  }

  function scrollPage(direction, amount) {
    const distance = Number(amount) || 600;
    const deltas = {
      up: [0, -distance],
      down: [0, distance],
      left: [-distance, 0],
      right: [distance, 0]
    };
    const [left, top] = deltas[direction] || deltas.down;
    window.scrollBy({
      left,
      top,
      behavior: "smooth"
    });
    return {
      status: "ok",
      tool: "scroll",
      direction,
      amount: distance,
      url: window.location.href
    };
  }

  function getMappedElement(elementId) {
    const element = window.__browserAgentElementMap.get(elementId);
    if (!element) {
      throw new Error(`Unknown element id: ${elementId}. Observe the page again.`);
    }
    if (!document.contains(element)) {
      throw new Error(`Element id ${elementId} is stale. Observe the page again.`);
    }
    if (!isElementVisible(element)) {
      throw new Error(`Element id ${elementId} is no longer visible.`);
    }
    if (!isEnabled(element)) {
      throw new Error(`Element id ${elementId} is disabled.`);
    }
    return element;
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText"
    }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function createPageSnapshot() {
    const elements = collectActionableElements();
    const visibleText = collectVisibleText();
    window.__browserAgentElementMap = new Map(
      elements.map((elementSnapshot) => [elementSnapshot.id, elementSnapshot.__element])
    );

    return {
      url: window.location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        scrollWidth: Math.round(document.documentElement?.scrollWidth || document.body?.scrollWidth || 0),
        scrollHeight: Math.round(document.documentElement?.scrollHeight || document.body?.scrollHeight || 0),
        devicePixelRatio: window.devicePixelRatio || 1
      },
      pageText: visibleText.items,
      pageTextMeta: visibleText.meta,
      frame: {
        isTopFrame: window.top === window,
        url: window.location.href,
        title: document.title
      },
      embeddedFrames: collectEmbeddedFrames(),
      elements: elements.map(({ __element, ...snapshot }) => snapshot)
    };
  }

  function collectVisibleText() {
    const snippets = [];
    const seen = new Set();
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let truncated = false;
    let scannedNodes = 0;
    while (walker.nextNode()) {
      scannedNodes += 1;
      if (scannedNodes > MAX_TEXT_NODES_SCANNED) {
        truncated = true;
        break;
      }

      const node = walker.currentNode;
      const text = normalizeText(node.nodeValue || "");
      if (text.length < 2) {
        continue;
      }

      const parent = node.parentElement;
      if (!parent || shouldSkipTextParent(parent) || !isElementVisible(parent)) {
        continue;
      }
      if (!isTextNodeInViewport(node)) {
        continue;
      }

      if (!seen.has(text)) {
        seen.add(text);
        if (snippets.length >= MAX_VISIBLE_TEXT_SNIPPETS) {
          truncated = true;
          break;
        }
        snippets.push(truncate(text, 180));
      }
    }

    return {
      items: snippets,
      meta: {
        scope: "visible_viewport",
        includedSnippets: snippets.length,
        maxSnippets: MAX_VISIBLE_TEXT_SNIPPETS,
        scannedNodes,
        scanLimit: MAX_TEXT_NODES_SCANNED,
        truncated
      }
    };
  }

  function collectActionableElements() {
    const selector = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[contenteditable]:not([contenteditable='false'])",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='menuitem']",
      "[onclick]",
      "[tabindex]"
    ].join(",");

    const unique = collectPotentialActionableElements(selector);

    return unique
      .filter((element) => isElementVisible(element))
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect()
      }))
      .filter(({ rect }) => intersectsViewport(rect) && isUsefulActionableRect(rect))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
      .slice(0, MAX_ACTIONABLE_ELEMENTS)
      .map(({ element, rect }, index) => describeElement(element, rect, `el_${index + 1}`));
  }

  function collectPotentialActionableElements(selector) {
    const root = document.body || document.documentElement;
    const candidates = [];
    const seen = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let scannedElements = 0;

    while (walker.nextNode()) {
      scannedElements += 1;
      if (scannedElements > MAX_DOM_SCAN_ELEMENTS) {
        break;
      }

      const element = walker.currentNode;
      if (!(element instanceof Element)) {
        continue;
      }
      if (
        element.matches(selector) ||
        typeof element.onclick === "function" ||
        isPointerCursorAffordance(element, selector)
      ) {
        addUniqueCandidate(candidates, seen, element);
      }
    }

    return candidates;
  }

  function addUniqueCandidate(candidates, seen, element) {
    if (seen.has(element)) {
      return;
    }
    seen.add(element);
    candidates.push(element);
  }

  function collectEmbeddedFrames() {
    return Array.from(document.querySelectorAll("iframe, frame"))
      .filter((frameElement) => isElementVisible(frameElement))
      .map((frameElement) => ({
        element: frameElement,
        rect: frameElement.getBoundingClientRect()
      }))
      .filter(({ rect }) => intersectsViewport(rect))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
      .slice(0, MAX_EMBEDDED_FRAMES)
      .map(({ element, rect }, index) => describeEmbeddedFrame(element, rect, index + 1));
  }

  function describeEmbeddedFrame(element, rect, index) {
    const isFrameLike = element instanceof HTMLIFrameElement ||
      (typeof HTMLFrameElement !== "undefined" && element instanceof HTMLFrameElement);
    return {
      id: `iframe_${index}`,
      tagName: element.tagName.toLowerCase(),
      title: normalizeText(element.getAttribute("title") || element.title || ""),
      name: element.getAttribute("name") || "",
      src: isFrameLike ? element.src : "",
      dataSrc: element.getAttribute("data-src") || "",
      sandbox: element.getAttribute("sandbox") || "",
      allow: element.getAttribute("allow") || "",
      visible: true,
      bbox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      access: getEmbeddedFrameAccess(element)
    };
  }

  function getEmbeddedFrameAccess(element) {
    try {
      const childDocument = element.contentDocument;
      if (childDocument) {
        return "same_origin";
      }
    } catch (error) {
      return "cross_origin";
    }
    return "unknown";
  }

  function describeElement(element, rect, id) {
    const role = inferRole(element);
    const text = getElementText(element);
    const semanticHints = buildSemanticHints(element);
    const name = getAccessibleName(element, text) || inferNameFromSemanticHints(element, semanticHints);
    const value = getElementValue(element);
    const style = window.getComputedStyle(element);
    const form = getElementFormMetadata(element);

    return {
      __element: element,
      id,
      role,
      tagName: element.tagName.toLowerCase(),
      type: element.getAttribute("type") || "",
      name,
      label: name,
      text,
      placeholder: element.getAttribute("placeholder") || "",
      value,
      checked: getCheckedState(element),
      selected: getSelectedState(element),
      enabled: isEnabled(element),
      visible: true,
      bbox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      form,
      state: getElementState(element),
      input: getElementInputMetadata(element),
      options: getElementOptions(element),
      description: getElementDescription(element),
      domPath: getDomPath(element),
      semanticHints,
      attributes: {
        href: element instanceof HTMLAnchorElement ? element.href : "",
        id: isUsefulIdentifier(element.getAttribute("id") || "") ? element.getAttribute("id") || "" : "",
        className: getUsefulClassName(element),
        name: isUsefulIdentifier(element.getAttribute("name") || "") ? element.getAttribute("name") || "" : "",
        testId: getTestIdentifier(element),
        title: element.getAttribute("title") || "",
        alt: element.getAttribute("alt") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        ariaDescribedBy: element.getAttribute("aria-describedby") || "",
        tabIndex: element.getAttribute("tabindex") || "",
        contentEditable: element.getAttribute("contenteditable") || "",
        cursor: style.cursor === "pointer" ? "pointer" : ""
      }
    };
  }

  function getElementFormMetadata(element) {
    const form = getOwningForm(element);
    if (!form) {
      return null;
    }

    const submitter = findFormSubmitter(form, element);
    return {
      id: form.getAttribute("id") || "",
      name: form.getAttribute("name") || "",
      method: getFormMethod(form),
      action: getFormAction(form),
      target: form.getAttribute("target") || "",
      intent: inferFormIntent(form),
      submitter: submitter ? describeSubmitter(submitter) : "",
      canSubmit: true
    };
  }

  function isPointerCursorAffordance(element, selector) {
    if (!(element instanceof Element) || element.closest("svg")) {
      return false;
    }
    if (["BODY", "HTML", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName)) {
      return false;
    }
    if (element.matches(selector) || element.closest(selector)) {
      return false;
    }
    return window.getComputedStyle(element).cursor === "pointer" && hasActionableIdentity(element);
  }

  function getAccessibleName(element, fallbackText) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return normalizeText(ariaLabel);
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelText = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .join(" ");
      if (normalizeText(labelText)) {
        return normalizeText(labelText);
      }
    }

    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label?.innerText) {
        return normalizeText(label.innerText);
      }
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel?.innerText) {
      return normalizeText(wrappingLabel.innerText);
    }

    const title = element.getAttribute("title");
    if (title) {
      return normalizeText(title);
    }

    const alt = element.getAttribute("alt");
    if (alt) {
      return normalizeText(alt);
    }

    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      return normalizeText(placeholder);
    }

    const value = getElementValue(element);
    if (isButtonLike(element) && value) {
      return value;
    }

    return fallbackText;
  }

  function inferRole(element) {
    const explicitRole = element.getAttribute("role");
    if (explicitRole) {
      return explicitRole;
    }

    const tag = element.tagName.toLowerCase();
    if (tag === "a") {
      return "link";
    }
    if (tag === "button") {
      return "button";
    }
    if (tag === "textarea") {
      return "textbox";
    }
    if (tag === "select") {
      return "combobox";
    }
    if (element.isContentEditable) {
      return "textbox";
    }
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      if (["button", "submit", "reset", "image"].includes(type)) {
        return "button";
      }
      return "textbox";
    }
    if (typeof element.onclick === "function") {
      return "button";
    }
    if (window.getComputedStyle(element).cursor === "pointer") {
      return "button";
    }
    return "generic";
  }

  function buildSemanticHints(element) {
    const hints = [];
    const contextRoot = getSemanticContextRoot(element);
    addIdentifierHints(hints, element, "");

    if (contextRoot && contextRoot !== element) {
      addIdentifierHints(hints, contextRoot, "context ");
    }

    const form = getElementFormMetadata(element);
    if (form) {
      addHint(hints, `form method=${form.method}`);
      if (form.intent) {
        addHint(hints, `form intent: ${form.intent}`);
      }
      if (form.submitter) {
        addHint(hints, `form submitter: ${form.submitter}`);
      }
    }

    const style = window.getComputedStyle(element);
    if (style.cursor === "pointer") {
      addHint(hints, "cursor: pointer");
    }
    if (!normalizeText(element.innerText || element.textContent || "") && element.querySelector("svg")) {
      addHint(hints, "icon-only control");
    }

    addDescendantControlHints(hints, contextRoot || element, element);
    return hints.slice(0, MAX_SEMANTIC_HINTS);
  }

  function getSemanticContextRoot(element) {
    const candidates = [
      element,
      element.parentElement,
      element.parentElement?.parentElement
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (candidate === document.body || candidate === document.documentElement) {
        continue;
      }
      if (candidate.querySelector?.("form, input, textarea, select")) {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      if (candidate === document.body || candidate === document.documentElement) {
        continue;
      }
      if (collectIdentifierTokens(candidate).some((token) => CONTROL_KEYWORD_LABELS.has(token))) {
        return candidate;
      }
    }
    return element;
  }

  function addIdentifierHints(hints, element, prefix) {
    const id = element.getAttribute("id") || "";
    const title = element.getAttribute("title") || "";
    const alt = element.getAttribute("alt") || "";
    const name = element.getAttribute("name") || "";
    const testId = getTestIdentifier(element);

    if (isUsefulIdentifier(id)) {
      addHint(hints, `${prefix}id: ${id}`);
    }
    if (isUsefulIdentifier(name)) {
      addHint(hints, `${prefix}name: ${name}`);
    }
    if (testId) {
      addHint(hints, `${prefix}test id: ${testId}`);
    }
    if (title) {
      addHint(hints, `${prefix}title: ${normalizeText(title)}`);
    }
    if (alt) {
      addHint(hints, `${prefix}alt: ${normalizeText(alt)}`);
    }

    const keywordLabels = collectIdentifierTokens(element)
      .map((token) => CONTROL_KEYWORD_LABELS.get(token))
      .filter(Boolean);
    for (const label of Array.from(new Set(keywordLabels))) {
      addHint(hints, `${prefix}${label}`);
    }
  }

  function addDescendantControlHints(hints, root, targetElement) {
    if (!root?.querySelectorAll) {
      return;
    }

    const controls = Array.from(root.querySelectorAll("form, input, textarea, select, button"))
      .filter((control) => control === targetElement || isVisibleControlForHint(control))
      .slice(0, 8);
    if (!controls.length) {
      return;
    }

    const hasSearchForm = controls.some((control) => {
      const text = [
        control.getAttribute("name"),
        control.getAttribute("id"),
        control.getAttribute("class"),
        control.getAttribute("title"),
        control.getAttribute("alt"),
        control.getAttribute("aria-label"),
        getTestIdentifier(control),
        control instanceof HTMLInputElement ? control.value : "",
        control instanceof HTMLFormElement ? control.action : ""
      ].join(" ");
      return tokenizeIdentifier(text).some((token) => [
        "search",
        "find",
        "query",
        "lookup",
        "\u043f\u043e\u0438\u0441\u043a",
        "\u0438\u0441\u043a\u0430\u0442\u044c"
      ].includes(token));
    });
    if (hasSearchForm) {
      addHint(hints, "contains search form");
    }

    for (const control of controls) {
      if (control === targetElement) {
        continue;
      }
      if (control instanceof HTMLFormElement) {
        const method = control.getAttribute("method") || "";
        addHint(hints, method ? `contains form method=${method}` : "contains form");
        continue;
      }
      addHint(hints, `contains ${describeControl(control)}`);
    }
  }

  function describeControl(control) {
    const tag = control.tagName.toLowerCase();
    const type = control.getAttribute("type") || tag;
    const name = isUsefulIdentifier(control.getAttribute("name") || "") ? control.getAttribute("name") || "" : "";
    const id = isUsefulIdentifier(control.getAttribute("id") || "") ? control.getAttribute("id") || "" : "";
    const title = normalizeText(control.getAttribute("title") || control.getAttribute("alt") || "");
    const parts = [type === tag ? tag : `${type} ${tag}`];
    if (name) {
      parts.push(`name=${name}`);
    }
    if (id) {
      parts.push(`id=${id}`);
    }
    if (title) {
      parts.push(`title=${title}`);
    }
    return parts.join(" ");
  }

  function inferNameFromSemanticHints(element, hints) {
    const normalizedHints = hints.map((hint) => hint.toLowerCase());
    for (const label of CONTROL_KEYWORD_LABELS.values()) {
      if (normalizedHints.some((hint) => !hint.startsWith("contains ") && hint.includes(label))) {
        return label;
      }
    }
    if (
      isButtonLike(element) &&
      normalizedHints.some((hint) => hint.includes("contains search form"))
    ) {
      return "search control";
    }
    return "";
  }

  function getUsefulClassName(element) {
    return Array.from(element.classList || [])
      .filter((className) => isUsefulClassName(className))
      .slice(0, MAX_IDENTIFIER_HINTS)
      .join(" ");
  }

  function collectIdentifierTokens(element) {
    return [
      element.getAttribute("id"),
      element.getAttribute("class"),
      element.getAttribute("name"),
      element.getAttribute("title"),
      element.getAttribute("alt"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      getTestIdentifier(element)
    ].flatMap(tokenizeIdentifier);
  }

  function tokenizeIdentifier(value) {
    return normalizeText(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([a-zA-Z\u0400-\u04FF])(\d)/g, "$1 $2")
      .split(/[^a-zA-Z0-9\u0400-\u04FF]+/)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 2);
  }

  function isUsefulIdentifier(value) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length > 80) {
      return false;
    }
    const lower = normalized.toLowerCase();
    if (GENERIC_IDENTIFIER_VALUES.has(lower)) {
      return false;
    }
    if (
      /^[a-f0-9]{8,}$/i.test(normalized) ||
      /^\d+$/.test(normalized) ||
      /^_?r_[a-z0-9_]*_?$/i.test(normalized) ||
      /^[a-z]{1,3}\d{1,5}$/i.test(normalized) ||
      /^(?=.*\d)[a-z0-9]{12,}$/i.test(normalized)
    ) {
      return false;
    }
    return tokenizeIdentifier(normalized).length > 0;
  }

  function isUsefulClassName(value) {
    if (!isUsefulIdentifier(value)) {
      return false;
    }
    const tokens = tokenizeIdentifier(value);
    if (!tokens.length) {
      return false;
    }
    if (/[_-]?[a-z0-9]{8,}[_-]?/i.test(value) && !tokens.some((token) => CONTROL_KEYWORD_LABELS.has(token))) {
      return false;
    }
    return tokens.some((token) => CONTROL_KEYWORD_LABELS.has(token) || [
      "submit",
      "login",
      "account",
      "profile",
      "settings",
      "pause",
      "next",
      "previous",
      "close",
      "open"
    ].includes(token));
  }

  function addHint(hints, hint) {
    const normalized = truncate(normalizeText(hint), 120);
    if (normalized && !hints.includes(normalized)) {
      hints.push(normalized);
    }
  }

  function getElementText(element) {
    if (element instanceof HTMLInputElement) {
      const type = (element.type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) {
        return truncate(normalizeText(element.value || element.getAttribute("title") || element.getAttribute("alt") || ""), 180);
      }
      return "";
    }
    return truncate(normalizeText(element.innerText || element.textContent || ""), 220);
  }

  function getElementValue(element) {
    if (element instanceof HTMLInputElement) {
      const type = (element.type || "text").toLowerCase();
      if (["password"].includes(type)) {
        return "";
      }
      return truncate(normalizeText(element.value || ""), 220);
    }
    if (element instanceof HTMLTextAreaElement) {
      return truncate(normalizeText(element.value || ""), 220);
    }
    if (element instanceof HTMLSelectElement) {
      return truncate(normalizeText(element.value || ""), 220);
    }
    if (element.isContentEditable) {
      return truncate(normalizeText(element.innerText || ""), 220);
    }
    return "";
  }

  function getCheckedState(element) {
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      return element.checked;
    }
    const ariaChecked = element.getAttribute("aria-checked");
    if (ariaChecked === "true") {
      return true;
    }
    if (ariaChecked === "false") {
      return false;
    }
    return null;
  }

  function getSelectedState(element) {
    if (element instanceof HTMLOptionElement) {
      return element.selected;
    }
    if (element instanceof HTMLSelectElement) {
      return Array.from(element.selectedOptions).map((option) => option.value);
    }
    return null;
  }

  function getElementState(element) {
    return removeEmptyObject({
      expanded: parseAriaBoolean(element.getAttribute("aria-expanded")),
      pressed: parseAriaBoolean(element.getAttribute("aria-pressed")),
      selected: parseAriaBoolean(element.getAttribute("aria-selected")),
      current: normalizeText(element.getAttribute("aria-current") || ""),
      hasPopup: normalizeText(element.getAttribute("aria-haspopup") || "")
    });
  }

  function getElementInputMetadata(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      return null;
    }
    return removeEmptyObject({
      required: element.required || undefined,
      readOnly: "readOnly" in element && element.readOnly ? true : undefined,
      autocomplete: element.getAttribute("autocomplete") || "",
      inputMode: element.getAttribute("inputmode") || "",
      min: element.getAttribute("min") || "",
      max: element.getAttribute("max") || "",
      maxLength: element.maxLength > 0 ? element.maxLength : undefined
    });
  }

  function getElementOptions(element) {
    if (!(element instanceof HTMLSelectElement)) {
      return [];
    }
    return Array.from(element.options).slice(0, 30).map((option) => removeEmptyObject({
      value: option.value || "",
      label: normalizeText(option.label || option.textContent || ""),
      selected: option.selected || undefined,
      disabled: option.disabled || undefined
    }));
  }

  function getElementDescription(element) {
    const describedBy = element.getAttribute("aria-describedby") || "";
    if (!describedBy) {
      return "";
    }
    return truncate(normalizeText(
      describedBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .join(" ")
    ), 220);
  }

  function isEnabled(element) {
    if ("disabled" in element && element.disabled) {
      return false;
    }
    return element.getAttribute("aria-disabled") !== "true";
  }

  function isButtonLike(element) {
    if (element instanceof HTMLButtonElement) {
      return true;
    }
    if (element instanceof HTMLInputElement) {
      return ["button", "submit", "reset", "image"].includes((element.type || "").toLowerCase());
    }
    return false;
  }

  function parseAriaBoolean(value) {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return undefined;
  }

  function getTestIdentifier(element) {
    return [
      "data-testid",
      "data-test-id",
      "data-test",
      "data-qa",
      "data-cy"
    ].map((attribute) => element.getAttribute(attribute) || "")
      .find((value) => isUsefulIdentifier(value)) || "";
  }

  function hasActionableIdentity(element) {
    if (normalizeText(element.innerText || element.textContent || "")) {
      return true;
    }
    if (
      normalizeText(element.getAttribute("aria-label") || "") ||
      normalizeText(element.getAttribute("title") || "") ||
      normalizeText(element.getAttribute("alt") || "") ||
      normalizeText(element.getAttribute("placeholder") || "") ||
      getTestIdentifier(element)
    ) {
      return true;
    }
    return collectIdentifierTokens(element).some((token) => CONTROL_KEYWORD_LABELS.has(token));
  }

  function isVisibleControlForHint(control) {
    if (control instanceof HTMLInputElement && control.type === "hidden") {
      return false;
    }
    if (control instanceof HTMLFormElement) {
      return isElementVisible(control) || Boolean(control.querySelector("input, textarea, select, button"));
    }
    return isElementVisible(control);
  }

  function shouldSkipTextParent(element) {
    return ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"].includes(element.tagName);
  }

  function isElementVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rects = element.getClientRects();
    if (!rects.length) {
      return false;
    }
    return Array.from(rects).some((rect) => rect.width > 0 && rect.height > 0);
  }

  function isTextNodeInViewport(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    range.detach();
    return intersectsViewport(rect);
  }

  function intersectsViewport(rect) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  }

  function isUsefulActionableRect(rect) {
    return (
      rect.width >= MIN_ACTIONABLE_SIDE &&
      rect.height >= MIN_ACTIONABLE_SIDE &&
      rect.width * rect.height >= MIN_ACTIONABLE_AREA
    );
  }

  function removeEmptyObject(object) {
    const entries = Object.entries(object).filter(([, value]) => (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0)
    ));
    return entries.length ? Object.fromEntries(entries) : null;
  }

  function getDomPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${current.id}`;
        parts.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children)
          .filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(selector);
      current = parent;
    }
    return parts.join(" > ");
  }

  function normalizeText(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function getRoundedRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function truncate(value, maxLength) {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 1)}...`;
  }
})();
