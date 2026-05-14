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

fn run_storage_tests(s: &impl Storage) {
    test_enqueue_and_get(s);
    test_dequeue(s);
    test_complete(s);
    test_fail(s);
    test_retry(s);
    test_cancel_job(s);
    test_stats(s);
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
