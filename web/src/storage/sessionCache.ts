import type { Message, Session } from "../types/messages";

const DB_NAME = "research-assistant-cache";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const MESSAGE_STORE = "messages";

type CachedMessage = Message & {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
};

function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
        const store = db.createObjectStore(MESSAGE_STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStores<T>(
  mode: IDBTransactionMode,
  callback: (stores: { sessions: IDBObjectStore; messages: IDBObjectStore }) => T
) {
  const db = await openCache();

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction([SESSION_STORE, MESSAGE_STORE], mode);
      const result = callback({
        sessions: transaction.objectStore(SESSION_STORE),
        messages: transaction.objectStore(MESSAGE_STORE),
      });

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function loadCachedSessions(): Promise<Session[]> {
  const db = await openCache();

  try {
    const sessionTransaction = db.transaction(SESSION_STORE, "readonly");
    const sessions = (await requestToPromise(
      sessionTransaction.objectStore(SESSION_STORE).getAll()
    )) as Omit<Session, "messages">[];

    const messageTransaction = db.transaction(MESSAGE_STORE, "readonly");
    const messages = (await requestToPromise(
      messageTransaction.objectStore(MESSAGE_STORE).getAll()
    )) as CachedMessage[];
    const messagesBySession = new Map<string, Message[]>();

    for (const message of messages) {
      const { sessionId, createdAt, updatedAt, ...rest } = message;
      const items = messagesBySession.get(sessionId) ?? [];
      items.push(rest);
      messagesBySession.set(sessionId, items);
      void createdAt;
      void updatedAt;
    }

    return sessions
      .map((session) => ({
        ...session,
        messages: messagesBySession.get(session.id) ?? [],
      }))
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  } finally {
    db.close();
  }
}

export async function saveCachedSessions(sessions: Session[]) {
  await withStores("readwrite", ({ sessions: sessionStore, messages }) => {
    sessionStore.clear();
    messages.clear();

    for (const session of sessions) {
      const { messages: sessionMessages, ...summary } = session;
      sessionStore.put(summary);

      for (const message of sessionMessages) {
        messages.put({
          ...message,
          sessionId: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt ?? session.createdAt,
        } satisfies CachedMessage);
      }
    }
  });
}
