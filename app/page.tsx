'use client';

import {
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  Database,
  Download,
  Gamepad2,
  HardDrive,
  House,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  NotebookPen,
  PackageCheck,
  Plus,
  Radio,
  RotateCcw,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload,
  UserPlus,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  type AccountData,
  type AccountSummary,
  type ContactCard,
  type DeliveryReceipt,
  type MessageStatus,
  type RelayEnvelope,
  type SchoolTask,
  createAccount,
  createEncryptedBackup,
  createEnvelope,
  createId,
  createReceipt,
  decodeContactCard,
  encodeContactCard,
  getContactCard,
  hasPersistentStorage,
  listAccounts,
  loadAccount,
  loadActiveAccount,
  openEncryptedBackup,
  openEnvelope,
  pruneAccount,
  requestPersistentStorage,
  saveAccount,
  setActiveAccountId,
  storageUsage,
  verifyReceipt,
} from '@/lib/offline-store';

type View = 'today' | 'chat' | 'nearby' | 'tasks' | 'classes' | 'feed' | 'games' | 'profile';
type PairRole = 'host' | 'join' | null;
type ConnectionState = 'idle' | 'preparing' | 'ready' | 'connecting' | 'connected' | 'failed';
type IncomingRelay = { envelope: RelayEnvelope; hops: number; copiesLeft: number };
type PeerPacket =
  | { kind: 'hello'; card: ContactCard }
  | { kind: 'envelope'; relay: IncomingRelay }
  | { kind: 'receipt'; receipt: DeliveryReceipt };

type LegacyData = {
  user?: { name?: string; className?: string; school?: string };
  messages?: Array<{
    id: string;
    body: string;
    createdAt: string;
    senderName: string;
    direction: 'incoming' | 'outgoing';
    status: 'pending' | 'sent' | 'delivered';
  }>;
  tasks?: SchoolTask[];
  notes?: Array<{ id: string; body: string; updatedAt: string }>;
};

const LEGACY_STORAGE_KEY = 'schultag-mvp-data-v1';
const navigation: Array<{ id: View; label: string; icon: typeof House; later?: boolean }> = [
  { id: 'today', label: 'Heute', icon: House },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'nearby', label: 'Nearby', icon: Radio },
  { id: 'tasks', label: 'Aufgaben', icon: NotebookPen },
  { id: 'classes', label: 'Klassen', icon: UsersRound, later: true },
  { id: 'feed', label: 'Feed', icon: BookOpen, later: true },
  { id: 'games', label: 'Spiele', icon: Gamepad2, later: true },
];

const lessons = [
  { time: '08:00', subject: 'Mathematik', room: 'Raum 204 · Frau König', current: true },
  { time: '09:45', subject: 'Englisch', room: 'Raum 112 · Herr Braun' },
  { time: '11:35', subject: 'Biologie', room: 'Labor 2 · Frau Sattler' },
];

const futureCopy = {
  classes: {
    title: 'Klassenräume kommen in Version 0.4',
    text: 'Gemeinsame Aufgaben, Termine und Gruppenrechte bauen auf demselben Offline-Speicher auf.',
    icon: UsersRound,
  },
  feed: {
    title: 'Der Schul-Feed kommt später',
    text: 'Beiträge, Umfragen und Lost & Found brauchen zusätzlich Moderationsregeln.',
    icon: BookOpen,
  },
  games: {
    title: 'Offline-Spiele sind vorgemerkt',
    text: 'Tic-Tac-Toe, Vier gewinnt und Quiz können dieselbe Direktverbindung verwenden.',
    icon: Gamepad2,
  },
} satisfies Record<'classes' | 'feed' | 'games', { title: string; text: string; icon: typeof UsersRound }>;

function encodeSignal(description: RTCSessionDescriptionInit) {
  return btoa(JSON.stringify(description));
}

function decodeSignal(value: string): RTCSessionDescriptionInit {
  const parsed = JSON.parse(atob(value.trim())) as RTCSessionDescriptionInit;
  if (!parsed.type || !parsed.sdp) throw new Error('Ungültiger Verbindungscode.');
  return parsed;
}

function waitForIceGathering(connection: RTCPeerConnection) {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(done, 8000);
    function done() {
      window.clearTimeout(timeout);
      connection.removeEventListener('icegatheringstatechange', checkState);
      resolve();
    }
    function checkState() {
      if (connection.iceGatheringState === 'complete') done();
    }
    connection.addEventListener('icegatheringstatechange', checkState);
  });
}

function messageTime(value: string) {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function statusLabel(status: MessageStatus) {
  if (status === 'delivered') return 'Angekommen';
  if (status === 'relayed') return 'Unterwegs';
  return 'Ausstehend';
}

function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'delivered') return <CheckCheck aria-label="Angekommen" />;
  if (status === 'relayed') return <Check aria-label="Unterwegs" />;
  return <Clock3 aria-label="Ausstehend" />;
}

