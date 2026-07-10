import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeAppearance } from "./appearance";

// The settings window is normally hidden until explicitly opened, but applying
// appearance before React renders also prevents a light-frame flash in direct
// development launches and automated visual checks.
initializeAppearance();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
