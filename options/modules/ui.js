// options/modules/ui.js
import { i18n, currentLang } from './i18n.js';

/**
 * Custom prompt using the modal
 */
export function showPrompt(title, desc, okText = null) {
  return new Promise((resolve) => {
    const modal = document.getElementById('prompt-modal');
    const input = document.getElementById('prompt-input');
    const titleEl = document.getElementById('prompt-title');
    const descEl = document.getElementById('prompt-desc');
    const okBtn = document.getElementById('prompt-ok');
    const cancelBtn = document.getElementById('prompt-cancel');

    titleEl.innerText = title;
    descEl.innerText = desc;
    okBtn.innerText = okText || i18n[currentLang].unlockBtn;
    
    input.value = '';
    modal.style.display = 'block';
    input.focus();

    const cleanup = () => {
      modal.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
    };

    okBtn.onclick = () => {
      const val = input.value;
      cleanup();
      resolve(val);
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') okBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    };
  });
}

/**
 * AI Model Download Progress Handler
 * @param {boolean} isManual - True if triggered by button click
 */
export async function checkAndDownloadAI(isManual = false) {
  const AIProvider = typeof ai !== 'undefined' && ai.languageModel ? ai.languageModel : (typeof LanguageModel !== 'undefined' ? LanguageModel : null);
  
  if (!AIProvider) {
    if (isManual) alert(i18n[currentLang].aiNotSupported);
    return;
  }

  try {
    const config = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }]
    };
    const status = await AIProvider.availability(config);
    
    if (status === 'available') {
      if (isManual) alert(i18n[currentLang].aiReady);
      return;
    }

    if (status === 'after-download' || status === 'downloading') {
      const modal = document.getElementById('ai-loading-modal');
      const progressBar = document.getElementById('ai-progress-bar');
      const progressText = document.getElementById('ai-progress-text');
      
      modal.style.display = 'block';

      try {
        await AIProvider.create({
          ...config,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              const percent = Math.round((e.loaded / e.total) * 100);
              progressBar.style.width = percent + '%';
              progressText.innerText = percent + '%';
              if (percent >= 100) {
                setTimeout(() => {
                  modal.style.display = 'none';
                  if (isManual) alert(i18n[currentLang].aiReady);
                }, 1000);
              }
            });
          }
        });
      } catch (e) {
        console.error('AI Download session failed:', e);
        modal.style.display = 'none';
        if (isManual) alert(i18n[currentLang].aiUnavailable + ': ' + e.message);
      }
    } else {
      // unavailable
      if (isManual) alert(i18n[currentLang].aiUnavailable + ' (Status: ' + status + ')');
    }
  } catch (e) {
    console.error('AI Availability check failed:', e);
    if (isManual) alert(i18n[currentLang].aiUnavailable + ': ' + e.message);
  }
}
