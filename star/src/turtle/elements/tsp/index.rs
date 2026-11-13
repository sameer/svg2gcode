use std::{
    marker::PhantomData,
    ops::{Index, IndexMut, RangeInclusive},
    slice, vec,
};

/// Index of an input stroke in the provided ordering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct StrokeIndex(usize);

impl StrokeIndex {
    #[cfg(test)]
    pub const fn new(index: usize) -> Self {
        Self(index)
    }
}

/// Index of a node in a [`Tour`](super::tour::Tour).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct TourIndex(usize);

impl TourIndex {
    pub const MIN: Self = Self(0);

    pub fn range_inclusive(start: Self, end: Self) -> impl Iterator<Item = Self> {
        (start.0..=end.0).map(Self)
    }

    pub const fn as_usize(self) -> usize {
        self.0
    }
}

/// Index of a rapid edge in a [`Tour`](super::tour::Tour).
/// There are always `tour.len().saturating_sub(1)` edges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct EdgeIndex(usize);

impl EdgeIndex {
    #[cfg(test)]
    pub const fn new(index: usize) -> Self {
        Self(index)
    }

    pub fn range_inclusive(start: Self, end: Self) -> impl Iterator<Item = Self> {
        (start.0..=end.0).map(Self)
    }

    pub const fn start(self) -> TourIndex {
        TourIndex(self.0)
    }

    pub const fn end(self) -> TourIndex {
        TourIndex(self.0 + 1)
    }

    pub const fn nodes(self) -> [TourIndex; 2] {
        [self.start(), self.end()]
    }

    pub const fn node_range(self) -> RangeInclusive<TourIndex> {
        self.start()..=self.end()
    }

    pub const fn is_adjacent_or_equal(self, other: Self) -> bool {
        self.0.abs_diff(other.0) < 2
    }

    pub const fn as_usize(self) -> usize {
        self.0
    }
}

/// A `Vec<T>` indexed exclusively by a strongly-typed key `I`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedVec<I, T> {
    inner: Vec<T>,
    _marker: PhantomData<I>,
}

impl<I, T> IndexedVec<I, T> {
    pub fn from_vec(inner: Vec<T>) -> Self {
        Self {
            inner,
            _marker: PhantomData,
        }
    }

    pub fn filled_like<U: Clone>(&self, value: U) -> IndexedVec<I, U> {
        IndexedVec {
            inner: vec![value; self.inner.len()],
            _marker: PhantomData,
        }
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn iter(&self) -> slice::Iter<'_, T> {
        self.inner.iter()
    }

    pub fn as_slice(&self) -> &[T] {
        &self.inner
    }

    pub fn as_mut_slice(&mut self) -> &mut [T] {
        &mut self.inner
    }
}

impl<I, T> FromIterator<T> for IndexedVec<I, T> {
    fn from_iter<Iter: IntoIterator<Item = T>>(iter: Iter) -> Self {
        Self {
            inner: Vec::from_iter(iter),
            _marker: PhantomData,
        }
    }
}

impl<I, T> IntoIterator for IndexedVec<I, T> {
    type Item = T;
    type IntoIter = vec::IntoIter<T>;

    fn into_iter(self) -> Self::IntoIter {
        self.inner.into_iter()
    }
}

impl<'a, I, T> IntoIterator for &'a IndexedVec<I, T> {
    type Item = &'a T;
    type IntoIter = slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.inner.iter()
    }
}

impl<'a, I, T> IntoIterator for &'a mut IndexedVec<I, T> {
    type Item = &'a mut T;
    type IntoIter = slice::IterMut<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.inner.iter_mut()
    }
}

macro_rules! impl_indexed_vec {
    ($idx:ident) => {
        impl<T> IndexedVec<$idx, T> {
            pub fn indices(&self) -> impl Iterator<Item = $idx> + use<T> {
                (0..self.inner.len()).map($idx)
            }

            pub fn rotated_indices_from(
                &self,
                start_offset: usize,
            ) -> impl Iterator<Item = $idx> + use<T> {
                let len = self.inner.len();
                let offset = start_offset.min(len);
                (offset..len).chain(0..offset).map($idx)
            }

            pub fn last_index(&self) -> Option<$idx> {
                self.inner.len().checked_sub(1).map($idx)
            }

            pub fn enumerate(&self) -> impl Iterator<Item = ($idx, &T)> {
                self.inner
                    .iter()
                    .enumerate()
                    .map(|(i, item)| ($idx(i), item))
            }

            pub fn index_at(&self, index: usize) -> Option<$idx> {
                (index < self.inner.len()).then_some($idx(index))
            }

            pub fn map_enumerated<U>(
                &self,
                mut f: impl FnMut($idx, &T) -> U,
            ) -> IndexedVec<$idx, U> {
                self.enumerate().map(|(i, item)| f(i, item)).collect()
            }
        }

        impl<T> Index<$idx> for IndexedVec<$idx, T> {
            type Output = T;

            fn index(&self, index: $idx) -> &Self::Output {
                self.inner.get(index.0).expect("typed index out of bounds")
            }
        }

        impl<T> IndexMut<$idx> for IndexedVec<$idx, T> {
            fn index_mut(&mut self, index: $idx) -> &mut Self::Output {
                self.inner
                    .get_mut(index.0)
                    .expect("typed index out of bounds")
            }
        }

        impl<T> Index<RangeInclusive<$idx>> for IndexedVec<$idx, T> {
            type Output = [T];

            fn index(&self, range: RangeInclusive<$idx>) -> &Self::Output {
                self.inner
                    .get(range.start().0..=range.end().0)
                    .expect("typed index range out of bounds")
            }
        }

        impl<T> IndexMut<RangeInclusive<$idx>> for IndexedVec<$idx, T> {
            fn index_mut(&mut self, range: RangeInclusive<$idx>) -> &mut Self::Output {
                self.inner
                    .get_mut(range.start().0..=range.end().0)
                    .expect("typed index range out of bounds")
            }
        }
    };
}

impl_indexed_vec!(StrokeIndex);
impl_indexed_vec!(TourIndex);
impl_indexed_vec!(EdgeIndex);
