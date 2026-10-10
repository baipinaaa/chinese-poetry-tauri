/**
 * 数据层：只读打开 SQLite 单库 + 通用只读查询桥。
 *
 * 设计取舍：把 SQL 全部留在前端（TypeScript）侧，Rust 只做「打开 / 校验 / 执行只读 SQL / 行转 JSON」四件事。
 * 原因：本地无 Rust 编译条件，Rust 代码越少、越不含业务逻辑，CI 上编译失败的风险越低；
 * 同时 BLOB（gzip 压缩的段落文本）以 base64 传给前端，由前端用 DecompressionStream 解压。
 */

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{Map, Number, Value};
use tauri::{AppHandle, Manager};

/// 全局数据库连接（只读；同一时刻仅一个库）
pub struct DbState(pub Mutex<Option<Connection>>);

impl DbState {
    pub fn new() -> Self {
        DbState(Mutex::new(None))
    }
}

impl Default for DbState {
    fn default() -> Self {
        Self::new()
    }
}

/// 数据库状态，供前端判断是否需要引导用户导入
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub ready: bool,
    pub path: Option<String>,
    /// 文件字节数
    pub size: Option<u64>,
    /// poems 表行数（用于自检与展示）
    pub poems: Option<i64>,
    pub error: Option<String>,
}

impl DbStatus {
    pub fn missing() -> Self {
        DbStatus {
            ready: false,
            path: None,
            size: None,
            poems: None,
            error: None,
        }
    }
}

/// 以只读方式打开数据库并做结构校验（必须含 poems 表）
pub fn open_readonly(path: &Path) -> Result<Connection, String> {
    if !path.is_file() {
        return Err(format!("文件不存在：{}", path.display()));
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("打开数据库失败：{e}"))?;
    // 只读连接的读优化：文件内存映射 + 更大的页缓存 + 排序/临时表放内存。
    // 库接近 500MB，默认 2MB 页缓存会让列表页反复读盘；PRAGMA 失败也不致命，忽略错误。
    let _ = conn.execute_batch(
        "PRAGMA mmap_size = 268435456; PRAGMA cache_size = -60000; PRAGMA temp_store = MEMORY;",
    );
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'poems'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("校验数据库失败：{e}"))?;
    if tables == 0 {
        return Err("该文件不是诗词数据库（缺少 poems 表）".to_string());
    }
    Ok(conn)
}

/// 组装状态（已打开连接时）
pub fn status_of(conn: &Connection, path: Option<String>) -> DbStatus {
    // 不用 count(*)：47 万行全表计数实测 465ms，正好落在「双击图标后到界面可用」的
    // 关键路径上（本地库无删行，MAX(rowid) 即总数，实测 ~1ms）。
    let poems = conn
        .query_row("SELECT COALESCE(MAX(rowid), 0) FROM poems", [], |row| {
            row.get::<_, i64>(0)
        })
        .ok();
    let size = path.as_ref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len());
    DbStatus {
        ready: true,
        path,
        size,
        poems,
        error: None,
    }
}

/// 候选数据库路径，按优先级解析
pub fn candidate_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    // 1) 之前导入过的路径
    if let Some(saved) = load_saved_path(app) {
        out.push(PathBuf::from(saved));
    }

    // 2) 环境变量（开发调试用）
    if let Ok(env_path) = std::env::var("POETRY_DB") {
        let trimmed = env_path.trim();
        if !trimmed.is_empty() {
            out.push(PathBuf::from(trimmed));
        }
    }

    // 3) 随包分发的内置数据库（CI 打包时放入 resources/）
    if let Ok(res_dir) = app.path().resource_dir() {
        out.push(res_dir.join("resources").join("poetry_index.db"));
        out.push(res_dir.join("poetry_index.db"));
    }

    // 4) 应用数据目录（用户手工放入）
    if let Ok(data_dir) = app.path().app_data_dir() {
        out.push(data_dir.join("poetry_index.db"));
        out.push(data_dir.join("data").join("poetry_index.db"));
    }

    out
}

/// 尝试按候选顺序打开数据库；返回 (连接, 路径)
pub fn open_first_available(app: &AppHandle) -> Result<(Connection, String), String> {
    let mut last_err: Option<String> = None;
    let mut tried: Vec<String> = Vec::new();
    for path in candidate_paths(app) {
        if !path.is_file() {
            continue;
        }
        tried.push(path.display().to_string());
        match open_readonly(&path) {
            Ok(conn) => return Ok((conn, path.display().to_string())),
            Err(e) => last_err = Some(e),
        }
    }
    Err(match last_err {
        Some(e) => e,
        None => {
            if tried.is_empty() {
                "尚未导入诗词数据库，请点击「导入数据库」选择 poetry_index.db".to_string()
            } else {
                format!("候选数据库均不可用：{}", tried.join(" , "))
            }
        }
    })
}

/// 保存/读取「已导入数据库路径」（app_data_dir/config.json）
fn config_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("config.json"))
}

pub fn load_saved_path(app: &AppHandle) -> Option<String> {
    let file = config_file(app)?;
    let raw = std::fs::read_to_string(file).ok()?;
    let json: Value = serde_json::from_str(&raw).ok()?;
    json.get("dbPath")?.as_str().map(|s| s.to_string())
}

pub fn save_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let file = config_file(app).ok_or_else(|| "无法定位应用数据目录".to_string())?;
    let mut obj = match std::fs::read_to_string(&file).ok().and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    obj.insert("dbPath".to_string(), Value::String(path.to_string()));
    obj.insert(
        "updatedAt".to_string(),
        Value::String(chrono_like_now()),
    );
    std::fs::write(&file, serde_json::to_string_pretty(&Value::Object(obj)).unwrap_or_default())
        .map_err(|e| format!("保存配置失败：{e}"))
}

/// 极简时间戳（避免引入 chrono 依赖）
fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

/// 执行只读查询，返回行数组（行 = { 列名: 值 }；BLOB 转为 {"$b64": "..."}）
pub fn query(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Value>, String> {
    let head: String = sql
        .trim_start()
        .chars()
        .take(8)
        .collect::<String>()
        .to_lowercase();
    if !(head.starts_with("select") || head.starts_with("with")) {
        return Err("只允许只读查询（SELECT / WITH）".to_string());
    }

    let mut stmt = conn.prepare(sql).map_err(|e| format!("SQL 解析失败：{e}"))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let args: Vec<rusqlite::types::Value> = params.iter().map(json_to_sql).collect();

    let mut rows = stmt
        .query(rusqlite::params_from_iter(args))
        .map_err(|e| format!("查询执行失败：{e}"))?;

    let mut out: Vec<Value> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("读取结果失败：{e}"))? {
        let mut obj = Map::new();
        for (i, name) in names.iter().enumerate() {
            let cell = row.get_ref(i).map_err(|e| format!("读取列 {name} 失败：{e}"))?;
            obj.insert(name.clone(), sql_to_json(cell));
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}

fn json_to_sql(value: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as SqlValue;
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => SqlValue::Null,
    }
}

fn sql_to_json(cell: ValueRef<'_>) -> Value {
    match cell {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(Number::from(i)),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => {
            let mut map = Map::new();
            map.insert("$b64".to_string(), Value::String(B64.encode(bytes)));
            Value::Object(map)
        }
    }
}
