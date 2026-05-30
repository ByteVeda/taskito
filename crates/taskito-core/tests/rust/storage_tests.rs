//! Backend-agnostic storage integration tests.
//!
//! These tests exercise the `Storage` trait contract and can run against any
//! backend. Currently wired for SQLite (always) and Redis (behind the `redis`
//! feature flag + a running redis-server).
//!
//! Each test function uses a unique queue name to avoid cross-contamination
//! when all tests share a single storage instance.

use taskito_core::job::{now_millis, JobStatus, NewJob};
use taskito_core::storage::Storage;
use taskito_core::SqliteStorage;

fn make_job(queue: &str, task_name: &str) -> NewJob {
    NewJob {
        queue: queue.to_string(),
        task_name: task_name.to_string(),
        payload: vec![1, 2, 3],
        priority: 0,
        scheduled_at: now_millis(),
        max_retries: 3,
        timeout_ms: 300_000,
        unique_key: None,
        metadata: None,
        notes: None,
        depends_on: vec![],
        expires_at: None,
        result_ttl_ms: None,
        namespace: None,
    }
}

// ── Generic test functions ───────────────────────────────────────────

fn test_enqueue_and_get(s: &impl Storage) {
    let job = s.enqueue(make_job("q-enqueue", "test_task")).unwrap();
    let fetched = s.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.task_name, "test_task");
    assert_eq!(fetched.status, JobStatus::Pending);
}

fn test_dequeue(s: &impl Storage) {
    let q = "q-dequeue";
    let job = s.enqueue(make_job(q, "dequeue_task")).unwrap();
    let dequeued = s.dequeue(q, now_millis() + 1000, None).unwrap().unwrap();
    assert_eq!(dequeued.id, job.id);
    assert_eq!(dequeued.status, JobStatus::Running);

    let none = s.dequeue(q, now_millis() + 1000, None).unwrap();
    assert!(none.is_none());
}

fn test_dequeue_batch(s: &impl Storage) {
    let q = "q-dequeue-batch";
    let mut ids = Vec::new();
    for _ in 0..5 {
        ids.push(s.enqueue(make_job(q, "batch_task")).unwrap().id);
    }

    // Claim 3 of the 5 in one round-trip.
    let now = now_millis() + 1000;
    let first = s.dequeue_batch(q, now, None, 3).unwrap();
    assert_eq!(first.len(), 3);
    for job in &first {
        assert_eq!(job.status, JobStatus::Running);
    }

    // A second batch of 10 returns only the 2 remaining — and no id overlaps.
    let second = s.dequeue_batch(q, now, None, 10).unwrap();
    assert_eq!(second.len(), 2);

    let mut all: Vec<String> = first
        .iter()
        .chain(second.iter())
        .map(|j| j.id.clone())
        .collect();
    all.sort();
    all.dedup();
    assert_eq!(all.len(), 5, "batches must claim disjoint jobs");

    // Queue is now empty.
    let empty = s.dequeue_batch(q, now, None, 4).unwrap();
    assert!(empty.is_empty());

    // max == 0 claims nothing even when jobs exist.
    s.enqueue(make_job(q, "batch_task")).unwrap();
    let zero = s.dequeue_batch(q, now, None, 0).unwrap();
    assert!(zero.is_empty());
}

fn test_complete(s: &impl Storage) {
    let q = "q-complete";
    let job = s.enqueue(make_job(q, "complete_task")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    s.complete(&job.id, Some(vec![42])).unwrap();

    let fetched = s.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Complete);
    assert_eq!(fetched.result, Some(vec![42]));
}

fn test_fail(s: &impl Storage) {
    let q = "q-fail";
    let job = s.enqueue(make_job(q, "fail_task")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    s.fail(&job.id, "something broke").unwrap();

    let fetched = s.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Failed);
    assert_eq!(fetched.error.as_deref(), Some("something broke"));
}

fn test_retry(s: &impl Storage) {
    let q = "q-retry";
    let job = s.enqueue(make_job(q, "retry_task")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();

    let future = now_millis() + 5000;
    s.retry(&job.id, future).unwrap();

    let fetched = s.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Pending);
    assert_eq!(fetched.retry_count, 1);
    assert_eq!(fetched.scheduled_at, future);
}

fn test_cancel_job(s: &impl Storage) {
    let job = s.enqueue(make_job("q-cancel", "cancel_me")).unwrap();
    assert!(s.cancel_job(&job.id).unwrap());

    let fetched = s.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Cancelled);
    assert!(!s.cancel_job(&job.id).unwrap());
}

