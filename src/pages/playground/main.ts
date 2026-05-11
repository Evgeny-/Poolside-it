import "$lib/styles/app.css";
import { applyThemePreference } from "$lib/theme";
import { mount } from "svelte";
import PlaygroundApp from "./PlaygroundApp.svelte";

applyThemePreference();

mount(PlaygroundApp, {
  target: document.getElementById("app")!
});
