//! Direct-storage `DataSource` — reads and mutates through the public
//! `taskito-core` `Storage` trait (and `taskito-workflows` `WorkflowStorage`)
//! on a connected [`Backend`]. No server, no PyO3.

use anyhow::{anyhow, Result};

use taskito_core::job::now_millis;
use taskito_core::{Job, JobStatus, NewJob, Storage};
use taskito_workflows::WorkflowStorage;

use super::{
    DataSource, DeadRow, JobDetail, JobErrorEntry, JobRow, LogEntry, StatsSnapshot, WorkerView,
    WorkflowNodeRow, WorkflowRunRow,
};
use crate::backend::Backend;

pub struct DbSource {
    be: Backend,
}

impl DbSource {
    pub fn new(be: Backend) -> Self {
        Self { be }
    }
}

impl DataSource for DbSource {
    fn stats(&self) -> Result<StatsSnapshot> {
        let overall = self.be.storage.stats()?;
        let mut per_queue: Vec<_> = self.be.storage.stats_all_queues()?.into_iter().collect();
        per_queue.sort_by(|a, b| a.0.cmp(&b.0));
        let paused = self.be.storage.list_paused_queues()?;
        Ok(StatsSnapshot {
            overall,
            per_queue,
            paused,
        })
    }

    fn jobs(&self, status: Option<JobStatus>, limit: i64) -> Result<Vec<JobRow>> {
        let status = status.map(|s| s as i32);
        let jobs = self
            .be
            .storage
            .list_jobs(status, None, None, limit, 0, None)?;
        Ok(jobs.into_iter().map(job_to_row).collect())
    }

    fn job_detail(&self, id: &str) -> Result<Option<JobDetail>> {
        let Some(job) = self.be.storage.get_job(id)? else {
            return Ok(None);
        };
        let errors = self
            .be
            .storage
            .get_job_errors(id)?
            .into_iter()
            .map(|e| JobErrorEntry {
                attempt: e.attempt,
                error: e.error,
                failed_at: e.failed_at,
            })
            .collect();
        let logs = self
            .be
            .storage
            .get_task_logs(id)?
            .into_iter()
            .map(|l| LogEntry {
                level: l.level,
                message: l.message,
                logged_at: l.logged_at,
            })
            .collect();
        Ok(Some(JobDetail {
            metadata: job.metadata.clone(),
            notes: job.notes.clone(),
            namespace: job.namespace.clone(),
            row: job_to_row(job),
            errors,
            logs,
        }))
    }

    fn dead_letters(&self, limit: i64) -> Result<Vec<DeadRow>> {
        let dead = self.be.storage.list_dead(limit, 0)?;
        Ok(dead
            .into_iter()
            .map(|d| DeadRow {
                id: d.id,
                original_job_id: d.original_job_id,
                task_name: d.task_name,
                queue: d.queue,
                error: d.error,
                retry_count: d.retry_count,
                dlq_retry_count: d.dlq_retry_count,
                failed_at: d.failed_at,
            })
            .collect())
    }

    fn workers(&self) -> Result<Vec<WorkerView>> {
        let workers = self.be.storage.list_workers()?;
        Ok(workers
            .into_iter()
            .map(|w| WorkerView {
                worker_id: w.worker_id,
                status: w.status,
                queues: w.queues,
                threads: w.threads,
                last_heartbeat: w.last_heartbeat,
                hostname: w.hostname,
                pid: w.pid,
            })
            .collect())
    }

    fn workflow_runs(&self, limit: i64) -> Result<Vec<WorkflowRunRow>> {
        let runs = self.be.workflows.list_workflow_runs(None, None, limit, 0)?;
        Ok(runs
            .into_iter()
            .map(|r| WorkflowRunRow {
                id: r.id,
                definition_id: r.definition_id,
                state: r.state,
                created_at: r.created_at,
                started_at: r.started_at,
                completed_at: r.completed_at,
                error: r.error,
                parent_run_id: r.parent_run_id,
            })
            .collect())
    }

    fn workflow_nodes(&self, run_id: &str) -> Result<Vec<WorkflowNodeRow>> {
        let nodes = self.be.workflows.get_workflow_nodes(run_id)?;
        Ok(nodes
            .into_iter()
            .map(|n| WorkflowNodeRow {
                node_name: n.node_name,
                status: n.status,
                job_id: n.job_id,
                error: n.error,
                started_at: n.started_at,
                completed_at: n.completed_at,
            })
            .collect())
    }

    fn cancel(&self, id: &str, running: bool) -> Result<bool> {
        if running {
            Ok(self.be.storage.request_cancel(id)?)
        } else {
            Ok(self.be.storage.cancel_job(id)?)
        }
    }

