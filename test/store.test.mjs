import assert from "node:assert/strict";
import { test } from "node:test";
import { addAvailability, createBooking } from "../lib/schedule.js";
import { blobStore, readDoc, updateDoc } from "../lib/store.js";

// Blob 서버처럼 굴러가는 가짜. 비교와 교체 사이에 await 가 없어 서버 쪽 원자성을 흉내 낸다.
// get() 은 실제처럼 CDN 이 압축하며 약한 ETag(W/"…")를 돌려준다. ifMatch 에 맞는 원본 ETag 는 head() 만 준다.
// (2026-11-10 미리보기에서 get() 의 ETag 로 ifMatch 를 걸어 모든 쓰기가 busy 가 됐다.)
class PreconditionFailed extends Error {}
class NotFound extends Error {}

function fakeBlob() {
  const files = new Map();
  const getOptions = [];
  let version = 0;
  const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
  return {
    files,
    getOptions,
    BlobPreconditionFailedError: PreconditionFailed,
    BlobNotFoundError: NotFound,
    async get(pathname, options) {
      getOptions.push(options);
      await jitter();
      const file = files.get(pathname);
      return file ? { statusCode: 200, stream: new Response(file.body).body, blob: { etag: `W/${file.etag}` } } : null;
    },
    async head(pathname) {
      await jitter();
      const file = files.get(pathname);
      if (!file) throw new NotFound();
      return { etag: file.etag };
    },
    async put(pathname, body, options) {
      await jitter();
      const current = files.get(pathname);
      if (options.ifMatch !== undefined) {
        if (!current || current.etag !== options.ifMatch) throw new PreconditionFailed();
      } else if (current && !options.allowOverwrite) {
        throw new Error("This blob already exists");
      }
      files.set(pathname, { body, etag: `"v${++version}"` });
      return {};
    },
    async del(pathname) {
      files.delete(pathname);
    },
  };
}

const NOW = { date: "2030-01-10", minute: 0 };
const DAY = "2030-01-20";

test("concurrent first writes to an empty store all land", async () => {
  const sdk = fakeBlob();
  const store = blobStore(sdk, "test");
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updateDoc(store, (doc) => addAvailability(doc, "hyunwoo", { dates: [DAY], start: i * 60, end: i * 60 + 30 }, NOW))
    )
  );
  assert.equal((await readDoc(store)).availability.hyunwoo[DAY].length, 10);
});

test("twenty people booking the same time at once leaves exactly one booking", async () => {
  const sdk = fakeBlob();
  const store = blobStore(sdk, "test");
  await updateDoc(store, (doc) => addAvailability(doc, "hyunwoo", { dates: [DAY], start: 600, end: 840 }, NOW));
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      updateDoc(store, (doc) =>
        createBooking(
          doc,
          { name: `신청자${i}`, party: "hyunwoo", date: DAY, start: 720, end: 780, method: "커피", location: "카페", isCustom: false, message: "" },
          NOW,
          { id: `b${i}`, createdAt: "2030-01-01T00:00:00.000Z" }
        )
      )
    )
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.code === "slot_taken"));
  assert.equal((await readDoc(store)).bookings.length, 1);
});

test("every read bypasses the cache so a closed time never looks open", async () => {
  const sdk = fakeBlob();
  const store = blobStore(sdk, "test");
  await updateDoc(store, (doc) => addAvailability(doc, "hyunwoo", { dates: [DAY], start: 600, end: 660 }, NOW));
  await store.saveSession("x", "hyunwoo");
  await readDoc(store);
  await store.findSession("x");
  assert.ok(sdk.getOptions.length >= 2);
  assert.ok(sdk.getOptions.every((o) => o.access === "private" && o.useCache === false));
});

test("environments keep separate data", async () => {
  const sdk = fakeBlob();
  await updateDoc(blobStore(sdk, "preview"), (doc) => addAvailability(doc, "hyunwoo", { dates: [DAY], start: 600, end: 660 }, NOW));
  assert.deepEqual((await readDoc(blobStore(sdk, "production"))).availability, {});
  assert.deepEqual([...sdk.files.keys()], ["coffeechat/preview/doc.json"]);
});

test("admin sessions are found until they are deleted", async () => {
  const sdk = fakeBlob();
  const store = blobStore(sdk, "test");
  await store.saveSession("tok", "minseok");
  assert.equal(await store.findSession("tok"), "minseok");
  assert.equal(await store.findSession("other"), null);
  await store.deleteSession("tok");
  assert.equal(await store.findSession("tok"), null);
});
