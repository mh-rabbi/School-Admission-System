using SchoolAdmission.Api.Infrastructure;

namespace SchoolAdmission.Api.Tests;

public sealed class PrefixedIdTests
{
    [Fact]
    public void Format_and_parse_round_trip()
    {
        var guid = PrefixedId.NewGuid();
        var id = PrefixedId.Class(guid);

        id.Should().StartWith("c_").And.HaveLength(34);
        PrefixedId.TryParse(PrefixedId.ClassPrefix, id, out var parsed).Should().BeTrue();
        parsed.Should().Be(guid);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("c_123")]
    [InlineData("0193f2a4c0de7a1b8c9d0e1f2a3b4c5d")]
    [InlineData("x_0193f2a4c0de7a1b8c9d0e1f2a3b4c5d")]
    [InlineData("c_0193f2a4c0de7a1b8c9d0e1f2a3b4c5z")]
    public void Malformed_ids_do_not_parse(string? value)
    {
        PrefixedId.TryParse(PrefixedId.ClassPrefix, value, out _).Should().BeFalse();
    }

    [Fact]
    public void Hold_id_does_not_parse_as_class_id()
    {
        var holdId = PrefixedId.Hold(PrefixedId.NewGuid());

        PrefixedId.TryParse(PrefixedId.ClassPrefix, holdId, out _).Should().BeFalse();
    }
}
