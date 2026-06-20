let invoke, listen;

let currentProject = null;
let projects = [];
let glossary = [];
let records = [];
let latestTranslation = null;
let isTranslating = false;
let latestRecordId = null;
let newTermIds = new Set();
let glossaryViewed = false;
let glossaryCollapsed = false;
let deleteTargetId = null;
let modelFetchTimer = null;
let selectedTermIds = new Set();
let lastClickedTermId = null;
let expandedTermId = null;
let loadingExplanationId = null;
let editingEntryId = null;
let editingExplanationId = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (window.__TAURI__ && window.__TAURI__.core) {
        invoke = window.__TAURI__.core.invoke;
        listen = window.__TAURI__.event.listen;
    }
    if (window.__TAURI__ && window.__TAURI__.window) {
        try {
            const win = window.__TAURI__.window.getCurrentWindow();
            await win.show();
        } catch(e) {}
    }

    bindEvents();
    await loadProjects();
    await loadSettings();
    setupClipboardListener();
});

function bindEvents() {
    document.getElementById('settingsBtn').addEventListener('click', showSettings);
    document.getElementById('editPromptBtn').addEventListener('click', showPromptEditor);
    document.getElementById('newProjectBtn').addEventListener('click', showNewProjectDialog);
    document.getElementById('cancelBtn').addEventListener('click', cancelTranslate);
    document.getElementById('copyOriginalBtn').addEventListener('click', () => copyText('original'));
    document.getElementById('copyTranslatedBtn').addEventListener('click', () => copyText('translated'));
    document.getElementById('glossaryHeader').addEventListener('click', toggleGlossary);
    document.getElementById('addTermBtn').addEventListener('click', (e) => { e.stopPropagation(); showAddTermDialog(); });
    document.getElementById('exportBtn').addEventListener('click', (e) => { e.stopPropagation(); exportGlossary(); });
    document.getElementById('selectAllBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleSelectAll(); });
    document.getElementById('batchDeleteBtn').addEventListener('click', (e) => { e.stopPropagation(); batchDeleteTerms(); });

    document.getElementById('settingsBackdrop').addEventListener('click', hideSettings);
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
    document.getElementById('settingsApiKey').addEventListener('input', debounceFetchModels);
    document.getElementById('settingsBaseUrl').addEventListener('input', debounceFetchModels);

    document.getElementById('newProjectBackdrop').addEventListener('click', hideNewProjectDialog);
    document.getElementById('cancelNewProjectBtn').addEventListener('click', hideNewProjectDialog);
    document.getElementById('confirmNewProjectBtn').addEventListener('click', createProject);
    document.getElementById('newProjectName').addEventListener('keydown', (e) => { if (e.key === 'Enter') createProject(); });

    document.getElementById('renameBackdrop').addEventListener('click', hideRenameDialog);
    document.getElementById('cancelRenameBtn').addEventListener('click', hideRenameDialog);
    document.getElementById('confirmRenameBtn').addEventListener('click', renameProject);
    document.getElementById('renameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') renameProject(); });

    document.getElementById('promptBackdrop').addEventListener('click', hidePromptEditor);
    document.getElementById('cancelPromptBtn').addEventListener('click', hidePromptEditor);
    document.getElementById('savePromptBtn').addEventListener('click', savePrompt);

    document.getElementById('addTermBackdrop').addEventListener('click', hideAddTermDialog);
    document.getElementById('cancelAddTermBtn').addEventListener('click', hideAddTermDialog);
    document.getElementById('confirmAddTermBtn').addEventListener('click', addTerm);

    document.getElementById('deleteBackdrop').addEventListener('click', hideDeleteDialog);
    document.getElementById('cancelDeleteBtn').addEventListener('click', hideDeleteDialog);
    document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDeleteProject);

    document.getElementById('projectMenuBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('projectDropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
        document.getElementById('projectDropdown').classList.add('hidden');
    });
}

function setupClipboardListener() {
    if (!listen) return;
    // Listen for Ctrl+Shift+T global shortcut
    listen('translate-shortcut', async () => {
        if (isTranslating) return;
        try {
            const text = await invoke('read_clipboard');
            if (text && text.trim()) {
                startTranslation(text);
            }
        } catch (e) {
            console.error('Failed to read clipboard:', e);
        }
    });
}

