import { currentAdmin, route } from "../../lib/http.js";
import { adminView, kstNow } from "../../lib/schedule.js";
import { getStore, readDoc } from "../../lib/store.js";

export const GET = route(async (request) => {
  const store = getStore();
  const host = await currentAdmin(request, store);
  if (!host) return { host: null };
  return { host, ...adminView(await readDoc(store), host, kstNow()) };
});
