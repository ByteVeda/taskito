use diesel::prelude::*;

use super::super::models::*;
use super::super::records::NewSubscription;
use super::super::schema::{topic_messages, topic_subscriptions};
use super::PostgresStorage;
use crate::error::Result;

crate::storage::diesel_common::impl_diesel_pubsub_ops!(PostgresStorage);

impl PostgresStorage {
    /// Insert or update a subscription. Idempotent on (topic, subscription_name).
    ///
    /// The `do_update` sets each mutable column explicitly rather than via
    /// `AsChangeset`, so re-registering with `owner_worker_id = None` writes SQL
    /// NULL (clearing a previously-ephemeral owner) instead of leaving it stale.
    /// `active` and `created_at` are deliberately excluded: re-declaring must
    /// not resume a paused subscription or reset its registration time.
    pub fn register_subscription(&self, sub: &NewSubscription) -> Result<()> {
        let mut conn = self.conn()?;
        let row = NewSubscriptionRow {
            topic: &sub.topic,
            subscription_name: &sub.subscription_name,
            task_name: &sub.task_name,
            queue: &sub.queue,
            active: sub.active,
            durable: sub.durable,
            owner_worker_id: sub.owner_worker_id.as_deref(),
            created_at: sub.created_at,
            priority: sub.priority,
            max_retries: sub.max_retries,
            timeout_ms: sub.timeout_ms,
            mode: &sub.mode,
        };

        // `cursor` is omitted so a re-registration preserves a log consumer's
        // read position.
        diesel::insert_into(topic_subscriptions::table)
            .values(&row)
            .on_conflict((
                topic_subscriptions::topic,
                topic_subscriptions::subscription_name,
            ))
            .do_update()
            .set((
                topic_subscriptions::task_name.eq(row.task_name),
                topic_subscriptions::queue.eq(row.queue),
                topic_subscriptions::durable.eq(row.durable),
                topic_subscriptions::owner_worker_id.eq(row.owner_worker_id),
                topic_subscriptions::priority.eq(row.priority),
                topic_subscriptions::max_retries.eq(row.max_retries),
                topic_subscriptions::timeout_ms.eq(row.timeout_ms),
                topic_subscriptions::mode.eq(row.mode),
            ))
            .execute(&mut conn)?;

        Ok(())
    }
}
