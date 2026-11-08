import { AppError, emptyDoc } from "./schedule.js";

const DOC_KEY = "coffeechat:doc";
const SESSION_PREFIX = "coffeechat:session:";
const MAX_WRITE_ATTEMPTS = 12;

// 문서 전체를 비교한 뒤 교체한다. 다른 요청이 먼저 썼으면 0 을 돌려주고 호출자가 다시 읽는다.
const COMPARE_AND_SET = `
local current = redis.call('GET', KEYS[1])
if (current or '') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`;

function upstashStore(url, token) {
  async function command(...args) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const out = await res.json();
    if (!res.ok || out.error) throw new Error(`redis ${args[0]} failed: ${out.error ?? res.status}`);
    return out.result;
  }
  return {
    read: () => command("GET", DOC_KEY),
    compareAndSet: async (expected, next) =>
      (await command("EVAL", COMPARE_AND_SET, "1", DOC_KEY, expected ?? "", next)) === 1,
    saveSession: (token, hostId, ttlSeconds) => command("SET", SESSION_PREFIX + token, hostId, "EX", String(ttlSeconds)),
    findSession: (token) => command("GET", SESSION_PREFIX + token),
    deleteSession: (token) => command("DEL", SESSION_PREFIX + token),
  };
}

function memoryStore() {
  let doc = null;
  const sessions = new Map();
  return {
    read: async () => doc,
    compareAndSet: async (expected, next) => {
      if (doc !== expected) return false;
      doc = next;
      return true;
    },
    saveSession: async (token, hostId) => void sessions.set(token, hostId),
    findSession: async (token) => sessions.get(token) ?? null,
    deleteSession: async (token) => void sessions.delete(token),
  };
}

let localStore;

export function getStore() {
  const { KV_REST_API_URL, KV_REST_API_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, VERCEL } = process.env;
  const url = KV_REST_API_URL || UPSTASH_REDIS_REST_URL;
  const token = KV_REST_API_TOKEN || UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashStore(url, token);
  // Vercel 인스턴스는 언제든 교체되므로 메모리에 받으면 신청이 조용히 사라진다.
  if (VERCEL) throw new AppError("storage_not_configured");
  return (localStore ??= memoryStore());
}

export async function readDoc(store) {
  const raw = await store.read();
  return raw ? JSON.parse(raw) : emptyDoc();
}

export async function updateDoc(store, mutate) {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const raw = await store.read();
    const doc = raw ? JSON.parse(raw) : emptyDoc();
    const result = mutate(doc);
    if (await store.compareAndSet(raw, JSON.stringify(doc))) return result;
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 40 * attempt));
  }
  throw new AppError("busy");
}
