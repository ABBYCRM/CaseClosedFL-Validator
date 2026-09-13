# Optional local sidecar for Holehe + h8mail only (compose --profile osint).
# Production / DigitalOcean App Platform uses the main Dockerfile, which bakes
# Holehe, PhoneInfoga, Mosint, and h8mail onto PATH. Prefer that image.
# Missing host binaries remain a soft-fail. See docs/OSINT_IDENTITY_SETUP.md.
FROM python:3.12-slim-bookworm
RUN pip install --no-cache-dir holehe==1.61 h8mail==2.5.6
WORKDIR /work
# No default entrypoint — adapters pass --entrypoint holehe|h8mail.
CMD ["holehe","--help"]
