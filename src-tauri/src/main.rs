// 诗词桌面版（Tauri v2）
// 数据层见 db.rs：只读打开 SQLite，SQL 由前端提供（见 src/lib/db-client.ts）。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{DbState, DbStatus};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

/// 查询数据库状态；未打开时按候选路径自动尝试打开（配置 → 环境变量 → 内置资源 → 应用数据目录）
#[tauri::command]
fn db_status(app: AppHandle, state: State<'_, DbState>) -> DbStatus {
    {
        let guard = state.0.lock().unwrap();
        if let Some(conn) = guard.as_ref() {
            let saved = db::load_saved_path(&app);
            return db::status_of(conn, saved);
        }
    }

    match db::open_first_available(&app) {
        Ok((conn, path)) => {
            let status = db::status_of(&conn, Some(path.clone()));
            let mut guard = state.0.lock().unwrap();
            *guard = Some(conn);
            // 内置资源/自动发现到的路径也记录一下，便于下次直接命中
            if db::load_saved_path(&app).as_deref() != Some(path.as_str()) {
                let _ = db::save_path(&app, &path);
            }
            status
        }
        Err(error) => DbStatus {
            ready: false,
            path: None,
            size: None,
            poems: None,
            error: Some(error),
        },
    }
}

/// 打开指定路径的数据库（用户通过文件对话框导入），成功后记录路径供下次启动使用
#[tauri::command]
fn db_open(app: AppHandle, state: State<'_, DbState>, path: String) -> Result<DbStatus, String> {
    let conn = db::open_readonly(std::path::Path::new(&path))?;
    let status = db::status_of(&conn, Some(path.clone()));
    {
        let mut guard = state.0.lock().unwrap();
        *guard = Some(conn);
    }
    db::save_path(&app, &path)?;
    Ok(status)
}

/// 关闭当前数据库连接
#[tauri::command]
fn db_close(state: State<'_, DbState>) -> DbStatus {
    let mut guard = state.0.lock().unwrap();
    *guard = None;
    DbStatus::missing()
}

/// 执行只读 SQL（前端数据层唯一入口）
#[tauri::command]
fn db_query(
    state: State<'_, DbState>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<Vec<Value>, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or_else(|| "数据库未打开".to_string())?;
    db::query(conn, &sql, params.as_deref().unwrap_or(&[]))
}

/// 应用数据目录（前端「打开所在文件夹」等展示用）
#[tauri::command]
fn app_data_dir(app: AppHandle) -> Option<String> {
    app.path().app_data_dir().ok().map(|p| p.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState::new())
        .setup(|app| {
            // 预热：窗口刚创建就在后台线程把库开好（含一次 poems 计数，让 OS 页缓存先热）。
            // 前端首屏的 db_status / 统计查询要么直接命中这个连接，要么只需等这把锁，
            // 省掉「打开库文件 + 首次读 B-tree 页」这段耗时。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Ok((conn, path)) = db::open_first_available(&handle) {
                    let _ = db::query(&conn, "SELECT count(*) AS c FROM poems", &[]);
                    let saved = db::load_saved_path(&handle);
                    {
                        let state = handle.state::<DbState>();
                        let mut guard = state.0.lock().unwrap();
                        if guard.is_none() {
                            *guard = Some(conn);
                        }
                    }
                    // 自动发现的路径也记一笔，下次启动能直接命中
                    if saved.as_deref() != Some(path.as_str()) {
                        let _ = db::save_path(&handle, &path);
                    }
                } else {
                    // 预热失败不阻塞启动，前端会自行重试；留一行日志便于排障
                    eprintln!("[db] 后台预热打开数据库失败，交给前端重试");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_status,
            db_open,
            db_close,
            db_query,
            app_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
