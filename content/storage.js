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
  async getPersonalInfo() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['personalInfo'], (result) => {
        resolve(result.personalInfo || []);
      });
    });
  },

  async savePersonalInfo(infoArray) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ personalInfo: infoArray }, () => {
        resolve();
      });
    });
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
