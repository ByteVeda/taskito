use std::collections::HashSet;

use redis::Commands;
use serde::{Deserialize, Serialize};

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::job::{Job, JobStatus};
use crate::storage::records::{NewSubscription, Subscription};
use crate::storage::SubscriptionBacklogStats;

/// JSON blob stored at `sub:<topic>:<subscription_name>`. Mirrors
/// [`Subscription`] so the CRUD path needs no Lua — index sets alone keep
/// lookups and the reaper off a keyspace `SCAN`.
#[derive(Serialize, Deserialize)]
struct SubEntry {
    topic: String,
    subscription_name: String,
    task_name: String,
    queue: String,
    active: bool,
    durable: bool,
    owner_worker_id: Option<String>,
    created_at: i64,
    // Older blobs (registered before per-subscription settings) lack these;
    // default to None so they resolve to queue defaults, matching prior behavior.
    #[serde(default)]
    priority: Option<i32>,
    #[serde(default)]
    max_retries: Option<i32>,
    #[serde(default)]
    timeout_ms: Option<i64>,
}

impl From<SubEntry> for Subscription {
    fn from(e: SubEntry) -> Self {
        Self {
            topic: e.topic,
            subscription_name: e.subscription_name,
            task_name: e.task_name,
            queue: e.queue,
            active: e.active,
            durable: e.durable,
            owner_worker_id: e.owner_worker_id,
            created_at: e.created_at,
            priority: e.priority,
            max_retries: e.max_retries,
            timeout_ms: e.timeout_ms,
        }
    }
}

impl RedisStorage {
    /// The `topic|subscription_name` member string used in the index sets.
    fn sub_composite(topic: &str, subscription_name: &str) -> String {
        format!("{topic}|{subscription_name}")
    }

    /// Load the entry a composite `topic|name` member points at, or `None` when
    /// the blob is gone (a stale index member). Splits on the first `|`, matching
    /// how [`Self::sub_composite`] builds it.
    fn load_sub_by_composite(
        &self,
        conn: &mut redis::Connection,
        composite: &str,
    ) -> Result<Option<SubEntry>> {
        let Some((topic, name)) = composite.split_once('|') else {
            return Ok(None);
        };
        let blob_key = self.key(&["sub", topic, name]);
        let data: Option<String> = conn.get(&blob_key).map_err(map_err)?;
        match data {
            Some(d) => {
                let entry: SubEntry = serde_json::from_str(&d)?;
                Ok(Some(entry))
            }
            None => Ok(None),
        }
    }

    /// Pipeline-load the entries for many `(topic, name)` pairs in a single
    /// round trip. Stale index members whose blob is gone are dropped (their
    /// `GET` returns nil). Replaces the per-member `GET` loop that made every
    /// list/reap/stats call O(N) round trips against Redis.
    fn load_subs_pipelined(
        &self,
        conn: &mut redis::Connection,
        pairs: &[(String, String)],
    ) -> Result<Vec<SubEntry>> {
        if pairs.is_empty() {
            return Ok(Vec::new());
        }
        let mut pipe = redis::pipe();
        for (topic, name) in pairs {
            pipe.get(self.key(&["sub", topic, name]));
        }
        let blobs: Vec<Option<String>> = pipe.query(conn).map_err(map_err)?;
        blobs
            .into_iter()
            .flatten()
            .map(|d| serde_json::from_str(&d).map_err(QueueError::from))
            .collect()
    }

