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
 * Makes an element draggable by its handle or itself
 */
export function makeDraggable(modalContent) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  // Use the dedicated handle bar
  const handle = modalContent.querySelector('.modal-drag-handle') || modalContent;
  
  handle.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    if (e.button !== 0) return; // Only left click
    
    // Don't drag if clicking the close button inside the handle
    if (e.target.classList.contains('close')) return;
    
    // Also ignore clicks on inputs/buttons if the handle contains any (fallback case)
    if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(e.target.tagName)) return;
    
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
    
    // Initial positioning calibration
    const rect = modalContent.getBoundingClientRect();
    modalContent.style.width = rect.width + 'px'; // Lock width to prevent shrinking
    modalContent.style.margin = '0';
    modalContent.style.position = 'absolute';
    modalContent.style.top = rect.top + 'px';
    modalContent.style.left = rect.left + 'px';
    modalContent.style.zIndex = '2000';
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    const newTop = modalContent.offsetTop - pos2;
    const newLeft = modalContent.offsetLeft - pos1;

    // Bounds check
    const maxX = window.innerWidth - modalContent.offsetWidth;
    const maxY = window.innerHeight - modalContent.offsetHeight;

    modalContent.style.top = Math.max(0, Math.min(newTop, maxY)) + "px";
    modalContent.style.left = Math.max(0, Math.min(newLeft, maxX)) + "px";
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
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
