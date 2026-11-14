import { datasetSchema, envelopeSchema, type Dataset, type VaultEnvelope } from './models';
import { CHECKUP_CONTROLS, controlKey } from './checkupCatalog';

const ITERATIONS = 600_000;
// Stable storage ID: existing installations must keep finding their encrypted vault.
const DB_NAME = 'personal-cyber-os';
const STORE_NAME = 'encrypted-vault';
const VAULT_KEY = 'primary';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < value.length; i += 0x8000) binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
}

export interface UnlockContext { key: CryptoKey; salt: Uint8Array; iterations: number; envelopeMetadata?: Record<string, unknown> }

export class UnsupportedVaultError extends Error {
  constructor(public readonly kind: 'format' | 'version' | 'data') {
    super(`unsupported-vault-${kind}`);
    this.name = 'UnsupportedVaultError';
  }
}

function parseEnvelope(value: unknown): VaultEnvelope {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) throw new UnsupportedVaultError('format');
  return parsed.data;
}

function migrateDataset(value: unknown): Dataset {
  if (!value || typeof value !== 'object' || !('version' in value)) throw new UnsupportedVaultError('data');
  if (value.version !== 1 && value.version !== 2) throw new UnsupportedVaultError('version');
  if (value.version === 2 && 'securityModel' in value) {
    const model = value.securityModel;
    if (model && typeof model === 'object' && 'revision' in model && typeof model.revision === 'number' && model.revision !== 1 && model.revision !== 2 && model.revision !== 3 && model.revision !== 4 && model.revision !== 5) throw new UnsupportedVaultError('version');
  }
  const parsed = datasetSchema.safeParse(value);
  if (!parsed.success) throw new UnsupportedVaultError('data');
  const data = parsed.data;
  const assessmentAnswers = { ...data.assessmentAnswers };
  for (const control of CHECKUP_CONTROLS) {
    if (!control.assetKind || !control.assetControl) continue;
    for (const asset of data.assets.filter((item) => item.kind === control.assetKind)) {
      const key = controlKey(control.id, asset.id);
      if (assessmentAnswers[key]) continue;
      const state = asset.controls[control.assetControl] ?? 'unknown';
      if (state === 'unknown') continue;
      const response = state === 'needs-improvement' ? 'no' : state === 'na' ? 'not-applicable' : 'yes';
      assessmentAnswers[key] = {
        response,
        evidence: state === 'verified' ? 'user-confirmed' : 'user-reported',
        updatedAt: asset.updatedAt,
      };
    }
  }
  return { ...data, assessmentAnswers };
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations = ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptDataset(data: Dataset, context: UnlockContext): Promise<VaultEnvelope> {
  const parsed = datasetSchema.parse(data);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, context.key, encoder.encode(JSON.stringify(parsed)));
  return {
    ...context.envelopeMetadata,
    format: 'personal-cyber-os-v1', algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256',
    iterations: context.iterations, salt: toBase64(context.salt), iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function createEncryptedVault(passphrase: string, data: Dataset, envelopeMetadata?: Record<string, unknown>): Promise<{ envelope: VaultEnvelope; context: UnlockContext }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const context = { key: await deriveKey(passphrase, salt), salt, iterations: ITERATIONS, envelopeMetadata };
  return { envelope: await encryptDataset(data, context), context };
}

export async function updateEncryptedVault(data: Dataset, context: UnlockContext): Promise<VaultEnvelope> {
  return encryptDataset(data, context);
}

export async function decryptVault(envelopeInput: unknown, passphrase: string): Promise<{ data: Dataset; context: UnlockContext }> {
  const envelope = parseEnvelope(envelopeInput);
  const salt = fromBase64(envelope.salt);
  const envelopeMetadata = Object.fromEntries(Object.entries(envelope).filter(([key]) => !['format', 'algorithm', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'].includes(key)));
  const context: UnlockContext = { key: await deriveKey(passphrase, salt, envelope.iterations), salt, iterations: envelope.iterations, envelopeMetadata };
  let clear: ArrayBuffer;
  try {
    clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(fromBase64(envelope.iv)) }, context.key, toArrayBuffer(fromBase64(envelope.ciphertext)));
  } catch {
    throw new Error('wrong-passphrase-or-damaged-vault');
  }
  let value: unknown;
  try { value = JSON.parse(decoder.decode(clear)); } catch { throw new UnsupportedVaultError('data'); }
  return { data: migrateDataset(value), context };
}

export async function rekeyVault(data: Dataset, newPassphrase: string, previousContext?: UnlockContext): Promise<{ envelope: VaultEnvelope; context: UnlockContext }> {
  return createEncryptedVault(newPassphrase, data, previousContext?.envelopeMetadata);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

export async function readStoredEnvelope(): Promise<unknown | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(VAULT_KEY);
    request.onsuccess = () => { db.close(); resolve(request.result === undefined ? null : request.result); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function readEnvelope(): Promise<VaultEnvelope | null> {
  const stored = await readStoredEnvelope();
  return stored === null ? null : parseEnvelope(stored);
}

export async function writeEnvelope(envelope: VaultEnvelope): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(envelope, VAULT_KEY);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Vault write aborted')); };
  });
}

export async function deleteEnvelope(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(VAULT_KEY);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export function downloadEncryptedBackup(envelope: VaultEnvelope): void {
  downloadStoredBackup(envelope, 'cyber-security-map-backup');
}

// Keep the stored object intact even when this app cannot interpret its format.
export function downloadStoredBackup(value: unknown, prefix = 'cyber-security-map-original'): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
