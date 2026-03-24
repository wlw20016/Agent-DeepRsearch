import { v4 as uuid } from "uuid";

type Decision = "approved" | "rejected";

const waiters = new Map<
  string,
  {
    resolve: (d: Decision) => void;
    created: number;
  }
>();

export function createApproval(): { id: string; wait: () => Promise<Decision> } {
  const id = uuid();
  let resolveFn: (d: Decision) => void = () => {};
  const wait = new Promise<Decision>((resolve) => {
    resolveFn = resolve;
  });
  waiters.set(id, { resolve: resolveFn, created: Date.now() });
  // 超时兜底
  setTimeout(() => {
    if (waiters.has(id)) {
      waiters.get(id)?.resolve("approved");
      waiters.delete(id);
    }
  }, 60_000);
  return { id, wait: () => wait };
}

export function resolveApproval(id: string, decision: Decision) {
  if (waiters.has(id)) {
    waiters.get(id)?.resolve(decision);
    waiters.delete(id);
  }
}
