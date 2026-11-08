import { randomUUID } from "node:crypto";
import { readJson, route } from "../lib/http.js";
import { createBooking, kstNow, parseBooking } from "../lib/schedule.js";
import { getStore, updateDoc } from "../lib/store.js";

export const POST = route(async (request) => {
  const input = parseBooking(await readJson(request));
  const identity = { id: randomUUID(), createdAt: new Date().toISOString() };
  const booking = await updateDoc(getStore(), (doc) => createBooking(doc, input, kstNow(), identity));
  return { id: booking.id };
});
