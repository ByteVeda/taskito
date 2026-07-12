use diesel::prelude::*;

use super::super::models::*;
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
    pub fn register_subscription(&self, sub: &NewSubscriptionRow) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::insert_into(topic_subscriptions::table)
            .values(sub)
            .on_conflict((
                topic_subscriptions::topic,
                topic_subscriptions::subscription_name,
            ))
            .do_update()
            .set((
                topic_subscriptions::task_name.eq(sub.task_name),
                topic_subscriptions::queue.eq(sub.queue),
                topic_subscriptions::durable.eq(sub.durable),
                topic_subscriptions::owner_worker_id.eq(sub.owner_worker_id),
                topic_subscriptions::priority.eq(sub.priority),
                topic_subscriptions::max_retries.eq(sub.max_retries),
                topic_subscriptions::timeout_ms.eq(sub.timeout_ms),
            ))
            .execute(&mut conn)?;

        Ok(())
    }
}
