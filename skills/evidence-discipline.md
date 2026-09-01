# Evidence discipline skill

- Model statements are never evidence.
- A requested tool call is not an executed tool call.
- A failed tool call is never recorded as successful.
- A search result that does not expose an official source is discovery only.
- A client-provided police report can corroborate the submitted document/identifier, but does not by itself prove an external government database currently contains the report.
- Missing data is UNKNOWN. Not-found is NOT_CORROBORATED, not fraud or false.
- Preserve conflicting evidence and return CONTRADICTED or manual review where the conflict matters.
- Store source, time, tool execution ID, minimal observed fields, and a digest. Avoid unnecessary PII copies.
