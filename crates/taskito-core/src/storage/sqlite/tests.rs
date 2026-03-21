use super::*;
use crate::job::{now_millis, JobStatus, NewJob};

fn test_storage() -> SqliteStorage {
    SqliteStorage::in_memory().unwrap()
}

fn make_job(task_name: &str) -> NewJob {
    NewJob {
        queue: "default".to_string(),
        task_name: task_name.to_string(),
        payload: vec![1, 2, 3],
        priority: 0,
        scheduled_at: now_millis(),
        max_retries: 3,
        timeout_ms: 300_000,
        unique_key: None,
        metadata: None,
        depends_on: vec![],
        expires_at: None,
        result_ttl_ms: None,
        namespace: None,
    }
}

#[test]
fn test_enqueue_and_get() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("test_task")).unwrap();

    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.task_name, "test_task");
    assert_eq!(fetched.status, JobStatus::Pending);
}

#[test]
fn test_dequeue() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("dequeue_task")).unwrap();

    let dequeued = storage
        .dequeue("default", now_millis() + 1000, None)
        .unwrap()
        .unwrap();
    assert_eq!(dequeued.id, job.id);
    assert_eq!(dequeued.status, JobStatus::Running);

    // Should not dequeue again
    let none = storage
        .dequeue("default", now_millis() + 1000, None)
        .unwrap();
    assert!(none.is_none());
}

#[test]
fn test_dequeue_respects_schedule() {
    let storage = test_storage();
    let future = now_millis() + 60_000;
    let mut new_job = make_job("future_task");
    new_job.scheduled_at = future;
    storage.enqueue(new_job).unwrap();

    let none = storage.dequeue("default", now_millis(), None).unwrap();
    assert!(none.is_none());

    let some = storage.dequeue("default", future + 1, None).unwrap();
    assert!(some.is_some());
}

#[test]
fn test_priority_ordering() {
    let storage = test_storage();

    let mut low = make_job("low_priority");
    low.priority = 1;
    storage.enqueue(low).unwrap();

    let mut high = make_job("high_priority");
    high.priority = 10;
    storage.enqueue(high).unwrap();

    let now = now_millis() + 1000;
    let first = storage.dequeue("default", now, None).unwrap().unwrap();
    assert_eq!(first.task_name, "high_priority");

    let second = storage.dequeue("default", now, None).unwrap().unwrap();
    assert_eq!(second.task_name, "low_priority");
}

#[test]
fn test_complete() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("complete_task")).unwrap();
    storage
        .dequeue("default", now_millis() + 1000, None)
        .unwrap();

    storage.complete(&job.id, Some(vec![42])).unwrap();

    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Complete);
    assert_eq!(fetched.result, Some(vec![42]));
}

#[test]
fn test_fail_and_retry() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("fail_task")).unwrap();
    storage
        .dequeue("default", now_millis() + 1000, None)
        .unwrap();

    storage.fail(&job.id, "something broke").unwrap();
    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Failed);
    assert_eq!(fetched.error.as_deref(), Some("something broke"));
}

#[test]
fn test_retry_reschedule() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("retry_task")).unwrap();
    storage
        .dequeue("default", now_millis() + 1000, None)
        .unwrap();

    let future = now_millis() + 5000;
    storage.retry(&job.id, future).unwrap();

    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Pending);
    assert_eq!(fetched.retry_count, 1);
    assert_eq!(fetched.scheduled_at, future);
}

#[test]
fn test_dead_letter_queue() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("dlq_task")).unwrap();
    storage
        .dequeue("default", now_millis() + 1000, None)
        .unwrap();

    storage
        .move_to_dlq(
            &storage.get_job(&job.id).unwrap().unwrap(),
            "max retries exceeded",
            None,
        )
        .unwrap();

    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Dead);

    let dead = storage.list_dead(10, 0).unwrap();
    assert_eq!(dead.len(), 1);
    assert_eq!(dead[0].original_job_id, job.id);
}

