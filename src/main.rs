extern crate cairo;

use cairo::{svg, Context};
use std::fs::File;
use std::io::Write;

fn main() {
    koch();
    sierpinski();
    arrowhead();
    dragon();
}

fn koch() {
    let mut out = File::create("koch.svg").unwrap();
    run(
        "F",
        &['F'],
        |c: char| match c {
            'F' => "F+F-F-F+F".chars().collect(),
            other => vec![other],
        },
        std::f64::consts::PI / 2.,
        4,
        &mut out,
    );
}

fn sierpinski() {
    let mut out = File::create("sierpinski.svg").unwrap();
    run(
        "F-G-G",
        &['F', 'G'],
        |c: char| match c {
            'F' => "F-G+F+G-F".chars().collect(),
            'G' => "GG".chars().collect(),
            other => vec![other],
        },
        std::f64::consts::PI * 2. / 3.,
        4,
        &mut out,
    );
}

fn arrowhead() {
    let mut out = File::create("arrowhead.svg").unwrap();
    run(
        "A",
        &['A', 'B'],
        |c: char| match c {
            'A' => "B-A-B".chars().collect(),
            'B' => "A+B+A".chars().collect(),
            other => vec![other],
        },
        std::f64::consts::PI * 1. / 3.,
        4,
        &mut out,
    );
}

fn dragon() {
    let mut out = File::create("dragon.svg").unwrap();
    run(
        "FX",
        &['F'],
        |c: char| match c {
            'X' => "X+YF+".chars().collect(),
            'Y' => "-FX-Y".chars().collect(),
            other => vec![other],
        },
        std::f64::consts::PI / 2.,
        10,
        &mut out,
    );
}

fn run<F, W>(axiom: &str, variables: &[char], rules: F, angle: f64, iterations: usize, writer: W)
where
    F: Fn(char) -> Vec<char> + Copy,
    W: Write,
{
    let surf = svg::Writer::new(1024.0, 1024.0, writer);
    let ctx = Context::new(&surf);
    ctx.scale(1024., 1024.);

    ctx.set_line_width(0.001);
    ctx.set_source_rgb(0., 0., 0.);

    let mut state = axiom.to_string();

    for _ in 0..iterations {
        state = state.chars().map(rules).flatten().collect();
    }

    // let segment_count = state.chars().filter(|c| variables.contains(&c)).count();


    ctx.move_to(0.0, 0.5);
    for c in state.chars() {
        match c {
            '+' => {
                ctx.rotate(-angle);
            }
            '-' => {
                ctx.rotate(angle);
            }
            other => {
                if variables.contains(&other) {
                    ctx.rel_line_to(0.01, 0.0);
                }
            }
        }
    }
    ctx.stroke();

    // let mut fout = File::create("out.png").unwrap();
    // surf.write_all(&mut fout).unwrap();
    // println!("{}", axiom);
}
