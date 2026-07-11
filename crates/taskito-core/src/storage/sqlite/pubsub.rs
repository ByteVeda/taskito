use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::topic_subscriptions;
use super::SqliteStorage;
use crate::error::Result;

crate::storage::diesel_common::impl_diesel_pubsub_ops!(SqliteStorage);

impl SqliteStorage {
    /// Insert or update a subscription. Idempotent on (topic, subscription_name).
    ///
    /// `replace_into` deletes any prior row before inserting, so re-registering
    /// with `owner_worker_id = None` correctly clears a previously-set owner.
    pub fn register_subscription(&self, sub: &NewSubscriptionRow) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::replace_into(topic_subscriptions::table)
            .values(sub)
            .execute(&mut conn)?;

        Ok(())
    }
}
