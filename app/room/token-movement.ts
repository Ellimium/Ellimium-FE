export type TokenPosition = { x: number; y: number };
type TokenMovement = TokenPosition & { token_id: string; sender_id: string; sent_at: string };

// Date.parse truncates microseconds, which can reverse a preview/commit within one millisecond.
export function movementTime(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const milliseconds = Date.parse(value);
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  return milliseconds * 1000 + Number(fraction.padEnd(6, "0").slice(3, 6));
}

export function createTokenMovement(options: {
  userId: string;
  send: (id: string, position: TokenPosition) => Promise<void>;
  save: (id: string, position: TokenPosition) => Promise<void>;
  read: (id: string) => Promise<TokenPosition | null>;
  apply: (id: string, position: TokenPosition) => void;
  error: (message: string) => void;
  denied?: () => void;
  idleMs?: number;
}) {
  type State = {
    version: number;
    saveVersion: number;
    readVersion: number;
    local: boolean;
    pending: TokenPosition | null;
    draining: boolean;
    tail: Promise<void>;
    messageTime: number;
    commitTime: number;
    timer?: ReturnType<typeof setTimeout>;
  };
  const states = new Map<string, State>();
  let disposed = false;
  const state = (id: string) => {
    let current = states.get(id);
    if (!current) {
      current = { version: 0, saveVersion: 0, readVersion: 0, local: false, pending: null, draining: false, tail: Promise.resolve(), messageTime: -Infinity, commitTime: -Infinity };
      states.set(id, current);
    }
    return current;
  };
  const apply = (id: string, position: TokenPosition) => { if (!disposed) options.apply(id, position); };
  const report = (message: string) => { if (!disposed) options.error(message); };
  const enqueue = (s: State, task: () => Promise<void>) => {
    s.tail = s.tail.then(task).catch(() => report("토큰 이동 서버에 연결할 수 없습니다."));
    return s.tail;
  };
  const recover = async (id: string) => {
    const s = state(id);
    if (disposed || s.local) return;
    const version = ++s.readVersion;
    try {
      const position = await options.read(id);
      if (!disposed && !s.local && version === s.readVersion && position) apply(id, position);
    } catch {
      if (!disposed && version === s.readVersion) {
        report("토큰의 확정 위치를 다시 불러올 수 없습니다.");
        expire(id);
      }
    }
  };
  const expire = (id: string) => {
    const s = state(id);
    clearTimeout(s.timer);
    if (!disposed) s.timer = setTimeout(() => { void recover(id); }, options.idleMs ?? 1000);
  };
  const preview = (id: string, position: TokenPosition) => {
    if (disposed) return;
    const s = state(id);
    s.local = true;
    s.version++;
    s.readVersion++;
    s.pending = position;
    clearTimeout(s.timer);
    apply(id, position);
    if (s.draining) return;
    s.draining = true;
    void enqueue(s, async () => {
      try {
        while (!disposed && s.pending) {
          const next = s.pending;
          s.pending = null;
          const version = s.version;
          try { await options.send(id, next); }
          catch (error) {
            report("토큰의 임시 이동을 공유할 수 없습니다.");
            if (!disposed && error && typeof error === "object" && "code" in error && error.code === "42501" && version === s.version) {
              s.pending = null;
              s.local = false;
              options.denied?.();
              await recover(id);
            }
          }
        }
      } finally { s.draining = false; }
    });
  };
  const finish = (id: string, position: TokenPosition) => {
    const s = state(id);
    const version = ++s.version;
    const saveVersion = ++s.saveVersion;
    s.readVersion++;
    s.local = true;
    s.pending = null;
    apply(id, position);
    return enqueue(s, async () => {
      // Only a newer completed move can supersede a queued save, not a preview/cancel.
      if (disposed || saveVersion !== s.saveVersion) return;
      try {
        await options.save(id, position);
        // A failed preview must never roll back a successful confirmed save.
        if (version === s.version) s.local = false;
      } catch {
        if (version === s.version) {
          s.local = false;
        }
        if (saveVersion === s.saveVersion) report("토큰의 최종 위치를 저장할 수 없습니다.");
      }
      if (version === s.version) await recover(id);
    });
  };
  const cancel = (id: string) => {
    const s = state(id);
    const version = ++s.version;
    s.readVersion++;
    s.pending = null;
    s.local = false;
    return enqueue(s, async () => {
      while (!disposed && version === s.version) {
        const readVersion = ++s.readVersion;
        try {
          const position = await options.read(id);
          if (disposed || version !== s.version) return;
          if (readVersion !== s.readVersion) {
            // Keep a newer peer preview; its idle timer will recover the DB position.
            if (s.messageTime > s.commitTime) return;
            continue;
          }
          if (!position) return;
          apply(id, position);
          try { await options.send(id, position); }
          catch { report("토큰의 복구 위치를 공유할 수 없습니다."); }
        } catch {
          if (disposed || version !== s.version) return;
          if (readVersion !== s.readVersion) {
            if (s.messageTime > s.commitTime) return;
            continue;
          }
          report("토큰의 확정 위치를 다시 불러올 수 없습니다.");
        }
        if (version === s.version) await recover(id);
        return;
      }
    });
  };
  return {
    preview, finish, cancel, recover,
    receive(payload: unknown) {
      if (disposed || !payload || typeof payload !== "object") return;
      const movement = payload as TokenMovement;
      if (typeof movement.token_id !== "string" || typeof movement.sender_id !== "string" || movement.sender_id === options.userId ||
        typeof movement.x !== "number" || typeof movement.y !== "number" || !Number.isFinite(movement.x) || !Number.isFinite(movement.y)) return;
      const time = movementTime(movement.sent_at);
      if (!Number.isFinite(time)) return;
      const s = state(movement.token_id);
      if (time <= s.commitTime || time < s.messageTime) return;
      s.messageTime = time;
      s.readVersion++;
      if (!s.local) apply(movement.token_id, movement);
      expire(movement.token_id);
    },
    confirmed(id: string, position: TokenPosition, timestamp: unknown) {
      const time = movementTime(timestamp);
      if (disposed || !Number.isFinite(time)) return;
      const s = state(id);
      if (time < s.commitTime) return;
      s.commitTime = time;
      s.readVersion++;
      if (time >= s.messageTime) {
        clearTimeout(s.timer);
        if (!s.local) apply(id, position);
      }
    },
    dispose() {
      disposed = true;
      for (const s of states.values()) {
        s.pending = null;
        s.version++;
        clearTimeout(s.timer);
      }
    },
  };
}
