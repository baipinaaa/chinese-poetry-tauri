/**
 * SPA 入口：挂载 React 根、引入全局样式，并以 HashRouter 提供路由上下文。
 *
 * 桌面版由 Tauri 通过自定义协议（tauri://）加载 index.html，使用 Hash 路由
 * 可避免刷新 / 深链接时命中不存在的文件；HashRouter 同样支持 useSearchParams。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 挂载点");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