    /// Insert or update a subscription. Idempotent on (topic, subscription_name).
    ///
    /// Maintains three index sets — `subs:by_topic:<topic>`, `subs:all`, and
    /// `subs:by_owner:<worker_id>` (ephemeral rows only). When a re-registration
    /// changes the owner (including clearing it to durable), the stale
    /// `by_owner` membership is dropped so the reaper's view stays exact.
    pub fn register_subscription(&self, sub: &NewSubscription) -> Result<()> {
        let mut conn = self.conn()?;

        let entry = SubEntry {
            topic: sub.topic.clone(),
            subscription_name: sub.subscription_name.clone(),
            task_name: sub.task_name.clone(),
            queue: sub.queue.clone(),
            active: sub.active,
            durable: sub.durable,
            owner_worker_id: sub.owner_worker_id.clone(),
            created_at: sub.created_at,
            priority: sub.priority,
            max_retries: sub.max_retries,
            timeout_ms: sub.timeout_ms,
        };
        let blob_key = self.key(&["sub", &sub.topic, &sub.subscription_name]);
        let by_topic = self.key(&["subs", "by_topic", &sub.topic]);
        let all = self.key(&["subs", "all"]);
        let composite = Self::sub_composite(&sub.topic, &sub.subscription_name);

        // A prior row may have carried a different (or NULL) owner; drop its
        // stale by_owner entry so ownership never lingers across re-registration.
        // Re-declaring also must not resume a paused subscription or reset its
        // registration time, so both survive from the prior entry.
        let prior = self.load_sub_by_composite(&mut conn, &composite)?;
        let prior_owner = prior.as_ref().and_then(|e| e.owner_worker_id.clone());
        let mut entry = entry;
        if let Some(prior) = &prior {
            entry.active = prior.active;
            entry.created_at = prior.created_at;
        }
        let json = serde_json::to_string(&entry)?;

        let pipe = redis::pipe().atomic().to_owned();
        let mut pipe = pipe;
        pipe.set(&blob_key, &json);
        pipe.sadd(&by_topic, &sub.subscription_name);
        pipe.sadd(&all, &composite);
        if let Some(prev) = prior_owner.as_deref() {
            if Some(prev) != sub.owner_worker_id.as_deref() {
                pipe.srem(self.key(&["subs", "by_owner", prev]), &composite);
            }
        }
        if let Some(owner) = sub.owner_worker_id.as_deref() {
            pipe.sadd(self.key(&["subs", "by_owner", owner]), &composite);
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    /// Active subscriptions for a topic, in registration order (`created_at`
    /// then `subscription_name`, matching the Diesel backends).
    pub fn list_subscriptions_for_topic(&self, topic: &str) -> Result<Vec<Subscription>> {
        let mut conn = self.conn()?;
        let by_topic = self.key(&["subs", "by_topic", topic]);

        let names: Vec<String> = conn.smembers(&by_topic).map_err(map_err)?;
        let pairs: Vec<(String, String)> = names
            .into_iter()
            .map(|name| (topic.to_string(), name))
            .collect();

        let mut rows: Vec<Subscription> = self
            .load_subs_pipelined(&mut conn, &pairs)?
            .into_iter()
            .filter(|entry| entry.active)
            .map(Subscription::from)
            .collect();

        rows.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.subscription_name.cmp(&b.subscription_name))
        });

