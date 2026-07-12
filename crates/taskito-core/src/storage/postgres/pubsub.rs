use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::topic_subscriptions;
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
            ))
            .execute(&mut conn)?;

        Ok(())
    }
}
