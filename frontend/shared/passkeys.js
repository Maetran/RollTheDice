/**
 * Browser-side WebAuthn conversion helpers.
 *
 * The API deliberately transports JSON-safe base64url values.  Keeping the
 * conversions here avoids a second dependency and makes every caller submit
 * the exact WebAuthn response without ever handling private key material.
 */

export class PasskeyBrowserError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function passkeysSupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials?.get && navigator.credentials?.create);
}

function base64urlToBytes(value) {
  if (typeof value !== "string" || !value) throw new PasskeyBrowserError("passkey_options_invalid");
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
    const binary = window.atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch (_) {
    throw new PasskeyBrowserError("passkey_options_invalid");
  }
}

function bytesToBase64url(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes) throw new PasskeyBrowserError("passkey_response_invalid");
  let binary = "";
  // Small WebAuthn values are common, but chunking keeps a large attestation
  // response safely below the argument limit of String.fromCharCode.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function credentialDescriptors(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item || typeof item !== "object") throw new PasskeyBrowserError("passkey_options_invalid");
    return { ...item, id: base64urlToBytes(item.id) };
  });
}

function requestOptions(options) {
  if (!options || typeof options !== "object") throw new PasskeyBrowserError("passkey_options_invalid");
  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    allowCredentials: credentialDescriptors(options.allowCredentials),
  };
}

function creationOptions(options) {
  if (!options || typeof options !== "object" || !options.user || typeof options.user !== "object") {
    throw new PasskeyBrowserError("passkey_options_invalid");
  }
  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    user: { ...options.user, id: base64urlToBytes(options.user.id) },
    excludeCredentials: credentialDescriptors(options.excludeCredentials),
  };
}

function credentialPayload(credential) {
  if (!credential?.response || !credential.rawId || !credential.id || !credential.type) {
    throw new PasskeyBrowserError("passkey_response_invalid");
  }
  const response = credential.response;
  const result = {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64url(response.clientDataJSON),
    },
    clientExtensionResults: typeof credential.getClientExtensionResults === "function"
      ? credential.getClientExtensionResults()
      : {},
  };
  if (typeof credential.authenticatorAttachment === "string") {
    result.authenticatorAttachment = credential.authenticatorAttachment;
  }
  if (response.attestationObject) {
    result.response.attestationObject = bytesToBase64url(response.attestationObject);
  }
  if (response.authenticatorData) {
    result.response.authenticatorData = bytesToBase64url(response.authenticatorData);
  }
  if (response.signature) {
    result.response.signature = bytesToBase64url(response.signature);
  }
  if (response.userHandle) {
    result.response.userHandle = bytesToBase64url(response.userHandle);
  }
  return result;
}

function browserFailure(error) {
  if (error instanceof PasskeyBrowserError) return error;
  if (error?.name === "NotAllowedError") return new PasskeyBrowserError("passkey_cancelled");
  if (error?.name === "InvalidStateError") return new PasskeyBrowserError("passkey_already_registered");
  return new PasskeyBrowserError("passkey_browser_failed");
}

export async function requestPasskeyAssertion(options) {
  if (!passkeysSupported()) throw new PasskeyBrowserError("passkey_not_supported");
  try {
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    return credentialPayload(credential);
  } catch (error) {
    throw browserFailure(error);
  }
}

export async function createPasskeyCredential(options) {
  if (!passkeysSupported()) throw new PasskeyBrowserError("passkey_not_supported");
  try {
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
    return credentialPayload(credential);
  } catch (error) {
    throw browserFailure(error);
  }
}
