import { useNavigate } from "@tanstack/react-router";
import { Ban, Copy, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Job } from "@/lib/api-types";
import { useCancelJob, useReplayJob } from "../hooks";
import { canCancel, canReplay } from "../utils";

interface JobActionsProps {
  job: Job;
}

export function JobActions({ job }: JobActionsProps) {
  const navigate = useNavigate();
  const cancelMutation = useCancelJob();
  const replayMutation = useReplayJob();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReplay, setConfirmReplay] = useState(false);

  const onCopyId = async () => {
    try {
      await navigator.clipboard.writeText(job.id);
      toast.success("Job ID copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const onReplay = async () => {
    const result = await replayMutation.mutateAsync(job.id);
    if (result.replay_job_id) {
      navigate({ to: "/jobs/$id", params: { id: result.replay_job_id } });
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={onCopyId}>
        <Copy aria-hidden /> Copy ID
      </Button>
      {canCancel(job.status) ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmCancel(true)}
          disabled={cancelMutation.isPending}
        >
          <Ban aria-hidden /> Cancel
        </Button>
      ) : null}
      {canReplay(job.status) ? (
        <Button
          variant="default"
          size="sm"
          onClick={() => setConfirmReplay(true)}
          disabled={replayMutation.isPending}
        >
          <RotateCcw aria-hidden /> Replay
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this job?"
        description="Pending jobs are removed from the queue; running jobs are signalled to stop at the next checkpoint."
        confirmLabel="Cancel job"
        cancelLabel="Keep running"
        variant="danger"
        pending={cancelMutation.isPending}
        onConfirm={async () => {
          await cancelMutation.mutateAsync(job.id);
        }}
      />

      <ConfirmDialog
        open={confirmReplay}
        onOpenChange={setConfirmReplay}
        title="Replay this job?"
        description="A new job will be enqueued with the same arguments. Replay history is preserved."
        confirmLabel="Replay"
        pending={replayMutation.isPending}
        onConfirm={onReplay}
      />
    </>
  );
}
