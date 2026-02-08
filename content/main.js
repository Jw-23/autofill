// content/main.js

const MainController = {
  isProcessing: false,
  abortController: null,

  async init() {
    console.log('AI Autofill: Initialized');
    // Listen for messages from background script (ContextMenu)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "run-autofill") {
        this.runAutofill();
      }
    });
  },

  async runAutofill() {
    if (this.isProcessing) {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isProcessing = false;
      console.log('AI Autofill: Stop signal sent.');
      return;
    }

    this.isProcessing = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const isDebug = await StorageManager.getDebugSetting();
    const lang = await StorageManager.getLanguage();
    const whitelist = await StorageManager.getWhitelist();
    const currentHost = window.location.hostname;

    const isDomainWhitelisted = (host, list) => {
      return list.some(pattern => {
        const regex = new RegExp('^' + pattern.split('.').map(part => part === '*' ? '.*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\.') + '$');
        return regex.test(host);
      });
    };

    const isWhitelisted = isDomainWhitelisted(currentHost, whitelist);
    
    const showPasswordModal = () => {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
          position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: '10000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'sans-serif'
        });

        const modal = document.createElement('div');
        Object.assign(modal.style, {
          background: 'white', padding: '24px', borderRadius: '8px',
          width: '320px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        });

        const title = document.createElement('h3');
        title.innerText = lang === 'zh' ? '安全验证' : 'Security Verification';
        title.style.marginTop = '0';

        const desc = document.createElement('p');
        desc.innerText = lang === 'zh' ? '请输入主密码以解锁数据：' : 'Enter master password to unlock vault:';
        desc.style.fontSize = '14px';

        const input = document.createElement('input');
        input.type = 'password';
        Object.assign(input.style, {
          width: '100%', padding: '8px', boxSizing: 'border-box',
          marginBottom: '16px', border: '1px solid #ccc', borderRadius: '4px'
        });

        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px' });

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = lang === 'zh' ? '取消' : 'Cancel';
        const confirmBtn = document.createElement('button');
        confirmBtn.innerText = lang === 'zh' ? '确认' : 'Unlock';
        Object.assign(confirmBtn.style, { backgroundColor: '#4285f4', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' });
        Object.assign(cancelBtn.style, { backgroundColor: '#eee', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' });

        btnRow.append(cancelBtn, confirmBtn);
        modal.append(title, desc, input, btnRow);
        overlay.append(modal);
        document.body.append(overlay);
        input.focus();

        const cleanup = () => { overlay.remove(); };
        confirmBtn.onclick = () => { resolve(input.value); cleanup(); };
        cancelBtn.onclick = () => { resolve(null); cleanup(); };
        input.onkeydown = (e) => {
          if (e.key === 'Enter') confirmBtn.click();
          if (e.key === 'Escape') cancelBtn.click();
        };
      });
    };

    const messages = {
      zh: '请先在扩展选项中配置个人信息。',
      en: 'Please configure your personal information in the extension options first.'
    };

    if (isDebug) console.log('AI Autofill: Starting...');
    
    try {
      // Check for encryption and unlock if needed
      const isEncrypted = await StorageManager.isEncryptionEnabled();
      if (isEncrypted) {
        const password = await showPasswordModal();
        if (!password) {
          this.isProcessing = false;
          return;
        }
        await StorageManager.unlock(password);
      }

      const personalInfo = await StorageManager.getPersonalInfo();
      if (personalInfo.length === 0) {
        alert(messages[lang]);
        return;
      }

      const inputs = InputDetector.getVisibleInputs();
      if (isDebug) console.log(`AI Autofill: 发现 ${inputs.length} 个输入框`);

      // Prepare batch for AI
      const fieldBatch = inputs.map((input, index) => ({
        id: index,
        context: InputDetector.getInputContext(input)
      }));

      if (isDebug) console.log('AI Autofill: Sending batch to AI...', fieldBatch);

      const matches = await AIManager.identifyFieldsBatch(fieldBatch, personalInfo);
      
      if (isDebug) console.log('AI Autofill: AI matched fields:', matches);

      for (const match of matches) {
        if (signal.aborted) return;
        
        if (match.matchedKey) {
          const input = inputs[match.inputId];
          const infoItem = personalInfo.find(i => i.keyname === match.matchedKey);
          
          if (input && infoItem) {
            let valueToFill = infoItem.value;

            // Check for high sensitivity confirmation and whitelisting
            if (infoItem.isSecret) {
              if (isWhitelisted) {
                // Whitelisted: Ask for confirmation before filling real data
                const confirmMsg = lang === 'zh' 
                  ? `检测到高敏感字段：${infoItem.keyname}\n描述：${infoItem.description || '无'}\n确定要填写此项吗？`
                  : `High sensitivity field detected: ${infoItem.keyname}\nDescription: ${infoItem.description || 'None'}\nDo you want to autofill this field?`;
                
                if (!confirm(confirmMsg)) {
                  if (isDebug) console.log(`AI Autofill: 用户拒绝填写高敏感字段 ${match.matchedKey}`);
                  continue;
                }
                valueToFill = infoItem.value;
              } else {
                // Not whitelisted: Fill fake value
                if (isDebug) console.log(`AI Autofill: Site not whitelisted. Filling fake value for ${match.matchedKey}`);
                valueToFill = infoItem.fakeValue || '••••••••';
              }
            }

            if (isDebug) console.log(`AI Autofill: Filling Input ${match.inputId} with ${match.matchedKey}`);
            InputFiller.fill(input, valueToFill);
            input.style.backgroundColor = '#e8f0fe';
          }
        }
      }
    } catch (e) {
      if (!signal.aborted && isDebug) {
        console.error('AI Autofill error:', e);
      }
      if (e.message.includes('password')) {
        alert(e.message);
      }
    } finally {
      StorageManager.lock(); // Securely wipe the Data Key from memory
      this.isProcessing = false;
      this.abortController = null;
      if (isDebug) console.log('AI Autofill: Process finished or stopped.');
    }
  }
};

// Start the controller
MainController.init();
