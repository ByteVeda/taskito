use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::models::JobErrorRow;
use crate::storage::QueueStats;

/// Compute dequeue score: higher priority → lower score → dequeued first.
/// Within same priority, earlier scheduled_at wins.
fn dequeue_score(priority: i32, scheduled_at: i64) -> f64 {
    (1000i64 - priority as i64) as f64 * 10_000_000_000_000.0 + scheduled_at as f64
}

impl RedisStorage {
    pub fn enqueue(&self, new_job: NewJob) -> Result<Job> {
        let depends_on = new_job.depends_on.clone();
        let job = new_job.into_job();
        let mut conn = self.conn()?;

        // Validate dependencies exist and aren't dead/cancelled
        for dep_id in &depends_on {
            let job_key = self.key(&["job", dep_id]);
            let data: Option<String> = conn.get(&job_key).map_err(map_err)?;
            match data {
                None => {
                    return Err(QueueError::DependencyNotFound(
                        "dependency not found or already dead/cancelled".to_string(),
                    ));
                }
                Some(d) => {
                    let dep_job: Job =
                        serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                    if dep_job.status == JobStatus::Dead || dep_job.status == JobStatus::Cancelled {
                        return Err(QueueError::DependencyNotFound(
                            "dependency not found or already dead/cancelled".to_string(),
                        ));
                    }
                }
            }
        }

        let job_json = serde_json::to_string(&job).map_err(|e| QueueError::Other(e.to_string()))?;
        let job_key = self.key(&["job", &job.id]);
        let status_key = self.key(&["jobs", "status", &(job.status as i32).to_string()]);
        let queue_key = self.key(&["queue", &job.queue, "pending"]);
        let by_queue_key = self.key(&["jobs", "by_queue", &job.queue]);
        let by_task_key = self.key(&["jobs", "by_task", &job.task_name]);
        let all_key = self.key(&["jobs", "all"]);
        let score = dequeue_score(job.priority, job.scheduled_at);

        let pipe = &mut redis::pipe();
        pipe.set(&job_key, &job_json);
        pipe.sadd(&status_key, &job.id);
        pipe.zadd(&queue_key, &job.id, score);
        pipe.sadd(&by_queue_key, &job.id);
        pipe.sadd(&by_task_key, &job.id);
        pipe.zadd(&all_key, &job.id, -(job.created_at as f64));

        // Store dependencies
        for dep_id in &depends_on {
            let depends_on_key = self.key(&["job", &job.id, "depends_on"]);
            let dependents_key = self.key(&["job", dep_id, "dependents"]);
            pipe.sadd(&depends_on_key, dep_id);
            pipe.sadd(&dependents_key, &job.id);
        }

        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(job)
    }

    pub fn enqueue_batch(&self, new_jobs: Vec<NewJob>) -> Result<Vec<Job>> {
        // Collect dependency lists before consuming new_jobs
        let dep_lists: Vec<Vec<String>> = new_jobs.iter().map(|nj| nj.depends_on.clone()).collect();
        let jobs: Vec<Job> = new_jobs.into_iter().map(|nj| nj.into_job()).collect();
        let mut conn = self.conn()?;

        // Collect batch job IDs for intra-batch dependency resolution
        let batch_ids: std::collections::HashSet<&str> =
            jobs.iter().map(|j| j.id.as_str()).collect();

        // Validate dependencies exist and aren't dead/cancelled
        for depends_on in &dep_lists {
            for dep_id in depends_on {
                if batch_ids.contains(dep_id.as_str()) {
                    continue; // intra-batch dependency
                }
                let dep_key = self.key(&["job", dep_id]);
                let data: Option<String> = conn.get(&dep_key).map_err(map_err)?;
                match data {
                    None => {
                        return Err(QueueError::DependencyNotFound(
                            "dependency not found or already dead/cancelled".to_string(),
                        ));
                    }
                    Some(d) => {
                        let dep_job: Job = serde_json::from_str(&d)
                            .map_err(|e| QueueError::Other(e.to_string()))?;
                        if dep_job.status == JobStatus::Dead
                            || dep_job.status == JobStatus::Cancelled
                        {
                            return Err(QueueError::DependencyNotFound(
                                "dependency not found or already dead/cancelled".to_string(),
                            ));
                        }
                    }
                }
            }
        }

        let pipe = &mut redis::pipe();
        for (i, job) in jobs.iter().enumerate() {
            let job_json =
                serde_json::to_string(job).map_err(|e| QueueError::Other(e.to_string()))?;
            let job_key = self.key(&["job", &job.id]);
            let status_key = self.key(&["jobs", "status", &(job.status as i32).to_string()]);
            let queue_key = self.key(&["queue", &job.queue, "pending"]);
            let by_queue_key = self.key(&["jobs", "by_queue", &job.queue]);
            let by_task_key = self.key(&["jobs", "by_task", &job.task_name]);
            let all_key = self.key(&["jobs", "all"]);
            let score = dequeue_score(job.priority, job.scheduled_at);

            pipe.set(&job_key, &job_json);
            pipe.sadd(&status_key, &job.id);
            pipe.zadd(&queue_key, &job.id, score);
            pipe.sadd(&by_queue_key, &job.id);
            pipe.sadd(&by_task_key, &job.id);
            pipe.zadd(&all_key, &job.id, -(job.created_at as f64));

            // Store dependencies
            for dep_id in &dep_lists[i] {
                let depends_on_key = self.key(&["job", &job.id, "depends_on"]);
                let dependents_key = self.key(&["job", dep_id, "dependents"]);
                pipe.sadd(&depends_on_key, dep_id);
                pipe.sadd(&dependents_key, &job.id);
            }
        }

        pipe.query::<()>(&mut conn).map_err(map_err)?;
        Ok(jobs)
    }

