export type MessageStatus = 'pending' | 'relayed' | 'delivered';

export type UserProfile = {
  id: string;
  name: string;
  className: string;
  school: string;
};

export type IdentityKeys = {
  encryptionPrivateKey: JsonWebKey;
  encryptionPublicKey: JsonWebKey;
  signingPrivateKey: JsonWebKey;
  signingPublicKey: JsonWebKey;
};

export type ContactCard = {
  version: 1;
  id: string;
  name: string;
  className: string;
  school: string;
  encryptionPublicKey: JsonWebKey;
  signingPublicKey: JsonWebKey;
};

export type Contact = {
  card: ContactCard;
  verified: boolean;
  addedAt: string;
  lastSeenAt?: string;
};

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  direction: 'incoming' | 'outgoing';
  status: MessageStatus;
  relayCount: number;
};

export type SchoolTask = {
  id: string;
  title: string;
  subject: string;
  due: string;
  completed: boolean;
  shared?: boolean;
  senderId?: string;
};

export type Note = {
  id: string;
  body: string;
  updatedAt: string;
};

export type SealedContent =
  | { kind: 'message'; body: string; sender: ContactCard }
  | { kind: 'task'; task: SchoolTask; sender: ContactCard };

export type OutgoingContent =
  | { kind: 'message'; body: string }
  | { kind: 'task'; task: SchoolTask };

export type RelayEnvelope = {
  version: 1;
  id: string;
  senderId: string;
  recipientId: string;
  createdAt: string;
  expiresAt: string;
  maxHops: number;
  iv: string;
  ciphertext: string;
  ephemeralPublicKey: JsonWebKey;
  signature: string;
};

export type RelayRecord = {
  envelope: RelayEnvelope;
  hops: number;
  copiesLeft: number;
  forwardedTo: string[];
};

export type DeliveryReceipt = {
  version: 1;
  messageId: string;
  fromId: string;
  toId: string;
  createdAt: string;
  signature: string;
};

export type StoredReceipt = {
  receipt: DeliveryReceipt;
  forwardedTo: string[];
};

export type AccountData = {
  schemaVersion: 2;
  user: UserProfile;
  identity: IdentityKeys;
  contacts: Contact[];
  messages: ChatMessage[];
  tasks: SchoolTask[];
  notes: Note[];
  relayStore: RelayRecord[];
  receiptStore: StoredReceipt[];
  seenEnvelopeIds: string[];
  seenReceiptIds: string[];
  updatedAt: string;
};

export type AccountSummary = Pick<UserProfile, 'id' | 'name' | 'className' | 'school'> & {
  updatedAt: string;
};

const DATABASE_NAME = 'schultag-local-v2';
const DATABASE_VERSION = 1;
const CONTACT_PREFIX = 'SCHULTAG-CONTACT-1.';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB-Anfrage fehlgeschlagen.'));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB-Transaktion wurde abgebrochen.'));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('accounts')) {
        database.createObjectStore('accounts', { keyPath: 'user.id' });
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Lokale Datenbank konnte nicht geöffnet werden.'));
  });
}

