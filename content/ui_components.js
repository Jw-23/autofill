// content/ui_components.js

const UIComponents = {
  createOverlay: () => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: '10000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'sans-serif'
    });
    return overlay;
  },

  customAlert: (titleText, bodyText) => {
    return new Promise((resolve) => {
      const overlay = UIComponents.createOverlay();
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
  },

  customConfirm: (titleText, bodyText, lang) => {
    return new Promise((resolve) => {
      const overlay = UIComponents.createOverlay();
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
  },

  showPasswordModal: (lang) => {
    return new Promise((resolve) => {
      const overlay = UIComponents.createOverlay();
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
  },

  showLoading: (lang) => {
    const overlay = UIComponents.createOverlay();
    overlay.innerHTML = `
      <div style="background:white; padding:20px; border-radius:8px; display:flex; flex-direction:column; align-items:center; gap:15px;">
        <div style="width:40px; height:40px; border:4px solid #f3f3f3; border-top:4px solid #4285f4; border-radius:50%; animation: UIComponentsSpin 1s linear infinite;"></div>
        <span style="font-size:14px; color:#333;">${lang === 'zh' ? 'AI 正在匹配字段...' : 'AI matching fields...'}</span>
      </div>
      <style>@keyframes UIComponentsSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;
    document.body.append(overlay);
    return overlay;
  },

  initFloatingPrompt: (onGenerate, onUndo) => {
    const box = document.createElement('div');
    box.id = 'ai-autofill-floating-prompt';
    Object.assign(box.style, {
      position: 'absolute', display: 'none', zIndex: '10001',
      backgroundColor: 'rgba(255, 255, 255, 0.98)', border: '1px solid #ddd',
      borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      padding: '8px', flexDirection: 'row', alignItems: 'center', gap: '8px',
      fontFamily: 'sans-serif', transition: 'opacity 0.2s', opacity: '0'
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'AI 提示词...';
    Object.assign(input.style, {
      border: '1px solid #ccc', borderRadius: '4px', padding: '4px 8px',
      fontSize: '13px', width: '150px', outline: 'none'
    });

    const btn = document.createElement('button');
    btn.innerText = '生成';
    Object.assign(btn.style, {
      backgroundColor: '#4285f4', color: 'white', border: 'none',
      borderRadius: '4px', padding: '4px 10px', fontSize: '13px', cursor: 'pointer'
    });

    const undoBtn = document.createElement('button');
    undoBtn.innerText = '撤销';
    undoBtn.style.display = 'none';
    Object.assign(undoBtn.style, {
      backgroundColor: '#f1f3f4', color: '#3c4043', border: '1px solid #dadce0',
      borderRadius: '4px', padding: '4px 10px', fontSize: '13px', cursor: 'pointer'
    });

    box.appendChild(input);
    box.appendChild(btn);
    box.appendChild(undoBtn);
    document.body.appendChild(box);

    const fp = { box, input, btn, undoBtn, targetInput: null };

    btn.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const val = input.value.trim();
      if (val && fp.targetInput) {
        btn.disabled = true; btn.innerText = '...';
        await onGenerate(fp.targetInput, val);
        btn.disabled = false; btn.innerText = '生成';
        undoBtn.style.display = 'inline-block';
      }
    };

    undoBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      onUndo(fp.targetInput);
      undoBtn.style.display = 'none';
    };
    
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };

    // Hover logic
    box.onmouseenter = () => { box.style.opacity = '1'; };
    box.onmouseleave = () => { box.style.opacity = '0'; };

    return fp;
  },

  updateFloatingPromptPosition: (fp, target) => {
    const rect = target.getBoundingClientRect();
    const box = fp.box;
    box.style.display = 'flex';
    box.style.opacity = '0'; // Start hidden
    fp.undoBtn.style.display = 'none'; // Reset undo button for new focus
    
    // Also show when target is hovered
    const show = () => { box.style.opacity = '1'; };
    const hide = () => { if (!box.matches(':hover')) box.style.opacity = '0'; };
    
    target.removeEventListener('mouseenter', fp._prevEnter);
    target.removeEventListener('mouseleave', fp._prevLeave);
    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);
    fp._prevEnter = show;
    fp._prevLeave = hide;

    const boxHeight = 45; // Approx height
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;

    if (spaceAbove > boxHeight + 10) {
      box.style.top = `${rect.top + window.scrollY - boxHeight - 5}px`;
    } else if (spaceBelow > boxHeight + 10) {
      box.style.top = `${rect.bottom + window.scrollY + 5}px`;
    } else {
      box.style.top = `${rect.top + window.scrollY - 5}px`;
    }
    box.style.left = `${rect.left + window.scrollX}px`;
    fp.targetInput = target;
  }
};
