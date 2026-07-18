use diesel::prelude::*;

use super::super::models::*;
use super::super::records::NewSubscription;
use super::super::schema::topic_subscriptions;
use super::SqliteStorage;
use crate::error::Result;

crate::storage::diesel_common::impl_diesel_pubsub_ops!(SqliteStorage);

impl SqliteStorage {
    /// Insert or update a subscription. Idempotent on (topic, subscription_name).
    ///
    /// The update set deliberately excludes `active`: re-declaring a
    /// subscription (every worker start does) must not resume one an operator
    /// paused. `owner_worker_id` is written explicitly so a durable
    /// re-registration clears a previously-ephemeral owner to SQL NULL.
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
        };

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
            ))
            .execute(&mut conn)?;

        Ok(())
    }
}
