"""Upload validation for the screening endpoint.

Three gaps the spec requires closing, none of which FastAPI supplies:

  * No type check. A text/plain upload used to return 201: the mock provider
    swallowed the decode failure and reported brightness 0.0, so the caller got
    a "successful" screening for a file that was not an image. Under the real
    provider an undecodable upload surfaced as a 503 "model unavailable", which
    the frontend showed as a service outage rather than a bad file.
  * No size cap. Starlette's 1MB `max_part_size` applies only to non-file form
    fields, so a 28MB JPEG was accepted and fully buffered in memory.
  * Content-Type is client-controlled, so it is checked AND the leading bytes
    are sniffed; a mismatch between the two is itself rejected.
"""

from __future__ import annotations

from fastapi import HTTPException, UploadFile

# Leading-byte signatures for the formats a browser can realistically produce
# from a camera capture or a photo library.
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
)


def _sniff(head: bytes) -> str | None:
    for signature, media_type in _MAGIC:
        if head.startswith(signature):
            return media_type
    # RIFF....WEBP
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    # ISO-BMFF: ....ftyp<brand>; HEIC/HEIF and also AVIF.
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"):
            return "image/heic"
        if brand in (b"avif", b"avis"):
            return "image/avif"
    return None


async def read_image_upload(
    upload: UploadFile,
    *,
    max_bytes: int,
    allowed_types: list[str],
) -> tuple[bytes, str]:
    """Read and validate an uploaded image. Returns `(bytes, sniffed_type)`.

    Raises HTTPException with a 4xx the client can act on -- never a 5xx, and
    never a success for something that is not an image.
    """
    declared = (upload.content_type or "").split(";")[0].strip().lower()
    if declared and declared not in allowed_types:
        raise HTTPException(
            415,
            f"Unsupported image type '{declared}'. Allowed: {', '.join(allowed_types)}.",
        )

    # Read with one byte of headroom so an oversized file is detected without
    # buffering the whole thing.
    payload = await upload.read(max_bytes + 1)
    if not payload:
        raise HTTPException(400, "Empty image upload.")
    if len(payload) > max_bytes:
        raise HTTPException(
            413,
            f"Image is larger than the {max_bytes // (1024 * 1024)}MB limit. "
            "Retake the photo or reduce its resolution.",
        )

    sniffed = _sniff(payload[:16])
    if sniffed is None:
        raise HTTPException(
            415,
            "That file is not a recognised image (expected JPEG, PNG, WebP or HEIC).",
        )
    if sniffed not in allowed_types:
        raise HTTPException(415, f"Unsupported image type '{sniffed}'.")
    if declared and declared != sniffed and not _compatible(declared, sniffed):
        raise HTTPException(
            415,
            f"Upload claims to be '{declared}' but its contents are '{sniffed}'.",
        )
    return payload, sniffed


def _compatible(declared: str, sniffed: str) -> bool:
    """HEIC/HEIF are the same container; browsers disagree on the label."""
    heif = {"image/heic", "image/heif"}
    return declared in heif and sniffed in heif
