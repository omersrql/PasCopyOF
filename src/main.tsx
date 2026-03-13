import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import LauncherPage from "./pages/LauncherPage.tsx";
import ManagerPage from "./pages/ManagerPage.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<LauncherPage />} />
        <Route path="/manager" element={<ManagerPage />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
