//! Job dispatch strategies for distributing work across child processes.

/// Selects the child with the fewest in-flight jobs (least-loaded).
/// Falls back to round-robin if all children have equal load.
pub fn least_loaded(in_flight_counts: &[u32]) -> usize {
    in_flight_counts
        .iter()
        .enumerate()
        .min_by_key(|(_, &count)| count)
        .map(|(idx, _)| idx)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_least_loaded_picks_idle() {
        assert_eq!(least_loaded(&[3, 0, 2]), 1);
    }

    #[test]
    fn test_least_loaded_picks_first_on_tie() {
        assert_eq!(least_loaded(&[1, 1, 1]), 0);
    }

    #[test]
    fn test_least_loaded_single() {
        assert_eq!(least_loaded(&[5]), 0);
    }
}
