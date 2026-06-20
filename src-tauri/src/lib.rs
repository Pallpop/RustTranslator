mod clipboard;
mod glossary;
mod translator;

use std::sync::{Arc, Mutex};
use tauri::Manager;

use clipboard::ClipboardManager;
use glossary::*;
use translator::*;

pub struct AppState {
    pub glossary: Mutex<GlossaryManager>,
    pub clipboard: Arc<ClipboardManager>,
}

#[tauri::command]
async fn translate(
    state: tauri::State<'_, AppState>,
    text: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("文本不能为空".to_string());
    }
    let result = translator::translate_text(&text).await?;
    state.clipboard.write_to_clipboard(&result.translation)?;

    let record_id = state.glossary.lock().unwrap().add_record(&text, &result.translation);

    if !result.terms.is_empty() {
        let refs: Vec<(&str, &str)> = result.terms.iter().map(|(s, t)| (s.as_str(), t.as_str())).collect();
        state.glossary.lock().unwrap().add_terms(&refs, record_id);
    }

    Ok(result.translation)
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map(|t| t.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_projects(state: tauri::State<AppState>) -> Vec<TranslationProject> {
    state.glossary.lock().unwrap().all_projects()
}

#[tauri::command]
fn get_current_project(state: tauri::State<AppState>) -> Option<TranslationProject> {
    state.glossary.lock().unwrap().current_project().cloned()
}

#[tauri::command]
fn create_project(state: tauri::State<AppState>, name: String) -> TranslationProject {
    state.glossary.lock().unwrap().create_project(&name)
}

#[tauri::command]
fn select_project(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.glossary.lock().unwrap().select_project(&id)
}

#[tauri::command]
fn delete_project(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.glossary.lock().unwrap().delete_project(&id)
}

#[tauri::command]
fn rename_project(state: tauri::State<AppState>, id: String, name: String) -> Result<(), String> {
    state.glossary.lock().unwrap().rename_project(&id, &name)
}

#[tauri::command]
fn update_project_prompt(state: tauri::State<AppState>, id: String, prompt: String) -> Result<(), String> {
    state.glossary.lock().unwrap().update_project_prompt(&id, &prompt)
}

#[tauri::command]
fn get_glossary(state: tauri::State<AppState>) -> Vec<GlossaryEntry> {
    state.glossary.lock().unwrap().all_entries()
}

#[tauri::command]
fn add_term(state: tauri::State<AppState>, source: String, target: String) {
    state.glossary.lock().unwrap().add_terms(&[(&source, &target)], None);
}

#[tauri::command]
fn delete_terms(state: tauri::State<AppState>, ids: Vec<String>) {
    let uuids: Vec<uuid::Uuid> = ids.iter().filter_map(|id| uuid::Uuid::parse_str(id).ok()).collect();
    state.glossary.lock().unwrap().delete_entries(&uuids);
}

#[tauri::command]
fn export_glossary(state: tauri::State<AppState>) -> String {
    state.glossary.lock().unwrap().export_terms_as_json()
}

#[tauri::command]
fn get_records(state: tauri::State<AppState>) -> Vec<TranslationRecord> {
    state.glossary.lock().unwrap().all_records()
}

#[tauri::command]
fn get_settings() -> TranslatorSettings {
    TranslatorSettings::load()
}

#[tauri::command]
fn update_settings(settings: TranslatorSettings) {
    settings.save();
}

#[tauri::command]
async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    translator::fetch_models_async(&base_url, &api_key).await
}

#[tauri::command]
fn get_translation_history(state: tauri::State<AppState>) -> Vec<TranslationRecord> {
    state.glossary.lock().unwrap().all_records()
}

#[tauri::command]
fn save_explanation(state: tauri::State<AppState>, id: String, explanation: String) {
    state.glossary.lock().unwrap().save_explanation(&id, &explanation);
}

#[tauri::command]
fn update_term_target(state: tauri::State<AppState>, id: String, target: String) {
    state.glossary.lock().unwrap().update_term_target(&id, &target);
}

#[tauri::command]
async fn fetch_term_explanation(source: String, target: String) -> Result<String, String> {
    let config = TranslatorSettings::load();
    if config.api_key.is_empty() {
        return Err("请先在设置中填写 API Key".to_string());
    }

    let project_prompt = GlossaryManager::load_current_project_prompt();
    let domain_hint = if project_prompt.trim().is_empty() {
        String::new()
    } else {
        format!("\n领域：{}", project_prompt)
    };

    let prompt = format!(
        "用中文简要解释专业术语「{}」（{}），50字以内，一句话说明含义。{}",
        source, target, domain_hint
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/v1/chat/completions", config.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": config.model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 256
    });

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let resp_json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    if let Some(error) = resp_json.get("error") {
        let msg = error.get("message").and_then(|m| m.as_str()).unwrap_or("未知错误");
        return Err(format!("API 错误: {}", msg));
    }

    let result = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("解释获取失败")
        .trim()
        .to_string();

    Ok(result)
}

pub fn run() {
    let clipboard = Arc::new(ClipboardManager);

    let app_state = AppState {
        glossary: Mutex::new(GlossaryManager::new()),
        clipboard: clipboard.clone(),
    };

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            translate,
            read_clipboard,
            get_projects,
            get_current_project,
            create_project,
            select_project,
            delete_project,
            rename_project,
            update_project_prompt,
            get_glossary,
            add_term,
            delete_terms,
            export_glossary,
            get_records,
            get_settings,
            update_settings,
            fetch_models,
            get_translation_history,
            fetch_term_explanation,
            save_explanation,
            update_term_target,
        ]);

    builder = builder.setup(move |app| {
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};

        let icon = app.default_window_icon().cloned().unwrap();

        let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
        let pin_item = MenuItem::with_id(app, "pin", "置顶窗口", true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show_item, &pin_item, &quit_item])?;

        let _tray = TrayIconBuilder::new()
            .icon(icon)
            .icon_as_template(true)
            .tooltip("RustTranslator")
            .menu(&menu)
            .on_menu_event(move |app, event| {
                match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "pin" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let current = window.is_always_on_top().unwrap_or(false);
                            let _ = window.set_always_on_top(!current);
                            let new_state = !current;
                            let label = if new_state { "✓ 置顶窗口" } else { "置顶窗口" };
                            pin_item.set_text(label).ok();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                }
            })
            .on_tray_icon_event(|tray_icon, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray_icon.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })
            .build(app)?;

        let handle = app.handle().clone();
        if let Some(window) = app.get_webview_window("main") {
            let w = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w.hide();
                }
            });
        }

        // Register global shortcut: Cmd+Shift+T (macOS) / Ctrl+Shift+T (Windows)
        let shortcut_handle = handle.clone();
        use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

        #[cfg(target_os = "macos")]
        let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyT);
        #[cfg(not(target_os = "macos"))]
        let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyT);

        app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                use tauri::Emitter;
                let _ = shortcut_handle.emit("translate-shortcut", ());
            }
        })?;

        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
