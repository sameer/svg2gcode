use serde::{
    de::{SeqAccess, Visitor},
    ser::SerializeSeq,
    Deserialize, Deserializer, Serialize, Serializer,
};
use svgtypes::{Length, LengthUnit};

pub fn serialize<S>(length: &[Option<Length>; 2], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut seq = serializer.serialize_seq(Some(2))?;
    for i in 0..2 {
        let length_def = length[i].clone().map(|length| LengthDef {
            number: length.number,
            unit: length.unit,
        });
        seq.serialize_element(&length_def)?;
    }
    seq.end()
}

struct OptionalLengthArrayVisitor;
impl<'de> Visitor<'de> for OptionalLengthArrayVisitor {
    type Value = [Option<Length>; 2];

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(formatter, "SVG dimension array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let x = seq.next_element::<Option<LengthDef>>()?.flatten();
        let y = seq.next_element::<Option<LengthDef>>()?.flatten();
        Ok([
            x.map(|length_def| Length {
                number: length_def.number,
                unit: length_def.unit,
            }),
            y.map(|length_def| Length {
                number: length_def.number,
                unit: length_def.unit,
            }),
        ])
    }
}

pub fn deserialize<'de, D>(deserializer: D) -> Result<[Option<Length>; 2], D::Error>
where
    D: Deserializer<'de>,
{
    deserializer.deserialize_seq(OptionalLengthArrayVisitor)
}

#[derive(Serialize, Deserialize)]
struct LengthDef {
    number: f64,
    #[serde(with = "LengthUnitDef")]
    unit: LengthUnit,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "LengthUnit")]
enum LengthUnitDef {
    None,
    Em,
    Ex,
    Px,
    In,
    Cm,
    Mm,
    Pt,
    Pc,
    Percent,
}
