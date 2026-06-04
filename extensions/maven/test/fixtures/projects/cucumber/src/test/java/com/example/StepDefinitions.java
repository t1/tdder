package com.example;

import io.cucumber.java.en.*;

public class StepDefinitions {

    @Given("a passing step")
    public void aPassingStep() {}

    @Given("a failing step")
    public void aFailingStep() {
        throw new AssertionError("scenario fails");
    }
}
