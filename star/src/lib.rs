#![deny(unused_crate_dependencies)]

/// Lowers an SVG to an intermediate representation that's easier to work when generating machine code.
pub mod lower;

/// Provides an interface for drawing lines.
/// This concept is referred to as [Turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics).
pub mod turtle;
