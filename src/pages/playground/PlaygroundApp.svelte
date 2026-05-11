<script lang="ts">
  import { FileText, Mail, MousePointerClick, Rows3, Shuffle } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";

  const pages = [
    { id: "index", href: "index.html", label: "Home" },
    { id: "contact", href: "contact.html", label: "Contact form" },
    { id: "compose", href: "compose.html", label: "Fake compose" },
    { id: "dynamic", href: "dynamic.html", label: "Dynamic UI" },
    { id: "ambiguous", href: "ambiguous.html", label: "Ambiguous controls" }
  ];

  let status = $state("");
  let advancedVisible = $state(false);
  let dynamicRows = $state<number[]>([]);
  let pageId = $derived(getPageId());

  $effect(() => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/observer.js");
    script.async = false;
    document.head.append(script);
    return () => script.remove();
  });

  function getPageId() {
    const file = location.pathname.split("/").pop() || "index.html";
    return file.replace(".html", "") || "index";
  }

  function setActionStatus(event: Event) {
    const target = event.currentTarget as HTMLElement;
    status = target.dataset.onclickAction || "";
  }

  function setActionStatusFromKeyboard(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActionStatus(event);
    }
  }

  function fakeSubmit(event: SubmitEvent, text: string) {
    event.preventDefault();
    status = text;
  }

  function addRow() {
    dynamicRows = [...dynamicRows, Date.now()];
  }

  function removeRow(id: number) {
    dynamicRows = dynamicRows.filter((rowId) => rowId !== id);
  }
</script>

