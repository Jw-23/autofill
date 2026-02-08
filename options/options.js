// options/options.js

// Translations
const i18n = {
  zh: {
    debugLogs: "调试日志",
    addNewInfo: "添加新信息",
    labelKeyname: "英文键名",
    labelDesc: "详细描述",
    labelValue: "填写内容",
    saveBtn: "保存条目",
    savedInfo: "已保存的信息",
    noData: "暂无数据",
    deleteBtn: "删除",
    alertMissing: "键名和内容必填",
    configAlert: "请先在扩展选项中配置个人信息。",
    editBtn: "编辑",
    editTitle: "编辑信息",
    cancelBtn: "取消",
    updateBtn: "更新",
    labelSecret: "高敏感数据 (需二次确认)",
    labelFakeValue: "干扰内容 (非白名单时使用)",
    whitelistTitle: "信任网站 (白名单)",
    whitelistDesc: "只有在这些网站中，高敏感数据才会填写真实值。支持 * 模糊匹配。",
    addBtn: "添加",
    unlockTitle: "解锁仓库",
    unlockDesc: "输入主密码以访问您的数据。",
    unlockBtn: "解锁",
    securityTitle: "安全设置",
    newMasterPass: "主密码",
    confirmMasterPass: "确认主密码",
    enableEncryption: "启用加密",
    securityStatusOn: "状态：已加密 ✅",
    securityStatusOff: "状态：未加密 🔓",
    closeBtn: "关闭",
    passReq: "主密码不能为空",
    passMatchError: "两次输入的密码不一致",
    resetData: "销毁数据并重置",
    resetConfirm: "确定要销毁所有数据并重置吗？此操作无法撤销！",
    enableConfirm: "一旦启用，每次填写都需输入密码。确定吗？",
    encDone: "加密已启用！",
    oneByOne: "逐个匹配模式"
  },
  en: {
    debugLogs: "Debug Logs",
    addNewInfo: "Add New Info",
    labelKeyname: "Keyname (e.g. phone_number)",
    labelDesc: "Description (Help AI match)",
    labelValue: "Value",
    saveBtn: "Add Entry",
    savedInfo: "Saved Information",
    noData: "No data saved.",
    deleteBtn: "Delete",
    alertMissing: "Keyname and Value are required",
    configAlert: "Please configure your personal information in the extension options first.",
    editBtn: "Edit",
    editTitle: "Edit Info",
    cancelBtn: "Cancel",
    updateBtn: "Update",
    labelSecret: "High Sensitivity (Confirm before fill, mask in list)",
    labelFakeValue: "Fake Value (Filled when site is not whitelisted)",
    whitelistTitle: "Trusted Websites (Whitelist)",
    whitelistDesc: "Real values for high-sensitivity data are only filled on these sites. Use * for wildcards (e.g. *.google.com).",
    addBtn: "Add",
    unlockTitle: "Unlock Vault",
    unlockDesc: "Enter master password to access your data.",
    unlockBtn: "Unlock",
    securityTitle: "Security Settings",
    newMasterPass: "Set New Master Password",
    confirmMasterPass: "Confirm Master Password",
    enableEncryption: "Enable Encryption",
    securityStatusOn: "Status: Encryption Enabled ✅",
    securityStatusOff: "Status: Not Encrypted (Enable below) 🔓",
    closeBtn: "Close",
    passReq: "Master password cannot be empty",
    passMatchError: "Passwords do not match",
    resetData: "Destroy All Data & Reset Security",
    resetConfirm: "Are you sure you want to destroy all data and reset all security settings? This action cannot be undone!",
    enableConfirm: "Once enabled, you will need your password to fill forms. Existing data will be encrypted. Continue?",
    encDone: "Encryption enabled!",
    oneByOne: "One-by-one Mode"
  }
};

let currentLang = 'zh';

async function updateLanguageUI() {
  currentLang = await StorageManager.getLanguage();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (i18n[currentLang][key]) {
      el.innerText = i18n[currentLang][key];
    }
  });
  renderList();
}

async function renderList() {
  const infoList = document.getElementById('info-list');
  const unlockCard = document.getElementById('unlock-card');
  const addForm = document.getElementById('add-form');
  
  infoList.innerHTML = '';
  
  let info = [];
  try {
    info = await StorageManager.getPersonalInfo();
    unlockCard.style.display = 'none';
    addForm.style.display = 'block';
  } catch (e) {
    if (e.message.includes('locked')) {
      unlockCard.style.display = 'block';
      addForm.style.display = 'none';
      return;
    }
    console.error(e);
  }

  if (info.length === 0) {
    infoList.innerHTML = `<div style="padding:20px; color:#999; text-align:center;">${i18n[currentLang].noData}</div>`;
    return;
  }

  info.forEach(item => {
    const div = document.createElement('div');
    div.className = 'info-item';
    const displayValue = item.isSecret ? '••••••••' : item.value;
    const sensitivityTag = item.isSecret ? `<span style="color:var(--danger-color); font-size:12px; font-weight:bold; margin-left:8px;">[高敏感/Sensitive]</span>` : '';
    div.innerHTML = `
      <div class="item-main">
        <div class="item-key">${item.keyname} ${sensitivityTag}</div>
        <div class="item-desc">${item.description || 'No description'}</div>
        <div class="item-val">${displayValue}</div>
      </div>
      <div class="item-actions">
        <button class="edit-btn" data-key="${item.keyname}">${i18n[currentLang].editBtn}</button>
        <button class="delete-btn" data-key="${item.keyname}">${i18n[currentLang].deleteBtn}</button>
      </div>
    `;
    infoList.appendChild(div);
  });

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.onclick = async (e) => {
      const key = e.target.getAttribute('data-key');
      const info = await StorageManager.getPersonalInfo();
      const item = info.find(i => i.keyname === key);
      if (item) {
        showEditModal(item);
      }
    };
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = async (e) => {
      const key = e.target.getAttribute('data-key');
      await StorageManager.deletePersonalInfo(key);
      renderList();
    };
  });
}

