import * as blobSdk from "@vercel/blob";
import { AppError, emptyDoc } from "./schedule.js";

const MAX_WRITE_ATTEMPTS = 12;
const SESSION_MS = 7 * 24 * 3600 * 1000;

// 저장소는 Vercel Blob(private) 하나다. 일정 전체가 문서 한 장이고, 쓰기는 ETag 를 맞춰 본 뒤에만 한다.
// 미리보기 배포가 운영 데이터를 건드리지 않도록 환경마다 폴더를 나눈다.
export function blobStore(sdk = blobSdk, env = process.env.VERCEL_ENV || "local") {
  const docPath = `coffeechat/${env}/doc.json`;
  const sessionPath = (token) => `coffeechat/${env}/sessions/${token}.json`;
  const putOptions = { access: "private", contentType: "application/json", addRandomSuffix: false };

  async function readText(pathname) {
    // useCache: false — 캐시를 거치면 방금 닫힌 시간이 열린 것처럼 보일 수 있다.
    const result = await sdk.get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { text: await new Response(result.stream).text(), etag: result.blob.etag };
  }

  return {
    async read() {
      const found = await readText(docPath);
      return found ? { raw: found.text, version: found.etag } : { raw: null, version: null };
    },
    async compareAndSet(version, next) {
      try {
        await sdk.put(docPath, next, version ? { ...putOptions, ifMatch: version } : { ...putOptions, allowOverwrite: false });
        return true;
      } catch (err) {
        if (err instanceof sdk.BlobPreconditionFailedError) return false;
        // 처음 만들 때 다른 요청이 먼저 만들었으면 다시 읽고 재시도한다.
        if (!version && (await readText(docPath))) return false;
        throw err;
      }
    },
    saveSession: (token, hostId) =>
      sdk.put(sessionPath(token), JSON.stringify({ hostId, expiresAt: Date.now() + SESSION_MS }), putOptions),
    async findSession(token) {
      const found = await readText(sessionPath(token));
      if (!found) return null;
      const { hostId, expiresAt } = JSON.parse(found.text);
      return expiresAt > Date.now() ? hostId : null;
    },
    deleteSession: (token) => sdk.del(sessionPath(token)),
  };
}

function memoryStore() {
  let doc = null;
  const sessions = new Map();
  return {
    read: async () => ({ raw: doc, version: doc }),
    compareAndSet: async (version, next) => {
      if (doc !== version) return false;
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
  const { BLOB_READ_WRITE_TOKEN, BLOB_STORE_ID, VERCEL } = process.env;
  if (BLOB_READ_WRITE_TOKEN || BLOB_STORE_ID) return blobStore();
  // Vercel 인스턴스는 언제든 교체되므로 메모리에 받으면 신청이 조용히 사라진다.
  if (VERCEL) throw new AppError("storage_not_configured");
  return (localStore ??= memoryStore());
}

export async function readDoc(store) {
  const { raw } = await store.read();
  return raw ? JSON.parse(raw) : emptyDoc();
}

export async function updateDoc(store, mutate) {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { raw, version } = await store.read();
    const doc = raw ? JSON.parse(raw) : emptyDoc();
    const result = mutate(doc);
    if (await store.compareAndSet(version, JSON.stringify(doc))) return result;
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 40 * attempt));
  }
  throw new AppError("busy");
}
