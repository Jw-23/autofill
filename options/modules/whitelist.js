// options/modules/whitelist.js
import { VaultStorage } from './storage.js';

export async function renderWhitelist() {
  const list = await VaultStorage.getWhitelist();
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
      await VaultStorage.setWhitelist(list);
      renderWhitelist();
    };
    container.appendChild(span);
  });
}

export function initWhitelist() {
  document.getElementById('add-whitelist-btn').onclick = async () => {
    const input = document.getElementById('new-whitelist-item');
    const domain = input.value.trim();
    if (domain) {
      const list = await VaultStorage.getWhitelist();
      if (!list.includes(domain)) {
        list.push(domain);
        await VaultStorage.setWhitelist(list);
        renderWhitelist();
        input.value = '';
      }
    }
  };
}
