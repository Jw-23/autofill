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
    if (window.__AI_AUTOFILL_INITED__) {
      return;
    }
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

    const isDebug = await StorageManager.getDebugSetting();
    if (isDebug) console.log('MainController: runSilentMatching triggered for', target);

    this.lastSilentMatchTarget = target;
    this.isMatchingSet.add(target);

    // Small delay to ensure focus is stable
    await new Promise(r => setTimeout(r, 100));
    
    try {
      if (document.activeElement !== target) {
        if (isDebug) console.log('MainController: Target lost focus, aborting silent match');
        return;
      }

      const context = InputDetector.getInputContext(target);
      if (isDebug) console.log('MainController: Extracted context:', context);
      if (!context) return;

      const info = await StorageManager.getPersonalInfo();
      const whitelist = await StorageManager.getWhitelist();
      const currentHost = window.location.hostname;

      // Whitelist check
      const isWhitelisted = whitelist.some(p => {
        const regex = new RegExp('^' + p.split('.').map(part => part === '*' ? '.*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\.') + '$');
        return regex.test(currentHost);
      });

      // User Logic: 
      // Not Whitelisted -> Match ALL (since it will use fake data)
      // Whitelisted -> Match Non-Sensitive ONLY
      const candidateKeys = isWhitelisted 
        ? info.filter(item => !item.isSecret)
        : info;

      if (candidateKeys.length === 0) {
        if (isDebug) console.log('MainController: No candidate keys for analysis');
        return;
      }
      
      // Use AIManager for unified local/remote handling
      const matches = await AIManager.identifyFieldsBatch(
        [{ id: 0, context }], 
        candidateKeys, 
        isDebug
      );

      if (isDebug) console.log('MainController: Match results:', matches);

      if (matches && matches.length > 0 && matches[0].matchedKey) {
        const matchedKey = matches[0].matchedKey;
        const matchedItem = candidateKeys.find(i => i.keyname === matchedKey);
        
        if (matchedItem && target === document.activeElement) {
          // If it's a secret but NOT whitelisted, use fake value for suggestion
          let displayItem = { ...matchedItem };
          if (matchedItem.isSecret && !isWhitelisted) {
            displayItem.value = matchedItem.fakeValue || '••••••••';
          }

          if (isDebug) console.log('MainController: Showing suggestion box for', matchedKey);
          this.suggestionBox.update([displayItem], target);
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
    const context = InputDetector.getInputContext(target);
    const isDebug = await StorageManager.getDebugSetting();
    
    if (isDebug) console.log('MainController: runStreamingFill started', { provider: aiSettings.provider, prompt, context });

    // Save for undo
    this.lastValueMap.set(target, target.isContentEditable ? target.innerHTML : target.value);

    if (target.isContentEditable) target.innerHTML = '';
    else target.value = ''; 

    let lastUpdate = 0;
    const updateUI = (chunk) => {
      if (isDebug) console.log('MainController: Received chunk:', chunk);
      if (target.isContentEditable) {
        target.innerHTML += chunk;
      } else {
        target.value += chunk;
      }
      const now = Date.now();
      if (now - lastUpdate > 30) { 
        target.dispatchEvent(new Event('input', { bubbles: true }));
        lastUpdate = now;
      }
    };

    const finalizeUI = () => {
      if (isDebug) console.log('MainController: Finalizing UI update');
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (aiSettings.provider === 'local') {
      const session = await AIManager.getSession();
      if (!session) {
        if (isDebug) console.warn('MainController: Local session not available for streaming');
        return;
      }
      try {
        const fullPrompt = `You are a helpful assistant. User is focusing on a field described by the context: "${context}".\nUser Request: "${prompt}"\nOutput ONLY the result text to fill. NO conversational text.`;
        if (isDebug) console.log('MainController [Local]: Sending prompt:', fullPrompt);
        const stream = session.promptStreaming(fullPrompt);
        let previousText = "";
        for await (const chunk of stream) {
          const newChunk = chunk.slice(previousText.length);
          if (newChunk) {
            updateUI(newChunk);
            previousText = chunk;
          }
        }
        finalizeUI();
      } catch (e) {
        console.error('Local AI Stream failed:', e);
        alert('本地 AI 生成失败：' + e.message);
      }
      return;
    }

    // Remote Provider Logic (existing)
    const port = chrome.runtime.connect({ name: 'ai-stream' });
    port.postMessage({
      action: 'stream-completion',
      apiUrl: aiSettings.apiUrl,
      apiKey: aiSettings.apiKey,
      model: aiSettings.model,
      userPrompt: prompt,
      systemPrompt: `You are a helpful assistant. User is focusing on "${context}". Output ONLY the content to fill.`
    });

    return new Promise((resolve) => {
      port.onMessage.addListener((msg) => {
        if (msg.chunk) {
          updateUI(msg.chunk);
        }
        if (msg.done || msg.error) {
          finalizeUI();
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
