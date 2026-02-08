// options/options.js

// Translations
const i18n = {
  zh: {
    debugLogs: "调试日志",
    addNewInfo: "添加新信息",
    labelKeyname: "英文键名 (例如: phone_number)",
    labelDesc: "详细描述 (协助 AI 匹配)",
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
    labelSecret: "保密模式 (列表遮挡显示)"
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
    labelSecret: "Confidential (Mask in list view)"
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
  infoList.innerHTML = '';
  const info = await StorageManager.getPersonalInfo();

  if (info.length === 0) {
    infoList.innerHTML = `<div style="padding:20px; color:#999; text-align:center;">${i18n[currentLang].noData}</div>`;
    return;
  }

  info.forEach(item => {
    const div = document.createElement('div');
    div.className = 'info-item';
    const displayValue = item.isSecret ? '••••••••' : item.value;
    div.innerHTML = `
      <div class="item-main">
        <div class="item-key">${item.keyname} ${item.isSecret ? '🔒' : ''}</div>
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
    await StorageManager.setDebugSetting(debugToggle.checked);
  };

  const langToggle = document.getElementById('lang-toggle');
  langToggle.onclick = async () => {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    await StorageManager.setLanguage(nextLang);
    await updateLanguageUI();
  };
}

document.getElementById('add-btn').onclick = async () => {
  const keyname = document.getElementById('new-keyname').value.trim();
  const description = document.getElementById('new-description').value.trim();
  const value = document.getElementById('new-value').value.trim();
  const isSecret = document.getElementById('new-is-secret').checked;

  if (!keyname || !value) {
    alert(i18n[currentLang].alertMissing);
    return;
  }

  try {
    await StorageManager.addPersonalInfo({ keyname, description, value, isSecret });
    document.getElementById('new-keyname').value = '';
    document.getElementById('new-description').value = '';
    document.getElementById('new-value').value = '';
    document.getElementById('new-is-secret').checked = false;
    renderList();
  } catch (e) {
    alert(e.message);
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

  if (!keyname || !value) {
    alert(i18n[currentLang].alertMissing);
    return;
  }

  try {
    await StorageManager.updatePersonalInfo(oldKey, { keyname, description, value, isSecret });
    hideEditModal();
    renderList();
  } catch (e) {
    alert(e.message);
  }
};

window.onclick = (event) => {
  const modal = document.getElementById('edit-modal');
  if (event.target === modal) {
    hideEditModal();
  }
};

updateLanguageUI();
initSettings();
