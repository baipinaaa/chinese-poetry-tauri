/**
 * 数据库就绪门禁（DbGate）
 *
 * Tauri 桌面版把 216MB 的 poetry_index.db 作为「资源」随安装包分发，但仓库里只放
 * 0 字节占位文件（DB 进 Git 不现实）。因此应用启动时要检查数据库是否可用：
 *   - 可用 → 直接渲染页面
 *   - 不可用 → 展示引导页，让用户选择本机的 poetry_index.db 导入
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { dbOpen, dbStatus, formatSize, type DbStatus } from "../lib/ipc";
import { resetStaticCache } from "../lib/api";

interface DbGateProps {
  children: ReactNode;
}

export default function DbGate({ children }: DbGateProps) {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** 查询数据库状态 */
  const refresh = useCallback(async () => {
    try {
      setStatus(await dbStatus());
    } catch (err) {
      setMessage(`无法与后端通信：${String(err)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 让用户挑选一个 poetry_index.db 并导入 */
  const handleImport = useCallback(async () => {
    setMessage(null);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: "选择 poetry_index.db",
        filters: [{ name: "SQLite 数据库", extensions: ["db", "sqlite", "sqlite3"] }],
      });
      if (typeof picked !== "string") return; // 用户取消

      setBusy(true);
      const next = await dbOpen(picked);
      // 切换数据库后清空静态数据缓存（朝代/标签/词牌/诗人），避免沿用到上一个库的数据
      if (next.ready) resetStaticCache();
      setStatus(next);
      setMessage(next.ready ? "导入成功" : next.error ?? "导入失败");
    } catch (err) {
      setMessage(`导入失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  // 首次状态未知：显示一个安静的空屏，避免闪烁
  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <p className="text-sm opacity-60">正在检查诗词数据库…</p>
      </div>
    );
  }

  if (status.ready) {
    // key 让数据库切换后所有页面重新取数
    return <div key={status.path ?? "ready"}>{children}</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 text-[var(--foreground)]">
      <div className="w-full max-w-xl rounded-2xl border border-black/10 bg-white/70 p-8 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
        <h1 className="text-xl font-semibold">需要导入诗词数据库</h1>
        <p className="mt-3 text-sm leading-relaxed opacity-80">
          诗词数据存放在单个 SQLite 文件 <code className="rounded bg-black/5 px-1">poetry_index.db</code>
          （约 216&nbsp;MB）中。安装包体积原因，仓库里只放了占位文件；首次运行需要你指定这个数据库文件。
        </p>

        <ul className="mt-4 space-y-1 text-xs opacity-70">
          <li>
            当前状态：{status.error ? status.error : "未找到数据库"}
            {status.size !== null && status.size > 0 ? `（文件大小 ${formatSize(status.size)}）` : ""}
          </li>
          {status.path ? <li>检测路径：{status.path}</li> : null}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={busy}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "导入中…" : "选择数据库文件"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-lg border border-black/15 px-4 py-2 text-sm disabled:opacity-50 dark:border-white/20"
          >
            重新检测
          </button>
        </div>

        {message ? <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">{message}</p> : null}

        <p className="mt-6 text-xs leading-relaxed opacity-60">
          数据库可从项目仓库的 Release 附件下载（<code className="rounded bg-black/5 px-1">poetry_index.db</code>
          ），或由 chinese-poetry-site 项目的 <code className="rounded bg-black/5 px-1">scripts/seed_db.ts</code> 生成。
        </p>
      </div>
    </div>
  );
}
