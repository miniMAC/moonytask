import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import PopoverApp from "./popover/PopoverApp";
import { ThemeProvider } from "./lib/theme";
import "./i18n";
import "./index.css";

const isPopover = getCurrentWebviewWindow().label === "popover";
if (isPopover) document.body.classList.add("popover-window");

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
