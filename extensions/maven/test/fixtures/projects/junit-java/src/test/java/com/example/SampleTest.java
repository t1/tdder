package com.example;

import org.junit.jupiter.api.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

public class SampleTest {

    @Test
    void plainPasses() { assertTrue(true); }

    @Test
    void plainFails() { assertEquals(1, 2, "plain fails"); }

    @TestFactory
    List<DynamicTest> dynamicTests() {
        return List.of(
            DynamicTest.dynamicTest("dynamic one", () -> assertTrue(true)),
            DynamicTest.dynamicTest("dynamic two", () -> fail("dynamic fails"))
        );
    }

    @Nested
    class InnerContext {
        @Test
        void nestedPasses() { assertTrue(true); }

        @Test
        void nestedFails() { fail("nested fails"); }
    }
}