    pub fn enqueue_unique(&self, new_job: NewJob) -> Result<Job> {
        let mut conn = self.conn()?;

        if let Some(uk) = new_job.unique_key.clone() {
            let unique_key = self.key(&["jobs", "unique", &uk]);

            // Atomically: check unique key → validate referenced job → decide
            let script = redis::Script::new(
                r#"
                local unique_key = KEYS[1]
                local existing_id = redis.call('GET', unique_key)

                if existing_id then
                    -- Check if referenced job still exists and is active
                    local job_key = ARGV[1] .. existing_id
                    local job_data = redis.call('GET', job_key)
                    if job_data then
                        local job = cjson.decode(job_data)
                        if job.status == 0 or job.status == 1 then
                            -- Pending or Running — return existing job data
                            return job_data
                        end
                    end
                    -- Job not found or no longer active — delete stale unique key
                    redis.call('DEL', unique_key)
                end

                return nil
                "#,
            );

            let job_key_prefix = self.key(&["job", ""]);
            let result: Option<String> = script
                .key(&unique_key)
                .arg(&job_key_prefix)
                .invoke(&mut conn)
                .map_err(map_err)?;

            if let Some(job_data) = result {
                let job: Job = serde_json::from_str(&job_data)
                    .map_err(|e| QueueError::Other(e.to_string()))?;
                return Ok(job);
            }

            // No active duplicate — enqueue normally
            let depends_on = new_job.depends_on.clone();
            let job = new_job.into_job();
            let job_json =
                serde_json::to_string(&job).map_err(|e| QueueError::Other(e.to_string()))?;

            // Validate dependencies
            for dep_id in &depends_on {
                let dep_key = self.key(&["job", dep_id]);
                let data: Option<String> = conn.get(&dep_key).map_err(map_err)?;
                match data {
                    None => {
                        return Err(QueueError::DependencyNotFound(
                            "dependency not found or already dead/cancelled".to_string(),
                        ));
                    }
                    Some(d) => {
                        let dep_job: Job = serde_json::from_str(&d)
                            .map_err(|e| QueueError::Other(e.to_string()))?;
                        if dep_job.status == JobStatus::Dead
                            || dep_job.status == JobStatus::Cancelled
                        {
                            return Err(QueueError::DependencyNotFound(
                                "dependency not found or already dead/cancelled".to_string(),
                            ));
                        }
                    }
                }
            }

            // Store everything atomically via Lua
            let store_script = redis::Script::new(
                r#"
                local unique_key = KEYS[1]
                local job_key = KEYS[2]
                local status_key = KEYS[3]
                local queue_key = KEYS[4]
                local by_queue_key = KEYS[5]
                local by_task_key = KEYS[6]
                local all_key = KEYS[7]

                local job_id = ARGV[1]
                local job_json = ARGV[2]
                local score = tonumber(ARGV[3])
                local created_at = tonumber(ARGV[4])
                local num_deps = tonumber(ARGV[5])

                -- Re-check unique key (race guard)
                local existing = redis.call('GET', unique_key)
                if existing then
                    local prefix = ARGV[6]
                    local ej_data = redis.call('GET', prefix .. existing)
                    if ej_data then
                        local ej = cjson.decode(ej_data)
                        if ej.status == 0 or ej.status == 1 then
                            return ej_data
                        end
                    end
                    redis.call('DEL', unique_key)
                end

                -- Store job
                redis.call('SET', job_key, job_json)
                redis.call('SADD', status_key, job_id)
                redis.call('ZADD', queue_key, score, job_id)
                redis.call('SADD', by_queue_key, job_id)
                redis.call('SADD', by_task_key, job_id)
                redis.call('ZADD', all_key, -created_at, job_id)
                redis.call('SET', unique_key, job_id)

                -- Store dependencies
                local base = 7
                for i = 1, num_deps do
                    local dep_on_key = ARGV[base + (i-1)*3]
                    local dep_id = ARGV[base + (i-1)*3 + 1]
                    local dependents_key = ARGV[base + (i-1)*3 + 2]
                    redis.call('SADD', dep_on_key, dep_id)
                    redis.call('SADD', dependents_key, job_id)
                end

                return nil
                "#,
            );

            let job_key = self.key(&["job", &job.id]);
            let status_key = self.key(&["jobs", "status", &(job.status as i32).to_string()]);
            let queue_key = self.key(&["queue", &job.queue, "pending"]);
            let by_queue_key = self.key(&["jobs", "by_queue", &job.queue]);
            let by_task_key = self.key(&["jobs", "by_task", &job.task_name]);
            let all_key = self.key(&["jobs", "all"]);
            let score = dequeue_score(job.priority, job.scheduled_at);
            let job_key_prefix = self.key(&["job", ""]);

            // Build keys and args vectors to avoid temporary lifetime issues
            let keys = vec![
                unique_key.clone(),
                job_key,
                status_key,
                queue_key,
                by_queue_key,
                by_task_key,
                all_key,
            ];
            let mut args: Vec<String> = vec![
                job.id.clone(),
                job_json.clone(),
                score.to_string(),
                job.created_at.to_string(),
                depends_on.len().to_string(),
                job_key_prefix,
            ];

            for dep_id in &depends_on {
                args.push(self.key(&["job", &job.id, "depends_on"]));
                args.push(dep_id.clone());
                args.push(self.key(&["job", dep_id, "dependents"]));
            }

            let mut invocation = store_script.prepare_invoke();
            for k in &keys {
                invocation.key(k);
            }
            for a in &args {
                invocation.arg(a);
            }
            let result: Option<String> = invocation.invoke(&mut conn).map_err(map_err)?;

            if let Some(existing_data) = result {
                // Lost the race — another caller created a job first
                let existing_job: Job = serde_json::from_str(&existing_data)
                    .map_err(|e| QueueError::Other(e.to_string()))?;
                return Ok(existing_job);
            }

            Ok(job)
        } else {
            self.enqueue(new_job)
        }
    }

