use std::collections::HashSet;

use redis::Commands;
use serde::{Deserialize, Serialize};

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::storage::models::{NewSubscriptionRow, SubscriptionRow};

/// JSON blob stored at `sub:<topic>:<subscription_name>`. Mirrors
/// [`SubscriptionRow`] so the CRUD path needs no Lua — index sets alone keep
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
}

impl From<SubEntry> for SubscriptionRow {
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
                let entry: SubEntry =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                Ok(Some(entry))
            }
            None => Ok(None),
        }
    }

    /// Insert or update a subscription. Idempotent on (topic, subscription_name).
    ///
    /// Maintains three index sets — `subs:by_topic:<topic>`, `subs:all`, and
    /// `subs:by_owner:<worker_id>` (ephemeral rows only). When a re-registration
    /// changes the owner (including clearing it to durable), the stale
    /// `by_owner` membership is dropped so the reaper's view stays exact.
    pub fn register_subscription(&self, sub: &NewSubscriptionRow) -> Result<()> {
        let mut conn = self.conn()?;

        let entry = SubEntry {
            topic: sub.topic.to_string(),
            subscription_name: sub.subscription_name.to_string(),
            task_name: sub.task_name.to_string(),
            queue: sub.queue.to_string(),
            active: sub.active,
            durable: sub.durable,
            owner_worker_id: sub.owner_worker_id.map(|s| s.to_string()),
            created_at: sub.created_at,
        };
        let blob_key = self.key(&["sub", sub.topic, sub.subscription_name]);
        let by_topic = self.key(&["subs", "by_topic", sub.topic]);
        let all = self.key(&["subs", "all"]);
        let composite = Self::sub_composite(sub.topic, sub.subscription_name);

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
        let json = serde_json::to_string(&entry).map_err(|e| QueueError::Other(e.to_string()))?;

        let pipe = redis::pipe().atomic().to_owned();
        let mut pipe = pipe;
        pipe.set(&blob_key, &json);
        pipe.sadd(&by_topic, sub.subscription_name);
        pipe.sadd(&all, &composite);
        if let Some(prev) = prior_owner.as_deref() {
            if Some(prev) != sub.owner_worker_id {
                pipe.srem(self.key(&["subs", "by_owner", prev]), &composite);
            }
        }
        if let Some(owner) = sub.owner_worker_id {
            pipe.sadd(self.key(&["subs", "by_owner", owner]), &composite);
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    /// Active subscriptions for a topic, in registration order (`created_at`
    /// then `subscription_name`, matching the Diesel backends).
    pub fn list_subscriptions_for_topic(&self, topic: &str) -> Result<Vec<SubscriptionRow>> {
        let mut conn = self.conn()?;
        let by_topic = self.key(&["subs", "by_topic", topic]);

        let names: Vec<String> = conn.smembers(&by_topic).map_err(map_err)?;

        let mut rows = Vec::new();
        for name in names {
            let blob_key = self.key(&["sub", topic, &name]);
            let data: Option<String> = conn.get(&blob_key).map_err(map_err)?;
            if let Some(d) = data {
                let entry: SubEntry =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                if entry.active {
                    rows.push(SubscriptionRow::from(entry));
                }
            }
        }

        rows.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.subscription_name.cmp(&b.subscription_name))
        });

        Ok(rows)
    }

    /// Every registered subscription, active or paused, across all topics.
    pub fn list_subscriptions(&self) -> Result<Vec<SubscriptionRow>> {
        let mut conn = self.conn()?;
        let all = self.key(&["subs", "all"]);

        let composites: Vec<String> = conn.smembers(&all).map_err(map_err)?;

        let mut rows = Vec::new();
        for composite in composites {
            if let Some(entry) = self.load_sub_by_composite(&mut conn, &composite)? {
                rows.push(SubscriptionRow::from(entry));
            }
        }

        Ok(rows)
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
        let entry: SubEntry =
            serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;

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

        let mut entry: SubEntry =
            serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
        entry.active = active;

        let json = serde_json::to_string(&entry).map_err(|e| QueueError::Other(e.to_string()))?;
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
        let live: HashSet<&str> = live_worker_ids.iter().map(String::as_str).collect();

        let mut removed = 0u64;
        for composite in composites {
            let Some(entry) = self.load_sub_by_composite(&mut conn, &composite)? else {
                continue;
            };
            // Durable rows (owner NULL) and live-owned rows survive.
            let Some(owner) = entry.owner_worker_id.as_deref() else {
                continue;
            };
            if live.contains(owner) || entry.created_at >= cutoff {
                continue;
            }

            let blob_key = self.key(&["sub", &entry.topic, &entry.subscription_name]);
            let by_topic = self.key(&["subs", "by_topic", &entry.topic]);
            let by_owner = self.key(&["subs", "by_owner", owner]);

            let mut pipe = redis::pipe().atomic().to_owned();
            pipe.del(&blob_key);
            pipe.srem(&by_topic, &entry.subscription_name);
            pipe.srem(&all, &composite);
            pipe.srem(&by_owner, &composite);
            pipe.query::<()>(&mut conn).map_err(map_err)?;

            removed += 1;
        }

        Ok(removed)
    }
}
