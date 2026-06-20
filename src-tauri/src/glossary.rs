use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlossaryEntry {
    pub id: String,
    pub source: String,
    pub target: String,
    pub record_id: Option<String>,
    pub explanation: Option<String>,
}

impl GlossaryEntry {
    pub fn new(source: &str, target: &str, record_id: Option<Uuid>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            source: source.to_string(),
            target: target.to_string(),
            record_id: record_id.map(|id| id.to_string()),
            explanation: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationRecord {
    pub id: String,
    pub original: String,
    pub translated: String,
    pub timestamp: String,
}

impl TranslationRecord {
    pub fn new(original: &str, translated: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            original: original.to_string(),
            translated: translated.to_string(),
            timestamp: chrono_now(),
        }
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    format!("{}", secs)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationProject {
    pub id: String,
    pub name: String,
    pub custom_prompt: String,
}

impl TranslationProject {
    pub fn new(name: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            custom_prompt: String::new(),
        }
    }
}

pub struct GlossaryManager {
    projects: Vec<TranslationProject>,
    current_project_id: Option<String>,
    entries: Vec<GlossaryEntry>,
    records: Vec<TranslationRecord>,
}

impl GlossaryManager {
    pub fn new() -> Self {
        let mut manager = Self {
            projects: Vec::new(),
            current_project_id: None,
            entries: Vec::new(),
            records: Vec::new(),
        };
        manager.load_projects();
        manager.ensure_default_project();
        manager
    }

    fn root_dir() -> PathBuf {
        let dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("RustTranslator");
        fs::create_dir_all(&dir).ok();
        dir
    }

    fn projects_file() -> PathBuf {
        Self::root_dir().join("projects.json")
    }

    fn current_project_id_file() -> PathBuf {
        Self::root_dir().join("current_project.txt")
    }

    fn save_current_project_id(&self) {
        if let Some(id) = &self.current_project_id {
            fs::write(Self::current_project_id_file(), id).ok();
        }
    }

    fn read_current_project_id_from_disk() -> Option<String> {
        fs::read_to_string(Self::current_project_id_file())
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    /// Load glossary text directly from disk for the currently selected project
    pub fn load_glossary_text(max_terms: usize) -> String {
        let projects: Vec<TranslationProject> = {
            let path = Self::projects_file();
            fs::read_to_string(&path)
                .ok()
                .and_then(|d| serde_json::from_str(&d).ok())
                .unwrap_or_default()
        };
        let project = if let Some(current_id) = Self::read_current_project_id_from_disk() {
            projects.iter().find(|p| p.id == current_id)
                .or_else(|| projects.first())
        } else {
            projects.first()
        };
        let project = match project {
            Some(p) => p,
            None => return String::new(),
        };
        let path = Self::project_dir(&project.id).join("glossary.json");
        let entries: Vec<GlossaryEntry> = fs::read_to_string(&path)
            .ok()
            .and_then(|d| serde_json::from_str(&d).ok())
            .unwrap_or_default();
        if entries.is_empty() {
            return String::new();
        }
        let entries = if max_terms > 0 && entries.len() > max_terms {
            &entries[entries.len() - max_terms..]
        } else {
            &entries
        };
        let lines: Vec<String> = entries.iter()
            .map(|e| format!("- {} → {}", e.source, e.target))
            .collect();
        format!("术语表：\n{}", lines.join("\n"))
    }

    /// Load current project's custom prompt directly from disk
    pub fn load_current_project_prompt() -> String {
        let projects: Vec<TranslationProject> = {
            let path = Self::projects_file();
            fs::read_to_string(&path)
                .ok()
                .and_then(|d| serde_json::from_str(&d).ok())
                .unwrap_or_default()
        };
        let project = if let Some(current_id) = Self::read_current_project_id_from_disk() {
            projects.iter().find(|p| p.id == current_id)
                .or_else(|| projects.first())
        } else {
            projects.first()
        };
        project
            .map(|p| p.custom_prompt.clone())
            .unwrap_or_default()
    }

    fn project_dir(id: &str) -> PathBuf {
        let dir = Self::root_dir().join("projects").join(id);
        fs::create_dir_all(&dir).ok();
        dir
    }

    fn load_projects(&mut self) {
        let path = Self::projects_file();
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(projects) = serde_json::from_str::<Vec<TranslationProject>>(&data) {
                self.projects = projects;
            }
        }
        if self.projects.is_empty() {
            self.ensure_default_project();
        }
    }

    fn save_projects(&self) {
        if let Ok(data) = serde_json::to_string_pretty(&self.projects) {
            fs::write(Self::projects_file(), data).ok();
        }
    }

    fn ensure_default_project(&mut self) {
        if !self.projects.iter().any(|p| p.name == "默认项目") {
            let project = TranslationProject::new("默认项目");
            self.projects.insert(0, project);
            self.save_projects();
        }
        if self.current_project_id.is_none() {
            self.current_project_id = self.projects.first().map(|p| p.id.clone());
            self.load_entries();
            self.load_records();
            self.save_current_project_id();
        }
    }

    pub fn all_projects(&self) -> Vec<TranslationProject> {
        self.projects.clone()
    }

    pub fn current_project(&self) -> Option<&TranslationProject> {
        let id = self.current_project_id.as_ref()?;
        self.projects.iter().find(|p| &p.id == id)
    }

    pub fn select_project(&mut self, id: &str) -> Result<(), String> {
        if !self.projects.iter().any(|p| p.id == id) {
            return Err("项目不存在".to_string());
        }
        self.save_entries();
        self.save_records();
        self.current_project_id = Some(id.to_string());
        self.load_entries();
        self.load_records();
        self.save_current_project_id();
        Ok(())
    }

    pub fn create_project(&mut self, name: &str) -> TranslationProject {
        let project = TranslationProject::new(name);
        self.projects.push(project.clone());
        self.save_projects();
        self.select_project(&project.id).ok();
        project
    }

    pub fn delete_project(&mut self, id: &str) -> Result<(), String> {
        let idx = self.projects.iter().position(|p| p.id == id)
            .ok_or("项目不存在")?;
        self.projects.remove(idx);

        let dir = Self::root_dir().join("projects").join(id);
        fs::remove_dir_all(&dir).ok();

        self.save_projects();

        if self.current_project_id.as_deref() == Some(id) {
            self.current_project_id = self.projects.first().map(|p| p.id.clone());
            self.load_entries();
            self.load_records();
        }
        Ok(())
    }

    pub fn rename_project(&mut self, id: &str, name: &str) -> Result<(), String> {
        let project = self.projects.iter_mut().find(|p| p.id == id)
            .ok_or("项目不存在")?;
        project.name = name.to_string();
        self.save_projects();
        Ok(())
    }

    pub fn update_project_prompt(&mut self, id: &str, prompt: &str) -> Result<(), String> {
        let project = self.projects.iter_mut().find(|p| p.id == id)
            .ok_or("项目不存在")?;
        project.custom_prompt = prompt.to_string();
        self.save_projects();
        Ok(())
    }

    fn load_entries(&mut self) {
        self.entries.clear();
        if let Some(id) = &self.current_project_id {
            let path = Self::project_dir(id).join("glossary.json");
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(entries) = serde_json::from_str::<Vec<GlossaryEntry>>(&data) {
                    self.entries = entries;
                }
            }
        }
    }

    fn save_entries(&self) {
        if let Some(id) = &self.current_project_id {
            let path = Self::project_dir(id).join("glossary.json");
            if let Ok(data) = serde_json::to_string_pretty(&self.entries) {
                fs::write(&path, data).ok();
            }
        }
    }

    fn load_records(&mut self) {
        self.records.clear();
        if let Some(id) = &self.current_project_id {
            let path = Self::project_dir(id).join("records.json");
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(records) = serde_json::from_str::<Vec<TranslationRecord>>(&data) {
                    self.records = records;
                }
            }
        }
    }

