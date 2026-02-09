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

  /**
   * Checks if the storage is protected by a password.
   */
  async isEncryptionEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['isEncrypted'], (result) => {
        resolve(!!result.isEncrypted);
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
        isEncrypted: true,
        salt: CryptoManager.bufferToHex(salt),
        encryptedDataKey,
        validator,
        vault: null // No data yet
      }, resolve);
    });

    this._dataKey = dataKey;
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

  async getPersonalInfo() {
    const encryptionEnabled = await this.isEncryptionEnabled();
    if (!encryptionEnabled) {
      return new Promise((resolve) => {
        chrome.storage.local.get(['personalInfo'], (result) => {
          resolve(result.personalInfo || []);
        });
      });
    }

    if (!this._dataKey) {
      throw new Error('Storage is locked. Please provide password.');
    }

    const { vault } = await new Promise(r => chrome.storage.local.get(['vault'], r));
    if (!vault) return [];

    return await CryptoManager.decrypt(vault, this._dataKey);
  },

  async savePersonalInfo(infoArray) {
    const encryptionEnabled = await this.isEncryptionEnabled();
    if (!encryptionEnabled) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ personalInfo: infoArray }, () => {
          resolve();
        });
      });
    }

    if (!this._dataKey) throw new Error('Storage is locked');

    const encryptedVault = await CryptoManager.encrypt(infoArray, this._dataKey);
    await new Promise(r => chrome.storage.local.set({ vault: encryptedVault }, r));
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
    return new Promise((resolve) => {
      chrome.storage.local.get(['aiProvider', 'remoteApiUrl', 'remoteApiKey', 'remoteModel'], (result) => {
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
   * If encrypted, exports the encrypted vault along with its keys.
   */
  async exportPersonalInfo() {
    const isEncrypted = await this.isEncryptionEnabled();
    if (isEncrypted && !this._dataKey) throw new Error('Storage is locked');

    if (isEncrypted) {
      const { vault, salt, encryptedDataKey, validator } = await new Promise(r => chrome.storage.local.get(['vault', 'salt', 'encryptedDataKey', 'validator'], r));
      return JSON.stringify({
        type: 'ai-autofill-export',
        version: 2,
        encrypted: true,
        metadata: { salt, encryptedDataKey, validator },
        vault: vault
      });
    } else {
      const info = await this.getPersonalInfo();
      return JSON.stringify({
        type: 'ai-autofill-export',
        version: 2,
        encrypted: false,
        data: info
      });
    }
  },

  /**
   * Imports personal info from a JSON string.
   * If the dataKey doesn't match, it can use a provided password to re-encrypt.
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

    const isCurrentEncrypted = await this.isEncryptionEnabled();
    
    // If storage is encrypted but locked, we must unlock it first to be able to save
    if (isCurrentEncrypted && !this._dataKey) {
      if (providedPassword) {
        try {
          await this.unlock(providedPassword);
        } catch (e) {
          throw new Error('INVALID_VAULT_PASSWORD'); // Password failed to unlock vault
        }
      } else {
        throw new Error('NEEDS_PASSWORD'); // Trigger prompt
      }
    }

    let dataToSave = null;

    if (!payload.encrypted) {
      // Importing plain text data
      dataToSave = payload.data;
    } else {
      // Importing encrypted data
      if (isCurrentEncrypted) {
        if (!this._dataKey) throw new Error('Storage is locked');

        // 1. Try with current session key
        try {
          dataToSave = await CryptoManager.decrypt(payload.vault, this._dataKey);
        } catch (e) {
          // 2. If it fails, try to use metadata + provided password
          if (!providedPassword) {
            throw new Error('NEEDS_PASSWORD'); // Special signal for UI
          }

          try {
            const { salt, encryptedDataKey } = payload.metadata;
            const masterKey = await CryptoManager.deriveMasterKey(providedPassword, CryptoManager.hexToBuffer(salt));
            const hexDataKey = await CryptoManager.decrypt(encryptedDataKey, masterKey);
            const importDataKey = await CryptoManager.importKey(CryptoManager.hexToBuffer(hexDataKey));
            dataToSave = await CryptoManager.decrypt(payload.vault, importDataKey);
          } catch (err) {
            throw new Error('Verification failed: Incorrect password for this backup.');
          }
        }
      } else {
        // Current storage is NOT encrypted, but file IS encrypted.
        // We need the password even if current storage is plain.
        if (!providedPassword) {
          throw new Error('NEEDS_PASSWORD');
        }
        try {
          const { salt, encryptedDataKey } = payload.metadata;
          const masterKey = await CryptoManager.deriveMasterKey(providedPassword, CryptoManager.hexToBuffer(salt));
          const hexDataKey = await CryptoManager.decrypt(encryptedDataKey, masterKey);
          const importDataKey = await CryptoManager.importKey(CryptoManager.hexToBuffer(hexDataKey));
          dataToSave = await CryptoManager.decrypt(payload.vault, importDataKey);
        } catch (err) {
          throw new Error('Verification failed: Incorrect password for this backup.');
        }
      }
    }

    if (dataToSave) {
      // savePersonalInfo handles encryption if enabled
      await this.savePersonalInfo(dataToSave);
      return true;
    }
    throw new Error('Failed to parse import data');
  }
};

window.ExtensionStorageManager = StorageManager;
