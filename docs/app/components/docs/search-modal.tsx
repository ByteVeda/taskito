// Full ⌘K search lands in Phase 6; this stub keeps the docs shell self-contained.
export function SearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <button
      type="button"
      className="cmdk"
      aria-label="Close search"
      onClick={onClose}
    >
      <div className="cmdk-panel">Search coming soon — press Esc</div>
    </button>
  );
}
