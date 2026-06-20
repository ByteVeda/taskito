//! Translate core errors into napi errors surfaced to JavaScript.

use napi::bindgen_prelude::{Error, Status};
use taskito_core::QueueError;

/// Map a core [`QueueError`] onto a napi [`Error`] (a thrown JS `Error`).
pub fn to_napi_err(err: QueueError) -> Error {
    Error::new(Status::GenericFailure, err.to_string())
}
