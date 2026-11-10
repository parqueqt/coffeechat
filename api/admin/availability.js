import { readJson, requireAdmin, route } from "../../lib/http.js";
import { addAvailability, kstNow, parseAvailabilityUpload } from "../../lib/schedule.js";
import { getStore, updateDoc } from "../../lib/store.js";

// 관리자는 시간을 올리기만 한다. 지우기·신청 취소는 일부러 두지 않는다.
export const POST = route(async (request) => {
  const store = getStore();
  const host = await requireAdmin(request, store);
  const upload = parseAvailabilityUpload(await readJson(request));
  await updateDoc(store, (doc) => addAvailability(doc, host, upload, kstNow()));
  return {};
});
