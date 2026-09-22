import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import LauncherPage from "./pages/LauncherPage.tsx";
import ManagerPage from "./pages/ManagerPage.tsx";
import ClipboardLauncherPage from "./pages/ClipboardLauncherPage.tsx";
import ScreenshotOverlayPage from "./pages/ScreenshotOverlayPage.tsx";
import { AppProvider } from "./context/AppContext.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<LauncherPage />} />
          <Route path="/manager" element={<ManagerPage />} />
          <Route path="/clipboard" element={<ClipboardLauncherPage />} />
          <Route path="/screenshot" element={<ScreenshotOverlayPage />} />
        </Routes>
      </HashRouter>
    </AppProvider>
  </React.StrictMode>
);
