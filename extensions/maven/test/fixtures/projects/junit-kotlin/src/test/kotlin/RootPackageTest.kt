import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertTrue

class RootPackageTest {
    @Test
    fun `root passes`() { assertTrue(true) }

    @Test
    fun `root fails`() { throw AssertionError("root fails") }
}
