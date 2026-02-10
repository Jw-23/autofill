// options/modules/storage.js
import { VaultCrypto } from './crypto.js';

/**
 * VaultStorage handles chrome.storage.local with encryption.
 * This is the modular version for the options page.
 */
export const VaultStorage = {
  _dataKey: null, // In-memory only

  async getWhitelist() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['whitelist'], (result) => {
        resolve(result.whitelist || []);
      });
    });
  },

  async setWhitelist(list) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ whitelist: list }, resolve);
    });
  },

  async isEncryptionEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['isSafeMode'], (result) => {
        resolve(!!result.isSafeMode);
      });
    });
  },

  async factoryReset() {
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => {
        this.lock();
        resolve();
      });
    });
  },

  async setupEncryption(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const masterKey = await VaultCrypto.deriveMasterKey(password, salt);
    
    const dataKey = await VaultCrypto.generateDataKey();
    const rawDataKey = await crypto.subtle.exportKey('raw', dataKey);
    const encryptedDataKey = await VaultCrypto.encrypt(VaultCrypto.bufferToHex(rawDataKey), masterKey);
    const validator = await VaultCrypto.encrypt("VALID", masterKey);

    await new Promise((resolve) => {
      chrome.storage.local.set({
        isSafeMode: true,
        salt: VaultCrypto.bufferToHex(salt),
        encryptedDataKey,
        validator
      }, resolve);
    });

    this._dataKey = dataKey;
    
    // Migration: Encrypt existing secrets
    const info = await this.getPersonalInfoRaw();
    await this.savePersonalInfo(info);
  },

  async disableEncryption() {
    const info = await this.getPersonalInfo(); // Should be unlocked 
    await new Promise((resolve) => {
      chrome.storage.local.set({
        isSafeMode: false,
        salt: null,
        encryptedDataKey: null,
        validator: null,
        personalInfo: info
      }, resolve);
    });
    this.lock();
  },

  async unlock(password) {
    const result = await new Promise(r => chrome.storage.local.get(['salt', 'validator', 'encryptedDataKey'], r));
    if (!result.salt) throw new Error('Encryption not set up');

    const salt = VaultCrypto.hexToBuffer(result.salt);
    const masterKey = await VaultCrypto.deriveMasterKey(password, salt);

    try {
      const valid = await VaultCrypto.decrypt(result.validator, masterKey);
      if (valid !== "VALID") throw new Error();
    } catch (e) {
      throw new Error('Incorrect password');
    }

    const hexDataKey = await VaultCrypto.decrypt(result.encryptedDataKey, masterKey);
    this._dataKey = await VaultCrypto.importKey(VaultCrypto.hexToBuffer(hexDataKey));
    return true;
  },

  async changePassword(oldPassword, newPassword) {
    const isEnc = await this.isEncryptionEnabled();
    if (!isEnc) throw new Error('Encryption not enabled');

    const result = await new Promise(r => chrome.storage.local.get(['salt', 'encryptedDataKey'], r));
    const oldSalt = VaultCrypto.hexToBuffer(result.salt);
    const oldMasterKey = await VaultCrypto.deriveMasterKey(oldPassword, oldSalt);
    
    let rawDataKey;
    try {
      const hexDataKey = await VaultCrypto.decrypt(result.encryptedDataKey, oldMasterKey);
      rawDataKey = VaultCrypto.hexToBuffer(hexDataKey);
    } catch (e) {
      throw new Error('INVALID_OLD_PASSWORD');
    }

    // Setup new master key protection for the SAME data key
    const newSalt = crypto.getRandomValues(new Uint8Array(16));
    const newMasterKey = await VaultCrypto.deriveMasterKey(newPassword, newSalt);
    
    const encryptedDataKey = await VaultCrypto.encrypt(VaultCrypto.bufferToHex(rawDataKey), newMasterKey);
    const validator = await VaultCrypto.encrypt("VALID", newMasterKey);

    await new Promise((resolve) => {
      chrome.storage.local.set({
        salt: VaultCrypto.bufferToHex(newSalt),
        encryptedDataKey,
        validator
      }, resolve);
    });

    this._dataKey = await VaultCrypto.importKey(rawDataKey);
    return true;
  },

  lock() {
    this._dataKey = null;
  },

  async getPersonalInfoRaw() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['personalInfo'], (result) => {
        resolve(result.personalInfo || []);
      });
    });
  },

  async getPersonalInfo() {
    const isSafeMode = await this.isEncryptionEnabled();
    const items = await this.getPersonalInfoRaw();

    if (!isSafeMode) return items;

    const decryptedItems = [];
    for (const item of items) {
      if (item.isSecret && typeof item.value === 'object' && item.value.ciphertext) {
        if (!this._dataKey) {
          decryptedItems.push(item); // Still encrypted object
        } else {
          try {
            const decVal = await VaultCrypto.decrypt(item.value, this._dataKey);
            decryptedItems.push({ ...item, value: decVal });
          } catch (e) {
            decryptedItems.push(item);
          }
        }
      } else {
        decryptedItems.push(item);
      }
    }
    return decryptedItems;
  },

  async savePersonalInfo(infoArray) {
    const isSafeMode = await this.isEncryptionEnabled();
    if (!isSafeMode) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ personalInfo: infoArray }, resolve);
      });
    }

    // In Safe Mode, encrypt secrets
    if (!this._dataKey) throw new Error('locked');

    const encryptedInfo = [];
    for (const item of infoArray) {
      if (item.isSecret && typeof item.value === 'string') {
        const encVal = await VaultCrypto.encrypt(item.value, this._dataKey);
        encryptedInfo.push({ ...item, value: encVal });
      } else {
        encryptedInfo.push(item);
      }
    }

    await new Promise(r => chrome.storage.local.set({ personalInfo: encryptedInfo }, r));
  },

  async addPersonalInfo(item) {
    const info = await this.getPersonalInfo();
    if (info.find(i => i.keyname === item.keyname)) {
      throw new Error('Keyname already exists');
    }
    info.push(item);
    await this.savePersonalInfo(info);
  },

  async deletePersonalInfo(keyname) {
    let info = await this.getPersonalInfo();
    info = info.filter(i => i.keyname !== keyname);
    await this.savePersonalInfo(info);
  },

  async updatePersonalInfo(oldKeyname, newItem) {
    let info = await this.getPersonalInfo();
    const index = info.findIndex(i => i.keyname === oldKeyname);
    if (index === -1) throw new Error('Item not found');
    
    if (oldKeyname !== newItem.keyname && info.find(i => i.keyname === newItem.keyname)) {
      throw new Error('New keyname already exists');
    }
    
    info[index] = newItem;
    await this.savePersonalInfo(info);
  },

  async getDebugSetting() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['debugEnabled'], (result) => {
        resolve(!!result.debugEnabled);
      });
    });
  },

  async setDebugSetting(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ debugEnabled: enabled }, resolve);
    });
  },

  async getOneByOneSetting() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['oneByOneMode'], (result) => {
        resolve(!!result.oneByOneMode);
      });
    });
  },

  async setOneByOneSetting(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ oneByOneMode: enabled }, resolve);
    });
  },

  async getClusterSetting() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['useClusterMode'], (result) => {
        resolve(!!result.useClusterMode);
      });
    });
  },

  async setClusterSetting(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ useClusterMode: enabled }, resolve);
    });
  },

  async getFloatingPromptSetting() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['floatingPromptEnabled'], (result) => {
        resolve(result.floatingPromptEnabled !== false); // Default to true
      });
    });
  },

  async setFloatingPromptSetting(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ floatingPromptEnabled: enabled }, resolve);
    });
  },

  async getLanguage() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['language'], (result) => {
        resolve(result.language || 'zh');
      });
    });
  },

  async setLanguage(lang) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ language: lang }, resolve);
    });
  },

  // --- AI Settings (Provider, Custom API, etc.) ---
  async getAISettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['aiProvider', 'remoteApiUrl', 'remoteApiKey', 'remoteModel'], (result) => {
        resolve({
          provider: result.aiProvider || 'local', // 'local' | 'remote'
          apiUrl: result.remoteApiUrl || 'https://api.openai.com/v1',
          apiKey: result.remoteApiKey || '',
          model: result.remoteModel || 'gpt-4.1'
        });
      });
    });
  },

  async setAISettings(settings) {
    // settings: { provider, apiUrl, apiKey, model }
    const update = {};
    if (settings.provider !== undefined) update.aiProvider = settings.provider;
    if (settings.apiUrl !== undefined) update.remoteApiUrl = settings.apiUrl;
    if (settings.apiKey !== undefined) update.remoteApiKey = settings.apiKey;
    if (settings.model !== undefined) update.remoteModel = settings.model;

    return new Promise((resolve) => {
      chrome.storage.local.set(update, resolve);
    });
  },

  async getCachedModels(apiUrl) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['aiModelCache'], (result) => {
        const cache = result.aiModelCache || {};
        resolve(cache[apiUrl] || []);
      });
    });
  },

  async setCachedModels(apiUrl, models) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['aiModelCache'], (result) => {
        const cache = result.aiModelCache || {};
        cache[apiUrl] = models;
        chrome.storage.local.set({ aiModelCache: cache }, resolve);
      });
    });
  },

  async exportPersonalInfo() {
    const isSafeMode = await this.isEncryptionEnabled();
    const { personalInfo, salt, encryptedDataKey, validator } = await new Promise(r => chrome.storage.local.get(['personalInfo', 'salt', 'encryptedDataKey', 'validator'], r));
    
    return JSON.stringify({
      type: 'ai-autofill-export',
      version: 3,
      isSafeMode: isSafeMode,
      metadata: isSafeMode ? { salt, encryptedDataKey, validator } : null,
      data: personalInfo
    });
  },

  async importPersonalInfo(jsonStr, providedPassword = null) {
    let payload;
    try {
      payload = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Invalid JSON');
    }

    if (!payload || (payload.type !== 'ai-autofill-export' && !Array.isArray(payload))) {
      throw new Error('INVALID_FORMAT');
    }

    let dataToSave = Array.isArray(payload) ? payload : payload.data;
    let metadata = payload.metadata;
    let isSafeMode = payload.isSafeMode || false;

    if (isSafeMode && metadata) {
      // If importing a Safe Mode export, we adopt its security settings
      await new Promise((resolve) => {
        chrome.storage.local.set({
          isSafeMode: true,
          salt: metadata.salt,
          encryptedDataKey: metadata.encryptedDataKey,
          validator: metadata.validator,
          personalInfo: dataToSave
        }, resolve);
      });
      this.lock(); // Lock until user provides password again
    } else {
      // Plain import
      await new Promise((resolve) => {
        chrome.storage.local.set({
          isSafeMode: false,
          salt: null,
          encryptedDataKey: null,
          validator: null,
          personalInfo: dataToSave
        }, resolve);
      });
      this.lock();
    }
    return true;
  }
};