async function loadProjects() {
    if (!invoke) return;
    try {
        projects = await invoke('get_projects');
        currentProject = await invoke('get_current_project');
        renderProjectList();
        updateProjectUI();
        await loadGlossary();
        await loadRecords();
    } catch (e) {
        console.error('loadProjects failed:', e);
    }
}

async function loadRecords() {
    if (!invoke) return;
    try {
        records = await invoke('get_records');
    } catch (e) {}
}

function renderProjectList() {
    const list = document.getElementById('projectList');
    list.innerHTML = '';
    projects.forEach(p => {
        const item = document.createElement('div');
        item.className = 'dropdown-item' + (currentProject && p.id === currentProject.id ? ' active' : '');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;

        const actions = document.createElement('div');
        actions.className = 'actions';

        if (p.name !== '默认项目') {
            const renameBtn = document.createElement('button');
            renameBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
            renameBtn.addEventListener('click', (e) => { e.stopPropagation(); showRenameDialog(p); });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'danger';
            deleteBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); showDeleteDialog(p); });

            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);
        }

        item.appendChild(nameSpan);
        item.appendChild(actions);
        item.addEventListener('click', () => selectProject(p.id));
        list.appendChild(item);
    });
}

function updateProjectUI() {
    if (currentProject) {
        document.getElementById('currentProjectName').textContent = currentProject.name;
        const isDefault = currentProject.name === '默认项目';
        document.getElementById('editPromptBtn').style.display = isDefault ? 'none' : '';
    }
}

async function selectProject(id) {
    if (!invoke) return;
    await invoke('select_project', { id });
    document.getElementById('projectDropdown').classList.add('hidden');
    latestTranslation = null;
    isTranslating = false;
    newTermIds.clear();
    editingEntryId = null;
    editingExplanationId = null;
    expandedTermId = null;
    showView('empty');
    await loadProjects();
}

async function loadGlossary() {
    if (!invoke) return;
    glossary = await invoke('get_glossary');
    records = await invoke('get_records');
    selectedTermIds.clear();
    expandedTermId = null;
    renderGlossary();
    updateBatchActions();
    const isDefault = currentProject && currentProject.name === '默认项目';
    document.getElementById('glossarySection').style.display = isDefault ? 'none' : '';
}