    fn save_records(&self) {
        if let Some(id) = &self.current_project_id {
            let path = Self::project_dir(id).join("records.json");
            if let Ok(data) = serde_json::to_string_pretty(&self.records) {
                fs::write(&path, data).ok();
            }
        }
    }

    pub fn all_entries(&self) -> Vec<GlossaryEntry> {
        self.entries.clone()
    }

    pub fn all_records(&self) -> Vec<TranslationRecord> {
        self.records.clone()
    }

    pub fn add_terms(&mut self, terms: &[(&str, &str)], record_id: Option<Uuid>) {
        let existing: std::collections::HashSet<String> = self
            .entries
            .iter()
            .map(|e| e.source.to_lowercase())
            .collect();

        let mut added = false;
        for (source, target) in terms {
            if !existing.contains(&source.to_lowercase()) {
                self.entries.push(GlossaryEntry::new(source, target, record_id));
                added = true;
            }
        }
        if added {
            self.save_entries();
        }
    }

    pub fn delete_entries(&mut self, ids: &[Uuid]) {
        let id_strs: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
        self.entries.retain(|e| !id_strs.contains(&e.id));
        self.save_entries();
    }

    pub fn export_terms_as_json(&self) -> String {
        let items: Vec<serde_json::Value> = self
            .entries
            .iter()
            .map(|e| {
                let mut item = serde_json::json!({
                    "source": e.source,
                    "target": e.target
                });
                if let Some(ref explanation) = e.explanation {
                    item["explanation"] = serde_json::Value::String(explanation.clone());
                }
                item
            })
            .collect();
        serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn save_explanation(&mut self, entry_id: &str, explanation: &str) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.id == entry_id) {
            entry.explanation = Some(explanation.to_string());
            self.save_entries();
        }
    }

    pub fn update_term_target(&mut self, entry_id: &str, target: &str) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.id == entry_id) {
            entry.target = target.to_string();
            self.save_entries();
        }
    }

    pub fn add_record(&mut self, original: &str, translated: &str) -> Option<Uuid> {
        let record = TranslationRecord::new(original, translated);
        let id = Uuid::parse_str(&record.id).ok();
        self.records.insert(0, record);
        self.save_records();
        id
    }

    pub fn find_record(&self, id: &str) -> Option<&TranslationRecord> {
        self.records.iter().find(|r| r.id == id)
    }

    pub fn is_current_project_default(&self) -> bool {
        self.current_project()
            .map(|p| p.name == "默认项目")
            .unwrap_or(true)
    }

    pub fn glossary_text(&self, max_terms: usize) -> String {
        if self.entries.is_empty() {
            return String::new();
        }
        let entries = if max_terms > 0 {
            let start = if self.entries.len() > max_terms {
                self.entries.len() - max_terms
            } else {
                0
            };
            &self.entries[start..]
        } else {
            &self.entries
        };
        let lines: Vec<String> = entries
            .iter()
            .map(|e| format!("- {} → {}", e.source, e.target))
            .collect();
        format!("术语表：\n{}", lines.join("\n"))
    }
}
