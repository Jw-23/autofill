// options/modules/settings.js
import { VaultStorage } from './storage.js';
import { i18n, currentLang, updateLanguageUI } from './i18n.js';
import { showPrompt, checkAndDownloadAI } from './ui.js';
import { renderList } from './vault.js';

export async function initSettings() {
  const debugToggle = document.getElementById('debug-toggle');
  debugToggle.checked = await VaultStorage.getDebugSetting();
  
  debugToggle.onchange = async () => {
    await VaultStorage.setDebugSetting(debugToggle.checked);
  };

  const floatingPromptToggle = document.getElementById('floating-prompt-toggle');
  floatingPromptToggle.checked = await VaultStorage.getFloatingPromptSetting();
  floatingPromptToggle.onchange = async () => {
    await VaultStorage.setFloatingPromptSetting(floatingPromptToggle.checked);
  };

  const oneByOneToggle = document.getElementById('one-by-one-toggle');
  const clusterToggle = document.getElementById('cluster-toggle');

  oneByOneToggle.checked = await VaultStorage.getOneByOneSetting();
  clusterToggle.checked = await VaultStorage.getClusterSetting();

  // Enforce mutual exclusion on load
  if (oneByOneToggle.checked && clusterToggle.checked) {
    // Prefer One-by-One mode, disable Cluster
    clusterToggle.checked = false;
    await VaultStorage.setClusterSetting(false);
  }

  oneByOneToggle.onchange = async () => {
    await VaultStorage.setOneByOneSetting(oneByOneToggle.checked);
    if (oneByOneToggle.checked && clusterToggle.checked) {
      clusterToggle.checked = false;
      await VaultStorage.setClusterSetting(false);
    }
  };
  clusterToggle.onchange = async () => {
    await VaultStorage.setClusterSetting(clusterToggle.checked);
    if (clusterToggle.checked && oneByOneToggle.checked) {
      oneByOneToggle.checked = false;
      await VaultStorage.setOneByOneSetting(false);
    }
  };

  const langToggle = document.getElementById('lang-toggle');
  langToggle.onclick = async () => {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    await VaultStorage.setLanguage(nextLang);
    await updateLanguageUI(renderList);
  };

  // --- AI Settings Logic (New) ---
  const aiSettings = await VaultStorage.getAISettings();
  const providerRadios = document.getElementsByName('ai-provider');
  const localSection = document.getElementById('ai-local-options');
  const remoteSection = document.getElementById('ai-remote-options');
  
  const apiUrlInput = document.getElementById('api-url');
  const apiKeyInput = document.getElementById('api-key');
  const apiModelSelect = document.getElementById('api-model');
  const saveAiBtn = document.getElementById('save-ai-settings');
  const fetchModelsBtn = document.getElementById('fetch-models-btn');
  const fetchStatus = document.getElementById('fetch-status');

  // Load Initial Values
  for (const radio of providerRadios) {
    if (radio.value === aiSettings.provider) radio.checked = true;
    radio.onchange = () => toggleAISections(radio.value);
  }
  apiUrlInput.value = aiSettings.apiUrl;
  apiKeyInput.value = aiSettings.apiKey;
  
  // Try to load cached models for this API URL
  try {
      const cachedModels = await VaultStorage.getCachedModels(aiSettings.apiUrl);
      if (cachedModels && cachedModels.length > 0) {
          apiModelSelect.innerHTML = '';
          cachedModels.forEach(mId => {
              const opt = document.createElement('option');
              opt.value = mId;
              opt.text = mId;
              apiModelSelect.appendChild(opt);
          });
      }
  } catch (e) { console.warn('Failed to load cached models', e); }

  // Custom model might not be in the default list (or cached list), add it if needed
  if (![...apiModelSelect.options].some(o => o.value === aiSettings.model)) {
      const opt = document.createElement('option');
      opt.value = aiSettings.model;
      opt.text = aiSettings.model;
      apiModelSelect.add(opt);
  }
  apiModelSelect.value = aiSettings.model;

  toggleAISections(aiSettings.provider);

  function toggleAISections(provider) {
    if (provider === 'local') {
      localSection.style.display = 'block';
      remoteSection.style.display = 'none';
      checkAndDownloadAI(); // Check status when switching to local
    } else {
      localSection.style.display = 'none';
      remoteSection.style.display = 'block';
    }
  }

  saveAiBtn.onclick = async () => {
    const provider = document.querySelector('input[name="ai-provider"]:checked').value;
    await VaultStorage.setAISettings({
      provider,
      apiUrl: apiUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: apiModelSelect.value
    });
    
    const msg = currentLang === 'zh' ? 'AI 设置已保存' : 'AI Settings Saved';
    saveAiBtn.textContent = msg;
    saveAiBtn.style.backgroundColor = '#1aa260';
    setTimeout(() => {
        saveAiBtn.textContent = i18n[currentLang].saveAiSettings;
        saveAiBtn.style.backgroundColor = '';
    }, 2000);
  };

  fetchModelsBtn.onclick = async () => {
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiUrl || !apiKey) {
      fetchStatus.textContent = i18n[currentLang].enterKeyUrl;
      fetchStatus.style.color = 'red';
      return;
    }

    fetchStatus.textContent = currentLang === 'zh' ? '正在获取...' : 'Fetching...';
    fetchStatus.style.color = '#666';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'fetch-models',
        apiUrl,
        apiKey
      });

      if (response && response.error) {
        throw new Error(response.error);
      }

      if (response && response.models) {
        // Clear and populate select
        apiModelSelect.innerHTML = '';
        const sortedModels = response.models.sort((a,b) => a.id.localeCompare(b.id));
        
        sortedModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.text = m.id;
          apiModelSelect.appendChild(opt);
        });
        
        // Select logic: try to keep current, else valid default, else first
        if (sortedModels.some(m => m.id === aiSettings.model)) {
            apiModelSelect.value = aiSettings.model;
        } else if (sortedModels.some(m => m.id === 'gpt-3.5-turbo')) {
            apiModelSelect.value = 'gpt-3.5-turbo';
        }

        // --- Persistence of Fetched Models ---
        // Save just the IDs (or simplified objects) to cache keyed by API URL
        const simpleModelList = sortedModels.map(m => m.id);
        await VaultStorage.setCachedModels(apiUrl, simpleModelList);

        fetchStatus.textContent = `${i18n[currentLang].fetchSuccess} (${sortedModels.length})`;
        fetchStatus.style.color = 'green';
      }
    } catch (e) {
      fetchStatus.textContent = `${i18n[currentLang].fetchError}: ${e.message}`;
      fetchStatus.style.color = 'red';
    }
  };

  // Data Management Logic
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');

  exportBtn.onclick = async () => {
    try {
      const jsonStr = await VaultStorage.exportPersonalInfo();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `autofill-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(i18n[currentLang].exportFailed + e.message);
    }
  };

  importBtn.onclick = () => {
    importFile.click();
  };

  importFile.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target.result;
      try {
        try {
          await VaultStorage.importPersonalInfo(content);
        } catch (err) {
          if (err.message && err.message.includes('NEEDS_PASSWORD')) {
            const isEnc = await VaultStorage.isEncryptionEnabled();
            const promptTitle = isEnc ? i18n[currentLang].unlockBtn : i18n[currentLang].importBtn;
            const promptMsg = isEnc ? i18n[currentLang].unlockToImport : i18n[currentLang].importPassReq;
            
            // Adjust OK button text based on context
            const okText = isEnc ? i18n[currentLang].unlockBtn : i18n[currentLang].confirmBtn;
            
            const pass = await showPrompt(promptTitle, promptMsg, okText);
            if (pass) {
              await VaultStorage.importPersonalInfo(content, pass);
            } else {
              return;
            }
          } else if (err.message && err.message.includes('INVALID_VAULT_PASSWORD')) {
            alert(i18n[currentLang].invalidPass);
            return;
          } else {
            throw err;
          }
        }
        alert(i18n[currentLang].importSuccess);
        renderList();
      } catch (err) {
        alert(i18n[currentLang].importFailed + err.message);
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  };

  // Format Help Toggle
  const helpToggle = document.getElementById('format-help-toggle');
  const helpContent = document.getElementById('format-help-content');
  const helpIcon = document.getElementById('format-help-icon');
  if (helpToggle) {
    helpToggle.onclick = () => {
      const isVisible = helpContent.style.display === 'block';
      helpContent.style.display = isVisible ? 'none' : 'block';
      helpIcon.innerText = isVisible ? '▶' : '▼';
    };
  }

  // Security UI Logic
  const securityBtn = document.getElementById('security-btn');
  const securityModal = document.getElementById('security-modal');
  const encryptionBtn = document.getElementById('enable-encryption');

  securityBtn.onclick = async () => {
    const isEnc = await VaultStorage.isEncryptionEnabled();
    const statusText = document.getElementById('security-status');
    const setPassArea = document.getElementById('set-pass-area');
    
    statusText.innerText = isEnc ? i18n[currentLang].securityStatusOn : i18n[currentLang].securityStatusOff;
    setPassArea.style.display = isEnc ? 'none' : 'block';
    securityModal.style.display = 'block';
  };

  document.getElementById('close-security').onclick = () => {
    securityModal.style.display = 'none';
  };

  encryptionBtn.onclick = async () => {
    const pass = document.getElementById('new-master-pass').value;
    const confirmPass = document.getElementById('confirm-master-pass').value;
    
    if (!pass) return alert(i18n[currentLang].passReq);
    if (pass !== confirmPass) return alert(i18n[currentLang].passMatchError);
    
    if (confirm(i18n[currentLang].enableConfirm)) {
      const oldData = await VaultStorage.getPersonalInfo();
      await VaultStorage.setupEncryption(pass);
      await VaultStorage.savePersonalInfo(oldData);
      chrome.storage.local.remove('personalInfo');
      alert(i18n[currentLang].encDone);
      securityModal.style.display = 'none';
      renderList();
    }
  };

  document.getElementById('factory-reset').onclick = async () => {
    if (confirm(i18n[currentLang].resetConfirm)) {
      await new Promise(r => chrome.storage.local.clear(r));
      VaultStorage.lock();
      alert('All categories and security settings have been reset.');
      location.reload();
    }
  };

  // Sidebar Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');
  const sidebar = document.getElementById('sidebar');
  const menuToggle = document.getElementById('menu-toggle');

  navItems.forEach(item => {
    item.onclick = async () => {
      const targetSection = item.getAttribute('data-section');
      
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      sections.forEach(sec => {
        sec.classList.remove('active');
        if (sec.id === targetSection) {
          sec.classList.add('active');
        }
      });

      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
      }

      if (targetSection === 'settings') {
        const isEnc = await VaultStorage.isEncryptionEnabled();
        const statusText = document.getElementById('security-status-display');
        if (statusText) {
          statusText.innerText = isEnc ? i18n[currentLang].securityStatusOn : i18n[currentLang].securityStatusOff;
        }
      }
    };
  });

  menuToggle.onclick = () => {
    sidebar.classList.toggle('open');
  };

  const isEnc = await VaultStorage.isEncryptionEnabled();
  const statusText = document.getElementById('security-status-display');
  if (statusText) {
    statusText.innerText = isEnc ? i18n[currentLang].securityStatusOn : i18n[currentLang].securityStatusOff;
  }

  const checkAiBtn = document.getElementById('check-ai-btn');
  if (checkAiBtn) {
    checkAiBtn.onclick = () => checkAndDownloadAI(true);
  }
}