function renderGlossary() {
    const list = document.getElementById('glossaryList');
    const count = document.getElementById('glossaryCount');
    count.textContent = glossary.length;
    list.innerHTML = '';
    if (glossary.length === 0) {
        list.innerHTML = '<div class="glossary-empty">翻译时自动提取专业术语</div>';
        return;
    }
    glossary.forEach(entry => {
        const item = document.createElement('div');
        const isNew = glossaryViewed && newTermIds.has(entry.id);
        const isSelected = selectedTermIds.has(entry.id);
        item.className = 'glossary-item' + (isSelected ? ' selected' : '') + (isNew ? ' new-term' : '');
        item.id = 'glossary-item-' + entry.id;

        // Click to toggle selection (supports Shift+click for range)
        item.addEventListener('click', (e) => {
            if (e.target.closest('.item-actions') || e.target.closest('.copy-btn') || e.target.closest('.glossary-checkbox') || e.target.closest('.edit-input') || e.target.closest('.text-btn')) return;

            // Mark new term as seen
            if (newTermIds.has(entry.id)) {
                newTermIds.delete(entry.id);
            }

            if (e.shiftKey && lastClickedTermId !== null) {
                // Range select
                const ids = glossary.map(g => g.id);
                const start = ids.indexOf(lastClickedTermId);
                const end = ids.indexOf(entry.id);
                if (start !== -1 && end !== -1) {
                    const [from, to] = start < end ? [start, end] : [end, start];
                    for (let i = from; i <= to; i++) {
                        selectedTermIds.add(ids[i]);
                    }
                }
            } else if (isSelected) {
                selectedTermIds.delete(entry.id);
            } else {
                selectedTermIds.add(entry.id);
            }
            lastClickedTermId = entry.id;
            updateBatchActions();
            renderGlossary();
        });

        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'glossary-checkbox';
        checkbox.checked = isSelected;
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedTermIds.has(entry.id)) {
                selectedTermIds.delete(entry.id);
            } else {
                selectedTermIds.add(entry.id);
            }
            updateBatchActions();
            renderGlossary();
        });

        const content = document.createElement('div');
        content.className = 'glossary-content';

        if (editingEntryId === entry.id) {
            // Edit mode: show input + save/cancel
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'edit-input';
            input.value = entry.target;
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') saveEdit(entry, input);
                if (e.key === 'Escape') cancelEdit();
            });

            const saveBtn = document.createElement('button');
            saveBtn.className = 'text-btn';
            saveBtn.textContent = '保存';
            saveBtn.style.marginTop = '4px';
            saveBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); saveEdit(entry, input); });

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'text-btn';
            cancelBtn.textContent = '取消';
            cancelBtn.style.marginTop = '4px';
            cancelBtn.style.marginLeft = '4px';
            cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); cancelEdit(); });

            const sourceLine = document.createElement('div');
            sourceLine.className = 'term-source';
            sourceLine.textContent = entry.source;

            const sourceRow = document.createElement('div');
            sourceRow.className = 'term-row';
            sourceRow.appendChild(sourceLine);

            const editRow = document.createElement('div');
            editRow.style.marginTop = '8px';
            editRow.appendChild(input);

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.gap = '4px';
            btnRow.style.marginTop = '4px';
            btnRow.appendChild(saveBtn);
            btnRow.appendChild(cancelBtn);
            editRow.appendChild(btnRow);

            content.appendChild(sourceRow);
            content.appendChild(editRow);
        } else {
            const sourceLine = document.createElement('div');
            sourceLine.className = 'term-source';
            sourceLine.textContent = entry.source;

            const copySourceBtn = document.createElement('button');
            copySourceBtn.className = 'copy-btn';
            copySourceBtn.title = '复制';
            copySourceBtn.innerHTML = COPY_ICON_SVG;
            copySourceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(entry.source);
                flashCopyBtn(copySourceBtn);
            });

            const targetLine = document.createElement('div');
            targetLine.className = 'term-target';
            targetLine.textContent = entry.target;

            const sourceRow = document.createElement('div');
            sourceRow.className = 'term-row';
            sourceRow.appendChild(sourceLine);
            sourceRow.appendChild(copySourceBtn);

            const targetRow = document.createElement('div');
            targetRow.className = 'term-row';
            targetRow.appendChild(targetLine);

            content.appendChild(sourceRow);
            content.appendChild(targetRow);
        }

        item.appendChild(checkbox);
        item.appendChild(content);

        // Action buttons (hidden during edit mode)
        if (editingEntryId !== entry.id) {
            const actions = document.createElement('div');
            actions.className = 'item-actions';

            // Edit target button
            const editTargetBtn = document.createElement('button');
            editTargetBtn.className = 'action-btn';
            editTargetBtn.title = '编辑';
            editTargetBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
            editTargetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                editingEntryId = entry.id;
                renderGlossary();
                scrollToEntry(entry.id);
            });
            actions.appendChild(editTargetBtn);

            // Toggle source + explanation panel
            const detailBtn = document.createElement('button');
            detailBtn.className = 'action-btn';
            detailBtn.title = '查看来源和解释';
            detailBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
            detailBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSourcePanel(entry);
            });
            actions.appendChild(detailBtn);

            // Delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'action-btn danger';
            delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteTerm(entry.id);
            });
            actions.appendChild(delBtn);

            item.appendChild(actions);
        }

        // Source + Explanation nested panels (shown together)
        if (expandedTermId === entry.id) {
            const nested = document.createElement('div');
            nested.className = 'term-nested';

            // Explanation block (on top)
            {
                const expBlock = document.createElement('div');
                expBlock.className = 'nested-block';

                if (loadingExplanationId === entry.id) {
                    const hdr = document.createElement('div');
                    hdr.className = 'nested-header';
                    hdr.textContent = '解释';
                    expBlock.appendChild(hdr);
                    const loading = document.createElement('div');
                    loading.className = 'detail-loading';
                    loading.innerHTML = '<div class="spinner tiny"></div> 正在解释...';
                    expBlock.appendChild(loading);
                } else if (editingExplanationId === entry.id) {
                    const hdr = document.createElement('div');
                    hdr.className = 'nested-header';
                    hdr.textContent = '编辑解释';
                    expBlock.appendChild(hdr);

                    const textarea = document.createElement('textarea');
                    textarea.className = 'edit-input';
                    textarea.value = entry.explanation || '';
                    textarea.rows = 3;
                    textarea.style.width = '100%';
                    textarea.style.fontSize = '12px';
                    textarea.style.resize = 'vertical';
                    textarea.addEventListener('click', (e) => e.stopPropagation());
                    textarea.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') cancelExplanationEdit(); });

                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'text-btn';
                    saveBtn.textContent = '保存';
                    saveBtn.style.marginTop = '4px';
                    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); saveExplanationEdit(entry, textarea); });

                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = 'text-btn';
                    cancelBtn.textContent = '取消';
                    cancelBtn.style.marginTop = '4px';
                    cancelBtn.style.marginLeft = '4px';
                    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelExplanationEdit(); });

                    expBlock.appendChild(textarea);
                    const btnRow = document.createElement('div');
                    btnRow.style.display = 'flex';
                    btnRow.style.gap = '4px';
                    btnRow.style.marginTop = '4px';
                    btnRow.appendChild(saveBtn);
                    btnRow.appendChild(cancelBtn);
                    expBlock.appendChild(btnRow);
                } else if (entry.explanation) {
                    const hdr = document.createElement('div');
                    hdr.className = 'nested-header';
                    const hdrText = document.createElement('span');
                    hdrText.textContent = '解释';
                    const editBtn = document.createElement('button');
                    editBtn.className = 'text-btn';
                    editBtn.textContent = '编辑';
                    editBtn.style.fontSize = '11px';
                    editBtn.addEventListener('click', (e) => { e.stopPropagation(); editingExplanationId = entry.id; renderGlossary(); });
                    hdr.appendChild(hdrText);
                    hdr.appendChild(editBtn);

                    const expRow = document.createElement('div');
                    expRow.className = 'nested-row';
                    const expText = document.createElement('span');
                    expText.className = 'nested-text';
                    expText.textContent = entry.explanation;
                    const copyBtn = document.createElement('button');
                    copyBtn.className = 'copy-btn';
                    copyBtn.innerHTML = COPY_ICON_SVG;
                    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.explanation); flashCopyBtn(copyBtn); });
                    expRow.appendChild(expText);
                    expRow.appendChild(copyBtn);

                    expBlock.appendChild(hdr);
                    expBlock.appendChild(expRow);
                } else {
                    const hdr = document.createElement('div');
                    hdr.className = 'nested-header';
                    hdr.textContent = '解释';
                    expBlock.appendChild(hdr);
                    const empty = document.createElement('div');
                    empty.className = 'nested-text';
                    empty.style.color = 'var(--text-secondary)';
                    empty.textContent = '暂无解释';
                    expBlock.appendChild(empty);
                }
                nested.appendChild(expBlock);
            }

            // Divider
            if (entry.record_id) {
                const divider = document.createElement('div');
                divider.className = 'nested-divider';
                nested.appendChild(divider);
            }

            // Source block (below)
            if (entry.record_id) {
                const record = records.find(r => r.id === entry.record_id);
                if (record) {
                    const srcBlock = document.createElement('div');
                    srcBlock.className = 'nested-block';

                    const srcHeader = document.createElement('div');
                    srcHeader.className = 'nested-header';
                    srcHeader.textContent = '来源';

                    const origRow = document.createElement('div');
                    origRow.className = 'nested-row';
                    const origLabel = document.createElement('span');
                    origLabel.className = 'nested-label';
                    origLabel.textContent = '原文';
                    const origText = document.createElement('span');
                    origText.className = 'nested-text';
                    origText.textContent = record.original;
                    const origCopy = document.createElement('button');
                    origCopy.className = 'copy-btn';
                    origCopy.innerHTML = COPY_ICON_SVG;
                    origCopy.title = '复制';
                    origCopy.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard.writeText(record.original); flashCopyBtn(origCopy); });
                    origRow.appendChild(origLabel);
                    origRow.appendChild(origText);
                    origRow.appendChild(origCopy);

                    const transRow = document.createElement('div');
                    transRow.className = 'nested-row';
                    const transLabel = document.createElement('span');
                    transLabel.className = 'nested-label';
                    transLabel.textContent = '译文';
                    const transText = document.createElement('span');
                    transText.className = 'nested-text';
                    transText.textContent = record.translated;
                    const transCopy = document.createElement('button');
                    transCopy.className = 'copy-btn';
                    transCopy.innerHTML = COPY_ICON_SVG;
                    transCopy.title = '复制';
                    transCopy.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard.writeText(record.translated); flashCopyBtn(transCopy); });
                    transRow.appendChild(transLabel);
                    transRow.appendChild(transText);
                    transRow.appendChild(transCopy);

                    srcBlock.appendChild(srcHeader);
                    srcBlock.appendChild(origRow);
                    srcBlock.appendChild(transRow);
                    nested.appendChild(srcBlock);
                }
            }

            item.appendChild(nested);
        }

        list.appendChild(item);
    });
}

