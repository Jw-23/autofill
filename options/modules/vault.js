// options/modules/vault.js
import { VaultStorage } from './storage.js';
import { i18n, currentLang } from './i18n.js';
import { makeDraggable } from './ui.js';

export async function renderList() {
  const infoList = document.getElementById('info-list');
  const unlockCard = document.getElementById('unlock-card');
  const addForm = document.getElementById('add-form');
  
  const isSafeMode = await VaultStorage.isEncryptionEnabled();
  const info = await VaultStorage.getPersonalInfo();
  
  // If in safe mode and locked, show unlock card if any secretive items exist
  const isLocked = isSafeMode && !VaultStorage._dataKey;
  unlockCard.style.display = isLocked ? 'block' : 'none';
  
  // We allow adding info even if locked (it just might not be able to save if we try to encrypt, 
  // actually VaultStorage.savePersonalInfo throws 'locked' if it needs to encrypt).
  // For simplicity, let's keep addForm visible but warn if encryption is needed.
  addForm.style.display = 'block';

  infoList.innerHTML = '';

  if (info.length === 0) {
    infoList.innerHTML = `<div style="padding:20px; color:#999; text-align:center;">${i18n[currentLang].noData}</div>`;
    return;
  }

  info.forEach(item => {
    const div = document.createElement('div');
    div.className = 'info-item';
    
    let displayValue = item.value;
    let isValueLocked = false;
    
    if (item.isSecret) {
      if (typeof item.value === 'object') {
        displayValue = ' [Encrypted / 已加密] ';
        isValueLocked = true;
      } else {
        displayValue = '••••••••'; // Masked but decrypted
      }
    }

    const sensitivityTag = item.isSecret ? `<span style="color:var(--danger-color); font-size:12px; font-weight:bold; margin-left:8px;">[高敏感/Sensitive]</span>` : '';
    
    div.innerHTML = `
      <div class="item-main">
        <div class="item-key">${item.keyname} ${sensitivityTag}</div>
        <div class="item-desc">${item.description || 'No description'}</div>
        <div class="item-val">${displayValue}</div>
      </div>
      <div class="item-actions">
        <button class="edit-btn" data-key="${item.keyname}" ${isValueLocked ? 'disabled title="Unlock to edit"' : ''}>${i18n[currentLang].editBtn}</button>
        <button class="delete-btn" data-key="${item.keyname}">${i18n[currentLang].deleteBtn}</button>
      </div>
    `;
    infoList.appendChild(div);
  });

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.onclick = async (e) => {
      const key = e.target.getAttribute('data-key');
      const info = await VaultStorage.getPersonalInfo();
      const item = info.find(i => i.keyname === key);
      if (item) {
        showEditModal(item);
      }
    };
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = async (e) => {
      const scrollPos = window.scrollY; // Capture scroll position
      const key = e.target.getAttribute('data-key');
      await VaultStorage.deletePersonalInfo(key);
      await renderList();
      window.scrollTo(0, scrollPos); // Restore scroll position
    };
  });
}

export function showEditModal(item) {
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-old-key').value = item.keyname;
  document.getElementById('edit-keyname').value = item.keyname;
  document.getElementById('edit-description').value = item.description || '';
  document.getElementById('edit-value').value = item.value;
  document.getElementById('edit-is-secret').checked = !!item.isSecret;
  document.getElementById('edit-fake-value').value = item.fakeValue || '';
  document.getElementById('edit-fake-value-group').style.display = item.isSecret ? 'block' : 'none';
  modal.style.display = 'block';
}

export function hideEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
}

export async function initVault() {
  const editModal = document.getElementById('edit-modal');
  const editModalContent = editModal.querySelector('.modal-content');
  if (editModalContent) makeDraggable(editModalContent);

  document.getElementById('add-btn').onclick = async () => {
    const keyname = document.getElementById('new-keyname').value.trim();
    const description = document.getElementById('new-description').value.trim();
    const value = document.getElementById('new-value').value.trim();
    const isSecret = document.getElementById('new-is-secret').checked;
    const fakeValue = document.getElementById('new-fake-value').value.trim();

    if (!keyname || !value) {
      alert(i18n[currentLang].alertMissing);
      return;
    }

    try {
      await VaultStorage.addPersonalInfo({ keyname, description, value, isSecret, fakeValue });
      document.getElementById('new-keyname').value = '';
      document.getElementById('new-description').value = '';
      document.getElementById('new-value').value = '';
      document.getElementById('new-is-secret').checked = false;
      document.getElementById('new-fake-value').value = '';
      document.getElementById('new-fake-value-group').style.display = 'none';
      renderList();
    } catch (e) {
      alert(e.message);
    }
  };

  document.getElementById('new-is-secret').onchange = (e) => {
    document.getElementById('new-fake-value-group').style.display = e.target.checked ? 'block' : 'none';
  };

  document.getElementById('edit-is-secret').onchange = (e) => {
    document.getElementById('edit-fake-value-group').style.display = e.target.checked ? 'block' : 'none';
  };

  document.getElementById('cancel-edit').onclick = hideEditModal;

  document.getElementById('save-edit').onclick = async () => {
    const oldKey = document.getElementById('edit-old-key').value;
    const keyname = document.getElementById('edit-keyname').value.trim();
    const description = document.getElementById('edit-description').value.trim();
    const value = document.getElementById('edit-value').value.trim();
    const isSecret = document.getElementById('edit-is-secret').checked;
    const fakeValue = document.getElementById('edit-fake-value').value.trim();

    if (!keyname || !value) {
      alert(i18n[currentLang].alertMissing);
      return;
    }

    try {
      await VaultStorage.updatePersonalInfo(oldKey, { keyname, description, value, isSecret, fakeValue });
      hideEditModal();
      renderList();
    } catch (e) {
      alert(e.message);
    }
  };

  window.addEventListener('click', (event) => {
    const modal = document.getElementById('edit-modal');
    if (event.target === modal) {
      hideEditModal();
    }
  });

  document.getElementById('unlock-btn').onclick = async () => {
    const pass = document.getElementById('unlock-pass').value;
    try {
      await VaultStorage.unlock(pass);
      renderList();
    } catch (e) {
      alert(e.message);
    }
  };
}
