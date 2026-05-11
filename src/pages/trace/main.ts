import "$lib/styles/app.css";
import { applyThemePreference } from "$lib/theme";
import { mount } from "svelte";
import TraceApp from "./TraceApp.svelte";

applyThemePreference();

mount(TraceApp, {
  target: document.getElementById("app")!
});
