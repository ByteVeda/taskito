//! JS-facing shape of a topic subscription.

use napi_derive::napi;
use taskito_core::storage::records::Subscription;

/// A topic subscription: routes messages published to `topic` to `taskName`
/// jobs on `queue`, one delivery per active subscription.
#[napi(object)]
pub struct JsSubscription {
    pub topic: String,
    pub subscription_name: String,
    pub task_name: String,
    pub queue: String,
    pub active: bool,
    pub durable: bool,
}

/// Convert a core [`Subscription`] into its JS-facing shape.
pub fn subscription_to_js(row: Subscription) -> JsSubscription {
    JsSubscription {
        topic: row.topic,
        subscription_name: row.subscription_name,
        task_name: row.task_name,
        queue: row.queue,
        active: row.active,
        durable: row.durable,
    }
}
