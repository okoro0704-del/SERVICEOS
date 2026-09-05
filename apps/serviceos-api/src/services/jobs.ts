import { getLocalJobDispatcher } from "./register-primitives.js";
import { expireOffer } from "./dispatch.js";
import { recalculateJobEta } from "./eta.js";

export function registerJobHandlers() {
  const local = getLocalJobDispatcher();
  if (!local) return;
  local.registerHandler("serviceos.offer.expire", async (payload) => {
    const jobId = String(payload.jobId ?? "");
    const providerId = String(payload.providerId ?? "");
    if (jobId && providerId) await expireOffer(jobId, providerId);
  });
  local.registerHandler("serviceos.eta.recalculate", async (payload) => {
    const jobId = String(payload.jobId ?? "");
    if (jobId) await recalculateJobEta(jobId);
  });
}
