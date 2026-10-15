"""Download the BAMF question catalogue PDF and extract its text.

Usage: python3 tools/fetch_catalogue.py [--force]

Writes build/katalog.pdf and build/katalog.txt (pdftotext -layout). Skips the download when the
PDF is already there, unless --force is given. The PDF link is read from the catalogue page,
because BAMF bumps its version parameter with every new edition.
"""

import argparse
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from common import PDF, PDF_TEXT

PAGE = "https://www.bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/gesamtfragenkatalog-lebenindeutschland.html"
FALLBACK = (
    "https://www.bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/"
    "gesamtfragenkatalog-lebenindeutschland.pdf?__blob=publicationFile"
)
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) lebenindeutschland-trainer"


def download(url: str, tries: int = 4) -> bytes:
    """GET url with a few retries; bamf.de resets connections now and then."""
    delay = 2
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except OSError as e:
            if attempt == tries:
                raise
            print(f"  {url}: attempt {attempt} failed ({e!r}); retrying in {delay}s", file=sys.stderr)
            time.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")


def pdf_url() -> str:
    page = download(PAGE).decode("utf-8", "replace")
    m = re.search(r'href="([^"]*gesamtfragenkatalog-lebenindeutschland\.pdf\?__blob=publicationFile[^"]*)"', page, re.I)
    if not m:
        print(f"no PDF link on {PAGE}, using {FALLBACK}", file=sys.stderr)
        return FALLBACK
    return m.group(1).replace("&amp;", "&")


def extract_text(pdf: Path, out: Path) -> None:
    subprocess.run(["pdftotext", "-layout", str(pdf), str(out)], check=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="download again even if build/katalog.pdf exists")
    args = ap.parse_args()

    if args.force or not PDF.exists():
        url = pdf_url()
        print(f"downloading {url}")
        data = download(url)
        if not data.startswith(b"%PDF"):
            sys.exit(f"{url} did not return a PDF")
        PDF.parent.mkdir(parents=True, exist_ok=True)
        tmp = PDF.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(PDF)
        print(f"saved {PDF} ({len(data) // 1024} KiB)")
    if args.force or not PDF_TEXT.exists() or PDF_TEXT.stat().st_mtime < PDF.stat().st_mtime:
        extract_text(PDF, PDF_TEXT)
        print(f"extracted {PDF_TEXT}")


if __name__ == "__main__":
    main()
