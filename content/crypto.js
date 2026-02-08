// content/crypto.js

const CryptoManager = {
  ALGO_NAME: 'AES-GCM',
  ITERATIONS: 100000,

  /**
   * Derives a cryptographic key from a password.
   */
  async deriveMasterKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.ITERATIONS,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: this.ALGO_NAME, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  async encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: this.ALGO_NAME, iv },
      key,
      encoder.encode(JSON.stringify(data))
    );

    return {
      ciphertext: this.bufferToHex(ciphertext),
      iv: this.bufferToHex(iv)
    };
  },

  async decrypt(encryptedObj, key) {
    const ciphertext = this.hexToBuffer(encryptedObj.ciphertext);
    const iv = this.hexToBuffer(encryptedObj.iv);

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: this.ALGO_NAME, iv },
        key,
        ciphertext
      );
      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(decrypted));
    } catch (e) {
      throw new Error('Decryption failed. Incorrect password?');
    }
  },

  /**
   * Generates a random AES key (The "Keychain")
   */
  async generateDataKey() {
    return crypto.subtle.generateKey(
      { name: this.ALGO_NAME, length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Exports a key to a hex string for storage (after encryption)
   */
  async exportKey(key) {
    const exported = await crypto.subtle.exportKey('raw', key);
    return this.bufferToHex(exported);
  },

  /**
   * Imports a key from a raw buffer
   */
  async importKey(rawBuffer) {
    return crypto.subtle.importKey(
      'raw',
      rawBuffer,
      this.ALGO_NAME,
      true,
      ['encrypt', 'decrypt']
    );
  },

  bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },

  hexToBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes.buffer;
  }
};
