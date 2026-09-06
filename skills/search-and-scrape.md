# Search and scraping skill

1. If the authoritative URL is known, begin there or constrain discovery to its official domain (`site:<officialHost>` plus the jurisdiction `source.url`). Do not invent portals.
2. Tavily/Exa/SerpAPI/DuckDuckGo are discovery/corroboration aids. Their snippets do not outrank the authoritative source.
3. Use Tavily/Exa extraction for readable static pages where available. If Composio is down, use the keyed direct Exa/Tavily search APIs.
4. Use Firecrawl, ScrapingBee, or Scrapfly for JavaScript rendering/extraction when a static retrieval cannot expose the public content.
5. Prefer Composio `browser_tool` for JS navigation/public-record lookup. Use the direct Steel fallback (`STEEL_API_KEY`) only when Composio is unavailable and navigation or a JS form is genuinely needed. If Steel is not keyed, scrape the official source URL with Firecrawl or ScrapingBee.
5a. When an official source URL is being checked (WEB_EXTRACT / JS_BROWSER / PUBLIC_RECORD_LOOKUP), capture the page with signed ScreenshotOne (`direct:screenshotone.capture`) if keys are present. OCR the image with NVIDIA vision. Record only text visible in the screenshot as `OFFICIAL_SOURCE_SCREENSHOT_OBSERVED`. Do not treat OCR as government-record truth.
6. Do not submit purchases, restricted-record requests, authentication bypasses, or CAPTCHA circumvention.
7. If the official source requires authorization not supplied by the lead, return AUTHORIZATION_REQUIRED.