// Debug Toggle & Language Toggle Logic
async function initSettings() {
  const debugToggle = document.getElementById('debug-toggle');
  debugToggle.checked = await StorageManager.getDebugSetting();
  
  debugToggle.onchange = async () => {
    console.log('Options: Toggling debug log:', debugToggle.checked);
    await StorageManager.setDebugSetting(debugToggle.checked);
  };

  const oneByOneToggle = document.getElementById('one-by-one-toggle');
  oneByOneToggle.checked = await StorageManager.getOneByOneSetting();
  oneByOneToggle.onchange = async () => {
    await StorageManager.setOneByOneSetting(oneByOneToggle.checked);
  };

  const langToggle = document.getElementById('lang-toggle');
  langToggle.onclick = async () => {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    await StorageManager.setLanguage(nextLang);
    await updateLanguageUI();
  };

  // Security UI Logic
  const securityBtn = document.getElementById('security-btn');
  const securityModal = document.getElementById('security-modal');
  const encryptionBtn = document.getElementById('enable-encryption');
  const unlockBtn = document.getElementById('unlock-btn');

  securityBtn.onclick = async () => {
    const isEnc = await StorageManager.isEncryptionEnabled();
    const statusText = document.getElementById('security-status');
    const setPassArea = document.getElementById('set-pass-area');
    
    statusText.innerText = isEnc ? i18n[currentLang].securityStatusOn : i18n[currentLang].securityStatusOff;
    setPassArea.style.display = isEnc ? 'none' : 'block';
    securityModal.style.display = 'block';
  };

  document.getElementById('close-security').onclick = () => {
    securityModal.style.display = 'none';
  };

  encryptionBtn.onclick = async () => {
    const pass = document.getElementById('new-master-pass').value;
    const confirmPass = document.getElementById('confirm-master-pass').value;
    
    if (!pass) return alert(i18n[currentLang].passReq);
    if (pass !== confirmPass) return alert(i18n[currentLang].passMatchError);
    
    if (confirm(i18n[currentLang].enableConfirm)) {
      const oldData = await StorageManager.getPersonalInfo(); // Should be plain text for now
      await StorageManager.setupEncryption(pass);
      await StorageManager.savePersonalInfo(oldData);
      chrome.storage.local.remove('personalInfo'); // Delete old plain text
      alert(i18n[currentLang].encDone);
      securityModal.style.display = 'none';
      renderList();
    }
  };

  unlockBtn.onclick = async () => {
    const pass = document.getElementById('unlock-pass').value;
    try {
      await StorageManager.unlock(pass);
      renderList();
    } catch (e) {
      alert(e.message);
    }
  };

  document.getElementById('factory-reset').onclick = async () => {
    if (confirm(i18n[currentLang].resetConfirm)) {
      await new Promise(r => chrome.storage.local.clear(r));
      StorageManager.lock();
      alert('All categories and security settings have been reset.');
      location.reload();
    }
  };
}

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
    await StorageManager.addPersonalInfo({ keyname, description, value, isSecret, fakeValue });
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

async function renderWhitelist() {
  const list = await StorageManager.getWhitelist();
  const container = document.getElementById('whitelist-list');
  container.innerHTML = '';
  
  list.forEach((item, index) => {
    const span = document.createElement('span');
    span.style.cssText = 'background:#e8f0fe; padding:4px 10px; border-radius:16px; font-size:13px; display:flex; align-items:center; gap:5px;';
    span.innerHTML = `
      ${item}
      <span style="cursor:pointer; color:var(--danger-color); font-weight:bold; margin-left:5px;">×</span>
    `;
    span.querySelector('span').onclick = async () => {
      list.splice(index, 1);
      await StorageManager.setWhitelist(list);
      renderWhitelist();
    };
    container.appendChild(span);
  });
}

document.getElementById('add-whitelist-btn').onclick = async () => {
  const input = document.getElementById('new-whitelist-item');
  const domain = input.value.trim();
  if (domain) {
    const list = await StorageManager.getWhitelist();
    if (!list.includes(domain)) {
      list.push(domain);
      await StorageManager.setWhitelist(list);
      renderWhitelist();
      input.value = '';
    }
  }
};

// Edit Modal Logic
function showEditModal(item) {
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

function hideEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
}

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
    await StorageManager.updatePersonalInfo(oldKey, { keyname, description, value, isSecret, fakeValue });
    hideEditModal();
    renderList();
  } catch (e) {
    alert(e.message);
  }
};

window.onclick = function(event) {
  const modal = document.getElementById('edit-modal');
  if (event.target === modal) {
    hideEditModal();
  }
};

updateLanguageUI();
initSettings();
renderWhitelist();
