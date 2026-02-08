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
  }
};