function toggleSourcePanel(entry) {
    const wasExpanded = expandedTermId === entry.id;
    expandedTermId = wasExpanded ? null : entry.id;
    editingExplanationId = null;
    newTermIds.delete(entry.id);
    renderGlossary();
    if (!wasExpanded) {
        scrollToEntry(entry.id);
        if (!entry.explanation) fetchExplanationForEntry(entry);
    }
}

function toggleExplanation(entry) {
    const wasExpanded = expandedTermId === entry.id;
    expandedTermId = wasExpanded ? null : entry.id;
    editingExplanationId = null;
    newTermIds.delete(entry.id);
    renderGlossary();
    if (!wasExpanded) {
        scrollToEntry(entry.id);
        if (!entry.explanation) fetchExplanationForEntry(entry);
    }
}

function scrollToEntry(id) {
    const el = document.getElementById('glossary-item-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function fetchExplanationForEntry(entry) {
    loadingExplanationId = entry.id;
    renderGlossary();
    try {
        const explanation = await invoke('fetch_term_explanation', { source: entry.source, target: entry.target });
        entry.explanation = explanation;
        await invoke('save_explanation', { id: entry.id, explanation });
    } catch (e) {
        entry.explanation = '解释获取失败: ' + String(e);
    }
    loadingExplanationId = null;
    renderGlossary();
    scrollToEntry(entry.id);
}

async function saveExplanationEdit(entry, textarea) {
    const newExplanation = textarea.value.trim();
    entry.explanation = newExplanation;
    await invoke('save_explanation', { id: entry.id, explanation: newExplanation });
    editingExplanationId = null;
    renderGlossary();
}

function cancelExplanationEdit() {
    editingExplanationId = null;
    renderGlossary();
}


async function saveEdit(entry, input) {
    const newTarget = input.value.trim();
    if (newTarget && newTarget !== entry.target) {
        entry.target = newTarget;
        await invoke('update_term_target', { id: entry.id, target: newTarget });
    }
    editingEntryId = null;
    renderGlossary();
}

function cancelEdit() {
    editingEntryId = null;
    renderGlossary();
}

function toggleSelectAll() {
    const btn = document.getElementById('selectAllBtn');
    if (selectedTermIds.size === glossary.length) {
        selectedTermIds.clear();
        btn.textContent = '全选';
    } else {
        glossary.forEach(e => selectedTermIds.add(e.id));
        newTermIds.clear();
        btn.textContent = '取消全选';
    }
    updateBatchActions();
    renderGlossary();
}

function updateBatchActions() {
    const batchBtn = document.getElementById('batchDeleteBtn');
    batchBtn.classList.toggle('hidden', selectedTermIds.size === 0);
    const selectAllBtn = document.getElementById('selectAllBtn');
    selectAllBtn.textContent = selectedTermIds.size === glossary.length && glossary.length > 0 ? '取消全选' : '全选';
}

async function batchDeleteTerms() {
    if (!invoke || selectedTermIds.size === 0) return;
    deleteTargetId = null;
    document.getElementById('deleteMessage').textContent = `确定删除选中的 ${selectedTermIds.size} 个术语？`;
    document.getElementById('deleteModal').classList.remove('hidden');
}

function toggleGlossary(e) {
    if (e && e.target.closest('.glossary-actions')) return;
    glossaryCollapsed = !glossaryCollapsed;
    document.getElementById('glossaryBody').classList.toggle('collapsed', glossaryCollapsed);
    document.getElementById('glossaryChevron').parentElement.classList.toggle('collapsed', glossaryCollapsed);
}

async function startTranslation(text) {
    if (isTranslating || !invoke) return;
    isTranslating = true;
    latestTranslation = null;
    showView('translating');
    document.getElementById('translatingOriginal').textContent = text;
    try {
        const result = await invoke('translate', { text });
        isTranslating = false;
        latestTranslation = { original: text, translated: result };
        showView('result');
        document.getElementById('resultOriginal').textContent = text;
        document.getElementById('resultTranslated').textContent = result;
        glossaryViewed = true;
        await loadGlossary();
        await loadRecords();
        if (records.length > 0) {
            latestRecordId = records[0].id;
            newTermIds = new Set(glossary.filter(e => e.record_id === latestRecordId).map(e => e.id));
            renderGlossary();
        }
        showToast('翻译完成，已复制到剪贴板');
    } catch (err) {
        isTranslating = false;
        if (String(err) !== '翻译已取消') {
            latestTranslation = { original: text, translated: String(err) };
            showView('result');
            document.getElementById('resultOriginal').textContent = text;
            document.getElementById('resultTranslated').textContent = String(err);
        } else {
            showView('empty');
        }
    }
}

function cancelTranslate() {
    if (invoke) invoke('cancel_translate');
    isTranslating = false;
    showView('empty');
}

function showView(view) {
    document.getElementById('emptyState').classList.toggle('hidden', view !== 'empty');
    document.getElementById('translatingState').classList.toggle('hidden', view !== 'translating');
    document.getElementById('resultState').classList.toggle('hidden', view !== 'result');
}

async function loadSettings() {
    if (!invoke) return;
    try {
        const settings = await invoke('get_settings');
        document.getElementById('settingsApiKey').value = settings.api_key || '';
        document.getElementById('settingsBaseUrl').value = settings.base_url || 'https://api.openai.com';
        document.getElementById('settingsGlossaryEnabled').checked = settings.glossary_enabled !== false;
        if (settings.api_key) fetchModels();
    } catch (e) { console.error('loadSettings failed:', e); }
}

function showSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
}
function hideSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}
async function saveSettings() {
    if (!invoke) return;
    const settings = {
        api_key: document.getElementById('settingsApiKey').value,
        base_url: document.getElementById('settingsBaseUrl').value,
        model: document.getElementById('settingsModel').value,
        glossary_enabled: document.getElementById('settingsGlossaryEnabled').checked
    };
    await invoke('update_settings', { settings });
    hideSettings();
}

