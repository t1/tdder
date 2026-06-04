package com.example

import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue

class SampleTest {

    @Test
    fun `plain passes`() { assertTrue(true) }

    @Test
    fun `plain fails`() { assertEquals(1, 2) }

    @TestFactory
    fun `dynamic tests`(): List<DynamicTest> = listOf(
        DynamicTest.dynamicTest("dynamic one") { assertTrue(true) },
        DynamicTest.dynamicTest("dynamic two") { throw AssertionError("dynamic fails") }
    )

    @Nested
    inner class `inner context` {
        @Test
        fun `nested passes`() { assertTrue(true) }

        @Test
        fun `nested fails`() { throw AssertionError("nested fails") }
    }
}