    fn replay(&self, id: &str) -> Result<String> {
        // No single `replay` on the trait — mirror the PyO3 composition:
        // read the original, enqueue a fresh independent job, record the audit.
        let job = self
            .be
            .storage
            .get_job(id)?
            .ok_or_else(|| anyhow!("job {id} not found"))?;
        let original_error = job.error.clone();
        // id is a UUID, so it needs no JSON escaping.
        let metadata = format!("{{\"replayed_from\":\"{id}\"}}");
        let new_job = NewJob {
            queue: job.queue,
            task_name: job.task_name,
            payload: job.payload,
            priority: job.priority,
            scheduled_at: now_millis(),
            max_retries: job.max_retries,
            timeout_ms: job.timeout_ms,
            unique_key: None,
            metadata: Some(metadata),
            notes: None,
            depends_on: Vec::new(),
            expires_at: None,
            result_ttl_ms: job.result_ttl_ms,
            namespace: job.namespace,
        };
        let created = self.be.storage.enqueue(new_job)?;
        self.be.storage.record_replay(
            id,
            &created.id,
            None,
            None,
            original_error.as_deref(),
            None,
        )?;
        Ok(created.id)
    }

    fn retry_dead(&self, dead_id: &str) -> Result<String> {
        Ok(self.be.storage.retry_dead(dead_id)?)
    }

    fn delete_dead(&self, dead_id: &str) -> Result<bool> {
        Ok(self.be.storage.delete_dead(dead_id)?)
    }

    fn purge_dead(&self) -> Result<u64> {
        // Cutoff = now → every entry with failed_at < now, i.e. all of them.
        Ok(self.be.storage.purge_dead(now_millis())?)
    }

    fn pause_queue(&self, queue: &str) -> Result<()> {
        Ok(self.be.storage.pause_queue(queue)?)
    }

    fn resume_queue(&self, queue: &str) -> Result<()> {
        Ok(self.be.storage.resume_queue(queue)?)
    }
}

fn job_to_row(job: Job) -> JobRow {
    JobRow {
        id: job.id,
        task_name: job.task_name,
        queue: job.queue,
        status: job.status,
        priority: job.priority,
        retry_count: job.retry_count,
        max_retries: job.max_retries,
        created_at: job.created_at,
        scheduled_at: job.scheduled_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        error: job.error,
        cancel_requested: job.cancel_requested,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed() -> DbSource {
        let be = crate::backend::open(":memory:").expect("open in-memory");
        DbSource::new(be)
    }

    fn enqueue(src: &DbSource, task: &str, queue: &str) -> Job {
        src.be
            .storage
            .enqueue(NewJob {
                queue: queue.to_string(),
                task_name: task.to_string(),
                payload: Vec::new(),
                priority: 0,
                scheduled_at: now_millis(),
                max_retries: 3,
                timeout_ms: 30_000,
                unique_key: None,
                metadata: None,
                notes: None,
                depends_on: Vec::new(),
                expires_at: None,
                result_ttl_ms: None,
                namespace: None,
            })
            .expect("enqueue")
    }

    #[test]
    fn jobs_and_stats_reflect_enqueue() {
        let src = seed();
        enqueue(&src, "send_email", "default");
        enqueue(&src, "resize_image", "media");

        let jobs = src.jobs(None, 50).unwrap();
        assert_eq!(jobs.len(), 2);

        let pending = src.jobs(Some(JobStatus::Pending), 50).unwrap();
        assert_eq!(pending.len(), 2);
        let running = src.jobs(Some(JobStatus::Running), 50).unwrap();
        assert!(running.is_empty());

        let stats = src.stats().unwrap();
        assert_eq!(stats.overall.pending, 2);
        assert_eq!(stats.per_queue.len(), 2);
    }

    #[test]
    fn cancel_pending_moves_out_of_pending() {
        let src = seed();
        let job = enqueue(&src, "send_email", "default");

        assert!(src.cancel(&job.id, false).unwrap());
        let pending = src.jobs(Some(JobStatus::Pending), 50).unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn replay_creates_new_pending_job() {
        let src = seed();
        let job = enqueue(&src, "send_email", "default");
        src.cancel(&job.id, false).unwrap();

        let new_id = src.replay(&job.id).unwrap();
        assert_ne!(new_id, job.id);

        let detail = src.job_detail(&new_id).unwrap().expect("new job exists");
        assert_eq!(detail.row.status, JobStatus::Pending);
        assert_eq!(
            detail.metadata.as_deref(),
            Some(format!("{{\"replayed_from\":\"{}\"}}", job.id).as_str())
        );
    }

    #[test]
    fn file_backed_open_persists_across_reopen() {
        let path = std::env::temp_dir().join(format!("taskito_tui_e2e_{}.db", std::process::id()));
        let url = format!("sqlite://{}", path.display());
        let _ = std::fs::remove_file(&path);

        // First handle writes (stands in for an SDK worker process).
        {
            let src = DbSource::new(crate::backend::open(&url).unwrap());
            enqueue(&src, "persisted_task", "default");
        }
        // A fresh handle on the same file reads it back — the cross-SDK path.
        let src = DbSource::new(crate::backend::open(&url).unwrap());
        let jobs = src.jobs(None, 50).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].task_name, "persisted_task");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn pause_resume_roundtrip() {
        let src = seed();
        src.pause_queue("default").unwrap();
        assert_eq!(src.stats().unwrap().paused, vec!["default".to_string()]);
        src.resume_queue("default").unwrap();
        assert!(src.stats().unwrap().paused.is_empty());
    }
}