#[test]
fn test_retry_dead() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("retry_dead_task")).unwrap();
    storage
        .dequeue("default", now_millis() + 1000, None)
        .unwrap();

    let running_job = storage.get_job(&job.id).unwrap().unwrap();
    storage
        .move_to_dlq(&running_job, "fatal error", None)
        .unwrap();

    let dead = storage.list_dead(10, 0).unwrap();
    let new_id = storage.retry_dead(&dead[0].id).unwrap();

    let new_job = storage.get_job(&new_id).unwrap().unwrap();
    assert_eq!(new_job.status, JobStatus::Pending);
    assert_eq!(new_job.task_name, "retry_dead_task");

    let dead = storage.list_dead(10, 0).unwrap();
    assert!(dead.is_empty());
}

#[test]
fn test_stats() {
    let storage = test_storage();
    storage.enqueue(make_job("t1")).unwrap();
    storage.enqueue(make_job("t2")).unwrap();

    let stats = storage.stats().unwrap();
    assert_eq!(stats.pending, 2);
    assert_eq!(stats.running, 0);
}

#[test]
fn test_cancel_job() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("cancel_me")).unwrap();

    assert!(storage.cancel_job(&job.id).unwrap());

    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.status, JobStatus::Cancelled);

    // Cancelling again should return false
    assert!(!storage.cancel_job(&job.id).unwrap());
}

#[test]
fn test_unique_key_dedup() {
    let storage = test_storage();

    let mut job1 = make_job("unique_task");
    job1.unique_key = Some("my-key".to_string());
    let j1 = storage.enqueue_unique(job1).unwrap();

    let mut job2 = make_job("unique_task");
    job2.unique_key = Some("my-key".to_string());
    let j2 = storage.enqueue_unique(job2).unwrap();

    // Should return the same job
    assert_eq!(j1.id, j2.id);
}

#[test]
fn test_enqueue_batch() {
    let storage = test_storage();
    let jobs: Vec<NewJob> = (0..5)
        .map(|i| {
            let mut j = make_job(&format!("batch_task_{i}"));
            j.priority = i;
            j
        })
        .collect();

    let result = storage.enqueue_batch(jobs).unwrap();
    assert_eq!(result.len(), 5);

    let stats = storage.stats().unwrap();
    assert_eq!(stats.pending, 5);
}

#[test]
fn test_record_and_get_job_errors() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("error_task")).unwrap();

    storage.record_error(&job.id, 0, "first failure").unwrap();
    storage.record_error(&job.id, 1, "second failure").unwrap();

    let errors = storage.get_job_errors(&job.id).unwrap();
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].attempt, 0);
    assert_eq!(errors[0].error, "first failure");
    assert_eq!(errors[1].attempt, 1);
    assert_eq!(errors[1].error, "second failure");
}

#[test]
fn test_job_errors_empty_for_success() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("ok_task")).unwrap();

    let errors = storage.get_job_errors(&job.id).unwrap();
    assert!(errors.is_empty());
}

#[test]
fn test_purge_job_errors() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("purge_err_task")).unwrap();

    storage.record_error(&job.id, 0, "old error").unwrap();
    let purged = storage.purge_job_errors(now_millis() + 10_000).unwrap();
    assert_eq!(purged, 1);

    let errors = storage.get_job_errors(&job.id).unwrap();
    assert!(errors.is_empty());
}

#[test]
fn test_progress_tracking() {
    let storage = test_storage();
    let job = storage.enqueue(make_job("progress_task")).unwrap();

    storage.update_progress(&job.id, 50).unwrap();
    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.progress, Some(50));

    storage.update_progress(&job.id, 100).unwrap();
    let fetched = storage.get_job(&job.id).unwrap().unwrap();
    assert_eq!(fetched.progress, Some(100));
}

// ── Dependency tests ────────────────────────────────────

