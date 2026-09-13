# Optional free OSINT CLI image (Holehe + h8mail).
# Not used by the default Node build. Missing from host PATH is a soft-fail.
# PhoneInfoga / Mosint: install official binaries or set *_DOCKER_IMAGE (see docs/OSINT_IDENTITY_SETUP.md).
FROM python:3.12-slim-bookworm
RUN pip install --no-cache-dir holehe h8mail
WORKDIR /work
# No default entrypoint — adapters pass --entrypoint holehe|h8mail.
CMD ["holehe","--help"]
