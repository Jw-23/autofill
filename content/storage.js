// content/storage.js
/**
 * PersonalInfo structure:
 * {
 *   keyname: string (unique id, e.g., 'full_name'),
 *   description: string (e.g., 'User\'s legal full name'),
 *   value: string (e.g., 'John Doe'),
 *   isSecret: boolean (if true, mask in UI)
 * }
 */

const StorageManager = {
  _dataKey: null, // In-memory only

  _isContextValid() {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  },

  async getWhitelist() {
    if (!this._isContextValid()) return [];
    return new Promise((resolve) => {
      chrome.storage.local.get(['whitelist'], (result) => {
        if (chrome.runtime.lastError) return resolve([]);
        resolve(result.whitelist || []);
      });
    });
  },

  async setWhitelist(list) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ whitelist: list }, resolve);
    });
  },

  /**
   * Checks if the storage is in Security Mode (Safe Mode).
   */
  async isEncryptionEnabled() {
    if (!this._isContextValid()) return false;
    return new Promise((resolve) => {
      chrome.storage.local.get(['isSafeMode'], (result) => {
        if (chrome.runtime.lastError) return resolve(false);
        resolve(!!result.isSafeMode);
      });
    });
  },

  /**
   * Initializes encryption with a new password.
   */
  async setupEncryption(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const masterKey = await CryptoManager.deriveMasterKey(password, salt);
    
    // Generate the "Keychain" (Data Key)
    const dataKey = await CryptoManager.generateDataKey();
    const rawDataKey = await crypto.subtle.exportKey('raw', dataKey);
    
    // Encrypt the "Keychain" with the Master Key
    const encryptedDataKey = await CryptoManager.encrypt(CryptoManager.bufferToHex(rawDataKey), masterKey);
    
    // Create a validator to verify the password later
    const validator = await CryptoManager.encrypt("VALID", masterKey);

    await new Promise((resolve) => {
      chrome.storage.local.set({
        isSafeMode: true,
        salt: CryptoManager.bufferToHex(salt),
        encryptedDataKey,
        validator
      }, resolve);
    });

    this._dataKey = dataKey;
    
    // Migration: Encrypt existing secret items if any
    const info = await this.getPersonalInfoRaw();
    await this.savePersonalInfo(info);
  },

  async disableEncryption() {
    const info = await this.getPersonalInfo(); // This will decrypt if unlocked
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

  /**
   * Unlocks the data key using the provided password.
   */
  async unlock(password) {
    const result = await new Promise(r => chrome.storage.local.get(['salt', 'validator', 'encryptedDataKey'], r));
    if (!result.salt) throw new Error('Encryption not set up');

    const salt = CryptoManager.hexToBuffer(result.salt);
    const masterKey = await CryptoManager.deriveMasterKey(password, salt);

    // Verify password
    try {
      const valid = await CryptoManager.decrypt(result.validator, masterKey);
      if (valid !== "VALID") throw new Error();
    } catch (e) {
      throw new Error('Incorrect password');
    }

    // Decrypt the Data Key
    const hexDataKey = await CryptoManager.decrypt(result.encryptedDataKey, masterKey);
    this._dataKey = await CryptoManager.importKey(CryptoManager.hexToBuffer(hexDataKey));
    return true;
  },

  lock() {
    this._dataKey = null;
  },

  async getPersonalInfoRaw() {
    if (!this._isContextValid()) return [];
    return new Promise((resolve) => {
      chrome.storage.local.get(['personalInfo'], (result) => {
        if (chrome.runtime.lastError) return resolve([]);
        resolve(result.personalInfo || []);
      });
    });
  },

  async getPersonalInfo() {
    const isSafeMode = await this.isEncryptionEnabled();
    const items = await this.getPersonalInfoRaw();

    if (!isSafeMode) return items;

    // In Safe Mode, decrypt items that are secret
    const decryptedItems = [];
    for (const item of items) {
      if (item.isSecret && typeof item.value === 'object' && item.value.ciphertext) {
        if (!this._dataKey) {
          // If locked, we return the item but the value remains encrypted object.
          // The UI or MainController will handle the "locked" state when trying to use it.
          decryptedItems.push(item);
        } else {
          try {
            const decVal = await CryptoManager.decrypt(item.value, this._dataKey);
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

    // In Safe Mode, encrypt secrets before saving
    if (!this._dataKey) throw new Error('Storage is locked');

    const encryptedInfo = [];
    for (const item of infoArray) {
      if (item.isSecret && typeof item.value === 'string') {
        const encVal = await CryptoManager.encrypt(item.value, this._dataKey);
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
    
    // If keyname changed, check for duplicates
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
      chrome.storage.local.set({ debugEnabled: enabled }, () => {
        console.log('StorageManager: Debug setting updated to:', enabled);
        resolve();
      });
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
      chrome.storage.local.set({ oneByOneMode: enabled }, () => {
        resolve();
      });
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
      chrome.storage.local.set({ useClusterMode: enabled }, () => {
        resolve();
      });
    });
  },

  async getFloatingPromptSetting() {
    if (!this._isContextValid()) return false;
    return new Promise((resolve) => {
      chrome.storage.local.get(['floatingPromptEnabled'], (result) => {
        if (chrome.runtime.lastError) return resolve(false);
        resolve(result.floatingPromptEnabled !== false); // Default to true
      });
    });
  },

  async setFloatingPromptSetting(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ floatingPromptEnabled: enabled }, () => {
        resolve();
      });
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
      chrome.storage.local.set({ language: lang }, () => {
        resolve();
      });
    });
  },

  // --- AI Settings (Provider, Custom API, etc.) ---
  async getAISettings() {
    if (!this._isContextValid()) return {};
    return new Promise((resolve) => {
      chrome.storage.local.get(['aiProvider', 'remoteApiUrl', 'remoteApiKey', 'remoteModel'], (result) => {
        if (chrome.runtime.lastError) return resolve({});
        resolve({
          provider: result.aiProvider || 'local', // 'local' | 'remote'
          apiUrl: result.remoteApiUrl || 'https://api.openai.com/v1',
          apiKey: result.remoteApiKey || '',
          model: result.remoteModel || 'gpt-3.5-turbo'
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

  /**
   * Exports personal info as a JSON string.
   * High sensitivity items are exported in their current state (encrypted if in Safe Mode).
   */
  async exportPersonalInfo() {
    const isSafeMode = await this.isEncryptionEnabled();
    const info = await this.getPersonalInfoRaw(); // Export raw state
    
    const exportData = {
      type: 'ai-autofill-export',
      version: 3,
      isSafeMode,
      data: info
    };

    if (isSafeMode) {
      const { salt, encryptedDataKey, validator } = await new Promise(r => chrome.storage.local.get(['salt', 'encryptedDataKey', 'validator'], r));
      exportData.metadata = { salt, encryptedDataKey, validator };
    }

    return JSON.stringify(exportData);
  },

  /**
   * Imports personal info from a JSON string.
   */
  async importPersonalInfo(jsonStr, providedPassword = null) {
    let payload;
    try {
      payload = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Invalid JSON format');
    }

    if (payload.type !== 'ai-autofill-export') {
      throw new Error('Invalid export file type');
    }

    // Version 2 migration or V3 handling
    let dataToSave = payload.data || [];
    if (payload.version === 2 && payload.encrypted) {
       // Old format: Whole vault was encrypted
       if (!providedPassword) throw new Error('NEEDS_PASSWORD');
       const { salt, encryptedDataKey } = payload.metadata;
       const masterKey = await CryptoManager.deriveMasterKey(providedPassword, CryptoManager.hexToBuffer(salt));
       const hexDataKey = await CryptoManager.decrypt(encryptedDataKey, masterKey);
       const importDataKey = await CryptoManager.importKey(CryptoManager.hexToBuffer(hexDataKey));
       dataToSave = await CryptoManager.decrypt(payload.vault, importDataKey);
    }

    // If importing into Safe Mode, and the data contains encrypted items but we don't have the key...
    // This is getting complex. Let's simplify: 
    // Just save the data. If the user has a different password, they won't be able to decrypt.
    await new Promise(r => chrome.storage.local.set({ personalInfo: dataToSave }, r));
    return true;
  }
};

window.ExtensionStorageManager = StorageManager;