    pub fn dequeue(&self, queue_name: &str, now: i64) -> Result<Option<Job>> {
        let mut conn = self.conn()?;
        let queue_key = self.key(&["queue", queue_name, "pending"]);

        // Get candidates ordered by score (lowest first = highest priority)
        let candidates: Vec<String> = conn
            .zrangebyscore_limit(&queue_key, "-inf", "+inf", 0, 100)
            .map_err(map_err)?;

        for job_id in candidates {
            let job_key = self.key(&["job", &job_id]);
            let data: Option<String> = conn.get(&job_key).map_err(map_err)?;
            let data = match data {
                Some(d) => d,
                None => {
                    // Stale entry — remove from queue
                    conn.zrem::<_, _, ()>(&queue_key, &job_id)
                        .map_err(map_err)?;
                    continue;
                }
            };

            let mut job: Job =
                serde_json::from_str(&data).map_err(|e| QueueError::Other(e.to_string()))?;

            // Must be pending and scheduled_at <= now
            if job.status != JobStatus::Pending || job.scheduled_at > now {
                continue;
            }

            // Skip expired jobs
            if let Some(expires_at) = job.expires_at {
                if now > expires_at {
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some("expired before execution".to_string());
                    self.save_job_and_move_status(&mut conn, &job, JobStatus::Pending)?;
                    conn.zrem::<_, _, ()>(&queue_key, &job_id)
                        .map_err(map_err)?;
                    continue;
                }
            }

            // Check dependencies
            let deps_key = self.key(&["job", &job_id, "depends_on"]);
            let dep_ids: Vec<String> = conn.smembers(&deps_key).map_err(map_err)?;
            if !dep_ids.is_empty() {
                let mut all_complete = true;
                for dep_id in &dep_ids {
                    if let Some(dep_job) = self.get_job(dep_id)? {
                        if dep_job.status != JobStatus::Complete {
                            all_complete = false;
                            break;
                        }
                    } else {
                        all_complete = false;
                        break;
                    }
                }
                if !all_complete {
                    continue;
                }
            }

            // Claim the job
            job.status = JobStatus::Running;
            job.started_at = Some(now);
            self.save_job_and_move_status(&mut conn, &job, JobStatus::Pending)?;
            conn.zrem::<_, _, ()>(&queue_key, &job_id)
                .map_err(map_err)?;

            return Ok(Some(job));
        }

        Ok(None)
    }

