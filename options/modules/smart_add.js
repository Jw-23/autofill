
import { VaultStorage } from './storage.js';
import { i18n, currentLang } from './i18n.js';
import { renderList } from './vault.js';
import { makeDraggable } from './ui.js';

const SCHEMA = {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "keyname": { 
                "type": "string", 
                "description": "Unique alphanumeric key (e.g. 'work_email', 'home_address'). Snake_case preferred. MUST BE ENGLISH." 
            },
            "description": { 
                "type": "string", 
                "description": "Detailed and clear description of what this data is, to help AI match it correctly in forms." 
            },
            "value": { 
                "type": "string", 
                "description": "The actual content/value to be autofilled." 
            },
            "isSecret": { 
                "type": "boolean", 
                "description": "Set to true if this is sensitive data like passwords, IDs, phone numbers, exact addresses." 
            },
            "fakeValue": { 
                "type": ["string", "null"], 
                "description": "A realistic-looking but fake value to use on untrusted sites. Required if isSecret is true." 
            }
          },
          "required": ["keyname", "description", "value", "isSecret", "fakeValue"],
          "additionalProperties": false
        }
      }
    },
    "required": ["items"],
    "additionalProperties": false
};

export function initSmartAdd() {
    const btn = document.getElementById('smart-add-btn');
    const modal = document.getElementById('smart-add-modal');
    const closeBtn = document.getElementById('smart-add-close');
    const submitBtn = document.getElementById('smart-add-submit-btn');
    const clearBtn = document.getElementById('smart-add-clear-btn');
    const applyBtn = document.getElementById('smart-add-apply-btn');
    const previewArea = document.getElementById('smart-add-preview-area');
    const previewList = document.getElementById('smart-add-list');
    const input = document.getElementById('smart-add-input');
    const descP = modal.querySelector('p[data-i18n="smartAddDesc"]');

    // Make modal draggable by its content box
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) makeDraggable(modalContent);

    btn.addEventListener('click', () => {
        // Update I18n dynamically (maintain existing content if any)
        descP.innerText = i18n[currentLang].smartAddDesc || "Describe the data...";
        input.placeholder = i18n[currentLang].smartAddPlaceholder || "E.g. Create a persona...";
        submitBtn.innerText = i18n[currentLang].smartAddGenerate;
        submitBtn.disabled = false;
        
        modal.style.display = 'block';
    });

    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    clearBtn.addEventListener('click', () => {
        previewArea.style.display = 'none';
        previewList.innerHTML = '';
        input.value = '';
        window._smartAddItems = [];
    });
    
    window.addEventListener('click', (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    });

    submitBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;

        const settings = await VaultStorage.getAISettings();
        if (settings.provider !== 'remote' || !settings.apiKey) {
           alert(i18n[currentLang].enterKeyUrl || "Please configure API Key first");
           return;
        }

        submitBtn.disabled = true;
        submitBtn.innerText = i18n[currentLang].smartAddGenerating || "Generating...";
        
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'ai-generate-structured',
                apiUrl: settings.apiUrl,
                apiKey: settings.apiKey,
                model: settings.model || 'gpt-3.5-turbo',
                userPrompt: `Extract or generate personal data items based on this request: "${text}".\nGenerate realistic values if needed (for personas). Keynames MUST be English. Descriptions MUST be detailed.`,
                schemaName: "vault_items",
                schema: SCHEMA
            });

            if (chrome.runtime.lastError) {
                console.error("Runtime Error:", chrome.runtime.lastError);
                alert(`${i18n[currentLang].smartAddError || 'Error'}: ${chrome.runtime.lastError.message}`);
                return;
            }

            if (!response) {
                 console.error("No response received");
                 alert(i18n[currentLang].smartAddError || "No response from AI provider.");
                 return;
            }

            if (response.error) {
                alert(`${i18n[currentLang].smartAddError || 'Error'}: ${response.error}`);
                return;
            }

            let result = response.result;
             // Cleanup markdown
            result = result.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            let parsed;
            try {
                parsed = JSON.parse(result);
            } catch (e) {
                console.error("Parse error", e);
                alert("AI returned invalid JSON.");
                return;
            }

            const items = parsed.items || (Array.isArray(parsed) ? parsed : []);
            
            if (items.length === 0) {
                alert(i18n[currentLang].smartAddNoResult);
                return;
            }
            
            renderPreview(items);

        } catch (e) {
            console.error(e);
            alert("Error: " + e.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = i18n[currentLang].smartAddGenerate;
        }
    });

    applyBtn.addEventListener('click', async () => {
        const checkboxes = previewList.querySelectorAll('input[type="checkbox"]:checked');
        let count = 0;
        
        applyBtn.disabled = true;
        
        for (const cb of checkboxes) {
            const index = parseInt(cb.dataset.index);
            const item = window._smartAddItems[index]; // Temporary storage
            if (item) {
                try {
                    // Check for duplicates handled by addPersonalInfo logic? 
                    // addPersonalInfo overwrites? No, it appends or errors?
                    // Let's check logic: storage.js:114 -> savePersonalInfo -> set.
                    // It pushes to array. It doesn't check uniqueness of keyname implicitly but we should.
                    // Actually addPersonalInfo just gets and pushes.
                    // We should probably check if key exists to avoid duplicates.
                    
                    const existing = await VaultStorage.getPersonalInfo();
                    const exists = existing.find(e => e.keyname === item.keyname);
                    
                    if (exists) {
                       await VaultStorage.updatePersonalInfo(item.keyname, item);
                    } else {
                       await VaultStorage.addPersonalInfo(item);
                    }
                    count++;
                } catch (e) {
                    console.error("Failed to add item", item, e);
                }
            }
        }
        
        await renderList(); // Refresh main table
        modal.style.display = 'none';
        applyBtn.disabled = false;
        alert(`${i18n[currentLang].importSuccess} (${count})`);
    });
}