        Ok(rows)
    }

    /// Every registered subscription, active or paused, across all topics.
    pub fn list_subscriptions(&self) -> Result<Vec<Subscription>> {
        let mut conn = self.conn()?;
        let all = self.key(&["subs", "all"]);

        let composites: Vec<String> = conn.smembers(&all).map_err(map_err)?;
        let pairs = Self::composites_to_pairs(&composites);

        let rows = self
            .load_subs_pipelined(&mut conn, &pairs)?
            .into_iter()
            .map(Subscription::from)
            .collect();

        Ok(rows)
    }

    /// Split `topic|name` composite index members into `(topic, name)` pairs,
    /// dropping any malformed member (matching `load_sub_by_composite`).
    fn composites_to_pairs(composites: &[String]) -> Vec<(String, String)> {
        composites
            .iter()
            .filter_map(|c| {
                c.split_once('|')
                    .map(|(t, n)| (t.to_string(), n.to_string()))
            })
            .collect()
    }

    /// Remove a subscription. Returns false if none matched.
    pub fn unsubscribe(&self, topic: &str, subscription_name: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let blob_key = self.key(&["sub", topic, subscription_name]);

        // Read the row first so its owner index entry can be dropped too.
        let data: Option<String> = conn.get(&blob_key).map_err(map_err)?;
        let Some(d) = data else {
            return Ok(false);
        };
        let entry: SubEntry = serde_json::from_str(&d)?;

        let by_topic = self.key(&["subs", "by_topic", topic]);
        let all = self.key(&["subs", "all"]);
        let composite = Self::sub_composite(topic, subscription_name);

        let mut pipe = redis::pipe().atomic().to_owned();
        pipe.del(&blob_key);
        pipe.srem(&by_topic, subscription_name);
        pipe.srem(&all, &composite);
        if let Some(owner) = entry.owner_worker_id.as_deref() {
            pipe.srem(self.key(&["subs", "by_owner", owner]), &composite);
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(true)
    }

    /// Pause (false) or resume (true) a subscription without removing its
    /// registration. Returns false if none matched.
    pub fn set_subscription_active(
        &self,
        topic: &str,
        subscription_name: &str,
        active: bool,
    ) -> Result<bool> {
        let mut conn = self.conn()?;
        let blob_key = self.key(&["sub", topic, subscription_name]);

        let data: Option<String> = conn.get(&blob_key).map_err(map_err)?;
        let Some(d) = data else {
            return Ok(false);
        };

        let mut entry: SubEntry = serde_json::from_str(&d)?;
        entry.active = active;

        let json = serde_json::to_string(&entry)?;
        conn.set::<_, _, ()>(&blob_key, &json).map_err(map_err)?;

        Ok(true)
    }

    /// Remove ephemeral subscriptions whose owner is not in `live_worker_ids`.
    /// Durable rows (owner NULL) are never touched, and rows younger than the
    /// registration grace window survive (a starting worker inserts its
    /// ephemeral subscriptions before its first heartbeat lands).
    /// Returns the count removed.
    ///
    /// Iterates the `subs:all` index set rather than a keyspace `SCAN`; each
    /// removed row is also pulled from its `by_topic` and `by_owner` sets.
    pub fn reap_ephemeral_subscriptions(&self, live_worker_ids: &[String]) -> Result<u64> {
        let mut conn = self.conn()?;
        let all = self.key(&["subs", "all"]);
        let cutoff = crate::job::now_millis() - crate::storage::EPHEMERAL_SUBSCRIPTION_GRACE_MS;

        let composites: Vec<String> = conn.smembers(&all).map_err(map_err)?;
        let pairs = Self::composites_to_pairs(&composites);
        let entries = self.load_subs_pipelined(&mut conn, &pairs)?;
        let live: HashSet<&str> = live_worker_ids.iter().map(String::as_str).collect();

        // Decide in memory, then remove every doomed row in one atomic pipe
        // rather than a MULTI/EXEC round trip per row.
        let mut pipe = redis::pipe().atomic().to_owned();
        let mut removed = 0u64;
        for entry in &entries {
            // Durable rows (owner NULL) and live-owned rows survive.
            let Some(owner) = entry.owner_worker_id.as_deref() else {
                continue;
            };
            if live.contains(owner) || entry.created_at >= cutoff {
                continue;
            }

            let composite = Self::sub_composite(&entry.topic, &entry.subscription_name);
            pipe.del(self.key(&["sub", &entry.topic, &entry.subscription_name]));
            pipe.srem(
                self.key(&["subs", "by_topic", &entry.topic]),
                &entry.subscription_name,
            );
            pipe.srem(&all, &composite);
            pipe.srem(self.key(&["subs", "by_owner", owner]), &composite);
            removed += 1;
        }

        if removed > 0 {
            pipe.query::<()>(&mut conn).map_err(map_err)?;
        }

        Ok(removed)
    }

    // ── Per-subscription backlog/lag indices ───────────────────────────────
    //
    // Three index keys per subscription mirror the live delivery backlog so
    // `topic_backlog_stats` costs O(subscriptions), never a job scan:
    //   sub:pending:<topic>:<name> — ZSET of job ids scored by `created_at` (ms)
    //   sub:running:<topic>:<name> — SET of job ids
    //   sub:dead:<topic>:<name>    — SET of (original) job ids
    // Every write is gated on `extract_topic_subscription`, so an ordinary job
    // never touches them: the whole feature stays zero-cost off the pub/sub path.

    /// Key for a subscription's per-status backlog index. `kind` is
    /// `"pending"`, `"running"`, or `"dead"`.
    fn sub_index_key(&self, kind: &str, topic: &str, subscription_name: &str) -> String {
        self.key(&["sub", kind, topic, subscription_name])
    }

    /// Append the backlog-index ops for `job` landing in status `to` onto
    /// `pipe`, if (and only if) `job` is a pub/sub delivery. Keyed on the
    /// *destination* status alone: every transition additionally scrubs the job
    /// from the indices it must not be in, so the indices self-heal any drift a
    /// best-effort claim reindex (see `reindex_pubsub_best_effort`) may leave,
    /// on the very next state change. All ops are `.ignore()`d so the helper is
    /// safe to fold into either a plain or a MULTI/EXEC pipeline without
    /// disturbing the caller's result type.
    pub(in crate::storage::redis_backend) fn push_pubsub_transition(
        &self,
        pipe: &mut redis::Pipeline,
        job: &Job,
        to: JobStatus,
    ) {
        let Some((topic, name)) = crate::pubsub::extract_topic_subscription(job.notes.as_deref())
        else {
            return;
        };
        let pending = self.sub_index_key("pending", &topic, &name);
        let running = self.sub_index_key("running", &topic, &name);
        let dead = self.sub_index_key("dead", &topic, &name);
        match to {
            JobStatus::Pending => {
                pipe.srem(&running, &job.id).ignore();
                pipe.zadd(&pending, &job.id, job.created_at as f64).ignore();
            }
            JobStatus::Running => {
                pipe.zrem(&pending, &job.id).ignore();
                pipe.sadd(&running, &job.id).ignore();
            }
            JobStatus::Dead => {
                pipe.zrem(&pending, &job.id).ignore();
                pipe.srem(&running, &job.id).ignore();
                pipe.sadd(&dead, &job.id).ignore();
            }
            // Complete / Failed / Cancelled: the delivery leaves the backlog.
            _ => {
                pipe.zrem(&pending, &job.id).ignore();
                pipe.srem(&running, &job.id).ignore();
            }
        }
    }

    /// Append a `sub:dead` removal onto `pipe` for a dead-letter row whose
    /// attribution comes from its persisted `notes` (retry/purge/delete paths
    /// hold a `DeadJobEntry`, not a live `Job`). `member` is the original job id
    /// — the value `move_to_dlq` added via [`Self::push_pubsub_transition`].
    /// No-op for non-pub/sub rows. Keeps the `dead` count from drifting upward
    /// after a dead-letter entry is retried or purged.
    pub(in crate::storage::redis_backend) fn push_pubsub_dead_remove(
        &self,
        pipe: &mut redis::Pipeline,
        notes: Option<&str>,
        member: &str,
    ) {
        if let Some((topic, name)) = crate::pubsub::extract_topic_subscription(notes) {
            pipe.srem(self.sub_index_key("dead", &topic, &name), member)
                .ignore();
        }
    }

    /// Best-effort backlog reindex for a status change committed by a bespoke,
    /// correctness-critical Lua script we deliberately keep minimal (the
    /// Pending→Running claim and the requeue-stuck rescue). The index move runs
    /// in a follow-up pipe: a crash between the script and this pipe can leave a
    /// delivery in the wrong backlog set, but that only skews a dashboard metric
    /// — never job state — and the next transition scrubs it. A Redis error is
    /// logged and swallowed so it cannot fail an operation that already
    /// succeeded. No-op (and no round trip) for ordinary jobs.
    pub(in crate::storage::redis_backend) fn reindex_pubsub_best_effort(
        &self,
        conn: &mut redis::Connection,
        job: &Job,
        to: JobStatus,
    ) {
        if crate::pubsub::extract_topic_subscription(job.notes.as_deref()).is_none() {
            return;
        }
        let mut pipe = redis::pipe();
        self.push_pubsub_transition(&mut pipe, job, to);
        if let Err(e) = pipe.query::<()>(conn) {
            log::warn!("pub/sub backlog reindex failed (metrics only): {e}");
        }
    }

    /// Backlog/lag snapshot per registered subscription. One bounded round trip
    /// per subscription (never a job scan): the three index cardinalities plus
    /// the oldest pending score. `oldest_pending_age_ms` is `now - score`
    /// floored at 0, or `None` when the subscription has no pending backlog.
    /// Mirrors the Diesel backends' shape; counts are a direct read of the live
    /// indices, so they cannot drift the way a maintained counter would.
    pub fn topic_backlog_stats(&self) -> Result<Vec<SubscriptionBacklogStats>> {
        let subs = self.list_subscriptions()?;
        if subs.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.conn()?;
        let now = crate::job::now_millis();

        // Batch every subscription's index reads instead of one MULTI/EXEC per
        // subscription. Two homogeneous pipes keep the reply types clean: the
        // three cardinalities (i64) in one, the oldest-pending score (a
        // heterogeneous ZRANGE reply) in another. Both are O(1) round trips.
        let mut counts_pipe = redis::pipe();
        let mut oldest_pipe = redis::pipe();
        for sub in &subs {
            let pending_key = self.sub_index_key("pending", &sub.topic, &sub.subscription_name);
            let running_key = self.sub_index_key("running", &sub.topic, &sub.subscription_name);
            let dead_key = self.sub_index_key("dead", &sub.topic, &sub.subscription_name);
            counts_pipe
                .zcard(&pending_key)
                .scard(&running_key)
                .scard(&dead_key);
            // ZRANGE 0 0 WITHSCORES yields at most the single oldest pending job.
            oldest_pipe.zrange_withscores(&pending_key, 0, 0);
        }
        let counts: Vec<i64> = counts_pipe.query(&mut conn).map_err(map_err)?;
        let oldest: Vec<Vec<(String, f64)>> = oldest_pipe.query(&mut conn).map_err(map_err)?;

        let out = subs
            .into_iter()
            .enumerate()
            .map(|(i, sub)| {
                let oldest_pending_age_ms = oldest
                    .get(i)
                    .and_then(|v| v.first())
                    .map(|(_, score)| (now - *score as i64).max(0));
                SubscriptionBacklogStats {
                    topic: sub.topic,
                    subscription_name: sub.subscription_name,
                    task_name: sub.task_name,
                    queue: sub.queue,
                    active: sub.active,
                    durable: sub.durable,
                    pending: counts[i * 3],
                    running: counts[i * 3 + 1],
                    dead: counts[i * 3 + 2],
                    oldest_pending_age_ms,
                }
            })
            .collect();
        Ok(out)
    }
}
