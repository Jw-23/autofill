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
    
    const messages = {
      zh: '请先在扩展选项中配置个人信息。',
      en: 'Please configure your personal information in the extension options first.'
    };

    if (isDebug) console.log('AI Autofill: Starting...');
    
    try {
      const personalInfo = await StorageManager.getPersonalInfo();
      if (personalInfo.length === 0) {
        alert(messages[lang]);
        return;
      }

      const inputs = InputDetector.getVisibleInputs();
      if (isDebug) console.log(`AI Autofill: 发现 ${inputs.length} 个输入框`);

      for (const input of inputs) {
        // Check if aborted before processing each field
        if (signal.aborted) {
          if (isDebug) console.log('AI Autofill: Loop aborted.');
          return;
        }

        const context = InputDetector.getInputContext(input);
        
        // 打印调试信息：输入框元素和对应的上下文
        if (isDebug) {
          console.group(`检测到输入框: ${input.name || input.id || '无ID/Name'}`);
          console.log('元素:', input);
          console.log('上下文内容:', context);
          console.groupEnd();
        }

        const matchKey = await AIManager.identifyField(context, personalInfo);
        
        // Final check after AI response
        if (signal.aborted) return;

        if (matchKey) {
          const infoItem = personalInfo.find(i => i.keyname === matchKey);
          if (infoItem) {
            if (isDebug) console.log(`AI Autofill: 匹配 "${context}" -> ${matchKey}`);
            InputFiller.fill(input, infoItem.value);
            input.style.backgroundColor = '#e8f0fe';
          }
        }
      }
    } catch (e) {
      if (!signal.aborted && isDebug) {
        console.error('AI Autofill error:', e);
      }
    } finally {
      this.isProcessing = false;
      this.abortController = null;
      if (isDebug) console.log('AI Autofill: Process finished or stopped.');
    }
  }
};

// Start the controller
MainController.init();
