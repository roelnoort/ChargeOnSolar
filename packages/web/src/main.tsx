import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { browserClock } from "./clock.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element in index.html");

createRoot(root).render(
  <StrictMode>
    <App clock={browserClock} />
  </StrictMode>
);
