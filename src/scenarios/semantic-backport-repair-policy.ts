import type { RepairPolicy } from "../core/types.js";

/** PortProof-owned authorization for the semantic-backport MVP. */
export const semanticBackportRepairPolicy: RepairPolicy = {
  allowedPaths: ["src/request.js"],
};
