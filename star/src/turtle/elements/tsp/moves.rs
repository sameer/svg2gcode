use std::{num::NonZeroUsize, ops::RangeInclusive};

/// Relocates a contiguous block of `block_len` internal nodes at `block_index` to sit immediately after `target_index`.
///
/// `reversed` encodes the option to reverse after relocating since strokes are reversible.
#[derive(Debug, Clone, Copy)]
pub struct Relocate {
    pub block_start_index: NonZeroUsize,
    pub block_len: NonZeroUsize,
    pub target_index: usize,
    pub reversed: bool,
}

/// Disentangles a crossing by reversing the tour at the given range in-place.
///
/// Because this is an open-loop TSP problem, all rotation ranges are well-formed (start < end).
#[derive(Debug, Clone)]
pub struct TwoOpt {
    pub range: RangeInclusive<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkSwapKind {
    Prefix,
    Suffix,
    Both,
}

/// A special case of [`TwoOpt`] that moves a node to the beginning as a means to remove an edge to it.
///
/// Because strokes are reversible, the possible reverse options are encoded in [`LinkSwapKind`].
#[derive(Debug, Clone, Copy)]
pub struct LinkSwap {
    pub kind: LinkSwapKind,
    pub split_index: usize,
}