fn test_stats(s: &impl Storage) {
    let q = "q-stats";
    s.enqueue(make_job(q, "t1")).unwrap();
    s.enqueue(make_job(q, "t2")).unwrap();

    let stats = s.stats().unwrap();
    assert!(stats.pending >= 2);
}

fn test_stats_by_queue_and_task(s: &impl Storage) {
    let q = "q-stats-breakdown";
    let task = "stats_breakdown_task";
    s.enqueue(make_job(q, task)).unwrap();
    s.enqueue(make_job(q, task)).unwrap();
    s.enqueue(make_job(q, task)).unwrap();

    // 3 pending, none running yet.
    let st = s.stats_by_queue(q).unwrap();
    assert_eq!(st.pending, 3);
    assert_eq!(st.running, 0);
    assert_eq!(s.count_running_by_task(task).unwrap(), 0);

    // Run two of them.
    let d1 = s.dequeue(q, now_millis() + 1000, None).unwrap().unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap().unwrap();
    assert_eq!(s.count_running_by_task(task).unwrap(), 2);
    let st = s.stats_by_queue(q).unwrap();
    assert_eq!(st.running, 2);
    assert_eq!(st.pending, 1);

    // Complete one — running drops, completed rises.
    s.complete(&d1.id, None).unwrap();
    assert_eq!(s.count_running_by_task(task).unwrap(), 1);
    let st = s.stats_by_queue(q).unwrap();
    assert_eq!(st.pending, 1);
    assert_eq!(st.running, 1);
    assert_eq!(st.completed, 1);

    // stats_all_queues reports the same breakdown for this queue.
    let all = s.stats_all_queues().unwrap();
    let qs = all.get(q).expect("queue should appear in stats_all_queues");
    assert_eq!(qs.pending, 1);
    assert_eq!(qs.running, 1);
    assert_eq!(qs.completed, 1);
}

fn test_unique_key_dedup(s: &impl Storage) {
    let mut job1 = make_job("q-unique", "unique_task");
    job1.unique_key = Some("dedup-key".to_string());
    let j1 = s.enqueue_unique(job1).unwrap();

    let mut job2 = make_job("q-unique", "unique_task");
    job2.unique_key = Some("dedup-key".to_string());
    let j2 = s.enqueue_unique(job2).unwrap();

    assert_eq!(j1.id, j2.id);
}

fn test_enqueue_batch(s: &impl Storage) {
    let jobs: Vec<NewJob> = (0..5)
        .map(|i| {
            let mut j = make_job("q-batch", &format!("batch_task_{i}"));
            j.priority = i;
            j
        })
        .collect();

    let result = s.enqueue_batch(jobs).unwrap();
    assert_eq!(result.len(), 5);
}

fn test_dead_letter_queue(s: &impl Storage) {
    let q = "q-dlq";
    let job = s.enqueue(make_job(q, "dlq_task")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();

    let running = s.get_job(&job.id).unwrap().unwrap();
    s.move_to_dlq(&running, "max retries exceeded", None)
        .unwrap();

    let fetched = s.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Dead);

    let dead = s.list_dead(10, 0).unwrap();
    assert!(!dead.is_empty());
}

fn test_progress_tracking(s: &impl Storage) {
    let job = s.enqueue(make_job("q-progress", "progress_task")).unwrap();
    s.update_progress(&job.id, 50).unwrap();

    let fetched = s.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.progress, Some(50));
}

fn test_record_and_get_errors(s: &impl Storage) {
    let job = s.enqueue(make_job("q-errors", "error_task")).unwrap();
    s.record_error(&job.id, 0, "first failure").unwrap();
    s.record_error(&job.id, 1, "second failure").unwrap();

    let errors = s.get_job_errors(&job.id).unwrap();
    assert_eq!(errors.len(), 2);
}

