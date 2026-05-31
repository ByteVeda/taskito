import { JOB_STATUS_LABEL, JOB_STATUS_TONE, type JobStatus } from "@/lib/status";
import { Badge } from "./badge";

/** A job-status pill with a leading status dot. */
export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge tone={JOB_STATUS_TONE[status]} dot>
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}