function initials(value: string) {
  return value.trim().split(/\s+/u).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '??';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Home() {
  const [view, setView] = useState<View>('today');
  const [data, setData] = useState<AccountData | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [storagePersistent, setStoragePersistent] = useState(false);
  const [usedStorage, setUsedStorage] = useState<number | null>(null);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskSubject, setTaskSubject] = useState('Mathematik');
  const [noteDraft, setNoteDraft] = useState('');
  const [contactCode, setContactCode] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [pairRole, setPairRole] = useState<PairRole>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectedPeer, setConnectedPeer] = useState<ContactCard | null>(null);
  const [localCode, setLocalCode] = useState('');
  const [remoteCode, setRemoteCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [toast, setToast] = useState('');

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const dataRef = useRef<AccountData | null>(null);
  const connectedPeerRef = useRef<ContactCard | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const processingEnvelopeIdsRef = useRef(new Set<string>());
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const openTasks = useMemo(() => data?.tasks.filter((task) => !task.completed) ?? [], [data?.tasks]);
  const pendingMessages = useMemo(
    () => data?.messages.filter((message) => message.direction === 'outgoing' && message.status === 'pending') ?? [],
    [data?.messages],
  );
  const selectedContact = useMemo(
    () => data?.contacts.find((contact) => contact.card.id === selectedContactId) ?? data?.contacts[0] ?? null,
    [data?.contacts, selectedContactId],
  );
  const conversationMessages = useMemo(() => {
    if (!data || !selectedContact) return [];
    return data.messages.filter((message) => (
      message.direction === 'outgoing' ? message.recipientId === selectedContact.card.id : message.senderId === selectedContact.card.id
    ));
  }, [data, selectedContact]);
  const ownContactCode = useMemo(() => data ? encodeContactCard(getContactCard(data)) : '', [data]);
  const connected = connectionState === 'connected';

  function notify(message: string) {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3000);
  }

  function mutateAccount(update: (current: AccountData) => AccountData) {
    setData((current) => {
      if (!current) return current;
      const next = pruneAccount({ ...update(current), updatedAt: new Date().toISOString() });
      dataRef.current = next;
      return next;
    });
  }

  async function refreshAccounts() {
    setAccounts(await listAccounts());
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        let account = await loadActiveAccount();
        if (!account) {
          let legacy: LegacyData | null = null;
          try {
            const value = window.localStorage.getItem(LEGACY_STORAGE_KEY);
            legacy = value ? JSON.parse(value) as LegacyData : null;
          } catch {
            legacy = null;
          }
          account = await createAccount(
            legacy?.user?.name ?? 'Mein Profil',
            legacy?.user?.className ?? '',
            legacy?.user?.school ?? '',
          );
          if (legacy) {
            const legacyPeer = await createAccount('Lena König', legacy.user?.className ?? '', legacy.user?.school ?? '');
            const peerCard = getContactCard(legacyPeer);
            account.contacts = [{ card: peerCard, verified: false, addedAt: new Date().toISOString() }];
            account.messages = (legacy.messages ?? []).map((message) => ({
              id: message.id,
              body: message.body,
              createdAt: message.createdAt,
              senderId: message.direction === 'incoming' ? peerCard.id : account!.user.id,
              recipientId: message.direction === 'incoming' ? account!.user.id : peerCard.id,
              senderName: message.direction === 'incoming' ? message.senderName : account!.user.name,
              direction: message.direction,
              status: message.status === 'sent' ? 'relayed' : message.status,
              relayCount: message.status === 'pending' ? 0 : 1,
            }));
            account.tasks = legacy.tasks?.length ? legacy.tasks : account.tasks;
            account.notes = legacy.notes?.length ? legacy.notes : account.notes;
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
          await saveAccount(account);
          await setActiveAccountId(account.user.id);
        }
        if (cancelled) return;
        const clean = pruneAccount(account);
        dataRef.current = clean;
        setData(clean);
        setNoteDraft(clean.notes[0]?.body ?? '');
        setSelectedContactId(clean.contacts[0]?.card.id ?? '');
        await refreshAccounts();
        setStoragePersistent(await hasPersistentStorage());
        const usage = await storageUsage();
        setUsedStorage(usage?.usage ?? null);
      } catch {
        notify('Der dauerhafte Offline-Speicher konnte nicht geöffnet werden.');
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void initialize();
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    dataRef.current = data;
    if (!hydrated || !data) return;
    saveQueueRef.current = saveQueueRef.current
      .then(() => saveAccount(data))
      .then(() => refreshAccounts())
      .catch(() => notify('Eine Änderung konnte nicht dauerhaft gespeichert werden.'));
  }, [data, hydrated]);

  useEffect(() => {
    const context = (document as Document & {
      modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
    }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'create_school_task',
      title: 'Schulaufgabe anlegen',
      description: 'Legt eine neue Aufgabe im aktiven lokalen Schultag-Konto an.',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', minLength: 1 }, subject: { type: 'string', minLength: 1 }, due: { type: 'string' } },
        required: ['title', 'subject'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const value = input as { title?: unknown; subject?: unknown; due?: unknown };
        if (typeof value.title !== 'string' || !value.title.trim()) throw new Error('title ist erforderlich');
        if (typeof value.subject !== 'string' || !value.subject.trim()) throw new Error('subject ist erforderlich');
        const task: SchoolTask = {
          id: createId('task'),
          title: value.title.trim(),
          subject: value.subject.trim(),
          due: typeof value.due === 'string' && value.due.trim() ? value.due.trim() : 'offen',
          completed: false,
        };
        mutateAccount((current) => ({ ...current, tasks: [task, ...current.tasks] }));
        return { id: task.id, status: 'saved-in-indexeddb' };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  useEffect(() => () => {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  function sendPacket(packet: PeerPacket) {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return false;
    channel.send(JSON.stringify(packet));
    return true;
  }

  function rememberContact(card: ContactCard, verified: boolean) {
    mutateAccount((current) => {
      const existing = current.contacts.find((contact) => contact.card.id === card.id);
      const nextContact = {
        card,
        verified: existing?.verified || verified,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      return { ...current, contacts: [nextContact, ...current.contacts.filter((contact) => contact.card.id !== card.id)] };
    });
  }

  function flushRelayStore(peerId: string) {
    const current = dataRef.current;
    if (!current) return;
    const now = Date.now();
    const envelopeIds: string[] = [];
    const receiptIds: string[] = [];
    for (const record of current.relayStore) {
      const active = new Date(record.envelope.expiresAt).getTime() > now
        && record.hops < record.envelope.maxHops
        && record.copiesLeft > 0
        && !record.forwardedTo.includes(peerId)
        && !(record.envelope.senderId === peerId && record.envelope.recipientId !== peerId);
      if (!active) continue;
      if (sendPacket({ kind: 'envelope', relay: { envelope: record.envelope, hops: record.hops + 1, copiesLeft: Math.max(0, Math.min(4, record.copiesLeft - 1)) } })) envelopeIds.push(record.envelope.id);
    }
    for (const stored of current.receiptStore) {
      if (stored.forwardedTo.includes(peerId)) continue;
      if (sendPacket({ kind: 'receipt', receipt: stored.receipt })) receiptIds.push(stored.receipt.messageId);
    }
    if (!envelopeIds.length && !receiptIds.length) return;
    const sentIds = new Set(envelopeIds);
    const sentReceiptIds = new Set(receiptIds);
    mutateAccount((account) => ({
      ...account,
      relayStore: account.relayStore.map((record) => sentIds.has(record.envelope.id) ? { ...record, copiesLeft: Math.max(0, record.copiesLeft - 1), forwardedTo: [...new Set([...record.forwardedTo, peerId])] } : record),
      receiptStore: account.receiptStore.map((stored) => sentReceiptIds.has(stored.receipt.messageId) ? { ...stored, forwardedTo: [...new Set([...stored.forwardedTo, peerId])] } : stored),
      messages: account.messages.map((message) => sentIds.has(message.id) && message.direction === 'outgoing' ? { ...message, status: message.status === 'pending' ? 'relayed' : message.status, relayCount: message.relayCount + 1 } : message),
    }));
    notify(`${envelopeIds.length + receiptIds.length} verschlüsselte${envelopeIds.length + receiptIds.length === 1 ? 's Paket' : ' Pakete'} synchronisiert.`);
  }

  async function processEnvelope(relay: IncomingRelay) {
    const current = dataRef.current;
    if (!current || processingEnvelopeIdsRef.current.has(relay.envelope.id)) return;
    if (current.seenEnvelopeIds.includes(relay.envelope.id) || current.relayStore.some((item) => item.envelope.id === relay.envelope.id)) return;
    if (relay.hops > relay.envelope.maxHops || new Date(relay.envelope.expiresAt).getTime() <= Date.now()) return;
    processingEnvelopeIdsRef.current.add(relay.envelope.id);
    try {
      if (relay.envelope.recipientId !== current.user.id) {
        const sourcePeerId = connectedPeerRef.current?.id;
        mutateAccount((account) => ({ ...account, relayStore: [...account.relayStore, { envelope: relay.envelope, hops: relay.hops, copiesLeft: Math.max(1, relay.copiesLeft), forwardedTo: sourcePeerId ? [sourcePeerId] : [] }], seenEnvelopeIds: [...account.seenEnvelopeIds, relay.envelope.id] }));
        notify('Verschlüsseltes Paket für eine andere Person zwischengespeichert.');
        return;
      }

      const content = await openEnvelope(current, relay.envelope);
      const receipt = await createReceipt(current, relay.envelope);
      mutateAccount((account) => {
        const contactExists = account.contacts.some((contact) => contact.card.id === content.sender.id);
        const contacts = contactExists ? account.contacts : [{ card: content.sender, verified: false, addedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }, ...account.contacts];
        const messages = content.kind === 'message' && !account.messages.some((message) => message.id === relay.envelope.id)
          ? [...account.messages, { id: relay.envelope.id, body: content.body, createdAt: relay.envelope.createdAt, senderId: content.sender.id, recipientId: account.user.id, senderName: content.sender.name, direction: 'incoming' as const, status: 'delivered' as const, relayCount: relay.hops }]
          : account.messages;
        const tasks = content.kind === 'task' && !account.tasks.some((task) => task.id === content.task.id)
          ? [{ ...content.task, shared: true, senderId: content.sender.id }, ...account.tasks]
          : account.tasks;
        return {
          ...account,
          contacts,
          messages,
          tasks,
          relayStore: account.relayStore.filter((record) => record.envelope.id !== relay.envelope.id),
          receiptStore: account.receiptStore.some((stored) => stored.receipt.messageId === receipt.messageId) ? account.receiptStore : [...account.receiptStore, { receipt, forwardedTo: [] }],
          seenEnvelopeIds: [...new Set([...account.seenEnvelopeIds, relay.envelope.id])],
        };
      });
      setSelectedContactId(content.sender.id);
      sendPacket({ kind: 'receipt', receipt });
      notify(content.kind === 'message' ? `Neue Nachricht von ${content.sender.name}` : `${content.sender.name} hat eine Aufgabe geteilt.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Ein Paket konnte nicht geprüft werden.');
    } finally {
      processingEnvelopeIdsRef.current.delete(relay.envelope.id);
    }
  }

  async function processReceipt(receipt: DeliveryReceipt) {
    const current = dataRef.current;
    if (!current || current.seenReceiptIds.includes(receipt.messageId)) return;
    if (receipt.toId !== current.user.id) {
      const sourcePeerId = connectedPeerRef.current?.id;
      mutateAccount((account) => ({ ...account, receiptStore: account.receiptStore.some((stored) => stored.receipt.messageId === receipt.messageId) ? account.receiptStore : [...account.receiptStore, { receipt, forwardedTo: sourcePeerId ? [sourcePeerId] : [] }], seenReceiptIds: [...account.seenReceiptIds, receipt.messageId] }));
      return;
    }
    const contact = current.contacts.find((item) => item.card.id === receipt.fromId);
    if (!contact || !await verifyReceipt(receipt, contact.card)) {
      notify('Eine Zustellbestätigung konnte nicht verifiziert werden.');
      return;
    }
    mutateAccount((account) => ({
      ...account,
      messages: account.messages.map((message) => message.id === receipt.messageId ? { ...message, status: 'delivered' } : message),
      relayStore: account.relayStore.filter((record) => record.envelope.id !== receipt.messageId),
      receiptStore: account.receiptStore.filter((stored) => stored.receipt.messageId !== receipt.messageId),
      seenReceiptIds: [...account.seenReceiptIds, receipt.messageId],
    }));
    notify('Nachricht ist beim Zielgerät angekommen.');
  }

  async function handlePeerPacket(raw: string) {
    try {
      const packet = JSON.parse(raw) as PeerPacket;
      if (packet.kind === 'hello') {
        const card = await decodeContactCard(encodeContactCard(packet.card));
        connectedPeerRef.current = card;
        setConnectedPeer(card);
        rememberContact(card, false);
        if (!selectedContactId) setSelectedContactId(card.id);
        flushRelayStore(card.id);
      }
      if (packet.kind === 'envelope') await processEnvelope(packet.relay);
      if (packet.kind === 'receipt') await processReceipt(packet.receipt);
    } catch {
      notify('Ein empfangenes Paket war ungültig.');
    }
  }

  function setupDataChannel(channel: RTCDataChannel) {
    dataChannelRef.current = channel;
    channel.onopen = () => {
      setConnectionState('connected');
      setPairError('');
      const current = dataRef.current;
      if (current) sendPacket({ kind: 'hello', card: getContactCard(current) });
    };
    channel.onmessage = (event) => void handlePeerPacket(String(event.data));
    channel.onclose = () => { connectedPeerRef.current = null; setConnectedPeer(null); setConnectionState('ready'); };
    channel.onerror = () => setPairError('Die Direktverbindung wurde unterbrochen.');
  }

  function createPeerConnection() {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC wird auf diesem Gerät nicht unterstützt.');
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    const connection = new RTCPeerConnection({ iceServers: [] });
    peerConnectionRef.current = connection;
    connection.ondatachannel = (event) => setupDataChannel(event.channel);
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') setConnectionState('connected');
      if (connection.connectionState === 'connecting') setConnectionState('connecting');
      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') { connectedPeerRef.current = null; setConnectedPeer(null); setConnectionState('failed'); }
    };
    return connection;
  }

  async function createOffer() {
    setPairRole('host'); setPairError(''); setLocalCode(''); setRemoteCode(''); setConnectionState('preparing');
    try {
      const connection = createPeerConnection();
      setupDataChannel(connection.createDataChannel('schultag-relay', { ordered: true }));
      await connection.setLocalDescription(await connection.createOffer());
      await waitForIceGathering(connection);
      if (!connection.localDescription) throw new Error('Es konnte kein Start-Code erstellt werden.');
      setLocalCode(encodeSignal(connection.localDescription)); setConnectionState('ready');
    } catch (error) { setConnectionState('failed'); setPairError(error instanceof Error ? error.message : 'Verbindung fehlgeschlagen.'); }
  }

  async function createAnswer() {
    setPairError(''); setConnectionState('preparing');
    try {
      const offer = decodeSignal(remoteCode);
      if (offer.type !== 'offer') throw new Error('Das ist kein Start-Code.');
      const connection = createPeerConnection();
      await connection.setRemoteDescription(offer);
      await connection.setLocalDescription(await connection.createAnswer());
      await waitForIceGathering(connection);
      if (!connection.localDescription) throw new Error('Es konnte keine Antwort erstellt werden.');
      setLocalCode(encodeSignal(connection.localDescription)); setConnectionState('connecting');
    } catch (error) { setConnectionState('failed'); setPairError(error instanceof Error ? error.message : 'Antwort konnte nicht erstellt werden.'); }
  }

  async function acceptAnswer() {
    setPairError(''); setConnectionState('connecting');
    try {
      const answer = decodeSignal(remoteCode);
      if (answer.type !== 'answer') throw new Error('Das ist kein Antwort-Code.');
      const connection = peerConnectionRef.current;
      if (!connection) throw new Error('Bitte zuerst einen neuen Start-Code erzeugen.');
      await connection.setRemoteDescription(answer);
    } catch (error) { setConnectionState('failed'); setPairError(error instanceof Error ? error.message : 'Verbindung konnte nicht abgeschlossen werden.'); }
  }

  function resetPairing() {
    dataChannelRef.current?.close(); peerConnectionRef.current?.close(); dataChannelRef.current = null; peerConnectionRef.current = null;
    connectedPeerRef.current = null; setConnectedPeer(null); setPairRole(null); setConnectionState('idle'); setLocalCode(''); setRemoteCode(''); setPairError('');
  }

  async function copyValue(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); notify(`${label} kopiert.`); }
    catch { notify('Bitte den Inhalt markieren und manuell kopieren.'); }
  }

  async function shareValue(value: string, title: string) {
    if (navigator.share) {
      try { await navigator.share({ title, text: value }); return; }
      catch { return; }
    }
    await copyValue(value, title);
  }

  async function submitMessage(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = dataRef.current;
    const body = messageDraft.trim();
    if (!current || !body || !selectedContact) { if (!selectedContact) notify('Füge zuerst einen Kontakt hinzu.'); return; }
    setCryptoBusy(true);
    try {
      const envelope = await createEnvelope(current, selectedContact.card, { kind: 'message', body });
      const peerId = connectedPeerRef.current?.id;
      const sentNow = peerId ? sendPacket({ kind: 'envelope', relay: { envelope, hops: 1, copiesLeft: 4 } }) : false;
      mutateAccount((account) => ({
        ...account,
        messages: [...account.messages, { id: envelope.id, body, createdAt: envelope.createdAt, senderId: account.user.id, recipientId: selectedContact.card.id, senderName: account.user.name, direction: 'outgoing', status: sentNow ? 'relayed' : 'pending', relayCount: sentNow ? 1 : 0 }],
        relayStore: [...account.relayStore, { envelope, hops: 0, copiesLeft: sentNow ? 7 : 8, forwardedTo: sentNow && peerId ? [peerId] : [] }],
      }));
      setMessageDraft('');
      notify(sentNow ? 'Verschlüsselt an das verbundene Gerät übertragen.' : 'Verschlüsselt gespeichert — wartet auf eine Verbindung.');
    } catch { notify('Die Nachricht konnte nicht verschlüsselt werden.'); }
    finally { setCryptoBusy(false); }
  }

  function submitTask(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    const task: SchoolTask = { id: createId('task'), title: taskTitle.trim(), subject: taskSubject, due: 'offen', completed: false };
    mutateAccount((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    setTaskTitle(''); notify('Aufgabe dauerhaft offline gespeichert.');
  }

  function toggleTask(taskId: string) {
    mutateAccount((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, completed: !task.completed } : task) }));
  }

  async function shareTask(task: SchoolTask) {
    const current = dataRef.current;
    if (!current || !selectedContact) { notify('Wähle zuerst einen Kontakt im Chat aus.'); return; }
    setCryptoBusy(true);
    try {
      const envelope = await createEnvelope(current, selectedContact.card, { kind: 'task', task });
      const peerId = connectedPeerRef.current?.id;
      const sentNow = peerId ? sendPacket({ kind: 'envelope', relay: { envelope, hops: 1, copiesLeft: 4 } }) : false;
      mutateAccount((account) => ({ ...account, relayStore: [...account.relayStore, { envelope, hops: 0, copiesLeft: sentNow ? 7 : 8, forwardedTo: sentNow && peerId ? [peerId] : [] }] }));
      notify(`Aufgabe für ${selectedContact.card.name} verschlüsselt eingereiht.`);
    } catch { notify('Die Aufgabe konnte nicht verschlüsselt werden.'); }
    finally { setCryptoBusy(false); }
  }

  function saveNote() {
    if (!data) return;
    const note = { id: data.notes[0]?.id ?? createId('note'), body: noteDraft, updatedAt: new Date().toISOString() };
    mutateAccount((current) => ({ ...current, notes: [note, ...current.notes.slice(1)] }));
    notify('Notiz dauerhaft offline gespeichert.');
  }

  async function addContact() {
    const current = dataRef.current;
    if (!current) return;
    setCryptoBusy(true);
    try {
      const card = await decodeContactCard(contactCode);
      if (card.id === current.user.id) throw new Error('Das ist deine eigene Kontaktkarte.');
      rememberContact(card, true); setSelectedContactId(card.id); setContactCode('');
      notify(`${card.name} wurde als verifizierter Kontakt gespeichert.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Kontakt konnte nicht hinzugefügt werden.'); }
    finally { setCryptoBusy(false); }
  }

  async function createLocalAccount() {
    if (!newAccountName.trim()) { notify('Bitte gib einen Namen für das Konto ein.'); return; }
    setCryptoBusy(true);
    try {
      const account = await createAccount(newAccountName.trim());
      await saveAccount(account); await setActiveAccountId(account.user.id); resetPairing();
      dataRef.current = account; setData(account); setNoteDraft(account.notes[0]?.body ?? ''); setSelectedContactId(''); setNewAccountName('');
      await refreshAccounts(); notify('Neues lokales Konto mit eigener ID erstellt.');
    } finally { setCryptoBusy(false); }
  }

  async function switchAccount(accountId: string) {
    const current = dataRef.current;
    if (current?.user.id === accountId) return;
    setCryptoBusy(true);
    try {
      if (current) await saveAccount(current);
      const account = await loadAccount(accountId);
      if (!account) throw new Error('Konto wurde nicht gefunden.');
      await setActiveAccountId(accountId); resetPairing(); dataRef.current = account; setData(pruneAccount(account));
      setNoteDraft(account.notes[0]?.body ?? ''); setSelectedContactId(account.contacts[0]?.card.id ?? ''); notify(`Konto ${account.user.name} ist jetzt aktiv.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Konto konnte nicht gewechselt werden.'); }
    finally { setCryptoBusy(false); }
  }

  async function exportBackup() {
    const current = dataRef.current;
    if (!current) return;
    setCryptoBusy(true);
    try {
      const contents = await createEncryptedBackup(current, backupPassword);
      const blob = new Blob([contents], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `schultag-${current.user.id.toLowerCase()}-backup.json`; link.click(); URL.revokeObjectURL(url);
      notify('Verschlüsseltes Konto-Backup erstellt.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Backup konnte nicht erstellt werden.'); }
    finally { setCryptoBusy(false); }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (backupPassword.length < 6) { notify('Gib zuerst das Backup-Passwort ein.'); return; }
    setCryptoBusy(true);
    try {
      const account = await openEncryptedBackup(await file.text(), backupPassword);
      await saveAccount(account); await setActiveAccountId(account.user.id); resetPairing(); dataRef.current = account; setData(account);
      setNoteDraft(account.notes[0]?.body ?? ''); setSelectedContactId(account.contacts[0]?.card.id ?? ''); await refreshAccounts();
      notify(`Backup von ${account.user.name} wiederhergestellt.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Backup konnte nicht geöffnet werden.'); }
    finally { setCryptoBusy(false); }
  }

  async function makeStoragePersistent() {
    const granted = await requestPersistentStorage();
    setStoragePersistent(granted || await hasPersistentStorage());
    notify(granted ? 'Browser-Speicher wurde als dauerhaft markiert.' : 'iOS entscheidet weiterhin automatisch über den Speicher. Nutze regelmäßig Backups.');
  }

  function resetCurrentData() {
    if (!window.confirm('Nachrichten, Aufgaben, Notizen und Relaispakete dieses Kontos löschen? ID und Kontakte bleiben erhalten.')) return;
    mutateAccount((current) => ({ ...current, messages: [], tasks: [], notes: [{ id: createId('note'), body: '', updatedAt: new Date().toISOString() }], relayStore: [], receiptStore: [], seenEnvelopeIds: [], seenReceiptIds: [] }));
    setNoteDraft(''); notify('Lokale Inhalte gelöscht; ID und Kontakte wurden behalten.');
  }

  const connectionLabel = {
    idle: 'Nicht verbunden', preparing: 'Code wird erstellt …', ready: 'Bereit', connecting: 'Verbindung wird aufgebaut …',
    connected: connectedPeer ? `Verbunden mit ${connectedPeer.name}` : 'Direkt verbunden', failed: 'Verbindung fehlgeschlagen',
  }[connectionState];

  if (!hydrated || !data) {
    return <main className="loading-screen"><span className="brand-mark"><span>S</span><i /></span><div><strong>Schultag wird lokal geöffnet</strong><small>Konten und Offline-Daten werden aus dem Gerätespeicher geladen.</small></div></main>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand-button" type="button" onClick={() => setView('today')} aria-label="Schultag Startseite"><span className="brand-mark"><span>S</span><i /></span><span className="brand-name">SCHULTAG<small>OFFLINE FIRST</small></span></button>
        <nav className="nav-list" aria-label="Hauptnavigation">
          {navigation.map(({ id, label, icon: Icon, later }) => <button key={id} className={`nav-item ${view === id ? 'is-active' : ''}`} type="button" onClick={() => setView(id)}><Icon /><span>{label}</span>{id === 'nearby' && connected ? <b className="nav-live">1</b> : null}{id === 'chat' && pendingMessages.length ? <b>{pendingMessages.length}</b> : null}{later ? <em>BALD</em> : null}</button>)}
        </nav>
        <button className={`profile-button ${view === 'profile' ? 'is-active' : ''}`} type="button" onClick={() => setView('profile')}><span className="avatar">{initials(data.user.name)}</span><span><strong>{data.user.name}</strong><small>{data.user.className || 'Keine Klasse'} · {data.user.school || 'Keine Schule'}</small></span><CircleUserRound /></button>
      </aside>

      <section className="content">
        <header className="topbar"><div><p>TESTVERSION 0.3 · INDEXEDDB · ENDE-ZU-ENDE</p><h1>{view === 'today' ? `Hallo, ${data.user.name}.` : navigation.find((item) => item.id === view)?.label ?? 'Profil'}</h1></div><div className="topbar-actions"><span className={`offline-pill ${online ? 'is-online' : ''}`}>{online ? <Wifi /> : <WifiOff />} {online ? 'Internet verfügbar' : 'Offline bereit'}</span><Button className="primary-button" onClick={() => setView('chat')}><Send /> Schnellnachricht</Button></div></header>

        {view === 'today' ? <div className="dashboard-grid">
          <section className="hero-card"><div className="hero-copy"><span className="eyebrow">DEIN TAG</span><h2>Alles im Blick.<br />Auch ohne WLAN.</h2><p>{openTasks.length} offene Aufgaben, {data.contacts.length} Kontakte und {data.relayStore.length} verschlüsselte Pakete im lokalen Speicher.</p></div><div className="signal-orbit" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit orbit-three" /><span className={`signal-core ${connected ? 'is-connected' : ''}`}><Radio /></span><span className="peer peer-one">ID</span><span className="peer peer-two">P2P</span><span className="peer peer-three">E2E</span></div></section>
          <section className="panel timetable-panel"><div className="panel-heading"><div><span className="eyebrow">NÄCHSTER SCHULTAG</span><h2>Stundenplan</h2></div><button className="icon-button" type="button" aria-label="Stundenplan öffnen"><CalendarDays /></button></div><div className="lessons">{lessons.map((lesson) => <article className={`lesson ${lesson.current ? 'current' : ''}`} key={lesson.time}><time>{lesson.time}</time><span className="lesson-line" /><div><strong>{lesson.subject}</strong><small>{lesson.room}</small></div>{lesson.current ? <span className="lesson-state">Als Nächstes</span> : null}</article>)}</div></section>
          <section className="panel nearby-panel"><div className="panel-heading"><div><span className="eyebrow">STORE & FORWARD</span><h2>Nearby</h2></div><span className={`live-dot ${connected ? '' : 'is-idle'}`}>{connected ? 'LIVE' : 'BEREIT'}</span></div><div className="nearby-count"><strong>{connected ? '1' : '0'}</strong><span>Gerät<br />direkt verbunden</span></div><p className="nearby-caption">Pakete werden beim Verbinden automatisch verschlüsselt abgeglichen.</p><button className="panel-link" type="button" onClick={() => setView('nearby')}>Verbindung öffnen <ChevronRight /></button></section>
          <section className="panel tasks-panel"><div className="panel-heading"><div><span className="eyebrow">NOCH OFFEN</span><h2>Aufgaben</h2></div><span className="count-chip">{openTasks.length}</span></div>{openTasks.slice(0, 3).map((task) => <div className="task-row" key={task.id}><button type="button" aria-label={`${task.title} erledigen`} onClick={() => toggleTask(task.id)}><CheckCircle2 /></button><span className={`subject-dot ${task.subject.toLowerCase().slice(0, 4)}`} /><div><strong>{task.title}</strong><small>{task.subject} · {task.due}</small></div><ChevronRight /></div>)}{!openTasks.length ? <div className="empty-compact"><CheckCircle2 /> Alles erledigt.</div> : null}</section>
          <section className="panel sync-panel"><div className="sync-icon"><Database /></div><div><span className="eyebrow">DAUERHAFT LOKAL</span><h2>{pendingMessages.length} warten · {data.relayStore.length} Pakete</h2><p>Jedes Konto hat einen getrennten IndexedDB-Speicher. Beim Schließen bleiben alle Inhalte erhalten.</p></div><button className="icon-button" type="button" aria-label="Speicher öffnen" onClick={() => setView('profile')}><ChevronRight /></button></section>
        </div> : null}

        {view === 'chat' ? <div className="chat-layout">
          <aside className="chat-list panel"><div className="section-intro"><span className="eyebrow">KONTAKTE</span><h2>Unterhaltungen</h2></div>{data.contacts.map((contact) => { const latest = data.messages.filter((message) => message.senderId === contact.card.id || message.recipientId === contact.card.id).at(-1); return <button className={`conversation ${selectedContact?.card.id === contact.card.id ? 'is-active' : ''}`} type="button" key={contact.card.id} onClick={() => setSelectedContactId(contact.card.id)}><span className="avatar lena">{initials(contact.card.name)}</span><span><strong>{contact.card.name}</strong><small>{latest?.body ?? contact.card.id}</small></span>{contact.verified ? <ShieldCheck className="contact-check" /> : <em>NEU</em>}</button>; })}{!data.contacts.length ? <button className="empty-contact" type="button" onClick={() => setView('profile')}><UserPlus /> Ersten Kontakt hinzufügen</button> : null}<div className="privacy-note"><LockKeyhole /><span><strong>Ende-zu-Ende.</strong> Relaisgeräte können Nachrichten nicht lesen.</span></div></aside>
          <section className="chat-panel panel"><header className="chat-header"><div className="chat-person"><span className="avatar lena">{initials(selectedContact?.card.name ?? '?')}</span><span><strong>{selectedContact?.card.name ?? 'Kontakt auswählen'}</strong><small>{selectedContact ? selectedContact.card.id : 'Im Profil Kontaktcode einfügen'}</small></span></div><span className={`connection-chip ${connected ? 'is-connected' : ''}`}><i /> {connectionLabel}</span></header><div className="messages" aria-live="polite"><div className="day-divider"><span>LOKALER VERLAUF</span></div>{conversationMessages.map((message) => <article className={`message ${message.direction}`} key={message.id} title={`ID: ${message.id}`}><p>{message.body}</p><footer><time>{messageTime(message.createdAt)}</time>{message.direction === 'outgoing' ? <span className={`message-status ${message.status}`} title={`${statusLabel(message.status)} · ${message.relayCount} Weitergaben`}><StatusIcon status={message.status} /></span> : null}</footer></article>)}{!conversationMessages.length ? <div className="empty-messages"><MessageCircle /><strong>Noch keine Nachrichten</strong><span>Nachrichten werden verschlüsselt gespeichert und bei einer Verbindung automatisch weitergegeben.</span></div> : null}</div><form className="message-composer" onSubmit={(event) => void submitMessage(event)}><Input value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder={selectedContact ? `Nachricht an ${selectedContact.card.name} …` : 'Zuerst Kontakt hinzufügen …'} aria-label="Nachricht" autoComplete="off" disabled={!selectedContact || cryptoBusy} /><Button type="submit" size="icon-lg" aria-label="Nachricht senden" disabled={!selectedContact || cryptoBusy}><Send /></Button></form><div className="queue-hint"><PackageCheck /> Ausstehend → unterwegs → durch signierte Bestätigung angekommen.</div></section>
        </div> : null}

        {view === 'nearby' ? <div className="nearby-view">
          <section className="connection-hero"><div><span className="eyebrow">MANUELLE VERBINDUNG · AUTOMATISCHER ABGLEICH</span><h2>Begegnen. Verbinden. Weitertragen.</h2><p>Kontakte werden nur einmal bestätigt. Der WebRTC-Verbindungscode ist technisch bei jeder neuen Sitzung nötig; danach tauschen beide Geräte alle fehlenden verschlüsselten Pakete automatisch aus.</p></div><div className={`device-link ${connected ? 'is-connected' : ''}`} aria-hidden="true"><span><Smartphone /></span><i><ArrowLeftRight /></i><span className="tablet-device"><Smartphone /></span></div></section>
          <div className="nearby-columns"><section className="panel pair-panel"><div className="pair-status-row"><div><span className="eyebrow">STATUS</span><h2>{connectionLabel}</h2></div><span className={`status-beacon ${connected ? 'is-connected' : ''}`}><i />{connected ? '1 Gerät' : '0 Geräte'}</span></div>
            {pairRole === null ? <div className="role-picker"><div className="pair-step"><span>1</span><div><strong>Beide Geräte im selben lokalen Netz</strong><small>Internet ist für die Übertragung nicht nötig.</small></div></div><div className="role-actions"><Button size="lg" onClick={() => void createOffer()}><Radio /> Dieses Gerät startet</Button><Button size="lg" variant="outline" onClick={() => { setPairRole('join'); setConnectionState('ready'); }}><Smartphone /> Dieses Gerät tritt bei</Button></div></div> : null}
            {pairRole === 'host' ? <div className="pair-flow"><div className="flow-heading"><span className="step-number">1</span><div><strong>Start-Code teilen</strong><small>Am besten über „Teilen“ → AirDrop.</small></div></div><Textarea className="code-box" value={localCode} readOnly placeholder="Code wird erstellt …" aria-label="Start-Code" /><div className="inline-actions"><Button variant="outline" onClick={() => void copyValue(localCode, 'Start-Code')} disabled={!localCode}><Copy /> Kopieren</Button><Button onClick={() => void shareValue(localCode, 'Schultag Start-Code')} disabled={!localCode}><Share2 /> Teilen</Button></div><div className="flow-heading"><span className="step-number">2</span><div><strong>Antwort-Code einfügen</strong><small>Er kommt vom zweiten Gerät zurück.</small></div></div><Textarea className="code-box" value={remoteCode} onChange={(event) => setRemoteCode(event.target.value)} placeholder="Antwort-Code …" aria-label="Antwort-Code" /><Button size="lg" onClick={() => void acceptAnswer()} disabled={!remoteCode.trim() || connected}><ArrowLeftRight /> Verbindung abschließen</Button></div> : null}
            {pairRole === 'join' ? <div className="pair-flow"><div className="flow-heading"><span className="step-number">1</span><div><strong>Start-Code einfügen</strong><small>Code vollständig einsetzen.</small></div></div><Textarea className="code-box" value={remoteCode} onChange={(event) => setRemoteCode(event.target.value)} placeholder="Start-Code …" aria-label="Start-Code einfügen" /><Button size="lg" onClick={() => void createAnswer()} disabled={!remoteCode.trim()}><Sparkles /> Antwort erzeugen</Button>{localCode ? <><div className="flow-heading"><span className="step-number">2</span><div><strong>Antwort zurückteilen</strong><small>Danach beginnt der automatische Paketabgleich.</small></div></div><Textarea className="code-box" value={localCode} readOnly aria-label="Erzeugter Antwort-Code" /><div className="inline-actions"><Button variant="outline" onClick={() => void copyValue(localCode, 'Antwort-Code')}><Copy /> Kopieren</Button><Button onClick={() => void shareValue(localCode, 'Schultag Antwort-Code')}><Share2 /> Teilen</Button></div></> : null}</div> : null}
            {pairError ? <div className="error-message"><X />{pairError}</div> : null}{pairRole !== null ? <Button variant="ghost" className="reset-button" onClick={resetPairing}><RotateCcw /> Verbindung zurücksetzen</Button> : null}
          </section><aside className="nearby-info-stack"><section className="panel honesty-card"><WifiOff /><div><span className="eyebrow">PWA-GRENZE</span><h3>Keine automatische Gerätesuche</h3><p>Safari erlaubt kein Nearby im Hintergrund. Jede Begegnung beginnt deshalb mit dem Verbindungscode.</p></div></section><section className="panel security-card"><ShieldCheck /><div><span className="eyebrow">E2E AKTIV</span><h3>Nur die Ziel-ID kann lesen</h3><p>AES-GCM schützt den Inhalt; die Absender-ID wird mit ECDSA signiert.</p></div></section><section className="panel queue-card"><PackageCheck /><div><span className="eyebrow">STORE & FORWARD</span><h3>{data.relayStore.length} Pakete gespeichert</h3><p>Maximal 8 Sprünge, 8 Kopien und 72 Stunden Gültigkeit begrenzen die Weitergabe.</p></div></section></aside></div>
        </div> : null}

        {view === 'tasks' ? <div className="tasks-layout"><section className="panel task-manager"><div className="panel-heading"><div><span className="eyebrow">DAUERHAFTER AUFGABENPLANER</span><h2>Meine Aufgaben</h2></div><span className="count-chip">{openTasks.length}</span></div><form className="task-form" onSubmit={submitTask}><Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Neue Aufgabe …" aria-label="Aufgabentitel" /><select value={taskSubject} onChange={(event) => setTaskSubject(event.target.value)} aria-label="Fach"><option>Mathematik</option><option>Deutsch</option><option>Englisch</option><option>Biologie</option><option>Geschichte</option><option>Sonstiges</option></select><Button type="submit"><Plus /> Hinzufügen</Button></form><div className="task-list-full">{data.tasks.map((task) => <article className={`task-item-full ${task.completed ? 'is-complete' : ''}`} key={task.id}><button type="button" onClick={() => toggleTask(task.id)} aria-label={`${task.title} ${task.completed ? 'wieder öffnen' : 'erledigen'}`}><CheckCircle2 /></button><span className={`subject-dot ${task.subject.toLowerCase().slice(0, 4)}`} /><div><strong>{task.title}</strong><small>{task.subject} · {task.due}{task.shared ? ' · empfangen' : ''}</small></div><Button variant="ghost" size="icon" onClick={() => void shareTask(task)} aria-label={`${task.title} verschlüsselt teilen`} disabled={!selectedContact || cryptoBusy}><Share2 /></Button></article>)}</div></section><aside className="panel notes-panel"><div className="panel-heading"><div><span className="eyebrow">PERSÖNLICHER NOTIZBLOCK</span><h2>Für mich</h2></div><NotebookPen /></div><Textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Notiz für den Schultag …" /><Button onClick={saveNote}>Dauerhaft speichern</Button><p><Database /> Im aktiven Konto in IndexedDB gespeichert.</p></aside></div> : null}

        {(view === 'classes' || view === 'feed' || view === 'games') ? (() => { const item = futureCopy[view]; const Icon = item.icon; return <section className="future-panel panel"><span className="future-icon"><Icon /></span><span className="eyebrow">WEITERER AUSBAU</span><h2>{item.title}</h2><p>{item.text}</p><Button variant="outline" onClick={() => setView('today')}>Zurück zur Offline-Version</Button></section>; })() : null}

        {view === 'profile' ? <div className="profile-layout profile-layout-expanded">
          <section className="panel profile-panel"><div className="panel-heading"><div><span className="eyebrow">AKTIVES LOKALES KONTO</span><h2>{data.user.name}</h2></div><CircleUserRound /></div><label htmlFor="profile-name">Name<Input id="profile-name" value={data.user.name} onChange={(event) => mutateAccount((current) => ({ ...current, user: { ...current.user, name: event.target.value } }))} /></label><label htmlFor="profile-class">Klasse<Input id="profile-class" value={data.user.className} onChange={(event) => mutateAccount((current) => ({ ...current, user: { ...current.user, className: event.target.value } }))} /></label><label htmlFor="profile-school">Schule<Input id="profile-school" value={data.user.school} onChange={(event) => mutateAccount((current) => ({ ...current, user: { ...current.user, school: event.target.value } }))} /></label><div className="identity-line"><KeyRound /><span><small>PERSÖNLICHE ID</small><strong>{data.user.id}</strong></span></div><p className="save-state"><Check /> Änderungen landen automatisch im getrennten Kontospeicher.</p></section>
          <section className="panel identity-panel"><div className="panel-heading"><div><span className="eyebrow">NUR EINMAL PRO KONTAKT</span><h2>Meine Kontaktkarte</h2></div><ShieldCheck /></div><Textarea className="code-box contact-code-box" value={ownContactCode} readOnly aria-label="Eigener Kontaktcode" /><div className="inline-actions"><Button variant="outline" onClick={() => void copyValue(ownContactCode, 'Kontaktcode')}><Copy /> Kopieren</Button><Button onClick={() => void shareValue(ownContactCode, 'Schultag Kontaktkarte')}><Share2 /> AirDrop</Button></div></section>
          <section className="panel contact-panel"><div className="panel-heading"><div><span className="eyebrow">KONTAKT HINZUFÜGEN</span><h2>Kontaktkarte einfügen</h2></div><UserPlus /></div><Textarea className="code-box contact-code-box" value={contactCode} onChange={(event) => setContactCode(event.target.value)} placeholder="SCHULTAG-CONTACT-1.…" aria-label="Kontaktcode einfügen" /><Button onClick={() => void addContact()} disabled={!contactCode.trim() || cryptoBusy}><ShieldCheck /> ID prüfen und speichern</Button></section>
          <section className="panel accounts-panel"><div className="panel-heading"><div><span className="eyebrow">GETRENNTE OFFLINE-SPEICHER</span><h2>Konten auf diesem Gerät</h2></div><UsersRound /></div><div className="account-list">{accounts.map((account) => <button type="button" key={account.id} className={account.id === data.user.id ? 'is-active' : ''} onClick={() => void switchAccount(account.id)} disabled={cryptoBusy}><span className="avatar">{initials(account.name)}</span><span><strong>{account.name}</strong><small>{account.id}</small></span>{account.id === data.user.id ? <CheckCircle2 /> : <ChevronRight />}</button>)}</div><div className="new-account-row"><Input value={newAccountName} onChange={(event) => setNewAccountName(event.target.value)} placeholder="Name für neues Konto" /><Button onClick={() => void createLocalAccount()} disabled={cryptoBusy}><Plus /> Konto</Button></div></section>
          <section className="panel backup-panel"><div className="panel-heading"><div><span className="eyebrow">VERSCHLÜSSELTES BACKUP</span><h2>Konto sichern</h2></div><HardDrive /></div><p>Enthält ID, private Schlüssel, Kontakte, Nachrichten, Aufgaben, Notizen und Warteschlange. Das Passwort wird nicht gespeichert.</p><Input type="password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} placeholder="Backup-Passwort · mindestens 6 Zeichen" aria-label="Backup-Passwort" /><div className="backup-actions"><Button onClick={() => void exportBackup()} disabled={cryptoBusy}><Download /> Exportieren</Button><Button variant="outline" onClick={() => importInputRef.current?.click()} disabled={cryptoBusy}><Upload /> Wiederherstellen</Button></div><input ref={importInputRef} className="sr-file-input" type="file" accept="application/json,.json" onChange={(event) => void importBackup(event)} /></section>
          <section className="panel storage-panel"><div className="storage-summary"><span className="install-icon"><Database /></span><div><span className="eyebrow">GERÄTESPEICHER</span><h2>{storagePersistent ? 'Dauerhafter Speicher aktiv' : 'IndexedDB aktiv'}</h2><p>{usedStorage === null ? 'Lokale Belegung wird vom Browser verwaltet.' : `${formatBytes(usedStorage)} für App und Daten belegt.`}</p></div></div>{!storagePersistent ? <Button variant="outline" onClick={() => void makeStoragePersistent()}><HardDrive /> Dauerhaften Speicher anfragen</Button> : null}</section>
          <section className="panel install-panel"><span className="install-icon"><Share2 /></span><div><span className="eyebrow">AUF IPAD / IPHONE</span><h2>Zum Home-Bildschirm</h2><p>Safari → Teilen → „Zum Home-Bildschirm“. App-Dateien werden für Offline-Starts zwischengespeichert.</p></div></section>
          <section className="panel reset-panel"><div><span className="eyebrow">INHALTE LEEREN</span><h2>ID und Kontakte behalten</h2><p>Löscht Nachrichten, Aufgaben, Notizen und Relaispakete nur aus dem aktiven Konto.</p></div><Button variant="destructive" onClick={resetCurrentData}><RotateCcw /> Leeren</Button></section>
        </div> : null}
      </section>
      {toast ? <output className="toast" aria-live="polite"><CheckCircle2 />{toast}</output> : null}
    </main>
  );
}
