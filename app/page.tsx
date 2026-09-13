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
  Gamepad2,
  House,
  Info,
  LockKeyhole,
  MessageCircle,
  NotebookPen,
  Plus,
  Radio,
  RotateCcw,
  School,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type View =
  | 'today'
  | 'chat'
  | 'nearby'
  | 'tasks'
  | 'classes'
  | 'feed'
  | 'games'
  | 'profile';

type MessageStatus = 'pending' | 'sent' | 'delivered';

type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  direction: 'incoming' | 'outgoing';
  status: MessageStatus;
};

type SchoolTask = {
  id: string;
  title: string;
  subject: string;
  due: string;
  completed: boolean;
  shared?: boolean;
};

type Note = {
  id: string;
  body: string;
  updatedAt: string;
};

type AppData = {
  user: {
    id: string;
    name: string;
    className: string;
    school: string;
  };
  messages: ChatMessage[];
  tasks: SchoolTask[];
  notes: Note[];
};

type PeerPacket =
  | { kind: 'message'; message: Omit<ChatMessage, 'direction' | 'status'> }
  | { kind: 'ack'; id: string }
  | { kind: 'task'; task: SchoolTask; senderName: string };

type PairRole = 'host' | 'join' | null;
type ConnectionState = 'idle' | 'preparing' | 'ready' | 'connecting' | 'connected' | 'failed';

const STORAGE_KEY = 'schultag-mvp-data-v1';

const defaultData: AppData = {
  user: {
    id: 'local-paul',
    name: 'Paul',
    className: '10b',
    school: 'Goethe-Schule',
  },
  messages: [
    {
      id: 'msg-demo-1',
      body: 'Hast du die Mathe-Aufgaben für morgen?',
      createdAt: '2026-09-13T10:21:00.000Z',
      senderId: 'lena-demo',
      senderName: 'Lena',
      direction: 'incoming',
      status: 'delivered',
    },
    {
      id: 'msg-demo-2',
      body: 'Ja — Seite 42, Nummer 3 bis 6.',
      createdAt: '2026-09-13T10:22:00.000Z',
      senderId: 'local-paul',
      senderName: 'Paul',
      direction: 'outgoing',
      status: 'delivered',
    },
  ],
  tasks: [
    { id: 'task-1', title: 'Seite 42, Nr. 3–6', subject: 'Mathematik', due: 'morgen', completed: false },
    { id: 'task-2', title: 'Vocabulary Unit 2', subject: 'Englisch', due: 'Mittwoch', completed: false },
    { id: 'task-3', title: 'Versuchsprotokoll', subject: 'Biologie', due: 'Freitag', completed: false },
  ],
  notes: [
    { id: 'note-1', body: 'Sportzeug für Dienstag mitnehmen.', updatedAt: '2026-09-13T09:00:00.000Z' },
  ],
};

const navigation: Array<{
  id: View;
  label: string;
  icon: typeof House;
  later?: boolean;
}> = [
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

const futureCopy: Record<'classes' | 'feed' | 'games', { title: string; text: string; icon: typeof UsersRound }> = {
  classes: {
    title: 'Klassenräume kommen in Version 0.4',
    text: 'Gemeinsame Aufgaben, Termine und Gruppenrechte bauen auf demselben lokalen Datenmodell auf.',
    icon: UsersRound,
  },
  feed: {
    title: 'Der Schul-Feed kommt später',
    text: 'Beiträge, Umfragen und Lost & Found brauchen zuerst sichere Accounts und Moderationsregeln.',
    icon: BookOpen,
  },
  games: {
    title: 'Offline-Spiele sind vorgemerkt',
    text: 'Tic-Tac-Toe, Vier gewinnt und Quiz können später über dieselbe Direktverbindung laufen.',
    icon: Gamepad2,
  },
};

function createId(prefix: string) {
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function encodeSignal(description: RTCSessionDescriptionInit) {
  return btoa(JSON.stringify(description));
}

function decodeSignal(value: string): RTCSessionDescriptionInit {
  const parsed = JSON.parse(atob(value.trim())) as RTCSessionDescriptionInit;
  if (!parsed.type || !parsed.sdp) throw new Error('Ungültiger Kopplungscode');
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
  if (status === 'sent') return 'Gesendet';
  return 'Ausstehend';
}

function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'delivered') return <CheckCheck aria-label="Angekommen" />;
  if (status === 'sent') return <Check aria-label="Gesendet" />;
  return <Clock3 aria-label="Ausstehend" />;
}

