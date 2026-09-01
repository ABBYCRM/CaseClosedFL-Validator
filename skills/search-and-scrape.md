# Search and scraping skill

1. If the authoritative URL is known, begin there or constrain discovery to its official domain.
2. Tavily/Exa/SerpAPI/DuckDuckGo are discovery/corroboration aids. Their snippets do not outrank the authoritative source.
3. Use Tavily/Exa extraction for readable static pages where available.
4. Use ScrapingBee for JavaScript rendering/extraction when a static retrieval cannot expose the public content.
5. Use Steel/read-only browser automation only when navigation or a JS form is genuinely needed.
6. Do not submit purchases, restricted-record requests, authentication bypasses, or CAPTCHA circumvention.
7. If the official source requires authorization not supplied by the lead, return AUTHORIZATION_REQUIRED.
