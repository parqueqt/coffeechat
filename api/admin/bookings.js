import { readJson, requireAdmin, route } from "../../lib/http.js";
import { AppError, cancelBooking } from "../../lib/schedule.js";
import { getStore, updateDoc } from "../../lib/store.js";

export const DELETE = route(async (request) => {
  const store = getStore();
  await requireAdmin(request, store);
  const { id } = await readJson(request);
  if (typeof id !== "string") throw new AppError("invalid_input");
  await updateDoc(store, (doc) => cancelBooking(doc, id));
  return {};
});