<div class="min-h-screen bg-background text-foreground">
  <header class="border-b border-border bg-card px-6 py-5">
    <div class="mx-auto grid w-[min(980px,calc(100%-16px))] gap-4">
      <div>
        <h1 class="text-2xl font-extrabold tracking-normal">{pageTitle(pageId)}</h1>
        <p class="mt-1 text-sm text-muted-foreground">{pageDescription(pageId)}</p>
      </div>
      <nav class="flex flex-wrap gap-2" aria-label="Playground navigation">
        {#each pages as page}
          <a
            class={[
              "rounded-md border px-3 py-2 text-sm font-bold no-underline transition-colors",
              page.id === pageId ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-secondary"
            ].join(" ")}
            href={page.href}
          >
            {page.label}
          </a>
        {/each}
      </nav>
    </div>
  </header>

  <main class="mx-auto grid w-[min(980px,calc(100%-32px))] gap-4 py-6">
    {#if pageId === "contact"}
      <section class="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-panel">
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><FileText size={20} /></div>
          <h2 class="text-lg font-bold">Contact request</h2>
        </div>
        <form class="grid gap-4" data-fake-submit data-status-target="#status" data-success-text="Contact request saved locally." onsubmit={(event) => fakeSubmit(event, "Contact request saved locally.")}>
          <label class="grid gap-1.5 text-sm font-semibold" for="contactName">Name
            <input class="min-h-10 rounded-md border border-input bg-card px-3" id="contactName" name="name" placeholder="Ada Lovelace" autocomplete="name" />
          </label>
          <label class="grid gap-1.5 text-sm font-semibold" for="contactEmail">Email
            <input class="min-h-10 rounded-md border border-input bg-card px-3" id="contactEmail" name="email" type="email" placeholder="ada@example.com" autocomplete="email" />
          </label>
          <label class="grid gap-1.5 text-sm font-semibold" for="topicSelect">Topic
            <select class="min-h-10 rounded-md border border-input bg-card px-3" id="topicSelect" name="topic">
              <option value="">Choose a topic</option>
              <option value="support">Support</option>
              <option value="sales">Sales</option>
              <option value="feedback">Feedback</option>
            </select>
          </label>
          <label class="grid gap-1.5 text-sm font-semibold" for="contactMessage">Message
            <textarea class="min-h-24 rounded-md border border-input bg-card p-3" id="contactMessage" name="message" placeholder="Write a short message"></textarea>
          </label>
          <label class="flex items-center gap-2 text-sm font-semibold">
            <input class="size-4" id="termsCheckbox" name="terms" type="checkbox" />
            I agree to the fake terms
          </label>
          <div class="flex flex-wrap gap-2">
            <Button variant="primary" type="submit">Submit request</Button>
            <Button type="reset">Reset</Button>
          </div>
        </form>
      </section>
    {:else if pageId === "compose"}
      <section class="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-panel">
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Mail size={20} /></div>
          <h2 class="text-lg font-bold">Fake email compose</h2>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button>Archive</Button>
          <Button>Mark unread</Button>
          <Button>Compose</Button>
        </div>
        <form class="grid gap-4" data-fake-submit data-status-target="#status" data-success-text="Fake email marked as sent." onsubmit={(event) => fakeSubmit(event, "Fake email marked as sent.")}>
          <label class="grid gap-1.5 text-sm font-semibold" for="recipientInput">To
            <input class="min-h-10 rounded-md border border-input bg-card px-3" id="recipientInput" name="to" type="email" placeholder="manager@example.com" />
          </label>
          <label class="grid gap-1.5 text-sm font-semibold" for="subjectInput">Subject
            <input class="min-h-10 rounded-md border border-input bg-card px-3" id="subjectInput" name="subject" placeholder="Out sick today" />
          </label>
          <label class="grid gap-1.5 text-sm font-semibold" for="bodyInput">Message
            <textarea class="min-h-32 rounded-md border border-input bg-card p-3" id="bodyInput" name="body" placeholder="Write the email body"></textarea>
          </label>
          <div class="flex flex-wrap gap-2">
            <Button variant="primary" type="submit">Send</Button>
            <Button data-onclick-action="Draft discarded" onclick={setActionStatus}>Discard</Button>
            <Button data-onclick-action="Draft saved" onclick={setActionStatus}>Save draft</Button>
          </div>
        </form>
        <div class="grid gap-2 rounded-lg border border-border bg-muted/40 p-3" aria-label="Fake inbox">
          <a class="text-primary" href="#thread-1">Team meeting notes</a>
          <a class="text-primary" href="#thread-2">Lunch plans</a>
          <a class="text-primary" href="#thread-3">Build status update</a>
        </div>
      </section>
    {:else if pageId === "dynamic"}
      <section class="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-panel">
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Rows3 size={20} /></div>
          <h2 class="text-lg font-bold">Reveal controls</h2>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" data-reveal-panel onclick={() => advancedVisible = true}>Show advanced options</Button>
          <Button data-add-row onclick={addRow}>Add dynamic row</Button>
        </div>
        {#if advancedVisible}
          <div id="revealedPanel" class="grid gap-4 rounded-xl border border-border bg-muted/40 p-4">
            <h2 class="text-base font-bold">Advanced options</h2>
            <label class="grid gap-1.5 text-sm font-semibold" for="advancedName">Internal label
              <input class="min-h-10 rounded-md border border-input bg-card px-3" id="advancedName" placeholder="Visible after click" />
            </label>
            <label class="grid gap-1.5 text-sm font-semibold" for="advancedMode">Mode
              <select class="min-h-10 rounded-md border border-input bg-card px-3" id="advancedMode">
                <option value="draft">Draft</option>
                <option value="review">Review</option>
                <option value="final">Final</option>
              </select>
            </label>
            <div id="editableNote" contenteditable="true" role="textbox" aria-label="Editable note" class="min-h-14 rounded-md border border-input bg-card p-3">Editable note</div>
          </div>
        {/if}
        <div id="dynamicList" class="grid gap-2" aria-label="Dynamic rows">
          {#each dynamicRows as row, index}
            <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border border-border bg-card p-2">
              <input class="min-h-10 rounded-md border border-input bg-card px-3" placeholder={`Dynamic item ${index + 1}`} aria-label={`Dynamic item ${index + 1}`} />
              <Button onclick={() => removeRow(row)}>Remove</Button>
            </div>
          {/each}
        </div>
      </section>
    {:else if pageId === "ambiguous"}
      <section class="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-panel">
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Shuffle size={20} /></div>
          <h2 class="text-lg font-bold">Choose an action</h2>
        </div>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
          <Button data-onclick-action="Opened primary account" onclick={setActionStatus}>Open</Button>
          <Button data-onclick-action="Opened archive account" onclick={setActionStatus}>Open</Button>
          <Button data-onclick-action="Sent local draft" onclick={setActionStatus}>Send</Button>
          <Button data-onclick-action="Sent test notification" onclick={setActionStatus}>Send</Button>
          <a class="rounded-md border border-border bg-card px-3 py-2 text-center text-sm font-bold text-primary no-underline hover:bg-secondary" href="#open-link">Open</a>
          <div role="button" tabindex="0" class="rounded-md border border-border bg-card px-3 py-2 text-center text-sm font-bold" data-onclick-action="Role button selected" onclick={setActionStatus} onkeydown={setActionStatusFromKeyboard}>Open</div>
          <div role="menuitem" tabindex="0" class="rounded-md border border-border bg-card px-3 py-2 text-center text-sm font-bold" data-onclick-action="Menu item selected" onclick={setActionStatus} onkeydown={setActionStatusFromKeyboard}>More</div>
          <div role="button" tabindex="0" class="rounded-md border border-border bg-card px-3 py-2 text-center text-sm font-bold" data-onclick-action="Tabindex box selected" onclick={setActionStatus} onkeydown={setActionStatusFromKeyboard}>Focusable box</div>
        </div>
      </section>
    {:else}
      <section class="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4" aria-label="Playground pages">
        <article class="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-panel">
          <MousePointerClick class="text-primary" size={22} />
          <h2 class="text-lg font-bold">Basic navigation</h2>
          <p class="text-sm leading-5 text-muted-foreground">Links and buttons are available as simple observation targets.</p>
          <Button data-onclick-action="Home button clicked" onclick={setActionStatus}>Plain button</Button>
        </article>
        <article class="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-panel">
          <FileText class="text-primary" size={22} />
          <h2 class="text-lg font-bold">Contact form</h2>
          <p class="text-sm leading-5 text-muted-foreground">Inputs, textarea, checkbox, select, and fake submit behavior.</p>
          <a class="font-bold text-primary" href="contact.html">Open contact form</a>
        </article>
        <article class="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-panel">
          <Mail class="text-primary" size={22} />
          <h2 class="text-lg font-bold">Fake email compose</h2>
          <p class="text-sm leading-5 text-muted-foreground">Recipient, subject, body, and non-destructive send action.</p>
          <a class="font-bold text-primary" href="compose.html">Open compose</a>
        </article>
        <article class="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-panel">
          <Rows3 class="text-primary" size={22} />
          <h2 class="text-lg font-bold">Dynamic UI</h2>
          <p class="text-sm leading-5 text-muted-foreground">Controls appear after clicks and rows can be added.</p>
          <a class="font-bold text-primary" href="dynamic.html">Open dynamic UI</a>
        </article>
      </section>
    {/if}

    <div id="status" class="min-h-11 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground" aria-live="polite">
      {status || "No local action yet."}
    </div>
  </main>
</div>

<script lang="ts" module>
  export function pageTitle(pageId: string) {
    const titles: Record<string, string> = {
      index: "Poolside it for me Playground",
      contact: "Contact Form",
      compose: "Fake Email Compose",
      dynamic: "Dynamic UI",
      ambiguous: "Ambiguous Controls"
    };
    return titles[pageId] || titles.index;
  }

  export function pageDescription(pageId: string) {
    const descriptions: Record<string, string> = {
      index: "Safe local pages for active-tab observation and action execution.",
      contact: "Non-destructive form controls for observe_page.",
      compose: "A local compose flow with no network send.",
      dynamic: "Controls appear after user interaction.",
      ambiguous: "Repeated labels and mixed roles for future disambiguation."
    };
    return descriptions[pageId] || descriptions.index;
  }
</script>
