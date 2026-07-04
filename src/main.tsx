import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import PopoverApp from "./popover/PopoverApp";
import { ThemeProvider } from "./lib/theme";
import "./i18n";
import "./index.css";

const isPopover = getCurrentWebviewWindow().label === "popover";
if (isPopover) {
  // anche <html> deve essere trasparente, altrimenti il canvas del documento
  // dipinge angoli netti dietro il bordo stondato del popover
  document.documentElement.classList.add("popover-window");
  document.body.classList.add("popover-window");
} else {
  document.body.classList.add("app-window");
}

window.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>{isPopover ? <PopoverApp /> : <App />}</ThemeProvider>
  </React.StrictMode>,
);
