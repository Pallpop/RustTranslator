use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatorSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub glossary_enabled: bool,
}

impl Default for TranslatorSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "https://api.openai.com".to_string(),
            model: "gpt-4o-mini".to_string(),
            glossary_enabled: true,
        }
    }
}

impl TranslatorSettings {
    fn settings_path() -> std::path::PathBuf {
        let dir = dirs::config_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("RustTranslator");
        std::fs::create_dir_all(&dir).ok();
        dir.join("settings.json")
    }

    pub fn load() -> Self {
        let path = Self::settings_path();
        if let Ok(data) = std::fs::read_to_string(&path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self) {
        let path = Self::settings_path();
        if let Ok(data) = serde_json::to_string_pretty(self) {
            std::fs::write(&path, data).ok();
        }
    }
}

pub struct TranslateResult {
    pub translation: String,
    pub terms: Vec<(String, String)>,
}

pub async fn translate_text(text: &str) -> Result<TranslateResult, String> {
    let config = TranslatorSettings::load();
    if config.api_key.is_empty() {
        return Err("请先在设置中填写 API Key".to_string());
    }

    let glossary_text = if config.glossary_enabled {
        crate::glossary::GlossaryManager::load_glossary_text(50)
    } else {
        String::new()
    };

    let project_prompt = crate::glossary::GlossaryManager::load_current_project_prompt();

    let mut system_content = "你是翻译助手，中英双向。英文译中文，中文译英文。保留技术缩写（API、SDK等），保持格式。\n\n你需要同时完成两件事：翻译和提取专业术语。\n请严格返回如下 JSON 格式（不要输出任何其他内容）：\n{\"translation\": \"翻译结果\", \"terms\": [{\"source\": \"英文术语\", \"target\": \"中文译文\"}]}\n其中 terms 只提取该领域相关的专业术语、技术名词、专有名词，无则为空数组。".to_string();

    if !project_prompt.trim().is_empty() {
        system_content.push_str(&format!("\n当前项目领域：{}", project_prompt));
    }

    if !glossary_text.is_empty() {
        system_content.push_str(&format!("\n\n{}", glossary_text));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/v1/chat/completions", config.base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_content},
            {"role": "user", "content": text}
        ],
        "temperature": 0.3,
        "max_tokens": 2048
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
        let msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        return Err(format!("API 错误: {}", msg));
    }

    let content = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    // Try to parse as JSON with both translation and terms
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
        let translation = json["translation"]
            .as_str()
            .unwrap_or(&content)
            .to_string();

        let terms: Vec<(String, String)> = json["terms"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let source = item["source"].as_str()?.to_string();
                        let target = item["target"].as_str()?.to_string();
                        if source.is_empty() || target.is_empty() { None } else { Some((source, target)) }
                    })
                    .collect()
            })
            .unwrap_or_default();

        return Ok(TranslateResult { translation, terms });
    }

    // Fallback: treat entire response as translation, no terms
    Ok(TranslateResult {
        translation: content,
        terms: Vec::new(),
    })
}

pub async fn fetch_models_async(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("无法获取模型列表: {}", e))?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let models = json["data"]
        .as_array()
        .map(|arr| {
            let mut names: Vec<String> = arr
                .iter()
                .filter_map(|item| item["id"].as_str().map(|s| s.to_string()))
                .collect();
            names.sort();
            names
        })
        .unwrap_or_default();

    Ok(models)
}
