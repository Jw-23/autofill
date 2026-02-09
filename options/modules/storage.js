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
      chrome.storage.local.get(['isEncrypted'], (result) => {
        resolve(!!result.isEncrypted);
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
        isEncrypted: true,
        salt: VaultCrypto.bufferToHex(salt),
        encryptedDataKey,
        validator,
        vault: null
      }, resolve);
    });

    this._dataKey = dataKey;
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
      throw new Error('locked'); // Simplified error for checking
    }

    const { vault } = await new Promise(r => chrome.storage.local.get(['vault'], r));
    if (!vault) return [];

    return await VaultCrypto.decrypt(vault, this._dataKey);
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

    const encryptedVault = await VaultCrypto.encrypt(infoArray, this._dataKey);
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

  async importPersonalInfo(jsonStr, providedPassword = null) {
    let payload;
    try {
      payload = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Invalid JSON');
    }

    const isCurrentEncrypted = await this.isEncryptionEnabled();
    let dataToSave = null;
    let importedMetadata = null;
    let fileIsEncrypted = false;

    // 1. Identify Format and Extract Raw Data
    if (payload && payload.type === 'ai-autofill-export') {
      if (payload.encrypted) {
        fileIsEncrypted = true;
        if (!providedPassword) {
          throw new Error('NEEDS_PASSWORD');
        }
        try {
          const { salt, encryptedDataKey } = payload.metadata;
          const masterKey = await VaultCrypto.deriveMasterKey(providedPassword, VaultCrypto.hexToBuffer(salt));
          const hexDataKey = await VaultCrypto.decrypt(encryptedDataKey, masterKey);
          const importDataKey = await VaultCrypto.importKey(VaultCrypto.hexToBuffer(hexDataKey));
          dataToSave = await VaultCrypto.decrypt(payload.vault, importDataKey);
          importedMetadata = payload.metadata;
        } catch (e) {
          throw new Error('INVALID_VAULT_PASSWORD');
        }
      } else {
        dataToSave = payload.data;
      }
    } else if (Array.isArray(payload)) {
      dataToSave = payload;
    } else if (payload && Array.isArray(payload.data)) {
      // Fallback for objects that might look like export but miss the type tag
      dataToSave = payload.data;
    } else {
      throw new Error('INVALID_FORMAT');
    }

    if (!dataToSave) {
      throw new Error('IMPORT_FAILED');
    }

    // 2. Handle Storage into Local Vault
    if (isCurrentEncrypted) {
      // If encrypted, we verify password (unlock) then save.
      if (!this._dataKey) {
        if (!providedPassword) {
          throw new Error('NEEDS_PASSWORD');
        }
        try {
          await this.unlock(providedPassword);
        } catch (e) {
          // If we successfully decrypted the file from *another* vault (importedMetadata exists)
          // but failed to unlock the *local* vault, we can adopt the imported security settings.
          if (importedMetadata) {
            await new Promise((resolve) => {
              chrome.storage.local.set({
                salt: importedMetadata.salt,
                encryptedDataKey: importedMetadata.encryptedDataKey,
                validator: importedMetadata.validator
              }, resolve);
            });
            await this.unlock(providedPassword);
          } else {
            // Plain text import. Unlock failed with the provided password.
            // Since this is a plain text import, strict password matching against the old vault 
            // is not required to read the file (it's plain text).
            // We interpret "providing a password" as "I want to encrypt this new data with THIS password".
            // Therefore, if unlock fails (wrong password or corrupted vault), 
            // we simply re-initialize the encryption with the provided password.
            await this.setupEncryption(providedPassword);
          }
        }
      }
      // If we are here, we are either unlocked (via successful unlock) 
      // or re-initialized (via setupEncryption). _dataKey should be set.
      if (!this._dataKey) {
          throw new Error('INVALID_VAULT_PASSWORD');
      }
      await this.savePersonalInfo(dataToSave);
    } else {
      // If NOT encrypted, directly import (as requested by user).
      // We do not force encryption here.
      await this.savePersonalInfo(dataToSave);
    }
    return true;
  }
};
