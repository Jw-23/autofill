// content/main.js

/**
 * MainController: Orchestrates the extension logic on the page.
 * Keeps glue code and event listeners here, delegating UI and Strategy to other modules.
 */
const MainController = {
  isProcessing: false,
  abortController: null,
  floatingPrompt: null,
  lastValueMap: new WeakMap(),

  async init() {
    console.log('AI Autofill: Initialized');

    // Register cross-module references
    AutofillStrategies.executeFill = this.executeFill.bind(this);

    // Listen for context menu triggers
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'run-autofill') this.runAutofill();
    });

    // Handle Floating Prompt Feature
    const enabled = await StorageManager.getFloatingPromptSetting();
    if (enabled) {
      this.floatingPrompt = UIComponents.initFloatingPrompt(
        this.runStreamingFill.bind(this),
        this.handleUndo.bind(this)
      );
      
      // Auto-position on focus
      const handleFocus = (e) => {
        let target = e.target;
        // Handle Shadow DOM and nested elements
        if (e.composedPath) target = e.composedPath()[0] || target;

        const isStandardInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        const editableRoot = target.closest?.('[contenteditable]') || (target.isContentEditable ? target : null);
        
        const effectiveTarget = isStandardInput ? target : editableRoot;

        if (effectiveTarget && effectiveTarget.id !== 'ai-autofill-floating-prompt' && !this.floatingPrompt.box.contains(effectiveTarget)) {
          UIComponents.updateFloatingPromptPosition(this.floatingPrompt, effectiveTarget);
        }
      };

      document.addEventListener('focusin', handleFocus);
      document.addEventListener('click', (e) => {
        // Fallback for elements that already have focus or managed by frameworks
        if (document.activeElement === e.target || e.target.isContentEditable) {
           handleFocus(e);
        }
      });

      // Hide when clicking away
      document.addEventListener('mousedown', (e) => {
        if (this.floatingPrompt && !this.floatingPrompt.box.contains(e.target) && this.floatingPrompt.targetInput !== e.target) {
          this.floatingPrompt.box.style.display = 'none';
        }
      });
    }
  },

  handleUndo(target) {
    if (!target) return;
    const prev = this.lastValueMap.get(target);
    if (prev !== undefined) {
      if (target.isContentEditable) target.innerHTML = prev;
      else target.value = prev;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },

  /**
   * AI-Powered individual field fill (Streaming result into input)
   */
  async runStreamingFill(target, prompt) {
    const aiSettings = await StorageManager.getAISettings();
    if (aiSettings.provider !== 'remote') return alert('请先在设置中配置远程 AI 提供商。');

    // Save for undo
    this.lastValueMap.set(target, target.isContentEditable ? target.innerHTML : target.value);

    const port = chrome.runtime.connect({ name: 'ai-stream' });
    const context = InputDetector.getInputContext(target);
    
    port.postMessage({
      action: 'stream-completion',
      apiUrl: aiSettings.apiUrl,
      apiKey: aiSettings.apiKey,
      model: aiSettings.model,
      userPrompt: prompt,
      systemPrompt: `You are a helpful assistant. User is focusing on "${context}". Output ONLY the content to fill.`
    });

    if (target.isContentEditable) target.innerHTML = '';
    else target.value = ''; 

    return new Promise((resolve) => {
      port.onMessage.addListener((msg) => {
        if (msg.chunk) {
          if (target.isContentEditable) {
            target.innerHTML += msg.chunk;
          } else {
            const start = target.selectionStart, end = target.selectionEnd, val = target.value;
            target.value = val.slice(0, start) + msg.chunk + val.slice(end);
            target.selectionStart = target.selectionEnd = start + msg.chunk.length;
          }
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (msg.done || msg.error) {
          if (msg.error) console.error('Streaming error:', msg.error);
          port.disconnect();
          resolve();
        }
      });
    });
  },

  /**
   * Lower-level fill execution with verification logic for secrets
   */
  async executeFill(input, matchedKey, personalInfo) {
    const infoItem = personalInfo.find(i => i.keyname === matchedKey);
    if (!infoItem) return;

    const lang = await StorageManager.getLanguage();
    const whitelist = await StorageManager.getWhitelist();
    const currentHost = window.location.hostname;
    
    // Whitelist check
    const isWhitelisted = whitelist.some(p => {
      const regex = new RegExp('^' + p.split('.').map(part => part === '*' ? '.*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\.') + '$');
      return regex.test(currentHost);
    });

    let val = infoItem.value;
    if (infoItem.isSecret) {
      if (isWhitelisted) {
        const title = lang === 'zh' ? '敏感字段确认' : 'Sensitive Field';
        const body = lang === 'zh' 
          ? `确定要在 ${currentHost} 填写 ${infoItem.keyname} 吗？`
          : `Fill ${infoItem.keyname} on ${currentHost}?`;
        if (!(await UIComponents.customConfirm(title, body, lang))) return;
      } else {
        val = infoItem.fakeValue || '••••••••';
      }
    }

    InputFiller.fill(input, val);
    input.style.backgroundColor = '#e8f0fe';
  },

  /**
   * Main entry point for full-page autofill
   */
  async runAutofill() {
    if (this.isProcessing) return this.abortController?.abort();

    this.isProcessing = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const lang = await StorageManager.getLanguage();

      // 1. Check encryption
      if (await StorageManager.isEncryptionEnabled()) {
        const pass = await UIComponents.showPasswordModal(lang);
        if (!pass) return;
        await StorageManager.unlock(pass);
      }

      // 2. Gather context
      const info = await StorageManager.getPersonalInfo();
      const inputs = InputDetector.getVisibleInputs();
      
      if (!info.length) {
        return UIComponents.customAlert('Tip', lang === 'zh' ? '请先配置个人信息。' : 'Please configure info.', lang);
      }
      if (!inputs.length) return;

      const isDebug = await StorageManager.getDebugSetting();
      const oneByOne = await StorageManager.getOneByOneSetting();
      const useCluster = await StorageManager.getClusterSetting();

      // 3. Execution
      if (oneByOne) {
        await AutofillStrategies.oneByOne(inputs, info, signal, isDebug);
      } else if (useCluster) {
        await AutofillStrategies.cluster(inputs, info, signal, isDebug);
      } else {
        await AutofillStrategies.batch(inputs, info, signal, isDebug, () => UIComponents.showLoading(lang));
      }
    } catch (e) {
      if (!signal.aborted) UIComponents.customAlert('Error', e.message);
    } finally {
      StorageManager.lock();
      this.isProcessing = false;
    }
  }
};

MainController.init();
