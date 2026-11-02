Feature: Explore: browsing and searching clips
  The list must stay fast and bounded on the full dataset, because the
  backend runs one SQLite query at a time and a slow list stalls every
  other endpoint.

  Scenario: The unfiltered list has an exact total
    When I request "/clips?page=1&limit=20"
    Then the response status is 200
    And the field "items" has 20 entries
    And the field "total" is greater than 200000
    And the field "totalCapped" is false
    And the response took less than 1500 ms

  Scenario: A search matching many clips reports a capped total
    When I request "/clips?search=casa&limit=20"
    Then the response status is 200
    And the field "items" has 20 entries
    And the field "total" equals 1000
    And the field "totalCapped" is true

  Scenario Outline: Search terms under 3 characters are ignored
    When I request "/clips?search=<term>&limit=20"
    Then the response status is 200
    And the field "total" is greater than 200000
    And the field "totalCapped" is false

    Examples:
      | term |
      | a    |
      | ca   |

  Scenario: A search with no match reports zero
    When I request "/clips?search=zzzzqqxx&limit=20"
    Then the response status is 200
    And the field "total" equals 0
    And the field "items" has 0 entries

  Scenario: Page size is clamped to 100
    When I request "/clips?limit=1000&page=1"
    Then the field "items" has 100 entries

  Scenario: Pages differ
    When I request "/clips?page=1&limit=20"
    And I remember the first clip id as "page1"
    And I request "/clips?page=2&limit=20"
    Then the first clip id differs from "page1"

  Scenario: Clip detail and its transcriptions load
    When I request "/clips?page=1&limit=1"
    And I request the first listed clip
    Then the response status is 200
    When I request the transcriptions of the first listed clip
    Then the response status is 200

  Scenario: An unknown clip is a 404
    When I request "/clips/does-not-exist"
    Then the response status is 404

  Scenario: Every API response carries the deployed version
    When I request "/votes/stats"
    Then the response header "x-app-version" matches "^[0-9a-f]{8}$"
