@writes
Feature: Evaluating clips and voting
  Writes production data under a dedicated test username and always removes
  it afterwards. Only clips nobody has voted on are used, so a single vote can
  never push a clip to "validated" (net votes >= 2). Dialect clips usually carry
  system votes, so the dialect scenario casts a downvote, which can never
  help a clip reach the threshold.

  Scenario: The evaluate flow serves a clip with audio for each dimension
    When I ask for the next untouched clip to evaluate for "transcription"
    And I ask for the next untouched clip to evaluate for "gender"
    And I ask for the next untouched clip to evaluate for "dialect"
    Then every picked clip has indexed audio

  Scenario: Voting on a transcription stores the real target and can be changed
    Given the next untouched clip to evaluate for "transcription"
    When I vote 1 for the first transcription of the "transcription" clip
    Then the response status is 201
    And the stored vote targets the first transcription
    When I vote -1 for the first transcription of the "transcription" clip
    Then I have exactly 1 "transcription" vote on the "transcription" clip with value -1

  Scenario: Voting on gender is reflected and the clip is not served again
    Given the next untouched clip to evaluate for "gender"
    When I vote 1 for "female" on the "gender" clip
    Then the response status is 201
    And the summary of the "gender" clip shows net 1 for "gender" and not validated
    And the evaluate view of the "gender" clip lists my vote
    And the next clip to evaluate for "gender" is not the "gender" clip

  Scenario: A downvote on dialect is accepted
    Given the next untouched clip to evaluate for "dialect"
    When I vote -1 for "central" on the "dialect" clip
    Then the response status is 201
