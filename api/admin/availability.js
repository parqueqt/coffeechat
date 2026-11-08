import { readJson, requireAdmin, route } from "../../lib/http.js";
import {
  addAvailability,
  kstNow,
  parseAvailabilityRemoval,
  parseAvailabilityUpload,
  removeAvailability,
} from "../../lib/schedule.js";
import { getStore, updateDoc } from "../../lib/store.js";

export const POST = route(async (request) => {
  const store = getStore();
  const host = await requireAdmin(request, store);
  const upload = parseAvailabilityUpload(await readJson(request));
  await updateDoc(store, (doc) => addAvailability(doc, host, upload, kstNow()));
  return {};
});

export const DELETE = route(async (request) => {
  const store = getStore();
  const host = await requireAdmin(request, store);
  const removal = parseAvailabilityRemoval(await readJson(request));
  await updateDoc(store, (doc) => removeAvailability(doc, host, removal));
  return {};
});
