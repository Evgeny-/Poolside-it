<script lang="ts">
  import {
    formatToolLabel,
    getToolCall,
    type TraceCycle,
    type TraceCycleStatus
  } from "$lib/trace/cycles";

  let {
    cycle
  }: {
    cycle: TraceCycle;
  } = $props();

  type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";

  type Badge = {
    label: string;
    value: string;
    tone: BadgeTone;
  };

  let badges = $derived(createBadges(cycle));

  function createBadges(currentCycle: TraceCycle): Badge[] {
    const step = currentCycle.actionStep;
    const toolCall = getToolCall(step);
    const validationOk = step?.validation?.ok;
    const confirmation = step?.confirmation;
    const execution = step?.execution;
    const risk = toolCall.riskCategory || "";
    const frame = execution?.frameId;

    const items: Badge[] = [];

    if (toolCall.tool) {
      items.push({
        label: "Tool",
        value: formatToolLabel(toolCall.tool),
        tone: "accent"
      });
    }

    if (validationOk === false) {
      items.push({
        label: "Validation",
        value: step?.validation?.reason || "blocked",
        tone: "danger"
      });
    } else if (validationOk === true) {
      items.push({
        label: "Validation",
        value: "ok",
        tone: "success"
      });
    }

    if (confirmation?.required || confirmation?.decision === "approved" || confirmation?.decision === "rejected") {
      items.push({
        label: "Confirmation",
        value: confirmation.decision || "required",
        tone: confirmation.decision === "approved" ? "warning" : "danger"
      });
    }

    if (execution?.status) {
      items.push({
        label: "Execution",
        value: execution.status,
        tone: execution.status === "ok" || execution.status === "submitted" ? "success" :
          execution.status === "blocked" ? "warning" :
            execution.status === "failed" || execution.status === "aborted" ? "danger" : "neutral"
      });
    }

    if (risk && risk !== "safe_navigation" && risk !== "data_entry") {
      items.push({
        label: "Risk",
        value: risk,
        tone: risk === "unknown" ? "warning" : "danger"
      });
    }

    if (frame !== null && frame !== undefined) {
      items.push({
        label: "Frame",
        value: String(frame),
        tone: "neutral"
      });
    }

    if (currentCycle.recoverySteps.length) {
      items.push({
        label: "Recovery",
        value: String(currentCycle.recoverySteps.length),
        tone: "warning"
      });
    }

    if (!items.length) {
      items.push({
        label: "Status",
        value: statusLabel(currentCycle.status),
        tone: toneForStatus(currentCycle.status)
      });
    }

    return items;
  }

  function statusLabel(status: TraceCycleStatus) {
    const labels: Record<TraceCycleStatus, string> = {
      ok: "ok",
      blocked: "blocked",
      failed: "failed",
      confirmed: "confirmed",
      recovery: "recovery",
      done: "done",
      observed: "observed"
    };
    return labels[status];
  }

  function toneForStatus(status: TraceCycleStatus): BadgeTone {
    if (status === "failed" || status === "blocked") {
      return "danger";
    }
    if (status === "confirmed" || status === "recovery") {
      return "warning";
    }
    if (status === "ok" || status === "done") {
      return "success";
    }
    return "neutral";
  }

  function badgeClass(tone: BadgeTone) {
    const classes: Record<BadgeTone, string> = {
      neutral: "border-foreground/[0.06] bg-foreground/[0.025] text-muted-foreground",
      success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      warning: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      danger: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
      accent: "border-primary/20 bg-primary/10 text-primary"
    };
    return classes[tone];
  }
</script>

<div class="flex flex-wrap gap-1.5">
  {#each badges as badge}
    <span class={`inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border px-2.5 text-xs ${badgeClass(badge.tone)}`}>
      <span class="font-medium opacity-70">{badge.label}</span>
      <span class="min-w-0 truncate font-medium">{badge.value}</span>
    </span>
  {/each}
</div>