function debounceFetchModels() {
    clearTimeout(modelFetchTimer);
    modelFetchTimer = setTimeout(fetchModels, 500);
}

async function fetchModels() {
    if (!invoke) return;
    const baseUrl = document.getElementById('settingsBaseUrl').value;
    const apiKey = document.getElementById('settingsApiKey').value;
    if (!apiKey) return;
    document.getElementById('modelsLoading').classList.remove('hidden');
    try {
        const models = await invoke('fetch_models', { baseUrl, apiKey });
        const select = document.getElementById('settingsModel');
        const currentModel = select.value;
        select.innerHTML = '';
        if (models.length === 0) {
            const opt = document.createElement('option');
            opt.value = currentModel || 'gpt-4o-mini';
            opt.textContent = currentModel || 'gpt-4o-mini';
            select.appendChild(opt);
        } else {
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                select.appendChild(opt);
            });
            if (models.includes(currentModel)) select.value = currentModel;
        }
    } catch (err) { console.error('Failed to fetch models:', err); }
    finally { document.getElementById('modelsLoading').classList.add('hidden'); }
}

function showNewProjectDialog() {
    document.getElementById('projectDropdown').classList.add('hidden');
    document.getElementById('newProjectModal').classList.remove('hidden');
    document.getElementById('newProjectName').value = '';
    setTimeout(() => document.getElementById('newProjectName').focus(), 100);
}
function hideNewProjectDialog() {
    document.getElementById('newProjectModal').classList.add('hidden');
}
async function createProject() {
    if (!invoke) return;
    const name = document.getElementById('newProjectName').value.trim();
    if (!name) return;
    await invoke('create_project', { name });
    hideNewProjectDialog();
    await loadProjects();
}

