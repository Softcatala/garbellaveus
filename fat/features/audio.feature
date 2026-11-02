Feature: Audio proxy
  Clips are streamed from HuggingFace through the backend's cache.
  Each scenario reads one clip, so a full run adds only a couple of
  upstream fetches.

  Background:
    When I request "/clips?page=1&limit=1"

  Scenario: A range request returns a partial WAV
    When I request the audio of the first listed clip with range "bytes=0-99"
    Then the response status is 206
    And the audio body is 100 bytes starting with "RIFF"
    And the response header "cache-control" matches "max-age"

  Scenario: A full request returns the whole clip
    When I request the audio of the first listed clip
    Then the response status is 200
    And the audio body length equals its content-length header

  Scenario: An unknown clip is a 404 that must not be cached
    When I request the audio of clip "does-not-exist"
    Then the response status is 404
    And the response header "cache-control" matches "^no-store$"

  Scenario: An unsatisfiable range is a 416
    When I request the audio of the first listed clip with range "bytes=99999999-"
    Then the response status is 416
