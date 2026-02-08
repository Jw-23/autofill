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
      return;
    }

    this.isProcessing = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const isDebug = await StorageManager.getDebugSetting();
    if (isDebug) console.log('MainController: runAutofill triggered. isDebug:', isDebug);
    
    const oneByOne = await StorageManager.getOneByOneSetting();
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
    
    const createOverlay = () => {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
        backgroundColor: 'rgba(0,0,0,0.5)', zIndex: '10000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'sans-serif'
      });
      return overlay;
    };

    const customAlert = (titleText, bodyText) => {
      return new Promise((resolve) => {
        const overlay = createOverlay();
        const modal = document.createElement('div');
        Object.assign(modal.style, {
          background: 'white', padding: '24px', borderRadius: '8px', 
          width: '320px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        });
        modal.innerHTML = `
          <h3 style="margin-top:0;">${titleText}</h3>
          <p style="font-size:14px; color:#555;">${bodyText}</p>
          <div style="display:flex; justify-content:flex-end; margin-top:20px;">
            <button style="padding:8px 16px; background:#4285f4; color:white; border:none; border-radius:4px; cursor:pointer;">OK</button>
          </div>
        `;
        overlay.append(modal);
        document.body.append(overlay);
        modal.querySelector('button').onclick = () => { overlay.remove(); resolve(); };
      });
    };

    const customConfirm = (titleText, bodyText) => {
      return new Promise((resolve) => {
        const overlay = createOverlay();
        const modal = document.createElement('div');
        Object.assign(modal.style, {
          background: 'white', padding: '24px', borderRadius: '8px',
          width: '350px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        });
        modal.innerHTML = `
          <h3 style="margin-top:0;">${titleText}</h3>
          <p style="font-size:14px; line-height:1.5; color:#555;">${bodyText}</p>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
            <button id="modal-cancel" style="padding:8px 16px; border:none; border-radius:4px; background:#eee; cursor:pointer;">${lang === 'zh' ? '取消' : 'Cancel'}</button>
            <button id="modal-confirm" style="padding:8px 16px; border:none; border-radius:4px; background:#4285f4; color:white; cursor:pointer;">${lang === 'zh' ? '确定' : 'Confirm'}</button>
          </div>
        `;
        overlay.append(modal);
        document.body.append(overlay);
        const cleanup = () => overlay.remove();
        overlay.querySelector('#modal-cancel').onclick = () => { cleanup(); resolve(false); };
        overlay.querySelector('#modal-confirm').onclick = () => { cleanup(); resolve(true); };
      });
    };

    const showPasswordModal = () => {
      return new Promise((resolve) => {
        const overlay = createOverlay();
        const modal = document.createElement('div');
        Object.assign(modal.style, {
          background: 'white', padding: '24px', borderRadius: '8px',
          width: '320px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        });
        modal.innerHTML = `
          <h3 style="margin-top:0;">${lang === 'zh' ? '安全验证' : 'Security Verification'}</h3>
          <p style="font-size:14px;">${lang === 'zh' ? '请输入主密码以解锁数据：' : 'Enter master password to unlock vault:'}</p>
          <input type="password" id="modal-pass" style="width:100%; padding:8px; box-sizing:border-box; margin-bottom:16px; border:1px solid #ccc; border-radius:4px;">
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button id="modal-cancel" style="padding:8px 16px; border:none; border-radius:4px; background:#eee; cursor:pointer;">${lang === 'zh' ? '取消' : 'Cancel'}</button>
            <button id="modal-confirm" style="padding:8px 16px; border:none; border-radius:4px; background:#4285f4; color:white; border:none; border-radius:4px; cursor:pointer;">${lang === 'zh' ? '确认' : 'Unlock'}</button>
          </div>
        `;
        overlay.append(modal);
        document.body.append(overlay);
        const input = overlay.querySelector('#modal-pass');
        input.focus();
        const cleanup = () => overlay.remove();
        overlay.querySelector('#modal-confirm').onclick = () => { resolve(input.value); cleanup(); };
        overlay.querySelector('#modal-cancel').onclick = () => { resolve(null); cleanup(); };
        input.onkeydown = (e) => {
          if (e.key === 'Enter') overlay.querySelector('#modal-confirm').click();
          if (e.key === 'Escape') overlay.querySelector('#modal-cancel').click();
        };
      });
    };

    const showLoading = () => {
      const overlay = createOverlay();
      overlay.innerHTML = `
        <div style="background:white; padding:20px; border-radius:8px; display:flex; flex-direction:column; align-items:center; gap:15px;">
          <div style="width:40px; height:40px; border:4px solid #f3f3f3; border-top:4px solid #4285f4; border-radius:50%; animation: spin 1s linear infinite;"></div>
          <span style="font-size:14px; color:#333;">${lang === 'zh' ? 'AI 正在匹配字段...' : 'AI matching fields...'}</span>
        </div>
        <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
      `;
      document.body.append(overlay);
      return overlay;
    };

    const applyHalo = (input) => {
      const originalBoxShadow = input.style.boxShadow;
      const originalTransition = input.style.transition;
      // Faster entry transition for immediate feedback
      input.style.transition = 'box-shadow 0.2s ease-out, background-color 0.2s ease-out';
      input.style.boxShadow = '0 0 15px 5px rgba(66, 133, 244, 0.8)';
      return () => {
        input.style.boxShadow = originalBoxShadow;
        setTimeout(() => {
          input.style.transition = originalTransition;
        }, 300);
      };
    };

    try {
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
      if (isDebug) console.log('MainController: Personal info retrieved:', personalInfo.length, 'items');

      if (personalInfo.length === 0) {
        const msg = lang === 'zh' ? '请先在扩展选项中配置个人信息。' : 'Please configure your personal information in the extension options first.';
        await customAlert(lang === 'zh' ? '提示' : 'Tip', msg);
        this.isProcessing = false;
        return;
      }

      const inputs = InputDetector.getVisibleInputs();
      if (isDebug) console.log('MainController: Visible inputs found:', inputs.length);

      if (inputs.length === 0) {
        this.isProcessing = false;
        return;
      }

      const executeFill = async (input, matchedKey) => {
        const infoItem = personalInfo.find(i => i.keyname === matchedKey);
        if (!infoItem) return;

        let valueToFill = infoItem.value;
        if (infoItem.isSecret) {
          if (isWhitelisted) {
            const title = lang === 'zh' ? '敏感字段确认' : 'Sensitive Field';
            const body = lang === 'zh' 
              ? `检测到高敏感字段：<b>${infoItem.keyname}</b><br>描述：${infoItem.description || '无'}<br><br>页面：${currentHost}<br>确定要填写此项吗？`
              : `High sensitivity field: <b>${infoItem.keyname}</b><br>Description: ${infoItem.description || 'None'}<br><br>Site: ${currentHost}<br>Fill this field?`;
            if (!(await customConfirm(title, body))) return;
          } else {
            valueToFill = infoItem.fakeValue || '••••••••';
          }
        }
        
        if (isDebug) console.log(`MainController: Filling ${matchedKey}`);
        InputFiller.fill(input, valueToFill);
        input.style.backgroundColor = '#e8f0fe';
      };

      if (oneByOne) {
        if (isDebug) console.log('MainController: One-by-One mode started');
        for (let i = 0; i < inputs.length; i++) {
          if (signal.aborted) break;
          const input = inputs[i];
          const removeHalo = applyHalo(input); // Halo starts for scanning
          
          try {
            await new Promise(r => setTimeout(r, 150)); // Ensure user sees where it scans
            const context = InputDetector.getInputContext(input);
            const [match] = await AIManager.identifyFieldsBatch([{ id: i, context }], personalInfo, isDebug);
            
            if (match?.matchedKey) {
              await executeFill(input, match.matchedKey);
              await new Promise(r => setTimeout(r, 400)); // Stay lit after filling
            } else {
              await new Promise(r => setTimeout(r, 200)); // Brief pause even if no match
            }
          } finally {
            removeHalo();
            // Wait for the halo to fade out before moving to the next one
            await new Promise(r => setTimeout(r, 250));
          }
        }
      } else {
        const loadingOverlay = showLoading();
        try {
          const fieldBatch = inputs.map((input, index) => ({ id: index, context: InputDetector.getInputContext(input) }));
          const matches = await AIManager.identifyFieldsBatch(fieldBatch, personalInfo, isDebug);
          
          for (const match of matches) {
            if (signal.aborted) break;
            if (match.matchedKey) {
              const input = inputs[match.inputId];
              const removeHalo = applyHalo(input); // Visual feedback for batch filling
              await executeFill(input, match.matchedKey);
              await new Promise(r => setTimeout(r, 400));
              removeHalo();
            }
          }
        } finally {
          loadingOverlay.remove();
        }
      }
    } catch (e) {
      if (!signal.aborted) {
        const title = lang === 'zh' ? '错误' : 'Error';
        await customAlert(title, e.message);
      }
    } finally {
      StorageManager.lock();
      this.isProcessing = false;
      this.abortController = null;
    }
  }
};

// Start the controller
MainController.init();
