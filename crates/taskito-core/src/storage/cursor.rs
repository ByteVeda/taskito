//! Opaque keyset-pagination cursor shared by every SDK binding.
//!
//! A cursor encodes the `(sort_key, id)` of the last row of a page — the sort
//! key being the listing's ordering column (`created_at`/`completed_at`/
//! `failed_at`, a non-negative millis timestamp) and `id` the row's UUIDv7 /
//! DLQ id. Neither contains a `:`, so a single split round-trips unambiguously
//! with no base64. Callers must treat the string as opaque and pass it back
//! verbatim; the format may gain a version prefix later.

use crate::error::{QueueError, Result};

/// Encode a `(sort_key, id)` keyset cursor as an opaque string.
pub fn encode_cursor(sort_key: i64, id: &str) -> String {
    format!("{sort_key}:{id}")
}

/// Decode a cursor produced by [`encode_cursor`]. Returns `Other` on malformed
/// input — treat it like any other bad-request error.
pub fn decode_cursor(cursor: &str) -> Result<(i64, &str)> {
    let (key, id) = cursor
        .split_once(':')
        .ok_or_else(|| QueueError::Other(format!("invalid cursor: {cursor}")))?;
    let sort_key: i64 = key
        .parse()
        .map_err(|_| QueueError::Other(format!("invalid cursor: {cursor}")))?;
    Ok((sort_key, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let s = encode_cursor(1_720_000_000_123, "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
        let (key, id) = decode_cursor(&s).unwrap();
        assert_eq!(key, 1_720_000_000_123);
        assert_eq!(id, "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    }

    #[test]
    fn rejects_malformed() {
        assert!(decode_cursor("nocolon").is_err());
        assert!(decode_cursor("notanint:abc").is_err());
    }
}
