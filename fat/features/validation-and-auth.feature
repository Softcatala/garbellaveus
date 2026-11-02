Feature: Input validation and access control
  Nothing here creates data: every request must be rejected.

  Scenario Outline: Malformed writes are rejected with 400
    When I send "<method>" "<path>" with JSON '<body>'
    Then the response status is 400

    Examples:
      | method | path                    | body                                                                    |
      | POST   | /votes                  | {"clipId":"x","dimension":"gender","targetId":"male","username":"{user}","value":5} |
      | POST   | /votes                  | {"clipId":"x","dimension":"gender","value":1}                           |
      | POST   | /issue-reports          | {"clipId":"x","dimension":"gender","message":"","username":"{user}"}    |
      | POST   | /issue-reports          | {"clipId":"x","dimension":"nope","message":"m","username":"{user}"}     |
      | POST   | /subscriptions/request  | {"email":"not-an-email","username":"{user}"}                            |

  Scenario Outline: Admin endpoints require the API key
    When I send "<method>" "<path>" without credentials
    Then the response status is 401 or 403

    Examples:
      | method | path                       |
      | DELETE | /votes?username={user}     |
      | POST   | /clips                     |
      | DELETE | /transcriptions/1          |
