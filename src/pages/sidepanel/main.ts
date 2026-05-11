import "$lib/styles/app.css";
import { applyThemePreference } from "$lib/theme";
import { mount } from "svelte";
import SidePanelApp from "./SidePanelApp.svelte";

applyThemePreference();

mount(SidePanelApp, {
  target: document.getElementById("app")!
});
