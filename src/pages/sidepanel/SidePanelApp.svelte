<script lang="ts">
  import { ArrowLeft, Copy, Download, Eye, FlaskConical, MessageSquarePlus, RefreshCw, Send, Settings, Square } from "@lucide/svelte";
  import { Tabs } from "bits-ui";
  import Button from "$lib/components/ui/Button.svelte";
  import Field from "$lib/components/ui/Field.svelte";
  import InlineSelect from "$lib/components/ui/InlineSelect.svelte";
  import JsonBlock from "$lib/components/ui/JsonBlock.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { openExtensionTab, sendRuntimeMessage } from "$lib/chrome/runtime";
  import { loadThemePreference, setThemePreference, THEME_OPTIONS, type ThemePreference } from "$lib/theme";
  import { assistantResponseFromTrace, latestSnapshotFromTrace } from "$lib/trace/format";
  import { createCompactTraceExport } from "$extension/shared/trace-export.js";
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
  import HistoryList from "./HistoryList.svelte";
  import MessageBubble from "./MessageBubble.svelte";
  import SiteAccessCard from "./SiteAccessCard.svelte";
  import TraceTimeline from "./TraceTimeline.svelte";

  const OPTIONAL_SITE_ORIGINS = ["http://*/*", "https://*/*"];

  let status = $state("Loading");
  let activeTab = $state("chat");
  let taskInput = $state("");
  let chatLogElement = $state<HTMLElement | null>(null);
  let taskInputElement = $state<HTMLTextAreaElement | null>(null);
  let observing = $state(false);
  let refreshingModels = $state(false);
  let grantingAccess = $state(false);
  let siteAccessPromptedThisSession = $state(false);
  let ephemeralMessages = $state<any[]>([]);

  let apiKey = $state("");
  let modelValue = $state(DEFAULT_SETTINGS.model);
  let customModel = $state("");
  let maxSteps = $state(DEFAULT_SETTINGS.maxSteps);
  let showActionPreview = $state(true);
  let confirmationMode = $state(CONFIRMATION_MODES.SMART_CONFIRMATION);
  let themePreference = $state<ThemePreference>(loadThemePreference());

  let appState = $state<any>({
    settings: null,
    latestSnapshot: null,
    latestTrace: null,
    history: [],
    conversations: [],
    activeConversation: null,
    availableModels: [...BUILT_IN_MODELS],
    currentTaskId: null,
    pendingConfirmation: null,
    pendingSiteAccessRetry: null,
    running: false,
    siteAccessVisible: false
  });

  let conversationMessages = $derived(appState.activeConversation?.messages || []);
  let visibleMessages = $derived([
    ...conversationMessages,
    ...ephemeralMessages
  ]);
  let modelOptions = $derived(mergeModels(appState.availableModels, [modelValue]));
  let modelSelectOptions = $derived(modelOptions.map((model) => ({
    value: model,
    label: model,
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
      if (!instructionOverride) {
        await requestSiteAccessForPromptGesture();
      }
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
      handlePossibleSiteAccessError(error, {
        type: "task",
        instruction
      });
      setStatus("Task failed");
    } finally {
      setRunning(false, null);
    }
  }

  async function requestSiteAccessForPromptGesture() {
    if (siteAccessPromptedThisSession || !apiKey.trim()) {
      return;
    }
    siteAccessPromptedThisSession = true;
    try {
      const granted = await chrome.permissions.request({
        origins: OPTIONAL_SITE_ORIGINS
      });
      if (granted) {
        appState.siteAccessVisible = false;
        appState.pendingSiteAccessRetry = null;
        addEphemeralMessage("tool", "Website access granted.");
      }
    } catch (error) {
      // Chrome only allows permission prompts during user gestures. If this is
      // rejected, the normal failed-observation recovery card still appears.
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
      const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.LIST_OPENAI_MODELS);
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

  async function loadTrace(taskId: string) {
    const data = await sendRuntimeMessage<any>(MESSAGE_TYPES.GET_TRACE, { taskId });
    if (!data.trace) {
      setStatus("Trace not found");
      return;
    }
    appState.latestTrace = data.trace;
    appState.latestSnapshot = latestSnapshotFromTrace(data.trace);
    activeTab = "advanced";
    setStatus("Trace loaded");
  }

  async function copyTrace() {
    if (!appState.latestTrace) {
      setStatus("No trace");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(createCompactTraceExport(appState.latestTrace), null, 2));
      setStatus("Compact trace copied");
    } catch (error: any) {
      addEphemeralMessage("error", error.message);
      setStatus("Copy failed");
    }
  }

  function exportTrace() {
    if (!appState.latestTrace) {
      setStatus("No trace");
      return;
    }
    const blob = new Blob([JSON.stringify(appState.latestTrace, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${appState.latestTrace.taskId || "browser-agent-trace"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Trace exported");
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
        reason: payload.deterministic?.reason || toolCall.reason || "This action may have side effects.",
        meta: [
          humanizeRisk(toolCall.riskCategory),
          toolCall.elementId || "",
          CONFIRMATION_MODE_LABELS[payload.mode] || payload.mode || ""
        ].filter(Boolean)
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
      return;
    }
    showSiteAccessRetry(retry);
  }

  function showSiteAccessRetry(retry: any = null) {
    appState.pendingSiteAccessRetry = retry;
    appState.siteAccessVisible = true;
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
        role,
        kind: role === "tool" ? "progress" : "message",
        content: body
      }
    ];
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

  function humanizeRisk(riskCategory: string) {
    const labels: Record<string, string> = {
      external_submit: "Sends data",
      destructive: "Destructive",
      financial: "Financial",
      auth_sensitive: "Account-sensitive",
      unknown: "Unknown risk",
      data_entry: "Data entry",
      safe_navigation: "Navigation"
    };
    return labels[riskCategory] || "";
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

<div class="grid h-screen min-w-80 overflow-hidden bg-background text-[13px] text-foreground">
  <Tabs.Root bind:value={activeTab} class="grid h-full min-h-0 overflow-hidden">
    <Tabs.Content value="chat" class="hidden min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
      <div class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 border-b border-border bg-background px-3 py-2">
        <InlineSelect
          class="min-w-0"
          buttonClass="w-full justify-start px-0 text-[12px] text-foreground hover:bg-transparent"
          value={appState.activeConversation?.conversationId || ""}
          options={conversationOptions}
          placeholder="New chat"
          ariaLabel="Conversation"
          onChange={switchConversation}
        />
        <Button size="icon" title="New chat" ariaLabel="New chat" onclick={newChat}>
          <MessageSquarePlus size={16} />
        </Button>
        <Button size="icon" title="Settings" ariaLabel="Settings" onclick={() => activeTab = "advanced"}>
          <Settings size={16} />
        </Button>
      </div>

      <div bind:this={chatLogElement} class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 py-4">
        {#if visibleMessages.length === 0}
          <EmptyState onPrompt={startTask} />
        {:else}
          {#each visibleMessages as message}
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
        class="grid shrink-0 gap-2 border-t border-border bg-background p-3"
        onsubmit={(event) => {
          event.preventDefault();
          startTask();
        }}
      >
        <textarea
          bind:this={taskInputElement}
          bind:value={taskInput}
          class="max-h-36 min-h-12 resize-none rounded-md border border-border bg-card p-3 text-sm leading-5 placeholder:text-muted-foreground"
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
        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div class="relative z-20 flex min-w-0 items-center gap-1.5 overflow-visible">
            <InlineSelect
              bind:value={modelValue}
              options={modelSelectOptions}
              placement="top"
              ariaLabel="Model"
              menuClass="left-0"
              buttonClass="max-w-40"
              onChange={() => saveSettings({ quiet: true })}
            />
            <InlineSelect
              bind:value={confirmationMode}
              options={confirmationSelectOptions}
              placement="top"
              ariaLabel="Confirmation mode"
              menuClass="right-0"
              buttonClass="max-w-32"
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
      </form>
    </Tabs.Content>

    <Tabs.Content value="advanced" class="hidden min-h-0 overflow-y-auto overflow-x-hidden data-[state=active]:block">
      <div class="sticky top-0 z-10 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-background px-3 py-2">
        <Button size="icon" title="Back to chat" ariaLabel="Back to chat" onclick={() => activeTab = "chat"}>
          <ArrowLeft size={16} />
        </Button>
        <div class="font-mono-ui truncate text-xs uppercase text-muted-foreground">Settings</div>
        <Button size="icon" title="Open playground" ariaLabel="Open playground" onclick={openPlayground}>
          <FlaskConical size={16} />
        </Button>
      </div>

      <Section title="Settings">
        <form
          class="grid gap-3"
          onsubmit={(event) => {
            event.preventDefault();
            saveSettings();
          }}
        >
          <Field label="OpenAI API key">
            <input class="min-h-9 rounded-md border border-input bg-card px-3" bind:value={apiKey} autocomplete="off" spellcheck="false" type="password" placeholder="sk-..." />
          </Field>
          <Field label="Custom model">
            <input class="min-h-9 rounded-md border border-input bg-card px-3" bind:value={customModel} autocomplete="off" spellcheck="false" placeholder="Optional model id" />
          </Field>
          <Field label="Max steps">
            <input class="min-h-9 rounded-md border border-input bg-card px-3" bind:value={maxSteps} min="1" max="1000" step="1" type="number" />
          </Field>
          <Field label="Theme">
            <InlineSelect
              bind:value={themePreference}
              options={THEME_OPTIONS}
              ariaLabel="Theme"
              onChange={updateThemePreference}
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

      <Section title="Trace">
        <div class="grid grid-cols-[repeat(auto-fit,minmax(92px,1fr))] gap-2">
          <Button class="w-full" size="sm" disabled={observing} onclick={observePage}>
            <Eye size={14} />
            Observe page
          </Button>
          <Button class="w-full" size="sm" onclick={copyTrace}>
            <Copy size={14} />
            Copy trace
          </Button>
          <Button class="w-full" size="sm" onclick={exportTrace}>
            <Download size={14} />
            Export JSON
          </Button>
        </div>
        <TraceTimeline trace={appState.latestTrace} />
      </Section>

      <Section title="Latest PageSnapshot">
        <JsonBlock value={appState.latestSnapshot || {}} />
      </Section>

      <Section title="Raw JSON">
        <JsonBlock value={appState.latestTrace || {}} />
      </Section>

      <Section title="Task Records" class="border-b-0">
        <HistoryList history={appState.history} onLoad={loadTrace} onOpen={openTraceDetails} />
      </Section>
    </Tabs.Content>
  </Tabs.Root>
</div>
