use std::ops::RangeInclusive;

use super::index::{EdgeIndex, TourIndex};

/// Relocates the contiguous block of internal nodes between `before_block` and `after_block`
/// into `target_edge`.
///
/// `reversed` encodes the option to reverse the block after relocating since strokes are reversible.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Relocate {
    before_block: EdgeIndex,
    after_block: EdgeIndex,
    target_edge: EdgeIndex,
    reversed: bool,
}

impl Relocate {
    pub fn new(
        before_block: EdgeIndex,
        after_block: EdgeIndex,
        target_edge: EdgeIndex,
        reversed: bool,
    ) -> Option<Self> {
        (before_block < after_block && !(before_block..=after_block).contains(&target_edge))
            .then_some(Self {
                before_block,
                after_block,
                target_edge,
                reversed,
            })
    }

    pub const fn before_block(self) -> EdgeIndex {
        self.before_block
    }

    pub const fn after_block(self) -> EdgeIndex {
        self.after_block
    }

    pub const fn target_edge(self) -> EdgeIndex {
        self.target_edge
    }

    pub const fn reversed(self) -> bool {
        self.reversed
    }
}

/// Unlinks two non-adjacent rapid edges and reverses the segment between them in-place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TwoOpt {
    first_edge: EdgeIndex,
    second_edge: EdgeIndex,
}

impl TwoOpt {
    pub fn new(edge_a: EdgeIndex, edge_b: EdgeIndex) -> Option<Self> {
        (!edge_a.is_adjacent_or_equal(edge_b)).then(|| Self {
            first_edge: edge_a.min(edge_b),
            second_edge: edge_a.max(edge_b),
        })
    }

    pub const fn reversed_nodes(self) -> RangeInclusive<TourIndex> {
        self.first_edge.end()..=self.second_edge.start()
    }

    pub const fn modified(self) -> [TourIndex; 4] {
        [
            self.first_edge.start(),
            self.first_edge.end(),
            self.second_edge.start(),
            self.second_edge.end(),
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkSwapKind {
    Prefix,
    Suffix,
    Both,
}

/// Unlinks `split_edge` and reverses the prefix, suffix, or both to reconnect via the open-tour endpoints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkSwap {
    pub kind: LinkSwapKind,
    pub split_edge: EdgeIndex,
}