function showRenameDialog(project) {
    document.getElementById('projectDropdown').classList.add('hidden');
    deleteTargetId = project.id;
    document.getElementById('renameModal').classList.remove('hidden');
    document.getElementById('renameInput').value = project.name;
    setTimeout(() => document.getElementById('renameInput').focus(), 100);
}
function hideRenameDialog() {
    document.getElementById('renameModal').classList.add('hidden');
    deleteTargetId = null;
}
async function renameProject() {
    if (!invoke) return;
    const name = document.getElementById('renameInput').value.trim();
    if (!name || !deleteTargetId) return;
    await invoke('rename_project', { id: deleteTargetId, name });
    hideRenameDialog();
    await loadProjects();
}

function showDeleteDialog(project) {
    document.getElementById('projectDropdown').classList.add('hidden');
    deleteTargetId = project.id;
    document.getElementById('deleteMessage').textContent = '确定要删除项目「' + project.name + '」吗？此操作不可撤销。';
    document.getElementById('deleteModal').classList.remove('hidden');
}
function hideDeleteDialog() {
    document.getElementById('deleteModal').classList.add('hidden');
    deleteTargetId = null;
}
async function confirmDeleteProject() {
    hideDeleteDialog();
    if (selectedTermIds.size > 0) {
        // Batch delete terms
        const ids = Array.from(selectedTermIds);
        await invoke('delete_terms', { ids });
        selectedTermIds.clear();
        showToast('已删除选中术语');
        await loadGlossary();
    } else if (deleteTargetId) {
        // Delete project
        await invoke('delete_project', { id: deleteTargetId });
        deleteTargetId = null;
        await loadProjects();
    }
}