function renderPreview(items) {
    const previewArea = document.getElementById('smart-add-preview-area');
    const list = document.getElementById('smart-add-list');
    
    // Store globally for the apply click
    window._smartAddItems = items;
    
    list.innerHTML = '';
    
    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.style.cssText = "display: grid; grid-template-columns: 24px 1.5fr 2fr; gap: 12px; align-items: center; border-bottom: 1px solid #eee; padding: 10px 4px;";
        
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = true;
        check.dataset.index = index;
        check.style.cursor = 'pointer';
        
        const keyCol = document.createElement('div');
        keyCol.innerHTML = `
            <div style="font-weight:600; font-size:14px; color:#333; margin-bottom:2px;">${item.keyname}</div>
            <div style="font-size:12px; color:#777; line-height:1.3;">${item.description}</div>
        `;

        const valCol = document.createElement('div');
        valCol.style.textAlign = 'right';
        const displayVal = item.value; // Show full value but allow wrap
        const secretBadge = item.isSecret 
            ? `<span style="display:inline-block; font-size:10px; font-weight:600; color:#c0392b; background:#fadbd8; padding:2px 6px; border-radius:10px; margin-left:6px; text-transform:uppercase;">Secret</span>` 
            : '';
        
        // Value styling
        valCol.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                 <div style="font-family:'SF Mono', Consolas, monospace; font-size:13px; background:#f8f9fa; border:1px solid #e9ecef; padding:4px 8px; border-radius:4px; word-break:break-all; color:#2c3e50; max-width:100%; text-align:left;">${displayVal}</div>
                 `;
        
        if (item.isSecret) {
            valCol.innerHTML += `<div style="margin-top:4px;">${secretBadge}</div>`;
        }
        valCol.innerHTML += `</div>`;

        div.appendChild(check);
        div.appendChild(keyCol);
        div.appendChild(valCol);
        list.appendChild(div);
    });
    
    previewArea.style.display = 'block';
}