    pub fn dequeue_from(&self, queues: &[String], now: i64) -> Result<Option<Job>> {
        for queue_name in queues {
            if let Some(job) = self.dequeue(queue_name, now)? {
                return Ok(Some(job));
            }
        }
        Ok(None)
    }

    pub fn complete(&self, id: &str, result_bytes: Option<Vec<u8>>) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;

        if job.status != JobStatus::Running {
            return Err(QueueError::JobNotFound(id.to_string()));
        }

        let old_status = job.status;
        job.status = JobStatus::Complete;
        job.completed_at = Some(now_millis());
        job.result = result_bytes;
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Clean up unique key if present
        if let Some(ref uk) = job.unique_key {
            let unique_key = self.key(&["jobs", "unique", uk]);
            conn.del::<_, ()>(&unique_key).map_err(map_err)?;
        }

        Ok(())
    }

    pub fn fail(&self, id: &str, error: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;

        if job.status != JobStatus::Running {
            return Err(QueueError::JobNotFound(id.to_string()));
        }

        let old_status = job.status;
        job.status = JobStatus::Failed;
        job.completed_at = Some(now_millis());
        job.error = Some(error.to_string());
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        Ok(())
    }

    pub fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;
        let old_status = job.status;

        job.status = JobStatus::Pending;
        job.scheduled_at = next_scheduled_at;
        job.retry_count += 1;
        job.started_at = None;
        job.completed_at = None;
        job.error = None;

        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Re-add to pending queue
        let queue_key = self.key(&["queue", &job.queue, "pending"]);
        let score = dequeue_score(job.priority, job.scheduled_at);
        conn.zadd::<_, _, _, ()>(&queue_key, &job.id, score)
            .map_err(map_err)?;

        Ok(())
    }

    pub fn cancel_job(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let job = match self.get_job(id)? {
            Some(j) => j,
            None => return Ok(false),
        };

        if job.status != JobStatus::Pending {
            return Ok(false);
        }

        let mut job = job;
        let old_status = job.status;
        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_millis());
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Remove from pending queue
        let queue_key = self.key(&["queue", &job.queue, "pending"]);
        conn.zrem::<_, _, ()>(&queue_key, &job.id)
            .map_err(map_err)?;

        // Cascade cancel dependents
        drop(conn);
        self.cascade_cancel(id, "dependency cancelled")?;

        Ok(true)
    }

    pub fn request_cancel(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let mut job = match self.get_job(id)? {
            Some(j) => j,
            None => return Ok(false),
        };

        if job.status != JobStatus::Running {
            return Ok(false);
        }

        job.cancel_requested = true;
        let job_json = serde_json::to_string(&job).map_err(|e| QueueError::Other(e.to_string()))?;
        let job_key = self.key(&["job", id]);
        conn.set::<_, _, ()>(&job_key, &job_json).map_err(map_err)?;

        let cancel_set = self.key(&["jobs", "cancel_requested"]);
        conn.sadd::<_, _, ()>(&cancel_set, id).map_err(map_err)?;

        Ok(true)
    }

    pub fn is_cancel_requested(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let cancel_set = self.key(&["jobs", "cancel_requested"]);
        let is_member: bool = conn.sismember(&cancel_set, id).map_err(map_err)?;
        Ok(is_member)
    }

    pub fn mark_cancelled(&self, id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;
        let old_status = job.status;

        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_millis());
        job.error = Some("cancelled by request".to_string());
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Clean up cancel request
        let cancel_set = self.key(&["jobs", "cancel_requested"]);
        conn.srem::<_, _, ()>(&cancel_set, id).map_err(map_err)?;

        Ok(())
    }

    pub fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()> {
        let now = now_millis();

        let mut queue: Vec<String> = vec![failed_job_id.to_string()];
        let mut visited = std::collections::HashSet::new();
        visited.insert(failed_job_id.to_string());
        let mut idx = 0;

        while idx < queue.len() {
            let current_id = queue[idx].clone();
            idx += 1;

            let dependents = self.get_dependents(&current_id)?;
            for dep_id in dependents {
                if visited.insert(dep_id.clone()) {
                    queue.push(dep_id);
                }
            }
        }

        // Remove the original job
        if !queue.is_empty() {
            queue.remove(0);
        }

        let error_msg = format!("{reason}: {failed_job_id}");
        for dep_id in &queue {
            if let Some(mut job) = self.get_job(dep_id)? {
                if job.status == JobStatus::Pending {
                    let mut conn = self.conn()?;
                    let old_status = job.status;
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some(error_msg.clone());
                    self.save_job_and_move_status(&mut conn, &job, old_status)?;

                    let queue_key = self.key(&["queue", &job.queue, "pending"]);
                    conn.zrem::<_, _, ()>(&queue_key, &job.id)
                        .map_err(map_err)?;
                }
            }
        }

        Ok(())
    }

    pub fn get_dependencies(&self, job_id: &str) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let key = self.key(&["job", job_id, "depends_on"]);
        let ids: Vec<String> = conn.smembers(&key).map_err(map_err)?;
        Ok(ids)
    }

    pub fn get_dependents(&self, job_id: &str) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let key = self.key(&["job", job_id, "dependents"]);
        let ids: Vec<String> = conn.smembers(&key).map_err(map_err)?;
        Ok(ids)
    }

    pub fn update_progress(&self, id: &str, progress: i32) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;
        job.progress = Some(progress);
        let job_json = serde_json::to_string(&job).map_err(|e| QueueError::Other(e.to_string()))?;
        let job_key = self.key(&["job", id]);
        conn.set::<_, _, ()>(&job_key, &job_json).map_err(map_err)?;
        Ok(())
    }

    pub fn list_jobs(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;

        // Get candidate job IDs based on filters
        let job_ids: Vec<String> = if let Some(s) = status {
            let key = self.key(&["jobs", "status", &s.to_string()]);
            conn.smembers(&key).map_err(map_err)?
        } else if let Some(q) = queue_name {
            let key = self.key(&["jobs", "by_queue", q]);
            conn.smembers(&key).map_err(map_err)?
        } else if let Some(t) = task_name {
            let key = self.key(&["jobs", "by_task", t]);
            conn.smembers(&key).map_err(map_err)?
        } else {
            // All jobs sorted by created_at desc
            let all_key = self.key(&["jobs", "all"]);
            let ids: Vec<String> = conn
                .zrangebyscore_limit(&all_key, "-inf", "+inf", offset as isize, limit as isize)
                .map_err(map_err)?;
            // Load and return directly since already paginated
            let mut jobs = Vec::new();
            for id in &ids {
                if let Some(job) = self.load_job(&mut conn, id)? {
                    jobs.push(job);
                }
            }
            return Ok(jobs);
        };

        // Load all matching jobs and apply additional filters
        let mut jobs = Vec::new();
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                // Apply all filters
                if let Some(s) = status {
                    if job.status as i32 != s {
                        continue;
                    }
                }
                if let Some(q) = queue_name {
                    if job.queue != q {
                        continue;
                    }
                }
                if let Some(t) = task_name {
                    if job.task_name != t {
                        continue;
                    }
                }
                jobs.push(job);
            }
        }

        // Sort by created_at desc
        jobs.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        // Apply pagination
        let start = offset as usize;
        let end = (start + limit as usize).min(jobs.len());
        if start >= jobs.len() {
            return Ok(Vec::new());
        }
        Ok(jobs[start..end].to_vec())
    }

    pub fn get_job(&self, id: &str) -> Result<Option<Job>> {
        let mut conn = self.conn()?;
        self.load_job(&mut conn, id)
    }

    pub fn stats(&self) -> Result<QueueStats> {
        let mut conn = self.conn()?;
        let mut stats = QueueStats::default();

        for (status_int, field) in [
            (0, &mut stats.pending),
            (1, &mut stats.running),
            (2, &mut stats.completed),
            (3, &mut stats.failed),
            (4, &mut stats.dead),
            (5, &mut stats.cancelled),
        ] {
            let key = self.key(&["jobs", "status", &status_int.to_string()]);
            let count: i64 = conn.scard(&key).map_err(map_err)?;
            *field = count;
        }

        Ok(stats)
    }

    pub fn purge_completed(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "2"]); // Complete
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                if let Some(completed_at) = job.completed_at {
                    if completed_at < older_than_ms {
                        self.delete_job_fully(&mut conn, &job)?;
                        count += 1;
                    }
                }
            }
        }

        Ok(count)
    }

    pub fn purge_completed_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64> {
        let now = now_millis();
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "2"]); // Complete
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                let should_purge = match (job.completed_at, job.result_ttl_ms) {
                    (Some(completed), Some(ttl)) => completed + ttl < now,
                    (Some(completed), None) => completed < global_cutoff_ms,
                    _ => false,
                };
                if should_purge {
                    self.delete_job_fully(&mut conn, &job)?;
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    pub fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "1"]); // Running
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut stale = Vec::new();
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                if let Some(started) = job.started_at {
                    if (started + job.timeout_ms) < now {
                        stale.push(job);
                    }
                }
            }
        }

        Ok(stale)
    }

    pub fn record_error(&self, job_id: &str, attempt: i32, error: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();

        let row = JobErrorRow {
            id: id.clone(),
            job_id: job_id.to_string(),
            attempt,
            error: error.to_string(),
            failed_at: now,
        };
        let json = serde_json::to_string(&row).map_err(|e| QueueError::Other(e.to_string()))?;

        let errors_key = self.key(&["job_errors", job_id]);
        conn.rpush::<_, _, ()>(&errors_key, &json)
            .map_err(map_err)?;

        Ok(())
    }

    pub fn get_job_errors(&self, job_id: &str) -> Result<Vec<JobErrorRow>> {
        let mut conn = self.conn()?;
        let errors_key = self.key(&["job_errors", job_id]);
        let entries: Vec<String> = conn.lrange(&errors_key, 0, -1).map_err(map_err)?;

        let mut rows = Vec::new();
        for entry in entries {
            let row: JobErrorRow =
                serde_json::from_str(&entry).map_err(|e| QueueError::Other(e.to_string()))?;
            rows.push(row);
        }
        rows.sort_by_key(|r| r.attempt);
        Ok(rows)
    }

    pub fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        // Scan for all job_errors keys
        let pattern = self.key(&["job_errors", "*"]);
        let keys: Vec<String> = redis::cmd("KEYS")
            .arg(&pattern)
            .query(&mut conn)
            .map_err(map_err)?;

        let mut count = 0u64;
        for key in keys {
            let entries: Vec<String> = conn.lrange(&key, 0, -1).map_err(map_err)?;
            let mut to_keep = Vec::new();
            for entry in &entries {
                if let Ok(row) = serde_json::from_str::<JobErrorRow>(entry) {
                    if row.failed_at >= older_than_ms {
                        to_keep.push(entry.clone());
                    } else {
                        count += 1;
                    }
                }
            }
            if to_keep.len() < entries.len() {
                let pipe = &mut redis::pipe();
                pipe.del(&key);
                for item in &to_keep {
                    pipe.rpush(&key, item);
                }
                pipe.query::<()>(&mut conn).map_err(map_err)?;
            }
        }

        Ok(count)
    }

    pub fn expire_pending_jobs(&self, now: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "0"]); // Pending
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(mut job) = self.load_job(&mut conn, id)? {
                if let Some(expires_at) = job.expires_at {
                    if expires_at < now {
                        let old_status = job.status;
                        job.status = JobStatus::Cancelled;
                        job.completed_at = Some(now);
                        job.error = Some("expired".to_string());
                        self.save_job_and_move_status(&mut conn, &job, old_status)?;

                        let queue_key = self.key(&["queue", &job.queue, "pending"]);
                        conn.zrem::<_, _, ()>(&queue_key, &job.id)
                            .map_err(map_err)?;
                        count += 1;
                    }
                }
            }
        }

        Ok(count)
    }

    pub fn cancel_pending_by_queue(&self, queue: &str) -> Result<u64> {
        let mut conn = self.conn()?;
        let by_queue_key = self.key(&["jobs", "by_queue", queue]);
        let job_ids: Vec<String> = conn.smembers(&by_queue_key).map_err(map_err)?;
        let now = now_millis();

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(mut job) = self.load_job(&mut conn, id)? {
                if job.status == JobStatus::Pending {
                    let old_status = job.status;
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some("purged".to_string());
                    self.save_job_and_move_status(&mut conn, &job, old_status)?;

                    let queue_key = self.key(&["queue", &job.queue, "pending"]);
                    conn.zrem::<_, _, ()>(&queue_key, &job.id)
                        .map_err(map_err)?;
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    pub fn cancel_pending_by_task(&self, task_name: &str) -> Result<u64> {
        let mut conn = self.conn()?;
        let by_task_key = self.key(&["jobs", "by_task", task_name]);
        let job_ids: Vec<String> = conn.smembers(&by_task_key).map_err(map_err)?;
        let now = now_millis();

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(mut job) = self.load_job(&mut conn, id)? {
                if job.status == JobStatus::Pending {
                    let old_status = job.status;
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some("revoked".to_string());
                    self.save_job_and_move_status(&mut conn, &job, old_status)?;

                    let queue_key = self.key(&["queue", &job.queue, "pending"]);
                    conn.zrem::<_, _, ()>(&queue_key, &job.id)
                        .map_err(map_err)?;
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    // ── Helpers ────────────────────────────────────────────────────

    pub(super) fn load_job(&self, conn: &mut redis::Connection, id: &str) -> Result<Option<Job>> {
        let job_key = self.key(&["job", id]);
        let data: Option<String> = conn.get(&job_key).map_err(map_err)?;
        match data {
            Some(d) => {
                let job: Job =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                Ok(Some(job))
            }
            None => Ok(None),
        }
    }

    fn get_job_required(&self, id: &str) -> Result<Job> {
        self.get_job(id)?
            .ok_or_else(|| QueueError::JobNotFound(id.to_string()))
    }

    /// Save job JSON and move between status sets.
    pub(super) fn save_job_and_move_status(
        &self,
        conn: &mut redis::Connection,
        job: &Job,
        old_status: JobStatus,
    ) -> Result<()> {
        let job_json = serde_json::to_string(job).map_err(|e| QueueError::Other(e.to_string()))?;
        let job_key = self.key(&["job", &job.id]);
        let old_status_key = self.key(&["jobs", "status", &(old_status as i32).to_string()]);
        let new_status_key = self.key(&["jobs", "status", &(job.status as i32).to_string()]);

        let pipe = &mut redis::pipe();
        pipe.set(&job_key, &job_json);
        if old_status != job.status {
            pipe.srem(&old_status_key, &job.id);
            pipe.sadd(&new_status_key, &job.id);
        }
        pipe.query::<()>(conn).map_err(map_err)?;

        Ok(())
    }

    /// Delete a job and all its associated data.
    pub(super) fn delete_job_fully(&self, conn: &mut redis::Connection, job: &Job) -> Result<()> {
        let pipe = &mut redis::pipe();

        let job_key = self.key(&["job", &job.id]);
        let status_key = self.key(&["jobs", "status", &(job.status as i32).to_string()]);
        let by_queue_key = self.key(&["jobs", "by_queue", &job.queue]);
        let by_task_key = self.key(&["jobs", "by_task", &job.task_name]);
        let all_key = self.key(&["jobs", "all"]);
        let errors_key = self.key(&["job_errors", &job.id]);
        let deps_key = self.key(&["job", &job.id, "depends_on"]);
        let dependents_key = self.key(&["job", &job.id, "dependents"]);

        pipe.del(&job_key);
        pipe.srem(&status_key, &job.id);
        pipe.srem(&by_queue_key, &job.id);
        pipe.srem(&by_task_key, &job.id);
        pipe.zrem(&all_key, &job.id);
        pipe.del(&errors_key);
        pipe.del(&deps_key);
        pipe.del(&dependents_key);

        if let Some(ref uk) = job.unique_key {
            let unique_key = self.key(&["jobs", "unique", uk]);
            pipe.del(&unique_key);
        }

        pipe.query::<()>(conn).map_err(map_err)?;

        Ok(())
    }
}
