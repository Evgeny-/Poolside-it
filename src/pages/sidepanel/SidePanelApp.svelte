<script lang="ts">
  import { ArrowLeft, FileJson2, FlaskConical, MessageSquarePlus, Plug, RefreshCw, Send, Settings, Square } from "@lucide/svelte";
  import { Tabs } from "bits-ui";
  import Button from "$lib/components/ui/Button.svelte";
  import Field from "$lib/components/ui/Field.svelte";
  import InlineSelect from "$lib/components/ui/InlineSelect.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { openExtensionTab, sendRuntimeMessage } from "$lib/chrome/runtime";
  import {
    ACCENT_THEME_OPTIONS,
    loadAccentThemePreference,
    loadThemePreference,
    setAccentThemePreference,
    setThemePreference,
    THEME_OPTIONS,
    type AccentThemePreference,
    type ThemePreference
  } from "$lib/theme";
  import { assistantResponseFromTrace } from "$lib/trace/format";
  import { createTaskId } from "$extension/shared/trace.js";
  import {
    BUILT_IN_MODELS,
    CONFIRMATION_MODE_LABELS,
    CONFIRMATION_MODE_TITLES,
    CONFIRMATION_MODES,
    DEFAULT_SETTINGS,
    MESSAGE_TYPES,
    UI_MESSAGE_TYPES
  } from "$extension/shared/protocol.js";
  import ConfirmationCard from "./ConfirmationCard.svelte";
  import EmptyState from "./EmptyState.svelte";
  import MessageBubble from "./MessageBubble.svelte";
  import SiteAccessCard from "./SiteAccessCard.svelte";

  const OPTIONAL_SITE_ORIGINS = ["http://*/*", "https://*/*"];

  let status = $state("Loading");
  let activeTab = $state("chat");
  let taskInput = $state("");
  let chatLogElement = $state<HTMLElement | null>(null);
  let taskInputElement = $state<HTMLTextAreaElement | null>(null);
  let observing = $state(false);
  let refreshingModels = $state(false);
  let grantingAccess = $state(false);
  let ephemeralMessages = $state<any[]>([]);

  let apiKey = $state("");
  let modelValue = $state(DEFAULT_SETTINGS.model);
  let customModel = $state("");
  let maxSteps = $state(DEFAULT_SETTINGS.maxSteps);
  let showActionPreview = $state(true);
  let confirmationMode = $state(CONFIRMATION_MODES.SMART_CONFIRMATION);
  let themePreference = $state<ThemePreference>(loadThemePreference());
  let accentThemePreference = $state<AccentThemePreference>(loadAccentThemePreference());

  let appState = $state<any>({
    settings: null,
    latestSnapshot: null,
    latestTrace: null,
    history: [],
    conversations: [],
    activeConversation: null,
    availableModels: [...BUILT_IN_MODELS],
    currentTaskId: null,
    mcpBridge: null,
    pendingConfirmation: null,
    pendingSiteAccessRetry: null,
    running: false,
    siteAccessVisible: false
  });

  let conversationMessages = $derived(appState.activeConversation?.messages || []);
  let visibleMessages = $derived(mergeVisibleMessages(conversationMessages, ephemeralMessages));
  let modelOptions = $derived(mergeModels(appState.availableModels, [modelValue]));
  let modelSelectOptions = $derived(modelOptions.map((model) => ({
    value: model,
    label: formatModelLabel(model),
    title: model
  })));
  let confirmationSelectOptions = $derived(Object.entries(CONFIRMATION_MODE_LABELS).map(([value, label]) => ({
    value,
    label,
    title: CONFIRMATION_MODE_TITLES[value] || label
  })));
  let conversationOptions = $derived((appState.conversations || []).map((conversation: any) => ({
    value: conversation.conversationId,
    label: conversation.title || "New chat",
    title: conversation.title || "New chat"
  })));
  let mcpBridgeLabel = $derived(appState.mcpBridge?.connected ? "MCP connected" : "MCP disconnected");

  $effect(() => {
    const listener = (message: any, sender: any, sendResponse: any) => {
      if (message?.type === UI_MESSAGE_TYPES.REQUEST_CONFIRMATION) {
        requestActionConfirmation(message.payload || {})
          .then((approved) => sendResponse({
            ok: true,
            data: { approved }
          }));
        return true;
      }

      if (message?.type === UI_MESSAGE_TYPES.TASK_EVENT) {
        handleTaskEvent(message.payload || {});
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === UI_MESSAGE_TYPES.MCP_BRIDGE_STATUS) {
        appState.mcpBridge = message.payload || null;
        sendResponse({ ok: true });
        return false;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    loadAppState();
    return () => chrome.runtime.onMessage.removeListener(listener);
  });

  $effect(() => {
    visibleMessages.length;
    window.setTimeout(() => {
      if (chatLogElement) {
        chatLogElement.scrollTop = chatLogElement.scrollHeight;
      }
    }, 0);
  });

  function syncSettingsDraft(settings: any) {
    apiKey = settings?.apiKey || "";
    modelValue = settings?.model || DEFAULT_SETTINGS.model;
    customModel = "";
    maxSteps = settings?.maxSteps || DEFAULT_SETTINGS.maxSteps;
    showActionPreview = settings?.showActionPreview !== false;
    confirmationMode = settings?.confirmationMode || CONFIRMATION_MODES.SMART_CONFIRMATION;
  }

  async function loadAppState() {
    setStatus("Loading");
    const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.GET_APP_STATE);
    appState.settings = data.settings;
    appState.latestSnapshot = data.latestSnapshot;
    appState.latestTrace = data.latestTrace;
    appState.history = data.history || [];
    appState.conversations = data.conversations || [];
    appState.activeConversation = data.activeConversation || appState.conversations[0] || null;
    appState.availableModels = mergeModels(data.model?.builtInModels || [], [data.settings?.model]);
    appState.mcpBridge = data.mcpBridge || null;
    syncSettingsDraft(data.settings);
    setStatus("Idle");
  }

  async function newChat() {
    resolvePendingConfirmation(false);
    const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.NEW_CONVERSATION);
    appState.activeConversation = data.conversation;
    appState.conversations = data.conversations || appState.conversations;
    appState.currentTaskId = null;
    ephemeralMessages = [];
    setStatus("New chat");
  }

  async function switchConversation(conversationId: string) {
    resolvePendingConfirmation(false);
    const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.SET_ACTIVE_CONVERSATION, { conversationId });
    appState.activeConversation = data.conversation;
    appState.conversations = data.conversations || appState.conversations;
    ephemeralMessages = [];
    setStatus("Chat loaded");
  }

  async function saveSettings({ quiet = false } = {}) {
    if (!quiet) {
      setStatus("Saving settings");
    }

    try {
      await saveSettingsFromForm();
      if (!quiet) {
        setStatus("Settings saved");
      }
    } catch (error: any) {
      addEphemeralMessage("error", error.message);
      setStatus("Settings failed");
    }
  }

  async function saveSettingsFromForm() {
    if (!Object.values(CONFIRMATION_MODES).includes(confirmationMode)) {
      throw new Error(`Unsupported confirmation mode: ${confirmationMode}`);
    }

    const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.SAVE_SETTINGS, {
      apiKey: apiKey.trim(),
      confirmationMode,
      model: getSelectedModel(),
      maxSteps: Number(maxSteps) || DEFAULT_SETTINGS.maxSteps,
      showActionPreview
    });
    appState.settings = data.settings;
    syncSettingsDraft(data.settings);
    return data.settings;
  }

  async function startTask(instructionOverride = "") {
    const instruction = (instructionOverride || taskInput).trim();
    if (!instruction) {
      return;
    }

    const taskId = createTaskId();
    const conversationId = appState.activeConversation?.conversationId || null;
    taskInput = "";
    resizeComposer();
    setRunning(true, taskId);
    setStatus("Running");

    try {
      await saveSettings({ quiet: true });
      const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.START_TASK, {
        taskId,
        instruction,
        conversationId
      });
      appState.latestSnapshot = data.snapshot;
      appState.latestTrace = data.trace;
      appState.history = data.history || appState.history;
      appState.activeConversation = data.conversation || appState.activeConversation;
      appState.conversations = data.conversations || appState.conversations;
      const siteAccessError = getSiteAccessErrorMessage(data.trace);
      if (siteAccessError) {
        showSiteAccessRetry({ type: "task", instruction });
        setStatus("Website access needed");
      } else {
        appState.pendingSiteAccessRetry = null;
        appState.siteAccessVisible = false;
        setStatus(`Task ${data.trace.status || "finished"}`);
      }
    } catch (error: any) {
      const handledSiteAccess = handlePossibleSiteAccessError(error, {
        type: "task",
        instruction
      });
      if (!handledSiteAccess) {
        addEphemeralMessage("error", error.message || "Task failed.");
      }
      setStatus("Task failed");
    } finally {
      setRunning(false, null);
    }
  }

  async function stopTask() {
    if (!appState.currentTaskId) {
      return;
    }

    resolvePendingConfirmation(false);
    const taskId = appState.currentTaskId;
    setStatus("Stopping");
    try {
      const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.STOP_TASK, { taskId });
      appState.latestTrace = data.trace || appState.latestTrace;
      appState.history = data.history || appState.history;
      addEphemeralMessage("tool", "Stop requested.");
    } catch (error: any) {
      addEphemeralMessage("error", error.message);
    } finally {
      setRunning(false, null);
    }
  }

  async function observePage() {
    setStatus("Observing page");
    observing = true;
    try {
      const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.OBSERVE_PAGE, {
        persist: true,
        instruction: "Manual observe_page"
      });
      appState.latestSnapshot = data.snapshot;
      appState.latestTrace = data.trace;
      appState.history = data.history || appState.history;
      appState.pendingSiteAccessRetry = null;
      appState.siteAccessVisible = false;
      setStatus("Observed page");
      if (data.trace?.taskId) {
        openTraceDetails(data.trace.taskId);
      }
    } catch (error: any) {
      handlePossibleSiteAccessError(error, { type: "observe" });
      addEphemeralMessage("error", error.message);
      setStatus("Observe failed");
    } finally {
      observing = false;
    }
  }

  async function openPlayground() {
    setStatus("Opening playground");
    try {
      await sendRuntimeMessage(MESSAGE_TYPES.OPEN_PLAYGROUND);
      setStatus("Playground opened");
    } catch (error: any) {
      addEphemeralMessage("error", error.message);
      setStatus("Open failed");
    }
  }

  async function grantSiteAccess() {
    grantingAccess = true;
    setStatus("Requesting access");
    try {
      const granted = await chrome.permissions.request({
        origins: OPTIONAL_SITE_ORIGINS
      });
      if (!granted) {
        throw new Error("Website access was not granted.");
      }
      appState.siteAccessVisible = false;
      const retry = appState.pendingSiteAccessRetry;
      appState.pendingSiteAccessRetry = null;
      if (retry?.type === "task" && retry.instruction) {
        addEphemeralMessage("tool", "Website access granted. Retrying the request.");
        await startTask(retry.instruction);
        return;
      }
      if (retry?.type === "observe") {
        addEphemeralMessage("tool", "Website access granted. Observing the page again.");
        await observePage();
        return;
      }
      addEphemeralMessage("tool", "Website access granted.");
      setStatus("Access granted");
    } catch (error: any) {
      addEphemeralMessage("error", error.message);
      setStatus("Access denied");
    } finally {
      grantingAccess = false;
    }
  }

  async function refreshModels() {
    setStatus("Refreshing models");
    refreshingModels = true;
    try {
      await saveSettingsFromForm();
      const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.LIST_MODELS);
      appState.availableModels = mergeModels(data.models || [], [getSelectedModel()]);
      setStatus("Models refreshed");
    } catch (error: any) {
      addEphemeralMessage("error", error.message);
      setStatus("Model refresh failed");
    } finally {
      refreshingModels = false;
    }
  }

  function updateThemePreference(value: string) {
    if (value !== "system" && value !== "light" && value !== "dark") {
      return;
    }
    themePreference = value;
    setThemePreference(themePreference);
  }

  function updateAccentThemePreference(value: string) {
    if (!ACCENT_THEME_OPTIONS.some((option) => option.value === value)) {
      return;
    }
    accentThemePreference = value as AccentThemePreference;
    setAccentThemePreference(accentThemePreference);
  }

  function handleTaskEvent(payload: any) {
    if (payload.conversation) {
      appState.activeConversation = payload.conversation.conversationId === appState.activeConversation?.conversationId
        ? payload.conversation
        : appState.activeConversation;
      appState.conversations = upsertLocalConversation(appState.conversations, payload.conversation);
    }
  }

  function requestActionConfirmation(payload: any) {
    const toolCall = payload.toolCall || {};
    if (appState.pendingConfirmation) {
      resolvePendingConfirmation(false);
    }

    activeTab = "chat";
    addEphemeralMessage("tool", `Approval needed: ${toolCall.summary || toolCall.tool || "action"}`);

    return new Promise((resolve) => {
      appState.pendingConfirmation = {
        resolve,
        toolCall,
        title: toolCall.summary || humanizeTool(toolCall.tool),
        reason: payload.deterministic?.reason || toolCall.reason || "This action may have side effects."
      };
    });
  }

  function resolvePendingConfirmation(approved: boolean) {
    if (!appState.pendingConfirmation) {
      return;
    }
    const { resolve, toolCall } = appState.pendingConfirmation;
    appState.pendingConfirmation = null;
    addEphemeralMessage(
      "tool",
      `${approved ? "Approved" : "Rejected"} ${toolCall.summary || toolCall.tool || "action"}`
    );
    resolve(approved);
  }

  function handlePossibleSiteAccessError(error: any, retry: any = null) {
    if (!isSiteAccessError(error)) {
      return false;
    }
    showSiteAccessRetry(retry);
    return true;
  }

  function showSiteAccessRetry(retry: any = null) {
    appState.pendingSiteAccessRetry = retry;
    appState.siteAccessVisible = true;
    activeTab = "chat";
  }

  function setRunning(isRunning: boolean, taskId: string | null) {
    appState.running = isRunning;
    appState.currentTaskId = taskId;
    if (isRunning) {
      setStatus("Running");
    }
  }

  function resizeComposer() {
    window.setTimeout(() => {
      if (!taskInputElement) {
        return;
      }
      taskInputElement.style.height = "auto";
      taskInputElement.style.height = `${Math.min(taskInputElement.scrollHeight, 140)}px`;
    }, 0);
  }

  function getSelectedModel() {
    return customModel.trim() || modelValue || DEFAULT_SETTINGS.model;
  }

  function formatModelLabel(model: string) {
    return String(model || "").replace(/^poolside\//, "");
  }

  function getVisibleMessageContent(message: any) {
    if (message.role !== "assistant" || !message.traceId) {
      return message.content || "";
    }
    return assistantResponseFromTrace(appState.latestTrace, message.traceId) || message.content || "";
  }

  function addEphemeralMessage(role: string, body: string) {
    ephemeralMessages = [
      ...ephemeralMessages,
      {
        messageId: createTaskId("local_msg"),
        role,
        kind: role === "tool" ? "progress" : "message",
        content: body,
        createdAt: new Date().toISOString()
      }
    ];
  }

  function mergeVisibleMessages(conversationMessages: any[], ephemeralMessages: any[]) {
    return [
      ...conversationMessages.map((message, index) => ({ message, index, source: "conversation" })),
      ...ephemeralMessages.map((message, index) => ({ message, index, source: "ephemeral" }))
    ]
      .sort((left, right) => (
        messageTimestamp(left.message, left.index) - messageTimestamp(right.message, right.index) ||
        messageSourcePriority(left.source) - messageSourcePriority(right.source) ||
        left.index - right.index
      ))
      .map(({ message }) => message);
  }

  function messageTimestamp(message: any, fallback: number) {
    const timestamp = Date.parse(message?.createdAt || "");
    return Number.isFinite(timestamp) ? timestamp : fallback;
  }

  function messageSourcePriority(source: string) {
    return source === "ephemeral" ? 0 : 1;
  }

  function openTraceDetails(taskId: string) {
    if (taskId) {
      openExtensionTab(`trace.html?taskId=${encodeURIComponent(taskId)}`);
    }
  }

  function mergeModels(...groups: any[][]) {
    const models = groups
      .flat()
      .filter(Boolean)
      .map((model) => String(model).trim())
      .filter(Boolean);
    return Array.from(new Set(models));
  }

  function setStatus(value: string) {
    status = value;
  }

  function isSiteAccessError(error: any) {
    const message = error?.message || String(error || "");
    return isSiteAccessErrorMessage(message);
  }

  function isSiteAccessErrorMessage(message: string) {
    return (
      message.includes("Cannot access contents of the page") ||
      message.includes("Extension manifest must request permission") ||
      message.includes("Cannot access a chrome") ||
      message.includes("The extensions gallery cannot be scripted")
    );
  }

  function getSiteAccessErrorMessage(trace: any) {
    const messages = [
      trace?.error?.message,
      trace?.summary,
      ...(trace?.steps || []).flatMap((step: any) => [
        step?.error?.message,
        step?.execution?.reason,
        step?.recovery?.summary
      ])
    ].filter(Boolean);
    return messages.find((message: string) => isSiteAccessErrorMessage(message)) || "";
  }

  function humanizeTool(tool: string) {
    return String(tool || "Approve action").replace(/_/g, " ");
  }

  function upsertLocalConversation(conversations: any[], conversation: any) {
    return [
      conversation,
      ...conversations.filter((item) => item.conversationId !== conversation.conversationId)
    ];
  }
</script>

<div class="grid h-screen min-w-80 overflow-hidden bg-surface text-base text-foreground">
  <Tabs.Root bind:value={activeTab} class="grid h-full min-h-0 overflow-hidden">
    <Tabs.Content value="chat" class="hidden min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
      <div class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-1.5 border-b border-border/70 bg-surface px-3 py-2">
        <InlineSelect
          class="min-w-0"
          buttonClass="w-full justify-start text-sm text-foreground"
          value={appState.activeConversation?.conversationId || ""}
          options={conversationOptions}
          placeholder="New chat"
          ariaLabel="Conversation"
          onChange={switchConversation}
        />
        <Button size="icon" title="New chat" ariaLabel="New chat" onclick={newChat}>
          <MessageSquarePlus size={16} />
        </Button>
        {#if appState.mcpBridge?.connected}
          <div
            class="inline-flex min-h-7 max-w-24 items-center gap-1 rounded-full border border-border/70 bg-accent/10 px-2 text-xs font-medium text-foreground"
            title={mcpBridgeLabel}
            aria-label={mcpBridgeLabel}
          >
            <Plug size={13} />
            <span class="truncate">MCP</span>
          </div>
        {/if}
        <Button size="icon" title="Settings" ariaLabel="Settings" onclick={() => activeTab = "advanced"}>
          <Settings size={16} />
        </Button>
      </div>

      <div bind:this={chatLogElement} class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto bg-background px-4 py-4">
        {#if visibleMessages.length === 0}
          <EmptyState onPrompt={startTask} />
        {:else}
          {#each visibleMessages as message (message.messageId || `${message.createdAt || ""}-${message.content || ""}`)}
            <MessageBubble
              {message}
              content={getVisibleMessageContent(message)}
              showRunDetails={Boolean(message.traceId && message.role === "user")}
              onOpenTrace={openTraceDetails}
            />
          {/each}
        {/if}
      </div>

      <SiteAccessCard visible={appState.siteAccessVisible} busy={grantingAccess} onGrant={grantSiteAccess} />

      <ConfirmationCard
        pending={appState.pendingConfirmation}
        onApprove={() => resolvePendingConfirmation(true)}
        onReject={() => resolvePendingConfirmation(false)}
      />

      <form
        class="shrink-0 border-t border-border/70 bg-background px-3 pb-3 pt-2"
        onsubmit={(event) => {
          event.preventDefault();
          startTask();
        }}
      >
        <div class="fyr-composer grid gap-1 overflow-visible p-1.5">
          <textarea
            bind:this={taskInputElement}
            bind:value={taskInput}
            class="max-h-36 min-h-12 resize-none bg-transparent px-2.5 py-2 text-base leading-5 text-foreground outline-none placeholder:text-muted-foreground/70"
            rows="2"
            placeholder="Ask the agent to inspect, explain, or operate this tab"
            oninput={resizeComposer}
            onkeydown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                startTask();
              }
            }}
          ></textarea>
          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-1 pb-0.5">
            <div class="relative z-20 flex min-w-0 items-center gap-1 overflow-visible">
              <InlineSelect
                bind:value={modelValue}
                options={modelSelectOptions}
                placement="top"
                ariaLabel="Model"
                menuClass="left-0"
                buttonClass="max-w-40 min-h-7 rounded-full px-2 text-xs text-muted-foreground"
                onChange={() => saveSettings({ quiet: true })}
              />
              <InlineSelect
                bind:value={confirmationMode}
                options={confirmationSelectOptions}
                placement="top"
                ariaLabel="Confirmation mode"
                menuClass="right-0"
                buttonClass="max-w-32 min-h-7 rounded-full px-2 text-xs text-muted-foreground"
                onChange={() => saveSettings({ quiet: true })}
              />
            </div>
            {#if appState.running}
              <Button variant="danger" size="icon" title="Stop" ariaLabel="Stop" onclick={stopTask}>
                <Square size={14} />
              </Button>
            {:else}
              <Button variant="primary" size="icon" type="submit" title="Send" ariaLabel="Send">
                <Send size={15} />
              </Button>
            {/if}
          </div>
        </div>
      </form>
    </Tabs.Content>

    <Tabs.Content value="advanced" class="hidden min-h-0 overflow-y-auto overflow-x-hidden data-[state=active]:block">
      <div class="sticky top-0 z-10 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border/70 bg-surface px-3 py-2">
        <Button size="icon" title="Back to chat" ariaLabel="Back to chat" onclick={() => activeTab = "chat"}>
          <ArrowLeft size={16} />
        </Button>
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-muted-foreground">Settings</div>
          <div class="truncate text-xs text-muted-foreground/70">{status}</div>
        </div>
        <Button
          size="icon"
          title={observing ? "Observing page" : "Observe page"}
          ariaLabel={observing ? "Observing page" : "Observe page"}
          disabled={observing}
          onclick={observePage}
        >
          {#if observing}
            <RefreshCw class="animate-spin" size={16} />
          {:else}
            <FileJson2 size={16} />
          {/if}
        </Button>
        <Button size="icon" title="Open playground" ariaLabel="Open playground" onclick={openPlayground}>
          <FlaskConical size={16} />
        </Button>
      </div>

      <Section title="Settings" class="border-b-0">
        <form
          class="grid gap-3"
          onsubmit={(event) => {
            event.preventDefault();
            saveSettings();
          }}
        >
          <Field label="OpenRouter API key">
            <input class="fyr-input min-h-8 px-2 py-1.5 text-base" bind:value={apiKey} autocomplete="off" spellcheck="false" type="password" placeholder="sk-or-v1-..." />
          </Field>
          <Field label="Custom model">
            <input class="fyr-input min-h-8 px-2 py-1.5 text-base" bind:value={customModel} autocomplete="off" spellcheck="false" placeholder="Optional model id" />
          </Field>
          <Field label="Max steps">
            <input class="fyr-input min-h-8 px-2 py-1.5 text-base" bind:value={maxSteps} min="1" max="1000" step="1" type="number" />
          </Field>
          <Field label="Theme">
            <InlineSelect
              class="w-full"
              bind:value={themePreference}
              options={THEME_OPTIONS}
              ariaLabel="Theme"
              buttonClass="w-full justify-between"
              onChange={updateThemePreference}
            />
          </Field>
          <Field label="Accent">
            <InlineSelect
              class="w-full"
              bind:value={accentThemePreference}
              options={ACCENT_THEME_OPTIONS}
              ariaLabel="Accent"
              buttonClass="w-full justify-between"
              onChange={updateAccentThemePreference}
            />
          </Field>
          <label class="flex items-center gap-2 text-sm font-semibold">
            <input class="size-4" bind:checked={showActionPreview} type="checkbox" />
            <span>Show action preview</span>
          </label>
          <div class="flex flex-wrap gap-2">
            <Button variant="primary" type="submit">
              <Settings size={14} />
              Save settings
            </Button>
            <Button disabled={refreshingModels} onclick={refreshModels}>
              <RefreshCw size={14} />
              Refresh models
            </Button>
          </div>
        </form>
      </Section>

      <Section title="MCP bridge" class="border-b-0">
        <div class="grid gap-2 text-sm">
          <div class="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background px-3 py-2">
            <div class="flex min-w-0 items-center gap-2">
              <Plug size={15} />
              <span class="truncate">{mcpBridgeLabel}</span>
            </div>
            <span class="shrink-0 text-xs text-muted-foreground">
              {appState.mcpBridge?.port ? `:${appState.mcpBridge.port}` : "local"}
            </span>
          </div>
          {#if appState.mcpBridge?.lastError && !appState.mcpBridge?.connected}
            <p class="break-words text-xs leading-5 text-muted-foreground">{appState.mcpBridge.lastError}</p>
          {/if}
        </div>
      </Section>

    </Tabs.Content>
  </Tabs.Root>
</div>
