"""Bounded RSS/Atom parsing using Python's standard library; no network access."""
import html
from html.parser import HTMLParser
import json
import re
import sys
import xml.etree.ElementTree as ET
from xml.parsers import expat

ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
ATOM = "{http://www.w3.org/2005/Atom}"


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("p", "br", "div", "li"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value, limit=8000):
    parser = Text()
    parser.feed(str(value or "")[:100000])
    return re.sub(r"\s+", " ", html.unescape("".join(parser.parts))).strip()[:limit]


def text(node, *names):
    for name in names:
        child = node.find(name)
        if child is not None and child.text:
            return child.text.strip()
    return ""


def image(node):
    child = node.find(ITUNES + "image")
    return child.get("href", "") if child is not None else text(node, "image/url", ATOM + "logo", ATOM + "icon")


def duration(value):
    try:
        parts = str(value or "").strip().split(":")
        result = 0.0
        for part in parts:
            result = result * 60 + float(part)
        return result if 0 <= result <= 2592000 else 0
    except ValueError:
        return 0


def reject_doctype(*args):
    raise ValueError("DTD y entidades no admitidas")


def parse(data):
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("Feed demasiado grande")
    # Validate with DTDs disabled before building an ElementTree (including UTF-16 documents).
    validator = expat.ParserCreate()
    validator.StartDoctypeDeclHandler = reject_doctype
    validator.EntityDeclHandler = reject_doctype
    validator.ExternalEntityRefHandler = reject_doctype
    validator.Parse(data, True)
    root = ET.fromstring(data)
    channel = root.find("channel") if root.tag == "rss" else root if root.tag == ATOM + "feed" else None
    if channel is None:
        raise ValueError("Se requiere RSS 2.0 o Atom")
    title = plain(text(channel, "title", ATOM + "title"), 500)
    if not title:
        raise ValueError("El feed no tiene título")
    author = plain(text(channel, ITUNES + "author", "managingEditor", ATOM + "author/" + ATOM + "name"), 500)
    result = {"title": title, "author": author, "description": plain(text(channel, "description", ITUNES + "summary", ATOM + "subtitle")), "image": image(channel), "language": text(channel, "language"), "episodes": []}
    entries = channel.findall("item") if root.tag == "rss" else channel.findall(ATOM + "entry")
    for item in entries[:2000]:
        enclosure = item.find("enclosure")
        if enclosure is None:
            enclosure = next((link for link in item.findall(ATOM + "link") if link.get("rel") == "enclosure"), None)
        if enclosure is None:
            continue
        url = enclosure.get("url") or enclosure.get("href", "")
        mime = enclosure.get("type", "").lower().split(";")[0].strip()
        if not mime.startswith("audio/") and not (mime in ("", "application/octet-stream") and re.search(r"\.(mp3|m4a|aac|ogg|opus|wav)(?:\?|$)", url, re.I)):
            continue
        if not url:
            continue
        result["episodes"].append({
            "guid": text(item, "guid", ATOM + "id") or url,
            "title": plain(text(item, "title", ATOM + "title"), 500) or "Episodio",
            "description": plain(text(item, "description", ITUNES + "summary", "{http://purl.org/rss/1.0/modules/content/}encoded", ATOM + "summary", ATOM + "content")),
            "author": plain(text(item, ITUNES + "author", "author", ATOM + "author/" + ATOM + "name"), 500) or author,
            "image": image(item) or result["image"], "enclosureUrl": url, "mimeType": mime or "audio/mpeg",
            "duration": duration(text(item, ITUNES + "duration")),
            "publishedAt": text(item, "pubDate", ATOM + "published", ATOM + "updated"),
            "explicit": text(item, ITUNES + "explicit").lower() in ("yes", "true", "explicit"),
        })
    return result


if __name__ == "__main__":
    try:
        print(json.dumps(parse(sys.stdin.buffer.read(8 * 1024 * 1024 + 1)), ensure_ascii=False))
    except (ValueError, ET.ParseError, expat.ExpatError, RecursionError) as error:
        print(str(error)[:300], file=sys.stderr)
        sys.exit(1)