export async function saveAccount(account: AccountData) {
  const database = await openDatabase();
  const transaction = database.transaction(['accounts'], 'readwrite');
  transaction.objectStore('accounts').put({ ...account, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  database.close();
}

export async function loadAccount(accountId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(['accounts'], 'readonly');
  const account = await requestResult(transaction.objectStore('accounts').get(accountId));
  await transactionDone(transaction);
  database.close();
  return account as AccountData | undefined;
}

export async function setActiveAccountId(accountId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(['meta'], 'readwrite');
  transaction.objectStore('meta').put({ key: 'activeAccountId', value: accountId });
  await transactionDone(transaction);
  database.close();
}

export async function loadActiveAccount() {
  const database = await openDatabase();
  const transaction = database.transaction(['accounts', 'meta'], 'readonly');
  const meta = await requestResult(transaction.objectStore('meta').get('activeAccountId')) as { value?: string } | undefined;
  let account = meta?.value
    ? await requestResult(transaction.objectStore('accounts').get(meta.value)) as AccountData | undefined
    : undefined;
  if (!account) {
    const accounts = await requestResult(transaction.objectStore('accounts').getAll()) as AccountData[];
    account = accounts[0];
  }
  await transactionDone(transaction);
  database.close();
  return account;
}

export async function listAccounts() {
  const database = await openDatabase();
  const transaction = database.transaction(['accounts'], 'readonly');
  const accounts = await requestResult(transaction.objectStore('accounts').getAll()) as AccountData[];
  await transactionDone(transaction);
  database.close();
  return accounts
    .map((account): AccountSummary => ({ ...account.user, updatedAt: account.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createId(prefix: string) {
  const value = 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalPublicKeys(encryptionPublicKey: JsonWebKey, signingPublicKey: JsonWebKey) {
  const select = (key: JsonWebKey) => ({ kty: key.kty, crv: key.crv, x: key.x, y: key.y });
  return JSON.stringify({ encryption: select(encryptionPublicKey), signing: select(signingPublicKey) });
}

export async function derivePersonId(encryptionPublicKey: JsonWebKey, signingPublicKey: JsonWebKey) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(canonicalPublicKeys(encryptionPublicKey, signingPublicKey)),
  ));
  const hex = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `SCH-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export async function createAccount(name: string, className = '', school = '') {
  const encryptionKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const signingKeys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const identity: IdentityKeys = {
    encryptionPrivateKey: await crypto.subtle.exportKey('jwk', encryptionKeys.privateKey),
    encryptionPublicKey: await crypto.subtle.exportKey('jwk', encryptionKeys.publicKey),
    signingPrivateKey: await crypto.subtle.exportKey('jwk', signingKeys.privateKey),
    signingPublicKey: await crypto.subtle.exportKey('jwk', signingKeys.publicKey),
  };
  const id = await derivePersonId(identity.encryptionPublicKey, identity.signingPublicKey);
  const now = new Date().toISOString();
  const account: AccountData = {
    schemaVersion: 2,
    user: { id, name: name.trim() || 'Mein Profil', className, school },
    identity,
    contacts: [],
    messages: [],
    tasks: [
      { id: createId('task'), title: 'Seite 42, Nr. 3–6', subject: 'Mathematik', due: 'morgen', completed: false },
      { id: createId('task'), title: 'Vocabulary Unit 2', subject: 'Englisch', due: 'Mittwoch', completed: false },
    ],
    notes: [{ id: createId('note'), body: '', updatedAt: now }],
    relayStore: [],
    receiptStore: [],
    seenEnvelopeIds: [],
    seenReceiptIds: [],
    updatedAt: now,
  };
  return account;
}

export function getContactCard(account: AccountData): ContactCard {
  return {
    version: 1,
    ...account.user,
    encryptionPublicKey: account.identity.encryptionPublicKey,
    signingPublicKey: account.identity.signingPublicKey,
  };
}

export function encodeContactCard(card: ContactCard) {
  return `${CONTACT_PREFIX}${bytesToBase64Url(textEncoder.encode(JSON.stringify(card)))}`;
}

export async function decodeContactCard(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(CONTACT_PREFIX)) throw new Error('Das ist kein gültiger Schultag-Kontaktcode.');
  const parsed = JSON.parse(textDecoder.decode(base64UrlToBytes(trimmed.slice(CONTACT_PREFIX.length)))) as ContactCard;
  if (parsed.version !== 1 || !parsed.id || !parsed.name || !parsed.encryptionPublicKey || !parsed.signingPublicKey) {
    throw new Error('Der Kontaktcode ist unvollständig.');
  }
  const expectedId = await derivePersonId(parsed.encryptionPublicKey, parsed.signingPublicKey);
  if (parsed.id !== expectedId) throw new Error('Die Kontakt-ID passt nicht zu den enthaltenen Schlüsseln.');
  return parsed;
}

async function importEncryptionPublicKey(key: JsonWebKey) {
  return crypto.subtle.importKey('jwk', key, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function importEncryptionPrivateKey(key: JsonWebKey) {
  return crypto.subtle.importKey('jwk', key, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']);
}

async function importSigningPrivateKey(key: JsonWebKey) {
  return crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function importSigningPublicKey(key: JsonWebKey) {
  return crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

async function deriveMessageKey(privateKey: CryptoKey, publicKey: CryptoKey, usages: KeyUsage[]) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

function unsignedEnvelope(envelope: RelayEnvelope | Omit<RelayEnvelope, 'signature'>) {
  return {
    version: envelope.version,
    id: envelope.id,
    senderId: envelope.senderId,
    recipientId: envelope.recipientId,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    maxHops: envelope.maxHops,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    ephemeralPublicKey: envelope.ephemeralPublicKey,
  };
}

export async function createEnvelope(account: AccountData, recipient: ContactCard, content: OutgoingContent) {
  const ephemeralKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const recipientKey = await importEncryptionPublicKey(recipient.encryptionPublicKey);
  const messageKey = await deriveMessageKey(ephemeralKeys.privateKey, recipientKey, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealedContent = { ...content, sender: getContactCard(account) } as SealedContent;
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    messageKey,
    textEncoder.encode(JSON.stringify(sealedContent)),
  );
  const now = new Date();
  const envelopeWithoutSignature: Omit<RelayEnvelope, 'signature'> = {
    version: 1,
    id: createId('msg'),
    senderId: account.user.id,
    recipientId: recipient.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    maxHops: 8,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    ephemeralPublicKey: await crypto.subtle.exportKey('jwk', ephemeralKeys.publicKey),
  };
  const signingKey = await importSigningPrivateKey(account.identity.signingPrivateKey);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    textEncoder.encode(JSON.stringify(unsignedEnvelope(envelopeWithoutSignature))),
  );
  return { ...envelopeWithoutSignature, signature: bytesToBase64Url(new Uint8Array(signature)) } satisfies RelayEnvelope;
}

export async function openEnvelope(account: AccountData, envelope: RelayEnvelope) {
  if (envelope.recipientId !== account.user.id) throw new Error('Das Paket gehört zu einer anderen ID.');
  if (new Date(envelope.expiresAt).getTime() <= Date.now()) throw new Error('Das Paket ist abgelaufen.');
  const privateKey = await importEncryptionPrivateKey(account.identity.encryptionPrivateKey);
  const ephemeralKey = await importEncryptionPublicKey(envelope.ephemeralPublicKey);
  const messageKey = await deriveMessageKey(privateKey, ephemeralKey, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) },
    messageKey,
    base64UrlToBytes(envelope.ciphertext),
  );
  const content = JSON.parse(textDecoder.decode(plaintext)) as SealedContent;
  const sender = content.sender;
  const expectedId = await derivePersonId(sender.encryptionPublicKey, sender.signingPublicKey);
  if (sender.id !== envelope.senderId || expectedId !== sender.id) throw new Error('Absender-ID konnte nicht bestätigt werden.');
  const signingKey = await importSigningPublicKey(sender.signingPublicKey);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    base64UrlToBytes(envelope.signature),
    textEncoder.encode(JSON.stringify(unsignedEnvelope(envelope))),
  );
  if (!valid) throw new Error('Die Nachrichtensignatur ist ungültig.');
  return content;
}

function receiptPayload(receipt: Omit<DeliveryReceipt, 'signature'> | DeliveryReceipt) {
  return `${receipt.version}|${receipt.messageId}|${receipt.fromId}|${receipt.toId}|${receipt.createdAt}`;
}

export async function createReceipt(account: AccountData, envelope: RelayEnvelope) {
  const receiptWithoutSignature: Omit<DeliveryReceipt, 'signature'> = {
    version: 1,
    messageId: envelope.id,
    fromId: account.user.id,
    toId: envelope.senderId,
    createdAt: new Date().toISOString(),
  };
  const key = await importSigningPrivateKey(account.identity.signingPrivateKey);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    textEncoder.encode(receiptPayload(receiptWithoutSignature)),
  );
  return { ...receiptWithoutSignature, signature: bytesToBase64Url(new Uint8Array(signature)) } satisfies DeliveryReceipt;
}

export async function verifyReceipt(receipt: DeliveryReceipt, contact: ContactCard) {
  if (receipt.fromId !== contact.id) return false;
  const key = await importSigningPublicKey(contact.signingPublicKey);
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    base64UrlToBytes(receipt.signature),
    textEncoder.encode(receiptPayload(receipt)),
  );
}

export function pruneAccount(account: AccountData) {
  const now = Date.now();
  return {
    ...account,
    relayStore: account.relayStore.filter((record) => new Date(record.envelope.expiresAt).getTime() > now),
    receiptStore: account.receiptStore.filter((record) => now - new Date(record.receipt.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000),
    seenEnvelopeIds: account.seenEnvelopeIds.slice(-2000),
    seenReceiptIds: account.seenReceiptIds.slice(-2000),
  };
}

type EncryptedBackup = {
  format: 'schultag-backup';
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

async function backupKey(password: string, salt: Uint8Array, iterations: number, usages: KeyUsage[]) {
  const sourceKey = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations },
    sourceKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

export async function createEncryptedBackup(account: AccountData, password: string) {
  if (password.length < 6) throw new Error('Das Backup-Passwort muss mindestens 6 Zeichen haben.');
  const iterations = 250_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(password, salt, iterations, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(JSON.stringify(account)),
  );
  const backup: EncryptedBackup = {
    format: 'schultag-backup',
    version: 1,
    iterations,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(backup, null, 2);
}

export async function openEncryptedBackup(value: string, password: string) {
  let backup: EncryptedBackup;
  try {
    backup = JSON.parse(value) as EncryptedBackup;
  } catch {
    throw new Error('Die ausgewählte Datei ist kein Schultag-Backup.');
  }
  if (backup.format !== 'schultag-backup' || backup.version !== 1 || !backup.salt || !backup.iv || !backup.ciphertext) {
    throw new Error('Das Backup-Format wird nicht unterstützt.');
  }
  if (password.length < 6) throw new Error('Das Backup-Passwort muss mindestens 6 Zeichen haben.');
  try {
    const salt = base64UrlToBytes(backup.salt);
    const key = await backupKey(password, salt, backup.iterations, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(backup.iv) },
      key,
      base64UrlToBytes(backup.ciphertext),
    );
    const account = JSON.parse(textDecoder.decode(plaintext)) as AccountData;
    if (account.schemaVersion !== 2 || !account.user?.id || !account.identity || !Array.isArray(account.messages) || !Array.isArray(account.tasks)) {
      throw new Error('Das entschlüsselte Konto ist unvollständig.');
    }
    const expectedId = await derivePersonId(account.identity.encryptionPublicKey, account.identity.signingPublicKey);
    if (expectedId !== account.user.id) throw new Error('Die Konto-ID passt nicht zu den enthaltenen Schlüsseln.');
    return pruneAccount(account);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Konto-ID')) throw error;
    throw new Error('Backup-Passwort falsch oder Datei beschädigt.');
  }
}

export async function hasPersistentStorage() {
  if (!navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function storageUsage() {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}
