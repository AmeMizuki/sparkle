import { mount } from "svelte";
import "@fontsource-variable/geist";
import "./app.css";
import App from "./App.svelte";
mount(App, { target: document.getElementById("app") });
if (import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js");