#[test]
fn test_enqueue_with_dependency() {
    let storage = test_storage();
    let job_a = storage.enqueue(make_job("task_a")).unwrap();

    let mut dep_job = make_job("task_b");
    dep_job.depends_on = vec![job_a.id.clone()];
    let job_b = storage.enqueue(dep_job).unwrap();

    let deps = storage.get_dependencies(&job_b.id).unwrap();
    assert_eq!(deps, vec![job_a.id.clone()]);

    let dependents = storage.get_dependents(&job_a.id).unwrap();
    assert_eq!(dependents, vec![job_b.id]);
}

#[test]
fn test_dequeue_blocks_on_unmet_dependency() {
    let storage = test_storage();
    let job_a = storage.enqueue(make_job("dep_task")).unwrap();

    let mut dep_job = make_job("dependent_task");
    dep_job.depends_on = vec![job_a.id.clone()];
    storage.enqueue(dep_job).unwrap();

    let now = now_millis() + 1000;

    let dequeued = storage.dequeue("default", now, None).unwrap().unwrap();
    assert_eq!(dequeued.id, job_a.id);

    let none = storage.dequeue("default", now, None).unwrap();
    assert!(none.is_none());

    storage.complete(&job_a.id, None).unwrap();

    let dequeued = storage.dequeue("default", now, None).unwrap().unwrap();
    assert_eq!(dequeued.task_name, "dependent_task");
}

#[test]
fn test_cascade_cancel_on_job_cancel() {
    let storage = test_storage();
    let job_a = storage.enqueue(make_job("root")).unwrap();

    let mut dep_b = make_job("child");
    dep_b.depends_on = vec![job_a.id.clone()];
    let job_b = storage.enqueue(dep_b).unwrap();

    let mut dep_c = make_job("grandchild");
    dep_c.depends_on = vec![job_b.id.clone()];
    let job_c = storage.enqueue(dep_c).unwrap();

    storage.cancel_job(&job_a.id).unwrap();

    let b = storage.get_job(&job_b.id).unwrap().unwrap();
    assert_eq!(b.status, JobStatus::Cancelled);

    let c = storage.get_job(&job_c.id).unwrap().unwrap();
    assert_eq!(c.status, JobStatus::Cancelled);
}

#[test]
fn test_cascade_cancel_on_dlq() {
    let storage = test_storage();
    let job_a = storage.enqueue(make_job("parent")).unwrap();

    let mut dep_b = make_job("child_of_dead");
    dep_b.depends_on = vec![job_a.id.clone()];
    let job_b = storage.enqueue(dep_b).unwrap();

    let now = now_millis() + 1000;
    storage.dequeue("default", now, None).unwrap();
    let running = storage.get_job(&job_a.id).unwrap().unwrap();
    storage.move_to_dlq(&running, "fatal error", None).unwrap();

    let b = storage.get_job(&job_b.id).unwrap().unwrap();
    assert_eq!(b.status, JobStatus::Cancelled);
    assert!(b.error.unwrap().contains("dependency failed"));
}

#[test]
fn test_count_running_by_task() {
    let storage = test_storage();
    storage.enqueue(make_job("task_a")).unwrap();
    storage.enqueue(make_job("task_a")).unwrap();
    storage.enqueue(make_job("task_b")).unwrap();

    // No running jobs yet
    assert_eq!(storage.count_running_by_task("task_a").unwrap(), 0);

    let now = now_millis() + 1000;
    // Dequeue one task_a (becomes running)
    storage.dequeue("default", now, None).unwrap().unwrap();

    assert_eq!(storage.count_running_by_task("task_a").unwrap(), 1);
    assert_eq!(storage.count_running_by_task("task_b").unwrap(), 0);

    // Dequeue second task_a
    storage.dequeue("default", now, None).unwrap().unwrap();
    assert_eq!(storage.count_running_by_task("task_a").unwrap(), 2);

    // Nonexistent task should return 0
    assert_eq!(storage.count_running_by_task("no_such_task").unwrap(), 0);
}

#[test]
fn test_enqueue_rejects_missing_dependency() {
    let storage = test_storage();

    let mut dep_job = make_job("orphan");
    dep_job.depends_on = vec!["nonexistent-id".to_string()];
    let result = storage.enqueue(dep_job);
    assert!(result.is_err());
}