export default function Home() {
  const [view, setView] = useState<View>('today');
  const [data, setData] = useState<AppData>(defaultData);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [messageDraft, setMessageDraft] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskSubject, setTaskSubject] = useState('Mathematik');
  const [noteDraft, setNoteDraft] = useState(defaultData.notes[0].body);
  const [pairRole, setPairRole] = useState<PairRole>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [localCode, setLocalCode] = useState('');
  const [remoteCode, setRemoteCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [toast, setToast] = useState('');

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const dataRef = useRef(data);
  const toastTimerRef = useRef<number | null>(null);

  const openTasks = useMemo(() => data.tasks.filter((task) => !task.completed), [data.tasks]);
  const pendingMessages = useMemo(
    () => data.messages.filter((message) => message.direction === 'outgoing' && message.status === 'pending'),
    [data.messages],
  );
  const connected = connectionState === 'connected';

  function notify(message: string) {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2800);
  }

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as AppData;
        setData(parsed);
        setNoteDraft(parsed.notes[0]?.body ?? '');
      }
    } catch {
      notify('Lokale Daten konnten nicht gelesen werden.');
    } finally {
      setHydrated(true);
    }

    setOnline(navigator.onLine);
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    }

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  useEffect(() => {
    const context = (document as Document & {
      modelContext?: {
        registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'create_school_task',
      title: 'Schulaufgabe anlegen',
      description: 'Legt eine neue Aufgabe lokal in Schultag an.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          subject: { type: 'string', minLength: 1 },
          due: { type: 'string' },
        },
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
        setData((current) => ({ ...current, tasks: [task, ...current.tasks] }));
        return { id: task.id, status: 'saved-locally' };
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

  function flushPendingMessages() {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return;
    const queue = dataRef.current.messages.filter(
      (message) => message.direction === 'outgoing' && message.status === 'pending',
    );
    queue.forEach((message) => {
      const { direction: _direction, status: _status, ...payload } = message;
      channel.send(JSON.stringify({ kind: 'message', message: payload } satisfies PeerPacket));
    });
    if (queue.length) {
      const queuedIds = new Set(queue.map((message) => message.id));
      setData((current) => ({
        ...current,
        messages: current.messages.map((message) => queuedIds.has(message.id)
          ? { ...message, status: 'sent' as const }
          : message),
      }));
      notify(`${queue.length} wartende Nachricht${queue.length === 1 ? '' : 'en'} gesendet.`);
    }
  }

  function handlePeerPacket(raw: string) {
    try {
      const packet = JSON.parse(raw) as PeerPacket;
      if (packet.kind === 'message') {
        setData((current) => {
          if (current.messages.some((message) => message.id === packet.message.id)) return current;
          return {
            ...current,
            messages: [...current.messages, {
              ...packet.message,
              direction: 'incoming',
              status: 'delivered',
            }],
          };
        });
        sendPacket({ kind: 'ack', id: packet.message.id });
        notify(`Neue Nachricht von ${packet.message.senderName}`);
      }

      if (packet.kind === 'ack') {
        setData((current) => ({
          ...current,
          messages: current.messages.map((message) => message.id === packet.id
            ? { ...message, status: 'delivered' }
            : message),
        }));
      }

      if (packet.kind === 'task') {
        setData((current) => {
          if (current.tasks.some((task) => task.id === packet.task.id)) return current;
          return { ...current, tasks: [{ ...packet.task, shared: true }, ...current.tasks] };
        });
        notify(`${packet.senderName} hat eine Aufgabe geteilt.`);
      }
    } catch {
      notify('Ein empfangenes Paket war nicht lesbar.');
    }
  }

  function setupDataChannel(channel: RTCDataChannel) {
    dataChannelRef.current = channel;
    channel.onopen = () => {
      setConnectionState('connected');
      setPairError('');
      flushPendingMessages();
    };
    channel.onmessage = (event) => handlePeerPacket(String(event.data));
    channel.onclose = () => setConnectionState('ready');
    channel.onerror = () => setPairError('Die Direktverbindung wurde unterbrochen.');
  }

  function createPeerConnection() {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC wird auf diesem Gerät nicht unterstützt.');
    }
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    const connection = new RTCPeerConnection({ iceServers: [] });
    peerConnectionRef.current = connection;
    connection.ondatachannel = (event) => setupDataChannel(event.channel);
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') setConnectionState('connected');
      if (connection.connectionState === 'connecting') setConnectionState('connecting');
      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
        setConnectionState('failed');
      }
    };
    return connection;
  }

  async function createOffer() {
    setPairRole('host');
    setPairError('');
    setLocalCode('');
    setRemoteCode('');
    setConnectionState('preparing');
    try {
      const connection = createPeerConnection();
      setupDataChannel(connection.createDataChannel('schultag-chat', { ordered: true }));
      await connection.setLocalDescription(await connection.createOffer());
      await waitForIceGathering(connection);
      if (!connection.localDescription) throw new Error('Es konnte kein Kopplungscode erstellt werden.');
      setLocalCode(encodeSignal(connection.localDescription));
      setConnectionState('ready');
    } catch (error) {
      setConnectionState('failed');
      setPairError(error instanceof Error ? error.message : 'Kopplung fehlgeschlagen.');
    }
  }

  async function createAnswer() {
    setPairError('');
    setConnectionState('preparing');
    try {
      const offer = decodeSignal(remoteCode);
      if (offer.type !== 'offer') throw new Error('Das ist kein Start-Code.');
      const connection = createPeerConnection();
      await connection.setRemoteDescription(offer);
      await connection.setLocalDescription(await connection.createAnswer());
      await waitForIceGathering(connection);
      if (!connection.localDescription) throw new Error('Es konnte keine Antwort erstellt werden.');
      setLocalCode(encodeSignal(connection.localDescription));
      setConnectionState('connecting');
    } catch (error) {
      setConnectionState('failed');
      setPairError(error instanceof Error ? error.message : 'Antwort konnte nicht erstellt werden.');
    }
  }

  async function acceptAnswer() {
    setPairError('');
    setConnectionState('connecting');
    try {
      const answer = decodeSignal(remoteCode);
      if (answer.type !== 'answer') throw new Error('Das ist kein Antwort-Code.');
      const connection = peerConnectionRef.current;
      if (!connection) throw new Error('Bitte zuerst einen neuen Start-Code erzeugen.');
      await connection.setRemoteDescription(answer);
    } catch (error) {
      setConnectionState('failed');
      setPairError(error instanceof Error ? error.message : 'Verbindung konnte nicht abgeschlossen werden.');
    }
  }

  function resetPairing() {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current = null;
    setPairRole(null);
    setConnectionState('idle');
    setLocalCode('');
    setRemoteCode('');
    setPairError('');
  }

  async function copyCode() {
    if (!localCode) return;
    try {
      await navigator.clipboard.writeText(localCode);
      notify('Kopplungscode kopiert.');
    } catch {
      notify('Bitte den Code markieren und manuell kopieren.');
    }
  }

  async function shareCode() {
    if (!localCode) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Schultag Kopplungscode', text: localCode });
        return;
      } catch {
        return;
      }
    }
    await copyCode();
  }

  function submitMessage(event: FormEvent) {
    event.preventDefault();
    const body = messageDraft.trim();
    if (!body) return;
    const message: ChatMessage = {
      id: createId('msg'),
      body,
      createdAt: new Date().toISOString(),
      senderId: data.user.id,
      senderName: data.user.name,
      direction: 'outgoing',
      status: 'pending',
    };
    setData((current) => ({ ...current, messages: [...current.messages, message] }));
    setMessageDraft('');
    const { direction: _direction, status: _status, ...payload } = message;
    if (sendPacket({ kind: 'message', message: payload })) {
      setData((current) => ({
        ...current,
        messages: current.messages.map((item) => item.id === message.id ? { ...item, status: 'sent' } : item),
      }));
    } else {
      notify('Lokal gespeichert — wartet auf eine Direktverbindung.');
    }
  }

  function submitTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    const task: SchoolTask = {
      id: createId('task'),
      title: taskTitle.trim(),
      subject: taskSubject,
      due: 'offen',
      completed: false,
    };
    setData((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    setTaskTitle('');
    notify('Aufgabe lokal gespeichert.');
  }

  function toggleTask(taskId: string) {
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) => task.id === taskId ? { ...task, completed: !task.completed } : task),
    }));
  }

  function shareTask(task: SchoolTask) {
    if (!sendPacket({ kind: 'task', task, senderName: data.user.name })) {
      notify('Zum Teilen zuerst ein Gerät verbinden.');
      return;
    }
    notify('Aufgabe direkt gesendet.');
  }

  function saveNote() {
    const note: Note = {
      id: data.notes[0]?.id ?? createId('note'),
      body: noteDraft,
      updatedAt: new Date().toISOString(),
    };
    setData((current) => ({ ...current, notes: [note, ...current.notes.slice(1)] }));
    notify('Notiz lokal gespeichert.');
  }

  function resetDemoData() {
    if (!window.confirm('Lokale Testdaten auf diesem Gerät zurücksetzen?')) return;
    setData(defaultData);
    setNoteDraft(defaultData.notes[0].body);
    notify('Testdaten zurückgesetzt.');
  }

  const connectionLabel = {
    idle: 'Nicht verbunden',
    preparing: 'Code wird erstellt …',
    ready: 'Code bereit',
    connecting: 'Verbindung wird aufgebaut …',
    connected: 'Direkt verbunden',
    failed: 'Verbindung fehlgeschlagen',
  }[connectionState];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand-button" type="button" onClick={() => setView('today')} aria-label="Schultag Startseite">
          <span className="brand-mark"><span>S</span><i /></span>
          <span className="brand-name">SCHULTAG<small>LOCAL FIRST</small></span>
        </button>

        <nav className="nav-list" aria-label="Hauptnavigation">
          {navigation.map(({ id, label, icon: Icon, later }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'is-active' : ''}`}
              type="button"
              onClick={() => setView(id)}
            >
              <Icon />
              <span>{label}</span>
              {id === 'nearby' && connected ? <b className="nav-live">1</b> : null}
              {id === 'chat' && pendingMessages.length ? <b>{pendingMessages.length}</b> : null}
              {later ? <em>BALD</em> : null}
            </button>
          ))}
        </nav>

        <button className={`profile-button ${view === 'profile' ? 'is-active' : ''}`} type="button" onClick={() => setView('profile')}>
          <span className="avatar">{data.user.name.slice(0, 2).toUpperCase()}</span>
          <span>
            <strong>{data.user.name}</strong>
            <small>{data.user.className} · {data.user.school}</small>
          </span>
          <CircleUserRound />
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p>TESTVERSION 0.1 · LOKAL AUF DIESEM GERÄT</p>
            <h1>{view === 'today' ? `Hallo, ${data.user.name}.` : navigation.find((item) => item.id === view)?.label ?? 'Profil'}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`offline-pill ${online ? 'is-online' : ''}`}>
              {online ? <Wifi /> : <WifiOff />} {online ? 'Internet verfügbar' : 'Offline bereit'}
            </span>
            <Button className="primary-button" onClick={() => setView('chat')}><Send /> Schnellnachricht</Button>
          </div>
        </header>

        {view === 'today' ? (
          <div className="dashboard-grid">
            <section className="hero-card">
              <div className="hero-copy">
                <span className="eyebrow">DEIN TAG</span>
                <h2>Alles im Blick.<br />Auch ohne WLAN.</h2>
                <p>{openTasks.length} offene Aufgaben, deine Notizen und Nachrichten direkt auf diesem Gerät.</p>
              </div>
              <div className="signal-orbit" aria-hidden="true">
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
                <span className="orbit orbit-three" />
                <span className={`signal-core ${connected ? 'is-connected' : ''}`}><Radio /></span>
                <span className="peer peer-one">LK</span>
                <span className="peer peer-two">NS</span>
                <span className="peer peer-three">+2</span>
              </div>
            </section>

            <section className="panel timetable-panel">
              <div className="panel-heading">
                <div><span className="eyebrow">NÄCHSTER SCHULTAG</span><h2>Stundenplan</h2></div>
                <button className="icon-button" type="button" aria-label="Stundenplan öffnen"><CalendarDays /></button>
              </div>
              <div className="lessons">
                {lessons.map((lesson) => (
                  <article className={`lesson ${lesson.current ? 'current' : ''}`} key={lesson.time}>
                    <time>{lesson.time}</time><span className="lesson-line" />
                    <div><strong>{lesson.subject}</strong><small>{lesson.room}</small></div>
                    {lesson.current ? <span className="lesson-state">Als Nächstes</span> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="panel nearby-panel">
              <div className="panel-heading">
                <div><span className="eyebrow">WEBRTC-TEST</span><h2>Nearby</h2></div>
                <span className={`live-dot ${connected ? '' : 'is-idle'}`}>{connected ? 'LIVE' : 'BEREIT'}</span>
              </div>
              <div className="nearby-count"><strong>{connected ? '1' : '0'}</strong><span>Gerät<br />direkt verbunden</span></div>
              <p className="nearby-caption">Manuelle Kopplung im selben lokalen Netz oder Hotspot.</p>
              <button className="panel-link" type="button" onClick={() => setView('nearby')}>Kopplung öffnen <ChevronRight /></button>
            </section>

            <section className="panel tasks-panel">
              <div className="panel-heading">
                <div><span className="eyebrow">NOCH OFFEN</span><h2>Aufgaben</h2></div>
                <span className="count-chip">{openTasks.length}</span>
              </div>
              {openTasks.slice(0, 3).map((task) => (
                <div className="task-row" key={task.id}>
                  <button type="button" aria-label={`${task.title} erledigen`} onClick={() => toggleTask(task.id)}><CheckCircle2 /></button>
                  <span className={`subject-dot ${task.subject.toLowerCase().slice(0, 4)}`} />
                  <div><strong>{task.title}</strong><small>{task.subject} · {task.due}</small></div>
                  <ChevronRight />
                </div>
              ))}
              {!openTasks.length ? <div className="empty-compact"><CheckCircle2 /> Alles erledigt.</div> : null}
            </section>

            <section className="panel sync-panel">
              <div className="sync-icon"><School /></div>
              <div>
                <span className="eyebrow">LOKAL GESPEICHERT</span>
                <h2>{pendingMessages.length} Nachricht{pendingMessages.length === 1 ? '' : 'en'} warten</h2>
                <p>{pendingMessages.length ? 'Die Warteschlange wird bei der nächsten Direktverbindung übertragen.' : 'Alles ist auf diesem Gerät gespeichert.'}</p>
              </div>
              <button className="icon-button" type="button" aria-label="Warteschlange öffnen" onClick={() => setView('chat')}><ChevronRight /></button>
            </section>
          </div>
        ) : null}

        {view === 'chat' ? (
          <div className="chat-layout">
            <aside className="chat-list panel">
              <div className="section-intro"><span className="eyebrow">NACHRICHTEN</span><h2>Unterhaltungen</h2></div>
              <button className="conversation is-active" type="button">
                <span className="avatar lena">LE</span><span><strong>Lena König</strong><small>{data.messages.at(-1)?.body ?? 'Noch keine Nachricht'}</small></span>
                {pendingMessages.length ? <b>{pendingMessages.length}</b> : null}
              </button>
              <button className="conversation" type="button" disabled>
                <span className="avatar class-avatar">10B</span><span><strong>Klasse 10b</strong><small>Gruppenchat · Version 0.4</small></span><em>BALD</em>
              </button>
              <div className="privacy-note"><LockKeyhole /><span><strong>Keine Cloud.</strong> Dieser Verlauf liegt nur auf dem Gerät.</span></div>
            </aside>

            <section className="chat-panel panel">
              <header className="chat-header">
                <div className="chat-person"><span className="avatar lena">LE</span><span><strong>Lena König</strong><small>{connected ? 'Direkt verbunden' : 'Nicht in Reichweite'}</small></span></div>
                <span className={`connection-chip ${connected ? 'is-connected' : ''}`}><i /> {connectionLabel}</span>
              </header>
              <div className="messages" aria-live="polite">
                <div className="day-divider"><span>HEUTE</span></div>
                {data.messages.map((message) => (
                  <article className={`message ${message.direction}`} key={message.id} title={`ID: ${message.id}`}>
                    <p>{message.body}</p>
                    <footer>
                      <time>{messageTime(message.createdAt)}</time>
                      {message.direction === 'outgoing' ? <span className={`message-status ${message.status}`} title={statusLabel(message.status)}><StatusIcon status={message.status} /></span> : null}
                    </footer>
                  </article>
                ))}
              </div>
              <form className="message-composer" onSubmit={submitMessage}>
                <Input value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Nachricht schreiben …" aria-label="Nachricht" autoComplete="off" />
                <Button type="submit" size="icon-lg" aria-label="Nachricht senden"><Send /></Button>
              </form>
              <div className="queue-hint"><Info /> Ohne Verbindung bleibt die Nachricht lokal als „ausstehend“ gespeichert.</div>
            </section>
          </div>
        ) : null}

        {view === 'nearby' ? (
          <div className="nearby-view">
            <section className="connection-hero">
              <div>
                <span className="eyebrow">DIREKT VON GERÄT ZU GERÄT</span>
                <h2>iPad ↔ iPhone testen</h2>
                <p>Beide Geräte öffnen Schultag im selben lokalen WLAN oder persönlichen Hotspot. Kopplungscodes können per AirDrop geteilt werden; danach laufen Nachrichten direkt per WebRTC.</p>
              </div>
              <div className={`device-link ${connected ? 'is-connected' : ''}`} aria-hidden="true">
                <span><Smartphone /></span><i><ArrowLeftRight /></i><span className="tablet-device"><Smartphone /></span>
              </div>
            </section>

            <div className="nearby-columns">
              <section className="panel pair-panel">
                <div className="pair-status-row">
                  <div><span className="eyebrow">STATUS</span><h2>{connectionLabel}</h2></div>
                  <span className={`status-beacon ${connected ? 'is-connected' : ''}`}><i />{connected ? '1 Gerät' : '0 Geräte'}</span>
                </div>

                {pairRole === null ? (
                  <div className="role-picker">
                    <div className="pair-step"><span>1</span><div><strong>Wähle auf dem ersten Gerät „Starten“</strong><small>Es erzeugt einen Code für die Direktverbindung.</small></div></div>
                    <div className="role-actions">
                      <Button size="lg" onClick={createOffer}><Radio /> Dieses Gerät startet</Button>
                      <Button size="lg" variant="outline" onClick={() => { setPairRole('join'); setConnectionState('ready'); }}><Smartphone /> Dieses Gerät tritt bei</Button>
                    </div>
                  </div>
                ) : null}

                {pairRole === 'host' ? (
                  <div className="pair-flow">
                    <div className="flow-heading"><span className="step-number">1</span><div><strong>Start-Code an das zweite Gerät</strong><small>Am besten über „Teilen“ → AirDrop.</small></div></div>
                    <Textarea className="code-box" value={localCode} readOnly placeholder="Code wird erstellt …" aria-label="Start-Code" />
                    <div className="inline-actions">
                      <Button variant="outline" onClick={copyCode} disabled={!localCode}><Copy /> Kopieren</Button>
                      <Button onClick={shareCode} disabled={!localCode}><Share2 /> Teilen</Button>
                    </div>
                    <div className="flow-heading"><span className="step-number">2</span><div><strong>Antwort-Code hier einfügen</strong><small>Er kommt vom zweiten Gerät zurück.</small></div></div>
                    <Textarea className="code-box" value={remoteCode} onChange={(event) => setRemoteCode(event.target.value)} placeholder="Antwort-Code …" aria-label="Antwort-Code" />
                    <Button size="lg" onClick={acceptAnswer} disabled={!remoteCode.trim() || connected}><ArrowLeftRight /> Verbindung abschließen</Button>
                  </div>
                ) : null}

                {pairRole === 'join' ? (
                  <div className="pair-flow">
                    <div className="flow-heading"><span className="step-number">1</span><div><strong>Start-Code vom ersten Gerät</strong><small>Code vollständig einfügen.</small></div></div>
                    <Textarea className="code-box" value={remoteCode} onChange={(event) => setRemoteCode(event.target.value)} placeholder="Start-Code …" aria-label="Start-Code einfügen" />
                    <Button size="lg" onClick={createAnswer} disabled={!remoteCode.trim()}><Sparkles /> Antwort erzeugen</Button>
                    {localCode ? (
                      <>
                        <div className="flow-heading"><span className="step-number">2</span><div><strong>Antwort zurück zum ersten Gerät</strong><small>Dort wird damit die Verbindung abgeschlossen.</small></div></div>
                        <Textarea className="code-box" value={localCode} readOnly aria-label="Erzeugter Antwort-Code" />
                        <div className="inline-actions">
                          <Button variant="outline" onClick={copyCode}><Copy /> Kopieren</Button>
                          <Button onClick={shareCode}><Share2 /> Teilen</Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {pairError ? <div className="error-message"><X />{pairError}</div> : null}
                {pairRole !== null ? <Button variant="ghost" className="reset-button" onClick={resetPairing}><RotateCcw /> Kopplung zurücksetzen</Button> : null}
              </section>

              <aside className="nearby-info-stack">
                <section className="panel honesty-card">
                  <WifiOff />
                  <div><span className="eyebrow">WICHTIGE GRENZE</span><h3>Eine Website findet Geräte nicht automatisch.</h3><p>Der Browser bekommt keinen Zugriff auf Apples Peer-to-Peer-WLAN-Suche. Automatisches Nearby braucht später eine native Swift-App.</p></div>
                </section>
                <section className="panel security-card">
                  <ShieldCheck />
                  <div><span className="eyebrow">SICHERHEIT IM TEST</span><h3>Transport verschlüsselt</h3><p>WebRTC verschlüsselt den Datenkanal. Eine geprüfte Schulidentität und echte Ende-zu-Ende-Schlüsselverwaltung fehlen im MVP noch.</p></div>
                </section>
                <section className="panel queue-card">
                  <Clock3 />
                  <div><span className="eyebrow">WARTESCHLANGE</span><h3>{pendingMessages.length} ausstehend</h3><p>Beim Verbinden werden lokal wartende Nachrichten automatisch übertragen.</p></div>
                </section>
              </aside>
            </div>
          </div>
        ) : null}

        {view === 'tasks' ? (
          <div className="tasks-layout">
            <section className="panel task-manager">
              <div className="panel-heading"><div><span className="eyebrow">LOKALER AUFGABENPLANER</span><h2>Meine Aufgaben</h2></div><span className="count-chip">{openTasks.length}</span></div>
              <form className="task-form" onSubmit={submitTask}>
                <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Neue Aufgabe …" aria-label="Aufgabentitel" />
                <select value={taskSubject} onChange={(event) => setTaskSubject(event.target.value)} aria-label="Fach">
                  <option>Mathematik</option><option>Deutsch</option><option>Englisch</option><option>Biologie</option><option>Geschichte</option><option>Sonstiges</option>
                </select>
                <Button type="submit"><Plus /> Hinzufügen</Button>
              </form>
              <div className="task-list-full">
                {data.tasks.map((task) => (
                  <article className={`task-item-full ${task.completed ? 'is-complete' : ''}`} key={task.id}>
                    <button type="button" onClick={() => toggleTask(task.id)} aria-label={`${task.title} ${task.completed ? 'wieder öffnen' : 'erledigen'}`}><CheckCircle2 /></button>
                    <span className={`subject-dot ${task.subject.toLowerCase().slice(0, 4)}`} />
                    <div><strong>{task.title}</strong><small>{task.subject} · {task.due}{task.shared ? ' · geteilt' : ''}</small></div>
                    <Button variant="ghost" size="icon" onClick={() => shareTask(task)} aria-label={`${task.title} teilen`} disabled={!connected}><Share2 /></Button>
                  </article>
                ))}
              </div>
            </section>

            <aside className="panel notes-panel">
              <div className="panel-heading"><div><span className="eyebrow">NOTIZBLOCK</span><h2>Für mich</h2></div><NotebookPen /></div>
              <Textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Notiz für den Schultag …" />
              <Button onClick={saveNote}>Lokal speichern</Button>
              <p><LockKeyhole /> Bleibt nur auf diesem Gerät.</p>
            </aside>
          </div>
        ) : null}

        {(view === 'classes' || view === 'feed' || view === 'games') ? (() => {
          const item = futureCopy[view];
          const Icon = item.icon;
          return (
            <section className="future-panel panel">
              <span className="future-icon"><Icon /></span>
              <span className="eyebrow">ROADMAP · NICHT TEIL DES TESTS</span>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
              <Button variant="outline" onClick={() => setView('today')}>Zurück zu Version 0.1</Button>
            </section>
          );
        })() : null}

        {view === 'profile' ? (
          <div className="profile-layout">
            <section className="panel profile-panel">
              <div className="panel-heading"><div><span className="eyebrow">LOKALES PROFIL</span><h2>Dieses Gerät</h2></div><CircleUserRound /></div>
              <label>Name<Input value={data.user.name} onChange={(event) => setData((current) => ({ ...current, user: { ...current.user, name: event.target.value } }))} /></label>
              <label>Klasse<Input value={data.user.className} onChange={(event) => setData((current) => ({ ...current, user: { ...current.user, className: event.target.value } }))} /></label>
              <label>Schule<Input value={data.user.school} onChange={(event) => setData((current) => ({ ...current, user: { ...current.user, school: event.target.value } }))} /></label>
              <p className="save-state"><Check /> Änderungen werden automatisch lokal gespeichert.</p>
            </section>

            <section className="panel install-panel">
              <span className="install-icon"><Share2 /></span>
              <div><span className="eyebrow">AUF IPAD / IPHONE</span><h2>Zum Home-Bildschirm</h2><p>In Safari: Teilen → „Zum Home-Bildschirm“. Danach startet Schultag wie eine App und die bereits geladenen Bereiche funktionieren offline.</p></div>
            </section>

            <section className="panel reset-panel">
              <div><span className="eyebrow">NUR FÜR DEN TEST</span><h2>Lokale Daten zurücksetzen</h2><p>Entfernt Nachrichten, Aufgaben und Notizen dieses Prototyps von diesem Gerät.</p></div>
              <Button variant="destructive" onClick={resetDemoData}><RotateCcw /> Zurücksetzen</Button>
            </section>
          </div>
        ) : null}
      </section>

      {toast ? <output className="toast" aria-live="polite"><CheckCircle2 />{toast}</output> : null}
    </main>
  );
}