function showPromptEditor() {
    if (!currentProject) return;
    document.getElementById('promptModal').classList.remove('hidden');
    document.getElementById('promptInput').value = currentProject.custom_prompt || '';
    setTimeout(() => document.getElementById('promptInput').focus(), 100);
}
function hidePromptEditor() {
    document.getElementById('promptModal').classList.add('hidden');
}
async function savePrompt() {
    if (!invoke || !currentProject) return;
    const prompt = document.getElementById('promptInput').value;
    await invoke('update_project_prompt', { id: currentProject.id, prompt });
    hidePromptEditor();
    await loadProjects();
}

function showAddTermDialog() {
    document.getElementById('addTermModal').classList.remove('hidden');
    document.getElementById('termSource').value = '';
    document.getElementById('termTarget').value = '';
    setTimeout(() => document.getElementById('termSource').focus(), 100);
}
function hideAddTermDialog() {
    document.getElementById('addTermModal').classList.add('hidden');
}
async function addTerm() {
    if (!invoke) return;
    const source = document.getElementById('termSource').value.trim();
    const target = document.getElementById('termTarget').value.trim();
    if (!source || !target) return;
    await invoke('add_term', { source, target });
    hideAddTermDialog();
    await loadGlossary();
}
async function deleteTerm(id) {
    if (!invoke) return;
    await invoke('delete_terms', { ids: [id] });
    await loadGlossary();
}
async function exportGlossary() {
    if (!invoke) return;
    const json = await invoke('export_glossary');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (currentProject ? currentProject.name : 'glossary') + '_术语表.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('术语表已导出');
}


const COPY_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

function flashCopyBtn(btn) {
    btn.innerHTML = CHECK_ICON_SVG;
    btn.classList.add('copied');
    clearTimeout(btn._timer);
    btn._timer = setTimeout(() => {
        btn.innerHTML = COPY_ICON_SVG;
        btn.classList.remove('copied');
    }, 2000);
}

function copyText(type) {
    if (!latestTranslation) return;
    const text = type === 'original' ? latestTranslation.original : latestTranslation.translated;
    navigator.clipboard.writeText(text);
    const btn = type === 'original' ? document.getElementById('copyOriginalBtn') : document.getElementById('copyTranslatedBtn');
    flashCopyBtn(btn);
}

function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    clearTimeout(toast._timer);
    toast.classList.remove('show');
    toast.textContent = msg;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('show');
            toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
        });
    });
}
