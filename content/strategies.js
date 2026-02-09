// content/strategies.js

const AutofillStrategies = {
  executeFill: null, // To be injected by MainController

  applyHalo: (input) => {
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
  },

  oneByOne: async (inputs, personalInfo, signal, isDebug) => {
    if (isDebug) console.log('AutofillStrategies: One-by-One mode started');
    for (let i = 0; i < inputs.length; i++) {
      if (signal.aborted) break;
      const input = inputs[i];
      const removeHalo = AutofillStrategies.applyHalo(input);
      
      try {
        await new Promise(r => setTimeout(r, 150)); 
        const context = InputDetector.getInputContext(input);
        const [match] = await AIManager.identifyFieldsBatch([{ id: i, context }], personalInfo, isDebug);
        
        if (match?.matchedKey) {
          await AutofillStrategies.executeFill(input, match.matchedKey, personalInfo);
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

  batch: async (inputs, personalInfo, signal, isDebug, showLoading) => {
    if (isDebug) console.log('AutofillStrategies: Batch mode started');
    const overlay = showLoading();
    try {
      const fieldBatch = inputs.map((input, index) => ({ id: index, context: InputDetector.getInputContext(input) }));
      const matches = await AIManager.identifyFieldsBatch(fieldBatch, personalInfo, isDebug);
      
      for (const match of matches) {
        if (signal.aborted) break;
        if (match.matchedKey) {
          const input = inputs[match.inputId];
          const removeHalo = AutofillStrategies.applyHalo(input);
          await AutofillStrategies.executeFill(input, match.matchedKey, personalInfo);
          await new Promise(r => setTimeout(r, 400));
          removeHalo();
        }
      }
    } finally {
      overlay.remove();
    }
  },

  cluster: async (inputs, personalInfo, signal, isDebug) => {
    console.log('AutofillStrategies: Cluster mode started');
    
    const inputOwners = new Map(); 
    inputs.forEach((input, idx) => inputOwners.set(idx, input.parentElement));

    const getInputCountInElement = (el) => {
        let count = 0;
        for (const input of inputs) {
            if (el === input || el.contains(input)) count++;
        }
        return count;
    };

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      const ownerGroups = new Map();
      for (const [idx, owner] of inputOwners) {
        if (!ownerGroups.has(owner)) ownerGroups.set(owner, []);
        ownerGroups.get(owner).push(idx);
      }
      for (const [owner, idxs] of ownerGroups) {
         const parent = owner.parentElement;
         if (!parent || ['BODY', 'HTML'].includes(parent.tagName)) continue;
         let parentIsValid = true;
         for (const child of parent.children) {
             if (getInputCountInElement(child) > 1) {
                 parentIsValid = false;
                 break;
             }
         }
         if (parentIsValid) {
            idxs.forEach(idx => inputOwners.set(idx, parent));
            changed = true;
         }
      }
    }

    const clusters = new Map();
    for (const [idx, owner] of inputOwners) {
      if (!clusters.has(owner)) clusters.set(owner, new Map());
      let depth = 0;
      let curr = inputs[idx];
      while (curr.parentElement) { curr = curr.parentElement; depth++; }
      const depthMap = clusters.get(owner);
      if (!depthMap.has(depth)) depthMap.set(depth, []);
      depthMap.get(depth).push({ input: inputs[idx], index: idx });
    }

    const finalBatches = [];
    for (const [root, depthMap] of clusters) {
      let clusterContext = '';
      try {
         const allClusterInputs = [];
         for (const items of depthMap.values()) items.forEach(i => allClusterInputs.push(i.input));
         const contextParts = [];
         for (const child of root.children) {
            const containsInput = allClusterInputs.some(input => child.contains(input) || child === input);
            if (!containsInput) {
               const text = child.innerText ? child.innerText.trim() : '';
               if (text.length > 0 && text.length < 300) contextParts.push(text);
            }
         }
         clusterContext = contextParts.join('; ');
      } catch (e) {}
      for (const [depth, items] of depthMap) {
        items.sort((a, b) => a.index - b.index);
        finalBatches.push({ items, clusterContext, depth });
      }
    }

    finalBatches.sort((a, b) => a.items[0].index - b.items[0].index);

    for (const batch of finalBatches) {
      if (signal.aborted) break;
      const halos = batch.items.map(item => AutofillStrategies.applyHalo(item.input));
      try {
        const fieldBatch = batch.items.map(item => {
           const localContext = InputDetector.getInputContext(item.input);
           const combinedContext = batch.clusterContext 
              ? `[Section Context: ${batch.clusterContext}] ${localContext}`
              : localContext;
           return { id: item.index, context: combinedContext };
        });
        const matches = await AIManager.identifyFieldsBatch(fieldBatch, personalInfo, isDebug);
        for (const match of matches) {
          if (match.matchedKey) {
            const item = batch.items.find(i => i.index === match.inputId);
            if (item) await AutofillStrategies.executeFill(item.input, match.matchedKey, personalInfo);
          }
        }
        await new Promise(r => setTimeout(r, Math.min(800, 400 + batch.items.length * 100)));
      } finally {
        halos.forEach(remove => remove());
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }
};
