Feature: Static site and branding
  The frontend is served with the GarbellaVeus logo and favicons.

  Scenario Outline: Site files are served with the right type
    When I fetch the site path "<path>"
    Then the response status is 200
    And the response content type contains "<type>"

    Examples:
      | path                | type      |
      | /                   | text/html |
      | /logo.svg           | image/svg |
      | /favicon.svg        | image/svg |
      | /favicon-32.png     | image/png |
      | /favicon-192.png    | image/png |
      | /apple-touch-icon.png | image/png |

  Scenario Outline: Client-side routes fall back to the app shell
    When I fetch the site path "<path>"
    Then the response status is 200
    And the response content type contains "text/html"

    Examples:
      | path        |
      | /llista     |
      | /avalua     |
      | /quant-a    |
      | /pautes     |
      | /list       |
      | /evaluate   |

  Scenario: The page links the SVG and PNG favicons
    When I fetch the site path "/"
    Then the response body contains 'rel="icon" href="/favicon.svg"'
    And the response body contains 'rel="icon" href="/favicon-32.png"'
    And the response body contains 'rel="apple-touch-icon" href="/apple-touch-icon.png"'

  Scenario: The header logo is the official artwork
    When I fetch the site path "/logo.svg"
    Then the response body is identical to "https://www.softcatala.org/uploads/2026/09/garbellaveus.svg"

  Scenario: The deployed build is the expected one
    # Only enforced when FAT_EXPECTED_VERSION is set (short commit SHA).
    When I request "/votes/stats"
    Then the deployed version matches the expected version
