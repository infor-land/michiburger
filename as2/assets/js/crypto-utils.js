
// assets/js/crypto-utils.js
// Gestor de cifrado AES-256-GCM con contraseña maestra (para navegador, ES module)

class CryptoManager {
  constructor(masterPassword = null) {
    this.masterPassword = masterPassword;
    this._keyCache = new Map();
  }

  setMasterPassword(password) {
    this.masterPassword = password || null;
    this._keyCache.clear();
  }

  // ---- helpers base64 / ArrayBuffer ----
  _bufToB64(buf) {
    const arr = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < arr.length; i++) {
      bin += String.fromCharCode(arr[i]);
    }
    return btoa(bin);
  }

  _b64ToBuf(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr.buffer;
  }

  // ---- detección de formato cifrado ----
  isEncrypted(text) {
    if (!text || typeof text !== "string") return false;
    try {
      const json = JSON.parse(atob(text));
      return (
        typeof json === "object" &&
        "salt" in json &&
        "nonce" in json &&
        "ciphertext" in json
      );
    } catch {
      return false;
    }
  }

  // ---- derivación de clave desde contraseña ----
  async _deriveKey(salt) {
    if (!this.masterPassword) {
      throw new Error("No se ha establecido la contraseña maestra");
    }

    const cacheKey = this._bufToB64(salt);
    if (this._keyCache.has(cacheKey)) {
      return this._keyCache.get(cacheKey);
    }

    const encoder = new TextEncoder();
    const pw = encoder.encode(this.masterPassword);

    const baseKey = await crypto.subtle.importKey(
      "raw",
      pw,
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    this._keyCache.set(cacheKey, derivedKey);
    return derivedKey;
  }

  // ---- cifrar ----
  async encrypt(plaintext) {
    if (!plaintext || !this.masterPassword) return plaintext;

    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await this._deriveKey(salt);

    const cipherBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      data
    );

    const payload = {
      salt: this._bufToB64(salt),
      nonce: this._bufToB64(nonce),
      ciphertext: this._bufToB64(cipherBuf)
    };

    return btoa(JSON.stringify(payload));
  }

  // ---- descifrar ----
  async decrypt(encryptedText) {
    if (!encryptedText || !this.masterPassword) return encryptedText;

    try {
      const json = JSON.parse(atob(encryptedText));

      const salt = new Uint8Array(this._b64ToBuf(json.salt));
      const nonce = new Uint8Array(this._b64ToBuf(json.nonce));
      const ciphertext = this._b64ToBuf(json.ciphertext);

      const key = await this._deriveKey(salt);

      const plainBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        key,
        ciphertext
      );

      return new TextDecoder().decode(plainBuf);
    } catch (err) {
      console.error("[Crypto] Error al desencriptar:", err);
      return "[ENCRIPTADO]";
    }
  }
}

// Instancia global que usaremos en app.js / store.js
export const cryptoManager = new CryptoManager();
export { CryptoManager };
