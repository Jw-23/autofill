// content/main.js

/**
 * MainController: Orchestrates the extension logic on the page.
 * Keeps glue code and event listeners here, delegating UI and Strategy to other modules.
 */
const MainController = {
  isProcessing: false,
  abortController: null,
  floatingPrompt: null,
  suggestionBox: null,
  lastValueMap: new WeakMap(),
  lastSilentMatchTarget: null,
  isMatchingSet: new WeakSet(), // Lock set for concurrent matching tasks

  async init() {
    // Prevent double initialization
    if (window.__AI_AUTOFILL_INITED__) return;
    window.__AI_AUTOFILL_INITED__ = true;

    console.log('AI Autofill: Initialized');

    // Register cross-module references
    AutofillStrategies.executeFill = this.executeFill.bind(this);

    // Listen for context menu triggers
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'run-autofill') this.runAutofill();
    });

    // Initialize Suggestion Box
    this.suggestionBox = UIComponents.createSuggestionBox((target, val) => {
      InputFiller.fill(target, val);
      target.style.backgroundColor = '#e8f0fe';
    });

    // Handle Floating Prompt Feature
    const enabled = await StorageManager.getFloatingPromptSetting();
    
    // Define handleFocus inside init
    const handleFocus = async (e) => {
      if (!StorageManager._isContextValid()) return;
      
      let target = e.target;
      if (e.composedPath) target = e.composedPath()[0] || target;

      const tag = target.tagName.toUpperCase();
      const isStandardInput = tag === 'INPUT';
      const isTextArea = tag === 'TEXTAREA';
      const editableArea = target.closest?.('[contenteditable]') || (target.isContentEditable ? target : null);
      const isContentEditable = !!editableArea && !isStandardInput && !isTextArea;

      // Ignore events originating from the floating prompt itself
      if (this.floatingPrompt?.box.contains(target)) return;

      // Requirement: Floating Prompt only for Textarea and non-Input ContentEditable
      if (enabled && (isTextArea || isContentEditable)) {
        const effectiveTarget = isTextArea ? target : editableArea;
        if (effectiveTarget.id !== 'ai-autofill-floating-prompt' && !this.floatingPrompt.box.contains(effectiveTarget)) {
          UIComponents.updateFloatingPromptPosition(this.floatingPrompt, effectiveTarget);
        }
      } 
      
      // Requirement: Silent AI matching for standard inputs
      if (isStandardInput && target.type !== 'password' && target.id !== 'ai-autofill-floating-prompt') {
        if (this.floatingPrompt) this.floatingPrompt.box.style.display = 'none'; // Hide prompt if it was shown elsewhere
        this.runSilentMatching(target);
      }
    };

    if (enabled) {
      this.floatingPrompt = UIComponents.initFloatingPrompt(
        this.runStreamingFill.bind(this),
        this.handleUndo.bind(this)
      );
    }

    document.addEventListener('focusin', handleFocus);
    document.addEventListener('click', (e) => {
      let target = e.target;
      if (e.composedPath) target = e.composedPath()[0] || target;
      const tag = target.tagName.toUpperCase();
      
      if (tag !== 'INPUT' && (document.activeElement === target || target.isContentEditable)) {
          handleFocus(e);
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (this.floatingPrompt && !this.floatingPrompt.box.contains(e.target) && this.floatingPrompt.targetInput !== e.target) {
        this.floatingPrompt.box.style.display = 'none';
      }
      if (this.suggestionBox && !this.suggestionBox.box.contains(e.target)) {
        this.suggestionBox.box.style.display = 'none';
      }
    });
  },

  /**
   * Background silent matching for inputs
   */
  async runSilentMatching(target) {
    if (this.lastSilentMatchTarget === target) return;
    if (this.isMatchingSet.has(target)) return;

    this.lastSilentMatchTarget = target;
    this.isMatchingSet.add(target);

    // Small delay to ensure focus is stable
    await new Promise(r => setTimeout(r, 100));
    
    try {
      if (document.activeElement !== target) return;

      const context = InputDetector.getInputContext(target);
      if (!context) return;

      const info = await StorageManager.getPersonalInfo();
      const nonSensitiveInfo = info.filter(item => !item.isSecret);
      if (nonSensitiveInfo.length === 0) return;

      const aiSettings = await StorageManager.getAISettings();
      if (aiSettings.provider !== 'remote') return;

      const keysStr = nonSensitiveInfo.map(i => i.keyname).join(', ');

      // Use JSON format for more robust matching
      const systemPrompt = "You are a field classifier. Match the context to the best entries in the personal data vault. You MUST output your response in JSON format.";
      const userPrompt = `Context: "${context}". Available Keys: [${keysStr}]. Return a JSON object like {"matches": ["key1"]} or {"matches": []} if no match.`;
      
      if (!StorageManager._isContextValid()) return;
      const response = await chrome.runtime.sendMessage({
        action: 'ai-analyze',
        apiUrl: aiSettings.apiUrl,
        apiKey: aiSettings.apiKey,
        model: aiSettings.model,
        systemPrompt,
        userPrompt
      });

      if (response.error || !response.result) return;
      
      let matchedKeys = [];
      try {
        const cleaned = response.result.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        const parsed = JSON.parse(cleaned);
        matchedKeys = parsed.matches || [];
      } catch (e) {
        // Fallback to text matching if JSON fails
        const result = response.result.toLowerCase();
        matchedKeys = nonSensitiveInfo
          .filter(i => result.includes(i.keyname.toLowerCase()))
          .map(i => i.keyname);
      }

      if (matchedKeys.length > 0) {
        const matchedItems = nonSensitiveInfo.filter(i => matchedKeys.includes(i.keyname));
        if (matchedItems.length > 0 && target === document.activeElement) {
          this.suggestionBox.update(matchedItems, target);
        }
      }
    } catch (e) {
      console.warn('Silent match failed', e);
    } finally {
      this.isMatchingSet.delete(target);
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

    let lastUpdate = 0;
    return new Promise((resolve) => {
      port.onMessage.addListener((msg) => {
        if (msg.chunk) {
          if (target.isContentEditable) {
            target.innerHTML += msg.chunk;
          } else {
            target.value += msg.chunk;
          }
          
          // Batch event dispatches to improve performance
          const now = Date.now();
          if (now - lastUpdate > 30) { 
            target.dispatchEvent(new Event('input', { bubbles: true }));
            lastUpdate = now;
          }
        }
        if (msg.done || msg.error) {
          target.dispatchEvent(new Event('input', { bubbles: true })); // Final event
          target.dispatchEvent(new Event('change', { bubbles: true }));
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
    let infoItem = personalInfo.find(i => i.keyname === matchedKey);
    if (!infoItem) return;

    const lang = await StorageManager.getLanguage();
    const whitelist = await StorageManager.getWhitelist();
    const currentHost = window.location.hostname;
    const isSafeMode = await StorageManager.isEncryptionEnabled();
    
    // Whitelist check
    const isWhitelisted = whitelist.some(p => {
      const regex = new RegExp('^' + p.split('.').map(part => part === '*' ? '.*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\.') + '$');
      return regex.test(currentHost);
    });

    let val = infoItem.value;

    if (infoItem.isSecret) {
      if (isWhitelisted) {
        // If it's still an object, it's encrypted and we need to unlock
        if (isSafeMode && typeof val === 'object') {
          const pass = await UIComponents.showPasswordModal(lang);
          if (!pass) return;
          try {
            await StorageManager.unlock(pass);
            // Refresh infoItem value after unlocking
            const refreshedInfo = await StorageManager.getPersonalInfo();
            // Update original array in-place so other fields in the same run don't re-trigger password modal
            personalInfo.length = 0;
            personalInfo.push(...refreshedInfo);
            
            infoItem = personalInfo.find(i => i.keyname === matchedKey);
            val = infoItem.value;
          } catch (e) {
            UIComponents.customAlert('Error', e.message, lang);
            return;
          }
        }

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

      // 1. Gather context (Don't check encryption here, let executeFill handle it)
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
