use std::ops::RangeInclusive;

#[derive(Debug, Clone, Copy)]
pub(super) struct RelocateMove {
    pub(super) block_start: usize,
    pub(super) block_len: usize,
    pub(super) target_index: usize,
    pub(super) reversed: bool,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct TwoOptMove {
    pub(super) reverse_start: usize,
    pub(super) reverse_end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LinkSwapKind {
    Prefix,
    Suffix,
    Both,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct LinkSwapMove {
    pub(super) kind: LinkSwapKind,
    pub(super) split_index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Crossing {
    pub(super) first_edge: usize,
    pub(super) second_edge: usize,
}

impl Crossing {
    pub(super) fn reverse_range(&self) -> RangeInclusive<usize> {
        (self.first_edge + 1)..=self.second_edge
    }
}