fn test_workers(s: &impl Storage) {
    let resources = Some(r#"["db","redis"]"#);
    let health = Some(r#"{"db":"healthy","redis":"healthy"}"#);

    s.register_worker(
        "w-test-1",
        "q-workers",
        None,
        resources,
        health,
        4,
        Some("test-host"),
        Some(12345),
        Some("thread"),
    )
    .unwrap();
    s.heartbeat("w-test-1", Some(r#"{"db":"unhealthy","redis":"healthy"}"#))
        .unwrap();

    let workers = s.list_workers().unwrap();
    assert!(!workers.is_empty());
    let w = workers.iter().find(|w| w.worker_id == "w-test-1").unwrap();
    assert_eq!(w.threads, 4);
    assert!(w.resources.as_deref().unwrap().contains("db"));
    assert!(w.resource_health.as_deref().unwrap().contains("unhealthy"));
    assert_eq!(w.hostname.as_deref(), Some("test-host"));
    assert_eq!(w.pid, Some(12345));
    assert_eq!(w.pool_type.as_deref(), Some("thread"));
    assert!(w.started_at.is_some());

    // Test update_worker_status
    s.update_worker_status("w-test-1", "draining").unwrap();
    let workers = s.list_workers().unwrap();
    let w = workers.iter().find(|w| w.worker_id == "w-test-1").unwrap();
    assert_eq!(w.status, "draining");

    s.unregister_worker("w-test-1").unwrap();
}

fn test_pause_resume_queue(s: &impl Storage) {
    let q = "q-pause-test";
    s.pause_queue(q).unwrap();
    let paused = s.list_paused_queues().unwrap();
    assert!(paused.contains(&q.to_string()));

    s.resume_queue(q).unwrap();
    let paused = s.list_paused_queues().unwrap();
    assert!(!paused.contains(&q.to_string()));
}

fn test_execution_claims_purge(s: &impl Storage) {
    // Regression: Redis `purge_execution_claims` was a silent no-op. The
    // scheduler's maintenance loop relies on this method to reap stale claims,
    // so all backends must honor the `older_than_ms` cutoff.
    let worker = "w-purge";
    let old_job = "old-claim-job-id";
    let fresh_job = "fresh-claim-job-id";

    assert!(s.claim_execution(old_job, worker).unwrap());
    // Advance past the old claim so the cutoff below can catch it but miss
    // the fresh claim (claimed after the cutoff below is computed).
    std::thread::sleep(std::time::Duration::from_millis(20));
    let cutoff = now_millis();
    std::thread::sleep(std::time::Duration::from_millis(20));
    assert!(s.claim_execution(fresh_job, worker).unwrap());

    let purged = s.purge_execution_claims(cutoff).unwrap();
    assert!(
        purged >= 1,
        "purge must delete at least the one claim older than the cutoff"
    );

    // The old claim is gone — a fresh claim_execution for the same job succeeds.
    assert!(s.claim_execution(old_job, worker).unwrap());
    // The fresh claim must still be held.
    assert!(!s.claim_execution(fresh_job, worker).unwrap());

    s.complete_execution(old_job).unwrap();
    s.complete_execution(fresh_job).unwrap();
}

fn test_dashboard_settings(s: &impl Storage) {
    // get on missing key
    assert!(s.get_setting("settings-nonexistent").unwrap().is_none());

    // set then get
    s.set_setting("settings-key", "settings-value").unwrap();
    assert_eq!(
        s.get_setting("settings-key").unwrap(),
        Some("settings-value".to_string())
    );

    // overwrite
    s.set_setting("settings-key", "settings-new").unwrap();
    assert_eq!(
        s.get_setting("settings-key").unwrap(),
        Some("settings-new".to_string())
    );

    // list contains the key
    let all = s.list_settings().unwrap();
    assert_eq!(all.get("settings-key"), Some(&"settings-new".to_string()));

    // delete returns true once, false the second time
    assert!(s.delete_setting("settings-key").unwrap());
    assert!(!s.delete_setting("settings-key").unwrap());
    assert!(s.get_setting("settings-key").unwrap().is_none());
}

fn test_circuit_breakers(s: &impl Storage) {
    let task = "cb-test-task";
    let cb = s.get_circuit_breaker(task).unwrap();
    assert!(cb.is_none());

    let row = taskito_core::storage::models::CircuitBreakerRow {
        task_name: task.to_string(),
        state: 0, // closed
        failure_count: 0,
        last_failure_at: None,
        opened_at: None,
        half_open_at: None,
        threshold: 5,
        window_ms: 60_000,
        cooldown_ms: 30_000,
        half_open_max_probes: 5,
        half_open_success_rate: 0.8,
        half_open_probe_count: 0,
        half_open_success_count: 0,
        half_open_failure_count: 0,
    };
    s.upsert_circuit_breaker(&row).unwrap();

    let cb = s.get_circuit_breaker(task).unwrap();
    assert!(cb.is_some());
}

// ── Run all generic tests against a storage impl ─────────────────────

fn test_immediate_archival(s: &impl Storage) {
    let q = "q-archival";

    // Complete, fail, and cancel are all terminal: they archive immediately but
    // remain readable via get_job and surface in the per-queue terminal stats.
    let done = s.enqueue(make_job(q, "arch_done")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    s.complete(&done.id, Some(vec![9])).unwrap();

    let failed = s.enqueue(make_job(q, "arch_fail")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    s.fail(&failed.id, "boom").unwrap();

    let cancelled = s.enqueue(make_job(q, "arch_cancel")).unwrap();
    assert!(s.cancel_job(&cancelled.id).unwrap());

    // One running and one pending left live. Enqueue the to-be-running job
    // first so the FIFO dequeue claims it, leaving the later one pending.
    s.enqueue(make_job(q, "arch_running")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    let pending_job = s.enqueue(make_job(q, "arch_pending")).unwrap();

    // get_job resolves archived terminals.
    assert_eq!(
        s.get_job(&done.id).unwrap().unwrap().status,
        JobStatus::Complete
    );
    assert_eq!(
        s.get_job(&failed.id).unwrap().unwrap().status,
        JobStatus::Failed
    );
    assert_eq!(
        s.get_job(&cancelled.id).unwrap().unwrap().status,
        JobStatus::Cancelled
    );

    // Per-queue stats: terminals from the archive, pending/running live.
    let stats = s.stats_by_queue(q).unwrap();
    assert_eq!(stats.completed, 1, "completed");
    assert_eq!(stats.failed, 1, "failed");
    assert_eq!(stats.cancelled, 1, "cancelled");
    assert_eq!(stats.pending, 1, "pending");
    assert_eq!(stats.running, 1, "running");

    // Listing by a terminal status reads the archive; pending must not surface
    // the archived row.
    let complete = s
        .list_jobs(Some(JobStatus::Complete as i32), Some(q), None, 50, 0, None)
        .unwrap();
    assert!(complete.iter().any(|j| j.id == done.id));

    let pending = s
        .list_jobs(Some(JobStatus::Pending as i32), Some(q), None, 50, 0, None)
        .unwrap();
    assert!(!pending.iter().any(|j| j.id == done.id));
    assert!(pending.iter().any(|j| j.id == pending_job.id));
}

fn test_enqueue_dep_on_completed_archived_job(s: &impl Storage) {
    let q = "q-dep-archived-complete";

    // Run A to completion — it now lives in `archived_jobs`, not `jobs`.
    let a = s.enqueue(make_job(q, "dep_parent_done")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    s.complete(&a.id, None).unwrap();

    // Enqueuing B with a completed (archived) dependency must succeed: the
    // existence check has to fall back to the archive.
    let mut b_job = make_job(q, "dep_child");
    b_job.depends_on = vec![a.id.clone()];
    let b = s.enqueue(b_job).unwrap();

    // And B must be dequeuable: a completed archived parent counts as satisfied.
    let dequeued = s.dequeue(q, now_millis() + 1000, None).unwrap();
    assert_eq!(
        dequeued.map(|j| j.id),
        Some(b.id),
        "B should dequeue once its archived-complete dependency is satisfied"
    );
}

fn test_dependent_blocked_by_cancelled_parent(s: &impl Storage) {
    let q = "q-dep-cancelled-parent";

    let a = s.enqueue(make_job(q, "dep_parent_cancel")).unwrap();
    let mut b_job = make_job(q, "dep_child_blocked");
    b_job.depends_on = vec![a.id.clone()];
    let b = s.enqueue(b_job).unwrap();

    // Cancelling A archives it as Cancelled. B's dependency is now unsatisfiable.
    assert!(s.cancel_job(&a.id).unwrap());

    // A dequeue attempt must not return B (its archived parent is non-Complete).
    // Cascade-cancel may also have archived B; either way it must not dequeue.
    let dequeued = s.dequeue(q, now_millis() + 1000, None).unwrap();
    assert!(
        dequeued.as_ref().map(|j| &j.id) != Some(&b.id),
        "B must not dequeue while its parent is archived-cancelled"
    );
}

fn run_storage_tests(s: &impl Storage) {
    test_enqueue_and_get(s);
    test_dequeue(s);
    test_dequeue_batch(s);
    test_complete(s);
    test_fail(s);
    test_retry(s);
    test_cancel_job(s);
    test_stats(s);
    test_stats_by_queue_and_task(s);
    test_unique_key_dedup(s);
    test_enqueue_batch(s);
    test_dead_letter_queue(s);
    test_progress_tracking(s);
    test_record_and_get_errors(s);
    test_workers(s);
    test_pause_resume_queue(s);
    test_circuit_breakers(s);
    test_execution_claims_purge(s);
    test_dashboard_settings(s);
    test_immediate_archival(s);
    test_enqueue_dep_on_completed_archived_job(s);
    test_dependent_blocked_by_cancelled_parent(s);
}

// ── Backend-specific wiring ──────────────────────────────────────────

#[test]
fn sqlite_storage_tests() {
    let storage = SqliteStorage::in_memory().unwrap();
    run_storage_tests(&storage);
}

#[cfg(feature = "redis")]
#[test]
fn redis_storage_tests() {
    use taskito_core::RedisStorage;

    // Use DB 15 to avoid interfering with other data.
    let url = std::env::var("TASKITO_REDIS_TEST_URL")
        .unwrap_or_else(|_| "redis://localhost:6379/15".to_string());

    let storage = match RedisStorage::new(&url) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Skipping Redis tests (cannot connect): {e}");
            return;
        }
    };

    run_storage_tests(&storage);
    redis_mutators_reject_archived_jobs(&storage);
    redis_purge_preserves_reused_unique_key(&storage);
}

/// A terminal job has left the live indices, so a mutator that resolves the
/// live row (`get_job_required`) must return `JobNotFound` rather than partially
/// reindexing an archived row.
#[cfg(feature = "redis")]
fn redis_mutators_reject_archived_jobs(s: &taskito_core::RedisStorage) {
    let q = "q-redis-mutate-archived";

    // Cancel a pending job → archived as Cancelled.
    let cancelled = s.enqueue(make_job(q, "redis_archived_cancel")).unwrap();
    assert!(s.cancel_job(&cancelled.id).unwrap());
    assert!(matches!(
        s.retry(&cancelled.id, now_millis()),
        Err(taskito_core::error::QueueError::JobNotFound(_))
    ));
    assert!(matches!(
        s.mark_cancelled(&cancelled.id),
        Err(taskito_core::error::QueueError::JobNotFound(_))
    ));

    // Complete a job → archived as Complete; the same guard applies.
    let done = s.enqueue(make_job(q, "redis_archived_done")).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    s.complete(&done.id, None).unwrap();
    assert!(matches!(
        s.retry(&done.id, now_millis()),
        Err(taskito_core::error::QueueError::JobNotFound(_))
    ));
}

/// Purging an archived job must not delete a `jobs:unique` pointer now owned by
/// a different live job that reused the same `unique_key`.
#[cfg(feature = "redis")]
fn redis_purge_preserves_reused_unique_key(s: &taskito_core::RedisStorage) {
    let q = "q-redis-unique-reuse";
    let shared_key = "redis-reused-unique";

    // Run A to completion under the shared unique key.
    let mut a_job = make_job(q, "unique_reuse_a");
    a_job.unique_key = Some(shared_key.to_string());
    let a = s.enqueue_unique(a_job).unwrap();
    s.dequeue(q, now_millis() + 1000, None).unwrap();
    s.complete(&a.id, None).unwrap();

    // A new live job B reuses the freed unique key and owns the lock.
    let mut b_job = make_job(q, "unique_reuse_b");
    b_job.unique_key = Some(shared_key.to_string());
    let b = s.enqueue_unique(b_job).unwrap();
    assert_ne!(
        a.id, b.id,
        "B should be a distinct live job, not deduped to A"
    );

    // Purge A's archived row — must leave B's unique lock intact.
    s.purge_completed(now_millis() + 1000).unwrap();

    // Re-enqueuing under the same key must still dedup to B, proving the lock
    // survived the purge.
    let mut c_job = make_job(q, "unique_reuse_c");
    c_job.unique_key = Some(shared_key.to_string());
    let c = s.enqueue_unique(c_job).unwrap();
    assert_eq!(
        c.id, b.id,
        "unique lock for B must survive purging archived A"
    );
}

#[cfg(feature = "postgres")]
#[test]
fn postgres_storage_tests() {
    use taskito_core::PostgresStorage;

    let url = match std::env::var("TASKITO_POSTGRES_TEST_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("Skipping Postgres tests (TASKITO_POSTGRES_TEST_URL not set)");
            return;
        }
    };

    let storage = match PostgresStorage::new(&url) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Skipping Postgres tests (cannot connect): {e}");
            return;
        }
    };

    run_storage_tests(&storage);
}
