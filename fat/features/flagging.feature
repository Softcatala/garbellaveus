@writes
Feature: Flagging clips as irrelevant
  One flag never hides a clip (two are needed). The test flags a clip with
  no other votes and retracts the flag through the public unflag endpoint.

  Scenario: A single flag is recorded without hiding the clip, and can be retracted
    Given the next untouched clip to evaluate for "gender"
    When I flag the "gender" clip as irrelevant because "no_speech"
    Then the response status is 201
    And the "gender" clip is not marked irrelevant
    When I retract my flag on the "gender" clip
    Then I have no "relevance" vote on the "gender" clip

  Scenario Outline: Invalid flags are rejected
    Given the next untouched clip to evaluate for "gender"
    When I send "POST" "<path>"
    Then the response status is 400

    Examples:
      | path                                                          |
      | /clips/{gender}/flag-irrelevant?username={user}&reason=bogus  |
      | /clips/{gender}/flag-irrelevant                               |
