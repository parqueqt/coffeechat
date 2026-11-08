import { route } from "../lib/http.js";
import { kstNow, publicSchedule } from "../lib/schedule.js";
import { getStore, readDoc } from "../lib/store.js";

export const GET = route(async () => publicSchedule(await readDoc(getStore()), kstNow()));
