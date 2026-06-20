pub struct ClipboardManager;

impl ClipboardManager {
    pub fn write_to_clipboard(&self, text: &str) -> Result<(), String> {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(text).map_err(|e| e.to_string())?;
        Ok(())
    }
}
