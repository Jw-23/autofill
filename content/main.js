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
    if (isDebug) console.log('MainController: runAutofill triggered [v2.0 Check]. isDebug:', isDebug);
    
    const oneByOne = await StorageManager.getOneByOneSetting();
    const useCluster = await StorageManager.getClusterSetting();

    const lang = await StorageManager.getLanguage();
    const whitelist = await StorageManager.getWhitelist();
    const currentHost = window.location.hostname;

    const isDomainWhitelisted = (host, list) => {
      return list.some(pattern => {
        const regex = new RegExp('^' + pattern.split('.').map(part => part === '*' ? '.*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\.') + '$');
        return regex.test(host);
      });
    };

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
      input.style.transition = 'box-shadow 0.2s ease-out, background-color 0.2s ease-out';
      input.style.boxShadow = '0 0 15px 5px rgba(66, 133, 244, 0.8)';
      return () => {
        input.style.boxShadow = originalBoxShadow;
        setTimeout(() => {
          input.style.transition = originalTransition;
        }, 300);
      };
    };

    const isWhitelisted = isDomainWhitelisted(currentHost, whitelist);

    const executeFill = async (input, matchedKey, personalInfo) => {
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

    const strategies = {
      /**
       * Strategy 1: One-by-One
       * Matches inputs one by one for maximum visibility.
       */
      oneByOne: async (inputs, personalInfo) => {
        if (isDebug) console.log('MainController: One-by-One mode started');
        for (let i = 0; i < inputs.length; i++) {
          if (signal.aborted) break;
          const input = inputs[i];
          const removeHalo = applyHalo(input);
          
          try {
            await new Promise(r => setTimeout(r, 150)); 
            const context = InputDetector.getInputContext(input);
            const [match] = await AIManager.identifyFieldsBatch([{ id: i, context }], personalInfo, isDebug);
            
            if (match?.matchedKey) {
              await executeFill(input, match.matchedKey, personalInfo);
              await new Promise(r => setTimeout(r, 400));
            } else {
              await new Promise(r => setTimeout(r, 200));
            }
          } finally {
            removeHalo();
            await new Promise(r => setTimeout(r, 250));
          }
        }
      },

      /**
       * Strategy 2: Batch (Global)
       * Matches all visible inputs in one single AI call.
       */
      batch: async (inputs, personalInfo) => {
        if (isDebug) console.log('MainController: Batch mode started');
        const overlay = showLoading();
        try {
          const fieldBatch = inputs.map((input, index) => ({ id: index, context: InputDetector.getInputContext(input) }));
          const matches = await AIManager.identifyFieldsBatch(fieldBatch, personalInfo, isDebug);
          
          for (const match of matches) {
            if (signal.aborted) break;
            if (match.matchedKey) {
              const input = inputs[match.inputId];
              const removeHalo = applyHalo(input);
              await executeFill(input, match.matchedKey, personalInfo);
              await new Promise(r => setTimeout(r, 400));
              removeHalo();
            }
          }
        } finally {
          overlay.remove();
        }
      },

      /**
       * Strategy 3: Cluster (Group-based) - v2 Enhanced
       * Groups inputs by finding the lowest common ancestor that contains multiple inputs,
       * then sub-groups by DOM depth. Extracts non-input text from that ancestor as context.
       */
      cluster: async (inputs, personalInfo) => {
        // Force log to confirm entry
        console.log('MainController: Cluster mode started (isDebug check skipped for diagnosis)');

        // --- 1. Bubbling Phase: Find Cluster Roots ---
        // Map each input index to its "Owner" element. Start with direct parent.
        const inputOwners = new Map(); // index -> HTMLElement
        inputs.forEach((input, idx) => inputOwners.set(idx, input.parentElement));

        const isClusterBoundary = (el) => {
          if (!el) return true; // Stop at null
          if (['BODY', 'HTML'].includes(el.tagName)) return true; // Hard stop
          
          // Semantic Boundaries
          if (['SECTION', 'FORM', 'FIELDSET', 'ARTICLE', 'MAIN'].includes(el.tagName)) return true;

          // Header Boundary: A generic DIV acts as a section if it has a direct header child
          // We use explicit loop for performance instead of querySelector
          for (const child of el.children) {
             if (/^H[1-6]$/.test(child.tagName) || child.tagName === 'LEGEND' || child.tagName === 'CAPTION') {
                return true;
             }
          }
          return false;
        };

        let changed = true;
        let iterations = 0;
        const MAX_ITERATIONS = 13; // Allow deeper bubbling to find sections

        while (changed && iterations < MAX_ITERATIONS) {
          changed = false;
          iterations++;

          const ownerGroups = new Map();
          for (const [idx, owner] of inputOwners) {
            if (!ownerGroups.has(owner)) ownerGroups.set(owner, []);
            ownerGroups.get(owner).push(idx);
          }

          for (const [owner, idxs] of ownerGroups) {
             // If we hit a boundary, we stop bubbling for this group
             if (isClusterBoundary(owner)) continue;

             // Logic: If this node is NOT a boundary, and has a parent, we TRY to bubble up.
             // But we should only bubble if strictly necessary?
             // Actually, the user WANTS to bubble up to the Section. 
             // So if we are at `div.form-row` (not boundary), we bubble to `section`.
             
             if (owner.parentElement) {
                // Heuristic: If this node has siblings that strictly contain other inputs,
                // merging up might create a better cluster.
                // But simplified logic: Just bubble until Boundary.
                idxs.forEach(idx => inputOwners.set(idx, owner.parentElement));
                changed = true;
             }
          }
        }

        // --- 2. Construction Phase: Organize by Root -> Depth ---
        const clusters = new Map(); // HTMLElement (Root) -> Map<Depth, Array<{input, index}>>

        for (const [idx, owner] of inputOwners) {
          if (!clusters.has(owner)) clusters.set(owner, new Map());
          
          // Calculate absolute depth of input
          let depth = 0;
          let curr = inputs[idx];
          while (curr.parentElement) { curr = curr.parentElement; depth++; }

          const depthMap = clusters.get(owner);
          if (!depthMap.has(depth)) depthMap.set(depth, []);
          depthMap.get(depth).push({ input: inputs[idx], index: idx });
        }

        // --- 3. Preparation Phase: Build Execution Batches ---
        const finalBatches = [];

        for (const [root, depthMap] of clusters) {
          // A. Extract "Cluster Context" (Text from Root's children that DON'T contain the inputs)
          // This captures things like "2. 职业与社交媒体" in the user's example
          let clusterContext = '';
          try {
             // Identify all inputs belonging to this cluster root (all depths)
             const allClusterInputs = [];
             for (const items of depthMap.values()) items.forEach(i => allClusterInputs.push(i.input));
             
             const contextParts = [];
             // Iterate direct children of the cluster root
             for (const child of root.children) {
                // Skip if this child is one of the inputs or WRAPS one of the inputs
                // (If it wraps an input, its text is likely that input's specific label, handled by InputDetector)
                const containsInput = allClusterInputs.some(input => child.contains(input) || child === input);
                
                if (!containsInput) {
                   // This is a sibling node (like an H2 header, or description P)
                   // Get clean text (ignoring hidden styles not checked here for perf, simple innerText)
                   const text = child.innerText ? child.innerText.trim() : '';
                   if (text.length > 0 && text.length < 300) { // arbitrary limit to avoid massive texts
                      contextParts.push(text);
                   }
                }
             }
             clusterContext = contextParts.join('; ');
          } catch (e) {
             if (isDebug) console.warn('Error extracting cluster context', e);
          }

          // B. Create Batches per Depth
          for (const [depth, items] of depthMap) {
            // Sort by DOM order (index)
            items.sort((a, b) => a.index - b.index);
            finalBatches.push({ items, clusterContext, depth });
          }
        }

        // Sort execution order by the first input's index in the batch
        finalBatches.sort((a, b) => a.items[0].index - b.items[0].index);

        if (isDebug || true) { // Force log for diagnosis
          console.group('MainController: Cluster Classification Results');
          console.log(`Total Batches: ${finalBatches.length}`);
          finalBatches.forEach((batch, bIdx) => {
            const indices = batch.items.map(i => i.index).join(', ');
            console.log(`#${bIdx + 1} | Depth: ${batch.depth} | Inputs: [${indices}] | Context: "${batch.clusterContext.slice(0, 50).replace(/\n/g, ' ')}..."`);
          });
          console.groupEnd();
        }

        if (isDebug) console.log(`MainController: Enhanced Cluster Strategy prepared ${finalBatches.length} batches.`);

        // --- 4. Execution Phase ---
        for (const batch of finalBatches) {
          if (signal.aborted) break;
          
          if (isDebug) {
             const preview = batch.items.map(c => `[${c.index}]`).join(', ');
             console.log(`MainController: Processing Batch (Depth: ${batch.depth}) Context: "${batch.clusterContext.slice(0, 30)}..." Items: ${preview}`);
          }

          const halos = batch.items.map(item => applyHalo(item.input));
          
          try {
            // Construct Batch Request
            const fieldBatch = batch.items.map(item => {
               const localContext = InputDetector.getInputContext(item.input);
               // Combine Cluster Context + Local Context
               const combinedContext = batch.clusterContext 
                  ? `[Section Context: ${batch.clusterContext}] ${localContext}`
                  : localContext;
               
               return { id: item.index, context: combinedContext };
            });

            const matches = await AIManager.identifyFieldsBatch(fieldBatch, personalInfo, isDebug);
            
            for (const match of matches) {
              if (match.matchedKey) {
                const item = batch.items.find(i => i.index === match.inputId);
                if (item) {
                  await executeFill(item.input, match.matchedKey, personalInfo);
                }
              }
            }
            // Dynamic pause
            const pauseTime = Math.min(800, 400 + batch.items.length * 100); 
            await new Promise(r => setTimeout(r, pauseTime)); 
          } finally {
            halos.forEach(remove => remove());
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
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

      // Determine strategy based on settings
      // Explicitly log the decision for debugging
      console.log(`MainController: Dispatching Strategy -> OneByOne: ${oneByOne}, Cluster: ${useCluster}`);

      if (oneByOne) {
        await strategies.oneByOne(inputs, personalInfo);
      } else if (useCluster) {
         // Explicit cluster mode
        await strategies.cluster(inputs, personalInfo);
      } else {
        // Default batch (or previous implicit cluster, now explicit batch)
        // If user didn't select Cluster, existing logic was "if not oneByOne, assume cluster".
        // Now we have a specific Cluster toggle. If False, we should probably fall back to Global Batch for speed.
        console.log(`MainController: Fallback to Batch strategy (OneByOne=${oneByOne}, Cluster=${useCluster})`);
        await strategies.batch(inputs, personalInfo);
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
